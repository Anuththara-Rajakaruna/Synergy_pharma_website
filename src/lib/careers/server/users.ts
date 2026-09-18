// Admin accounts: sign-in with lockout, user management and password changes. Used by the admin
// API routes and by scripts/admin-user.ts (which passes a null actor), so this module must not
// import Next.js request APIs.
//
// Concurrency note for the Google Sheets store. MongoDB gave two guarantees this module relied
// on: a unique index on the email address, and an atomic read-modify-write for the failed-login
// counter. Neither exists here, so every read-check-write that used to depend on them runs
// inside withLock() for the account in question and re-reads the row from Google (maxAgeMs 0, or
// refreshOnMiss when the question is "does this row exist at all?") before deciding anything.
// The lock is per process: two requests served by the same warm instance are ordered exactly as
// before, while requests spread across serverless instances are only bounded by the fresh
// re-read. That is weaker than a unique index, so account creation additionally reconciles after
// the append (reconcileDuplicate: the earliest row wins), and the lockout counter can in the
// worst case lose an increment across instances - it is an upper bound on guesses per instance
// rather than a global guarantee.

import { generateTemporaryPassword, hashPassword, verifyDummyPassword, verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  destroyUserSessions,
  toAuditActor,
  toSessionUser,
  type AdminContext,
} from "@/lib/auth/session";
import { ADMIN_ROLE_LABELS, type AdminRole } from "@/lib/careers/constants";
import { recordAudit } from "@/lib/careers/server/audit";
import { isRecordId, newId } from "@/lib/careers/server/ids";
import type { AdminUserRecord, AuditActor } from "@/lib/careers/server/records";
import {
  isAdminRole,
  normalizeEmail,
  validateEmail,
  validatePassword,
  validatePersonName,
  type FieldErrors,
} from "@/lib/careers/validation";
import { AppError, badRequest, conflict, notFound, unauthorized } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { ensureStoreReady, reconcileDuplicate, withLock, withLocks, type RecordValues } from "@/lib/sheets-db";
import {
  countActiveAdmins,
  findAdminUserByEmail,
  findAdminUserById,
  findAdminUserForAuth,
  insertAdminUser as appendAdminUserRow,
  listAdminUsers as loadAdminUsers,
  patchAdminUser,
  type SafeAdminUser,
} from "@/lib/sheets-db/repositories/admin";
import type { AdminSessionUser, AdminUserInfo } from "@/types/careers";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// One lock per account, keyed by whichever identifier the caller has. Creation is keyed by the
// normalised email (the unique key being claimed); everything else is keyed by the record id.
function accountLockKey(emailOrId: string): string {
  return `admin-user:${emailOrId}`;
}

// Guards the "there is always at least one active administrator" rule, which spans accounts and
// therefore cannot be protected by a per-account lock.
const ACTIVE_ADMINS_LOCK = "admin-users:active-admins";

// Oldest first with the id as the tie-breaker - the {createdAt: 1, _id: 1} sort the index used
// to provide. This is compareByDateAsc from mappers.ts, repeated here rather than imported:
// mappers.ts reaches next/server through the email outbox, and this module has to stay usable
// from scripts/admin-user.ts.
function byCreatedAtAsc(a: SafeAdminUser, b: SafeAdminUser): number {
  const diff = a.createdAt.getTime() - b.createdAt.getTime();
  return diff !== 0 ? diff : a.id.localeCompare(b.id);
}

type ClientMeta = { ip: string; userAgent: string | null };

type AdminUserInfoSource = Pick<
  AdminUserRecord,
  "id" | "email" | "name" | "role" | "active" | "mustChangePassword" | "lastLoginAt" | "lockedUntil" | "createdAt"
>;

