import { ADMIN_ROLES, FIELD_LIMITS, type AdminRole } from "@/lib/careers/constants";
import { idTimestamp } from "@/lib/careers/server/ids";
import type { AdminSessionRecord, AdminUserRecord } from "@/lib/careers/server/records";
import {
  decodeBoolean,
  decodeDate,
  decodeDateOr,
  decodeEnum,
  decodeInteger,
  decodeText,
  decodeTextOrNull,
  encodeBoolean,
  encodeDate,
  encodeNumber,
  encodeText,
} from "@/lib/sheets-db/codec";
import { allRecords, appendRecord, findRecord, updateRecord, type RecordValues, type TableRecord } from "@/lib/sheets-db/table";

// Admin accounts and their sessions.
//
// Two notes on how this differs from the MongoDB version:
//
//   * passwordHash used to be `select: false` so it could not be returned by accident. A
//     spreadsheet has no such feature, so the rule is enforced here instead: the only export
//     that includes the hash is findAdminUserForAuth, and nothing above the service layer ever
//     receives an AdminUserRecord straight from it.
//
//   * Sessions used to expire through a TTL index. Expired rows are now cleared by the
//     maintenance job; resolveSession still refuses an expired row the moment it sees one, so a
//     row that outlives its expiry is a tidiness problem, never an access-control one.

// ── Admin users ──────────────────────────────────────────────────────────────

function toAdminUser(values: RecordValues): AdminUserRecord {
  const id = decodeText(values.id);
  const createdAt = decodeDateOr(values.createdAt, idTimestamp(id) ?? new Date(0));
  return {
    id,
    email: decodeText(values.email).toLowerCase(),
    name: decodeText(values.name),
    role: decodeEnum<AdminRole>(values.role, ADMIN_ROLES, "hr"),
    passwordHash: decodeText(values.passwordHash),
    active: decodeBoolean(values.active),
    mustChangePassword: decodeBoolean(values.mustChangePassword),
    lastLoginAt: decodeDate(values.lastLoginAt),
    failedLoginAttempts: Math.max(0, decodeInteger(values.failedLoginAttempts, 0)),
    lockedUntil: decodeDate(values.lockedUntil),
    passwordChangedAt: decodeDateOr(values.passwordChangedAt, createdAt),
    createdBy: decodeTextOrNull(values.createdBy),
    createdAt,
    updatedAt: decodeDateOr(values.updatedAt, createdAt),
  };
}

export function adminUserRow(user: AdminUserRecord): RecordValues {
  return {
    id: user.id,
    email: encodeText(user.email.toLowerCase(), FIELD_LIMITS.email),
    name: encodeText(user.name, FIELD_LIMITS.name),
    role: user.role,
    passwordHash: encodeText(user.passwordHash, 500),
    active: encodeBoolean(user.active),
    mustChangePassword: encodeBoolean(user.mustChangePassword),
    lastLoginAt: encodeDate(user.lastLoginAt),
    failedLoginAttempts: encodeNumber(user.failedLoginAttempts),
    lockedUntil: encodeDate(user.lockedUntil),
    passwordChangedAt: encodeDate(user.passwordChangedAt),
    createdBy: user.createdBy ?? "",
    createdAt: encodeDate(user.createdAt),
    updatedAt: encodeDate(user.updatedAt),
  };
}

// Without the password hash. Everything that lists or displays users uses this.
export type SafeAdminUser = Omit<AdminUserRecord, "passwordHash">;

// Builds the safe view field by field rather than by deleting one from a copy, so a field added
// to AdminUserRecord later has to be named here before it can escape.
export function withoutHash(user: AdminUserRecord): SafeAdminUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    failedLoginAttempts: user.failedLoginAttempts,
    lockedUntil: user.lockedUntil,
    passwordChangedAt: user.passwordChangedAt,
    createdBy: user.createdBy,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function listAdminUsers(opts: { maxAgeMs?: number } = {}): Promise<SafeAdminUser[]> {
  const rows = await allRecords("AdminUsers", opts);
  return rows
    .filter((row) => decodeText(row.values.id) !== "")
    .map((row) => withoutHash(toAdminUser(row.values)));
}

export async function findAdminUserById(id: string, opts: { maxAgeMs?: number; refreshOnMiss?: boolean } = {}): Promise<SafeAdminUser | null> {
  const row = await findRecord("AdminUsers", (values) => decodeText(values.id) === id, opts);
  return row ? withoutHash(toAdminUser(row.values)) : null;
}

// The one place that returns the password hash. Sign-in is the only caller.
export async function findAdminUserForAuth(email: string, opts: { refreshOnMiss?: boolean } = {}): Promise<AdminUserRecord | null> {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return null;
  const row = await findRecord("AdminUsers", (values) => decodeText(values.email).toLowerCase() === wanted, {
    refreshOnMiss: opts.refreshOnMiss ?? true,
  });
  return row ? toAdminUser(row.values) : null;
}

export async function findAdminUserByEmail(email: string, opts: { refreshOnMiss?: boolean } = {}): Promise<SafeAdminUser | null> {
  const user = await findAdminUserForAuth(email, opts);
  return user ? withoutHash(user) : null;
}

export async function insertAdminUser(user: AdminUserRecord): Promise<TableRecord> {
  return appendRecord("AdminUsers", adminUserRow(user));
}

type PatchEncoder = { column: string; encode: (value: unknown) => string | number };

