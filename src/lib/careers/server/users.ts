// Admin accounts: sign-in with lockout, user management and password changes. Used by the admin
// API routes and by scripts/admin-user.ts (which passes a null actor), so this module must not
// import Next.js request APIs.

import type { Types } from "mongoose";
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
import { isObjectIdString, toObjectId } from "@/lib/careers/server/ids";
import {
  isAdminRole,
  normalizeEmail,
  validateEmail,
  validatePassword,
  validatePersonName,
  type FieldErrors,
} from "@/lib/careers/validation";
import { AppError, badRequest, conflict, notFound, unauthorized } from "@/lib/http/errors";
import { connectToDatabase, isDuplicateKeyError } from "@/lib/mongodb";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { AuditActor } from "@/models/audit-log";
import { AdminUserModel, type AdminUserDoc } from "@/models/admin-user";
import type { AdminSessionUser, AdminUserInfo } from "@/types/careers";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

type ClientMeta = { ip: string; userAgent: string | null };

type AdminUserInfoSource = Pick<
  AdminUserDoc,
  "_id" | "email" | "name" | "role" | "active" | "mustChangePassword" | "lastLoginAt" | "lockedUntil" | "createdAt"
>;

const USER_INFO_PROJECTION = {
  email: 1,
  name: 1,
  role: 1,
  active: 1,
  mustChangePassword: 1,
  lastLoginAt: 1,
  lockedUntil: 1,
  createdAt: 1,
} as const;