export function toAdminUserInfo(doc: AdminUserInfoSource, now: Date = new Date()): AdminUserInfo {
  return {
    id: doc.id,
    email: doc.email,
    name: doc.name,
    role: doc.role,
    active: doc.active,
    mustChangePassword: doc.mustChangePassword,
    lastLoginAt: doc.lastLoginAt ? doc.lastLoginAt.toISOString() : null,
    // Only a lock that is still in force is reported.
    lockedUntil: doc.lockedUntil && doc.lockedUntil.getTime() > now.getTime() ? doc.lockedUntil.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

function actorFor(actor: AdminContext | null): AuditActor | null {
  return actor ? toAuditActor(actor) : null;
}

function sourceSuffix(actor: AdminContext | null): string {
  return actor ? "" : " (command line)";
}

function firstError(errors: FieldErrors): string {
  return Object.values(errors)[0] ?? "Some of the submitted values are invalid.";
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

export type AuthenticationResult = { user: AdminSessionUser; token: string; expiresAt: Date };

function invalidCredentials(): AppError {
  return new AppError(401, "invalid_credentials", "Invalid email or password.");
}

function accountLocked(lockedUntil: Date, now: Date): AppError {
  const seconds = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return new AppError(
    429,
    "account_locked",
    `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    { headers: { "Retry-After": String(seconds) } }
  );
}

// Counts one wrong password and locks the account once the limit is reached, returning the lock
// that is now in force (or null). MongoDB did this with a single aggregation-pipeline
// findOneAndUpdate that no two guesses could interleave. Here the whole read-check-write runs
// under the account lock and re-reads the row with maxAgeMs 0 first, so parallel guesses served
// by one instance still count exactly; guesses spread across instances are bounded by the fresh
// re-read rather than guaranteed by it.
async function registerFailedAttempt(user: AdminUserRecord, normalisedEmail: string, now: Date): Promise<Date | null> {
  return withLock(accountLockKey(normalisedEmail), async () => {
    const current = (await findAdminUserById(user.id, { maxAgeMs: 0 })) ?? user;
    const attempts = Math.max(0, current.failedLoginAttempts) + 1;

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(now.getTime() + LOCKOUT_MS);
      // The counter restarts after each lock, exactly as the old update pipeline did.
      await patchAdminUser(user.id, { failedLoginAttempts: 0, lockedUntil, updatedAt: new Date() });
      return lockedUntil;
    }

    await patchAdminUser(user.id, { failedLoginAttempts: attempts, updatedAt: new Date() });
    // An earlier lock is left untouched, and reported if it somehow still applies.
    return current.lockedUntil && current.lockedUntil.getTime() > now.getTime() ? current.lockedUntil : null;
  });
}

// Every outcome performs one scrypt verification and one audit write, so response times do not
// reveal whether an account exists, is locked, or had the wrong password.
export async function authenticateAdmin(email: string, password: string, meta: ClientMeta): Promise<AuthenticationResult> {
  ensureStoreReady();
  const now = new Date();
  const normalisedEmail = normalizeEmail(email);

  // findAdminUserForAuth re-reads the tab when the cached copy has no match, so an account
  // created moments ago on another instance is not treated as unknown. An inactive account stays
  // indistinguishable from a missing one.
  const found = await findAdminUserForAuth(normalisedEmail);
  const user = found && found.active ? found : null;

  if (!user) {
    await verifyDummyPassword(password);
    await recordAudit({
      actor: null,
      action: "auth.login_failed",
      entityType: "admin_user",
      entityId: "unknown",
      summary: "Failed sign-in attempt for an unknown or inactive account",
      meta: { reason: "unknown_account" },
      ip: meta.ip,
    });
    throw invalidCredentials();
  }

  const userId = user.id;

  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    await verifyPassword(password, user.passwordHash);
    await recordAudit({
      actor: null,
      action: "auth.login_failed",
      entityType: "admin_user",
      entityId: userId,
      summary: `Sign-in refused for ${user.name}: account temporarily locked`,
      meta: { userId, reason: "locked" },
      ip: meta.ip,
    });
    throw accountLocked(user.lockedUntil, now);
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const locked = await registerFailedAttempt(user, normalisedEmail, now);

    await recordAudit({
      actor: null,
      action: "auth.login_failed",
      entityType: "admin_user",
      entityId: userId,
      summary: locked
        ? `Failed sign-in attempt for ${user.name}; account locked for ${LOCKOUT_MS / 60000} minutes`
        : `Failed sign-in attempt for ${user.name}`,
      meta: { userId, reason: locked ? "wrong_password_locked" : "wrong_password" },
      ip: meta.ip,
    });
    if (locked) throw accountLocked(locked, now);
    throw invalidCredentials();
  }

  await patchAdminUser(userId, { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now });
  const session = await createSession(userId, meta);
  const sessionUser = toSessionUser(user);
  await recordAudit({
    actor: { user: userId, email: user.email, name: user.name, role: user.role },
    action: "auth.login",
    entityType: "admin_user",
    entityId: userId,
    summary: `${user.name} signed in`,
    ip: meta.ip,
  });
  return { user: sessionUser, token: session.token, expiresAt: session.expiresAt };
}

// ── User management ──────────────────────────────────────────────────────────

export async function listAdminUsers(): Promise<AdminUserInfo[]> {
  ensureStoreReady();
  const users = await loadAdminUsers();
  // A single `now` is shared so the whole page agrees on which locks are still in force.
  const now = new Date();
  return [...users].sort(byCreatedAtAsc).map((user) => toAdminUserInfo(user, now));
}

export async function getAdminUserByEmail(email: string): Promise<AdminUserInfo | null> {
  ensureStoreReady();
  // Deliberately not filtered on `active`, so the CLI can find and reactivate a disabled account.
  const user = await findAdminUserByEmail(normalizeEmail(email));
  return user ? toAdminUserInfo(user) : null;
}

type NewAdminUser = { email: string; name: string; role: AdminRole };

function parseNewAdminUser(input: unknown): NewAdminUser {
  const body = asRecord(input);
  if (!body) throw badRequest("Invalid request body.");
  const errors: FieldErrors = {};
  const email = normalizeEmail(validateEmail(typeof body.email === "string" ? body.email : undefined, errors));
  const name = validatePersonName(typeof body.name === "string" ? body.name : undefined, errors);
  if (!isAdminRole(body.role)) errors.role = "Choose a role.";
  if (Object.keys(errors).length > 0) throw badRequest(firstError(errors), errors);
  return { email, name, role: body.role as AdminRole };
}

function duplicateEmail(): AppError {
  return new AppError(409, "duplicate_email", "An account with this email address already exists.", {
    fields: { email: "An account with this email address already exists." },
  });
}

function emailKeyOf(values: RecordValues): string | null {
  const email = String(values.email ?? "").trim().toLowerCase();
  return email || null;
}

// Retires a row that lost the race for an email address. It can never be signed in to (inactive,
// and with no usable hash) and it can never be the account the address resolves to, because a
// lookup by email takes the earliest matching row - the winner. It stays visible in the user
// list so an operator can tidy the spreadsheet.
async function retireDuplicateRow(id: string, winnerId: string): Promise<void> {
  await patchAdminUser(id, {
    active: false,
    passwordHash: "",
    mustChangePassword: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    updatedAt: new Date(),
  });
  logger.warn("user.duplicate_email_reconciled", { keptUserId: winnerId, retiredUserId: id });
}

async function insertAdminUser(
  values: NewAdminUser,
  password: string,
  mustChangePassword: boolean,
  actor: AdminContext | null
): Promise<AdminUserInfo> {
  ensureStoreReady();
  // Hashing is deliberately outside the lock: scrypt takes ~100 ms and touches no shared state.
  const passwordHash = await hashPassword(password);
  const now = new Date();

  // The unique index on email is gone. The lock orders creates for the same address on this
  // instance, the refreshOnMiss re-read closes the window where a row written elsewhere is not
  // yet in this instance's cached copy, and reconcileDuplicate settles what is left after the
  // append: the earliest row wins, and the loser reports the same 409 the duplicate-key error
  // used to. Cross-instance races are therefore bounded rather than prevented.
  const created = await withLock(accountLockKey(values.email), async () => {
    const existing = await findAdminUserByEmail(values.email, { refreshOnMiss: true });
    if (existing) return null;

    const user: AdminUserRecord = {
      id: newId(now),
      email: values.email,
      name: values.name,
      role: values.role,
      passwordHash,
      active: true,
      mustChangePassword,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: now,
      createdBy: actor?.userId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const appended = await appendAdminUserRow(user);
    const { isDuplicate, winner } = await reconcileDuplicate("AdminUsers", appended, emailKeyOf);
    if (isDuplicate) {
      await retireDuplicateRow(user.id, String(winner.values.id ?? ""));
      return null;
    }
    return user;
  });

  if (!created) throw duplicateEmail();

  await recordAudit({
    actor: actorFor(actor),
    action: "user.create",
    entityType: "admin_user",
    entityId: created.id,
    summary: `Created ${ADMIN_ROLE_LABELS[values.role]} account for ${values.name}${sourceSuffix(actor)}`,
    meta: { role: values.role, source: actor ? "admin" : "cli" },
    ip: actor?.ip ?? null,
  });
  return toAdminUserInfo(created, now);
}

// Creates an account with a generated temporary password that must be changed at first sign-in.
export async function createAdminUser(
  input: unknown,
  actor: AdminContext | null
): Promise<{ user: AdminUserInfo; temporaryPassword: string }> {
  const values = parseNewAdminUser(input);
  const temporaryPassword = generateTemporaryPassword();
  const user = await insertAdminUser(values, temporaryPassword, true, actor);
  return { user, temporaryPassword };
}

// Creates an account with a password chosen by the operator (command-line bootstrap).
export async function createAdminUserWithPassword(input: unknown, password: string, actor: AdminContext | null): Promise<AdminUserInfo> {
  const values = parseNewAdminUser(input);
  const errors: FieldErrors = {};
  const checked = validatePassword(password, errors, "password");
  if (Object.keys(errors).length > 0) throw badRequest(firstError(errors), errors);
  return insertAdminUser(values, checked, false, actor);
}

type AdminUserPatch = { name?: string; role?: AdminRole; active?: boolean };

function parseAdminUserPatch(input: unknown): AdminUserPatch {
  const body = asRecord(input);
  if (!body) throw badRequest("Invalid request body.");
  const errors: FieldErrors = {};
  const patch: AdminUserPatch = {};
  if (body.name !== undefined) {
    patch.name = validatePersonName(typeof body.name === "string" ? body.name : undefined, errors);
  }
  if (body.role !== undefined) {
    if (isAdminRole(body.role)) patch.role = body.role;
    else errors.role = "Choose a role.";
  }
  if (body.active !== undefined) {
    if (typeof body.active === "boolean") patch.active = body.active;
    else errors.active = "Invalid account status.";
  }
  if (Object.keys(errors).length > 0) throw badRequest(firstError(errors), errors);
  if (patch.name === undefined && patch.role === undefined && patch.active === undefined) {
    throw badRequest("Nothing to update.");
  }
  return patch;
}

function lastAdminError(): AppError {
  return conflict("At least one active administrator account is required.", "last_admin");
}

async function countOtherActiveAdmins(userId: string): Promise<number> {
  const users = await loadAdminUsers({ maxAgeMs: 0 });
  return users.filter((user) => user.role === "admin" && user.active && user.id !== userId).length;
}

// Updates name, role and/or active status. Admins cannot deactivate or demote themselves, and
// the last active administrator cannot be deactivated or demoted by anyone.
export async function updateAdminUser(id: string, patchInput: unknown, actor: AdminContext | null): Promise<AdminUserInfo> {
  if (!isRecordId(id)) throw notFound("User not found.", "user_not_found");
  const patch = parseAdminUserPatch(patchInput);
  ensureStoreReady();

  // Two locks: the account being edited, and the administrator head-count this edit can change.
  // withLocks always takes them in sorted order, so two concurrent edits cannot deadlock.
  return withLocks([accountLockKey(id), ACTIVE_ADMINS_LOCK], async () => {
    const existing = await findAdminUserById(id, { maxAgeMs: 0, refreshOnMiss: true });
    if (!existing) throw notFound("User not found.", "user_not_found");

    const roleChanges = patch.role !== undefined && patch.role !== existing.role;
    const activeChanges = patch.active !== undefined && patch.active !== existing.active;
    const nameChanges = patch.name !== undefined && patch.name !== existing.name;

    if (actor && actor.user.id === id) {
      if (activeChanges && patch.active === false) {
        throw badRequest("You can't deactivate your own account.", undefined, "cannot_modify_self");
      }
      if (roleChanges) throw badRequest("You can't change your own role.", undefined, "cannot_modify_self");
    }

    if (!roleChanges && !activeChanges && !nameChanges) return toAdminUserInfo(existing);

    const removesAdmin =
      existing.role === "admin" &&
      existing.active &&
      ((activeChanges && patch.active === false) || (roleChanges && patch.role !== "admin"));
    if (removesAdmin && (await countOtherActiveAdmins(id)) === 0) throw lastAdminError();

    const now = new Date();
    const changed: Partial<AdminUserRecord> = { updatedAt: now };
    if (nameChanges) changed.name = patch.name;
    if (roleChanges) changed.role = patch.role;
    if (activeChanges) changed.active = patch.active;

    if (!(await patchAdminUser(id, changed))) throw notFound("User not found.", "user_not_found");

    // There is no "return the document after the update" here; the updated record is the row we
    // just read plus the fields we just wrote, which is the same thing.
    const updated: SafeAdminUser = {
      ...existing,
      name: changed.name ?? existing.name,
      role: changed.role ?? existing.role,
      active: changed.active ?? existing.active,
      updatedAt: now,
    };

    if (removesAdmin && (await countActiveAdmins({ maxAgeMs: 0 })) === 0) {
      // Two administrators demoted each other at the same moment: undo this change.
      await patchAdminUser(id, { role: existing.role, active: existing.active, updatedAt: new Date() });
      throw lastAdminError();
    }

    if (activeChanges && patch.active === false) await destroyUserSessions(id);

    const changes: string[] = [];
    if (nameChanges) changes.push("name updated");
    if (roleChanges) changes.push(`role ${ADMIN_ROLE_LABELS[existing.role]} → ${ADMIN_ROLE_LABELS[updated.role]}`);
    if (activeChanges) changes.push(updated.active ? "reactivated" : "deactivated");
    await recordAudit({
      actor: actorFor(actor),
      action: "user.update",
      entityType: "admin_user",
      entityId: id,
      summary: `Updated ${updated.name}'s account: ${changes.join(", ")}${sourceSuffix(actor)}`,
      meta: {
        ...(roleChanges ? { role: { from: existing.role, to: updated.role } } : {}),
        ...(activeChanges ? { active: { from: existing.active, to: updated.active } } : {}),
        ...(nameChanges ? { nameChanged: true } : {}),
        source: actor ? "admin" : "cli",
      },
      ip: actor?.ip ?? null,
    });

    return toAdminUserInfo(updated);
  });
}