const ADMIN_USER_PATCH: Partial<Record<keyof AdminUserRecord, PatchEncoder>> = {
  name: { column: "name", encode: (value) => encodeText(value as string, FIELD_LIMITS.name) },
  role: { column: "role", encode: (value) => String(value) },
  passwordHash: { column: "passwordHash", encode: (value) => encodeText(value as string, 500) },
  active: { column: "active", encode: (value) => encodeBoolean(value as boolean) },
  mustChangePassword: { column: "mustChangePassword", encode: (value) => encodeBoolean(value as boolean) },
  lastLoginAt: { column: "lastLoginAt", encode: (value) => encodeDate(value as Date | null) },
  failedLoginAttempts: { column: "failedLoginAttempts", encode: (value) => encodeNumber(value as number) },
  lockedUntil: { column: "lockedUntil", encode: (value) => encodeDate(value as Date | null) },
  passwordChangedAt: { column: "passwordChangedAt", encode: (value) => encodeDate(value as Date | null) },
  updatedAt: { column: "updatedAt", encode: (value) => encodeDate(value as Date | null) },
};

export async function patchAdminUser(id: string, patch: Partial<AdminUserRecord>): Promise<boolean> {
  const values: RecordValues = {};
  for (const [field, value] of Object.entries(patch)) {
    const encoder = ADMIN_USER_PATCH[field as keyof AdminUserRecord];
    if (encoder) values[encoder.column] = encoder.encode(value);
  }
  return updateRecord("AdminUsers", id, values);
}

// How many accounts can still sign in as an administrator. Backs the "never remove the last
// admin" rule.
export async function countActiveAdmins(opts: { maxAgeMs?: number } = {}): Promise<number> {
  const users = await listAdminUsers({ maxAgeMs: opts.maxAgeMs ?? 0 });
  return users.filter((user) => user.active && user.role === "admin").length;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

function toSession(values: RecordValues): AdminSessionRecord {
  const id = decodeText(values.id);
  const createdAt = decodeDateOr(values.createdAt, idTimestamp(id) ?? new Date(0));
  return {
    id,
    tokenHash: decodeText(values.tokenHash),
    userId: decodeText(values.userId),
    createdAt,
    lastSeenAt: decodeDateOr(values.lastSeenAt, createdAt),
    expiresAt: decodeDateOr(values.expiresAt, new Date(0)),
    ip: decodeTextOrNull(values.ip),
    userAgent: decodeTextOrNull(values.userAgent),
    revokedAt: decodeDate(values.revokedAt),
  };
}

export async function insertSession(session: AdminSessionRecord): Promise<void> {
  await appendRecord("AdminSessions", {
    id: session.id,
    tokenHash: session.tokenHash,
    userId: session.userId,
    createdAt: encodeDate(session.createdAt),
    lastSeenAt: encodeDate(session.lastSeenAt),
    expiresAt: encodeDate(session.expiresAt),
    ip: encodeText(session.ip, 100),
    userAgent: encodeText(session.userAgent, 400),
    revokedAt: "",
  });
}

// `refreshOnMiss` is essential: a session created a moment ago on another serverless instance
// would otherwise look like a bad token and sign the user straight back out.
export async function findSessionByTokenHash(tokenHash: string): Promise<AdminSessionRecord | null> {
  if (!tokenHash) return null;
  const row = await findRecord(
    "AdminSessions",
    (values) => decodeText(values.tokenHash) === tokenHash && !decodeText(values.revokedAt),
    { refreshOnMiss: true }
  );
  return row ? toSession(row.values) : null;
}

export async function touchSession(id: string, at: Date): Promise<void> {
  await updateRecord("AdminSessions", id, { lastSeenAt: encodeDate(at) });
}

// Sessions are revoked by flag rather than by deleting the row, so row numbers stay stable.
// The maintenance job removes revoked and expired rows later.
export async function revokeSession(id: string, at: Date): Promise<void> {
  await updateRecord("AdminSessions", id, { revokedAt: encodeDate(at) });
}

export async function revokeSessionByTokenHash(tokenHash: string, at: Date): Promise<void> {
  const session = await findSessionByTokenHash(tokenHash);
  if (session) await revokeSession(session.id, at);
}

// Revokes every session of a user, optionally keeping one (the caller's own, after a password
// change).
export async function revokeUserSessions(userId: string, at: Date, exceptSessionId?: string): Promise<number> {
  const rows = await allRecords("AdminSessions", { maxAgeMs: 0 });
  const targets = rows.filter(
    (row) =>
      decodeText(row.values.userId) === userId &&
      !decodeText(row.values.revokedAt) &&
      decodeText(row.values.id) !== (exceptSessionId ?? "")
  );
  for (const row of targets) {
    await updateRecord("AdminSessions", decodeText(row.values.id), { revokedAt: encodeDate(at) });
  }
  return targets.length;
}

// Row numbers of sessions that are revoked or long expired, for the maintenance sweep.
export async function expiredSessionRows(now: Date, graceMs: number): Promise<number[]> {
  const rows = await allRecords("AdminSessions", { maxAgeMs: 0 });
  const cutoff = now.getTime() - graceMs;
  return rows
    .filter((row) => {
      const session = toSession(row.values);
      if (session.revokedAt) return session.revokedAt.getTime() < cutoff;
      return session.expiresAt.getTime() < cutoff;
    })
    .map((row) => row.rowNumber);
}