export function toAdminUserInfo(doc: AdminUserInfoSource, now: Date = new Date()): AdminUserInfo {
  return {
    id: String(doc._id),
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

// Every outcome performs one scrypt verification and one audit write, so response times do not
// reveal whether an account exists, is locked, or had the wrong password.
export async function authenticateAdmin(email: string, password: string, meta: ClientMeta): Promise<AuthenticationResult> {
  await connectToDatabase();
  const now = new Date();

  const user = await AdminUserModel.findOne({ email: normalizeEmail(email), active: true })
    .select("+passwordHash")
    .lean();

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

  const userId = String(user._id);

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
    const lockUntil = new Date(now.getTime() + LOCKOUT_MS);
    const reachedLimit = { $gte: ["$failedLoginAttempts", MAX_FAILED_ATTEMPTS] };
    // Increment and (at the limit) lock in one atomic update so parallel guesses all count.
    const updated = await AdminUserModel.findOneAndUpdate(
      { _id: user._id },
      [
        { $set: { failedLoginAttempts: { $add: [{ $ifNull: ["$failedLoginAttempts", 0] }, 1] } } },
        {
          $set: {
            lockedUntil: { $cond: [reachedLimit, lockUntil, "$lockedUntil"] },
            failedLoginAttempts: { $cond: [reachedLimit, 0, "$failedLoginAttempts"] },
          },
        },
      ],
      { returnDocument: "after", updatePipeline: true }
    )
      .select({ lockedUntil: 1 })
      .lean();
    const locked = updated?.lockedUntil && updated.lockedUntil.getTime() > now.getTime() ? updated.lockedUntil : null;

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

  await AdminUserModel.updateOne(
    { _id: user._id },
    { $set: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now } }
  );
  const session = await createSession(user._id, meta);
  const sessionUser = toSessionUser(user);
  await recordAudit({
    actor: { user: user._id, email: user.email, name: user.name, role: user.role },
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
  await connectToDatabase();
  const docs = await AdminUserModel.find({}).select(USER_INFO_PROJECTION).sort({ createdAt: 1, _id: 1 }).lean();
  const now = new Date();
  return docs.map((doc) => toAdminUserInfo(doc, now));
}

export async function getAdminUserByEmail(email: string): Promise<AdminUserInfo | null> {
  await connectToDatabase();
  const doc = await AdminUserModel.findOne({ email: normalizeEmail(email) }).select(USER_INFO_PROJECTION).lean();
  return doc ? toAdminUserInfo(doc) : null;
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

async function insertAdminUser(
  values: NewAdminUser,
  password: string,
  mustChangePassword: boolean,
  actor: AdminContext | null
): Promise<AdminUserInfo> {
  await connectToDatabase();
  if (await AdminUserModel.exists({ email: values.email })) throw duplicateEmail();

  const now = new Date();
  let created: AdminUserDoc;
  try {
    const doc = await AdminUserModel.create({
      email: values.email,
      name: values.name,
      role: values.role,
      passwordHash: await hashPassword(password),
      active: true,
      mustChangePassword,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: now,
      createdBy: actor?.userId ?? null,
    });
    created = doc.toObject();
  } catch (err) {
    if (isDuplicateKeyError(err)) throw duplicateEmail();
    throw err;
  }

  await recordAudit({
    actor: actorFor(actor),
    action: "user.create",
    entityType: "admin_user",
    entityId: String(created._id),
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

async function countOtherActiveAdmins(userId: Types.ObjectId): Promise<number> {
  return AdminUserModel.countDocuments({ role: "admin", active: true, _id: { $ne: userId } });
}

// Updates name, role and/or active status. Admins cannot deactivate or demote themselves, and
// the last active administrator cannot be deactivated or demoted by anyone.
export async function updateAdminUser(id: string, patchInput: unknown, actor: AdminContext | null): Promise<AdminUserInfo> {
  if (!isObjectIdString(id)) throw notFound("User not found.", "user_not_found");
  const patch = parseAdminUserPatch(patchInput);
  await connectToDatabase();

  const userId = toObjectId(id);
  const existing = await AdminUserModel.findById(userId).select(USER_INFO_PROJECTION).lean();
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
  if (removesAdmin && (await countOtherActiveAdmins(userId)) === 0) throw lastAdminError();

  const set: Partial<Pick<AdminUserDoc, "name" | "role" | "active">> = {};
  if (nameChanges) set.name = patch.name;
  if (roleChanges) set.role = patch.role;
  if (activeChanges) set.active = patch.active;

  const updated = await AdminUserModel.findOneAndUpdate({ _id: userId }, { $set: set }, { returnDocument: "after", runValidators: true })
    .select(USER_INFO_PROJECTION)
    .lean();
  if (!updated) throw notFound("User not found.", "user_not_found");

  if (removesAdmin && (await AdminUserModel.countDocuments({ role: "admin", active: true })) === 0) {
    // Two administrators demoted each other at the same moment: undo this change.
    await AdminUserModel.updateOne({ _id: userId }, { $set: { role: existing.role, active: existing.active } });
    throw lastAdminError();
  }

  if (activeChanges && patch.active === false) await destroyUserSessions(userId);

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
}

async function replacePassword(
  id: string,
  password: string,
  mustChangePassword: boolean,
  actor: AdminContext | null
): Promise<void> {
  if (!isObjectIdString(id)) throw notFound("User not found.", "user_not_found");
  if (actor && actor.user.id === id) {
    throw badRequest("Use Change password to update your own password.", undefined, "cannot_modify_self");
  }
  await connectToDatabase();
  const userId = toObjectId(id);
  const passwordHash = await hashPassword(password);
  const updated = await AdminUserModel.findOneAndUpdate(
    { _id: userId },
    {
      $set: {
        passwordHash,
        mustChangePassword,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    },
    { returnDocument: "after" }
  )
    .select({ name: 1 })
    .lean();
  if (!updated) throw notFound("User not found.", "user_not_found");

  // Whoever held the old password (or a session opened with it) is signed out everywhere.
  await destroyUserSessions(userId);
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

  await connectToDatabase();
  const user = await AdminUserModel.findOne({ _id: ctx.userId, active: true }).select("+passwordHash").lean();
  if (!user) throw unauthorized("Your session has expired. Please sign in again.");

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    const message = "Your current password is incorrect.";
    throw badRequest(message, { currentPassword: message }, "invalid_current_password");
  }

  const passwordHash = await hashPassword(newPassword);
  await AdminUserModel.updateOne(
    { _id: user._id },
    { $set: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() } }
  );
  // Keep this browser signed in; every other session of the account ends.
  await destroyUserSessions(user._id, ctx.sessionId);
  await recordAudit({
    actor: toAuditActor(ctx),
    action: "auth.password_change",
    entityType: "admin_user",
    entityId: ctx.user.id,
    summary: `${ctx.user.name} changed their password`,
    ip: ctx.ip,
  });
}