async function replacePassword(
  id: string,
  password: string,
  mustChangePassword: boolean,
  actor: AdminContext | null
): Promise<void> {
  if (!isRecordId(id)) throw notFound("User not found.", "user_not_found");
  if (actor && actor.user.id === id) {
    throw badRequest("Use Change password to update your own password.", undefined, "cannot_modify_self");
  }
  ensureStoreReady();
  const passwordHash = await hashPassword(password);
  const now = new Date();

  // Under the account lock so a reset cannot interleave with a failed-attempt increment and lose
  // the unlock; refreshOnMiss so an account created on another instance is not reported missing.
  const updated = await withLock(accountLockKey(id), async () => {
    const existing = await findAdminUserById(id, { maxAgeMs: 0, refreshOnMiss: true });
    if (!existing) return null;
    // A password reset also clears an active lockout.
    const written = await patchAdminUser(id, {
      passwordHash,
      mustChangePassword,
      passwordChangedAt: now,
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: now,
    });
    return written ? existing : null;
  });
  if (!updated) throw notFound("User not found.", "user_not_found");

  // Whoever held the old password (or a session opened with it) is signed out everywhere.
  await destroyUserSessions(id);
  await recordAudit({
    actor: actorFor(actor),
    action: "user.reset_password",
    entityType: "admin_user",
    entityId: id,
    summary: `Reset the password for ${updated.name}${sourceSuffix(actor)}`,
    meta: { temporary: mustChangePassword, source: actor ? "admin" : "cli" },
    ip: actor?.ip ?? null,
  });
}

// Issues a new temporary password; the user must change it at the next sign-in.
export async function resetAdminPassword(id: string, actor: AdminContext | null): Promise<{ temporaryPassword: string }> {
  const temporaryPassword = generateTemporaryPassword();
  await replacePassword(id, temporaryPassword, true, actor);
  return { temporaryPassword };
}

// Sets a password chosen by the operator (command line only).
export async function setAdminPassword(id: string, password: string, actor: AdminContext | null): Promise<void> {
  const errors: FieldErrors = {};
  const checked = validatePassword(password, errors, "password");
  if (Object.keys(errors).length > 0) throw badRequest(firstError(errors), errors);
  await replacePassword(id, checked, false, actor);
}

// ── Own password ─────────────────────────────────────────────────────────────

export async function changeOwnPassword(ctx: AdminContext, current: unknown, next: unknown): Promise<void> {
  const errors: FieldErrors = {};
  const currentPassword = typeof current === "string" ? current : "";
  if (!currentPassword) errors.currentPassword = "Enter your current password.";
  const newPassword = validatePassword(next, errors, "newPassword");
  if (Object.keys(errors).length > 0) throw badRequest(firstError(errors), errors);
  if (newPassword === currentPassword) {
    const message = "Choose a new password that is different from your current password.";
    throw badRequest(message, { newPassword: message });
  }

  // A stolen session must not become an unlimited password-guessing oracle.
  await enforceRateLimit(
    "password-user",
    ctx.user.id,
    RATE_LIMITS["password-user"],
    "Too many password change attempts. Please wait before trying again."
  );

  ensureStoreReady();
  // findAdminUserForAuth is the only reader that returns the stored hash, and it looks up by
  // address; an account's email never changes, so the session's address still identifies the
  // same row. The id is compared as well, so a mismatch fails closed like a missing account.
  const user = await findAdminUserForAuth(ctx.user.email);
  if (!user || !user.active || user.id !== ctx.userId) {
    throw unauthorized("Your session has expired. Please sign in again.");
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    const message = "Your current password is incorrect.";
    throw badRequest(message, { currentPassword: message }, "invalid_current_password");
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();
  // Deliberately leaves failedLoginAttempts and lockedUntil alone, unlike an admin reset.
  await patchAdminUser(user.id, { passwordHash, mustChangePassword: false, passwordChangedAt: now, updatedAt: now });
  // Keep this browser signed in; every other session of the account ends.
  await destroyUserSessions(user.id, ctx.sessionId);
  await recordAudit({
    actor: toAuditActor(ctx),
    action: "auth.password_change",
    entityType: "admin_user",
    entityId: ctx.user.id,
    summary: `${ctx.user.name} changed their password`,
    ip: ctx.ip,
  });
}
