// Server-side admin sessions. The browser only holds a random token; the store keeps its
// SHA-256, so a leak of the spreadsheet does not expose usable session tokens.
//
// Sessions used to live in a MongoDB collection with a TTL index. They now live in the
// AdminSessions tab (src/lib/sheets-db/repositories/admin.ts). Two consequences worth knowing:
//
//   * A dead session is revoked (revokedAt stamped) rather than deleted, so row numbers stay
//     stable for everything else; the maintenance job removes the rows later. resolveSession
//     still refuses an expired, idle, revoked or orphaned session the moment it sees it, so the
//     access-control behaviour is unchanged.
//   * A lookup by token hash always re-reads the tab when the cached copy has no match
//     (findSessionByTokenHash passes refreshOnMiss), because a session created a moment ago on
//     another serverless instance must not be mistaken for a bad token.

import { createHash, randomBytes } from "node:crypto";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth/cookie-name";
import { newId } from "@/lib/careers/server/ids";
import type { AdminSessionRecord, AdminUserRecord, AuditActor } from "@/lib/careers/server/records";
import { ensureStoreReady } from "@/lib/sheets-db";
import {
  findAdminUserById,
  findSessionByTokenHash,
  insertSession,
  revokeSession,
  revokeSessionByTokenHash,
  revokeUserSessions,
  touchSession,
} from "@/lib/sheets-db/repositories/admin";
import type { AdminSessionUser } from "@/types/careers";

export type AdminContext = {
  user: AdminSessionUser;
  userId: string;
  sessionId: string;
  ip: string;
  userAgent: string | null;
};

export type ResolvedSession = { user: AdminSessionUser; userId: string; sessionId: string };

const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
// lastSeenAt is written at most this often, so ordinary browsing does not write on every request.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
// 32 random bytes in base64url.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// The session row records where the session was opened from; the same clipping the audit trail
// applies, so an oversized header can never reach a cell.
const IP_LIMIT = 100;
const USER_AGENT_LIMIT = 400;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isWellFormedToken(token: string | undefined): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

export function toSessionUser(
  user: Pick<AdminUserRecord, "id" | "email" | "name" | "role" | "mustChangePassword">
): AdminSessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

export function toAuditActor(ctx: Pick<AdminContext, "user" | "userId">): AuditActor {
  return { user: ctx.userId, email: ctx.user.email, name: ctx.user.name, role: ctx.user.role };
}

export async function createSession(
  userId: string,
  meta: { ip: string; userAgent: string | null }
): Promise<{ token: string; expiresAt: Date }> {
  ensureStoreReady();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  const session: AdminSessionRecord = {
    id: newId(now),
    tokenHash: hashToken(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    ip: meta.ip && meta.ip !== "unknown" ? meta.ip.slice(0, IP_LIMIT) : null,
    userAgent: meta.userAgent ? meta.userAgent.slice(0, USER_AGENT_LIMIT) : null,
    revokedAt: null,
  };
  await insertSession(session);
  return { token, expiresAt };
}

// Returns the signed-in user for a session token, or null when the token is unknown, expired,
// idle for too long, or belongs to a deactivated account. Dead sessions are revoked on sight.
export async function resolveSession(token: string | undefined): Promise<ResolvedSession | null> {
  if (!isWellFormedToken(token)) return null;
  ensureStoreReady();

  // findSessionByTokenHash re-reads the tab on a miss and ignores already-revoked rows.
  const session = await findSessionByTokenHash(hashToken(token));
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() >= IDLE_TIMEOUT_MS) {
    await revokeSession(session.id, new Date(now));
    return null;
  }

  // refreshOnMiss again: an account created moments ago on another instance is not yet in this
  // instance's cached copy of the tab, and must not be read as "the user no longer exists".
  const user = await findAdminUserById(session.userId, { refreshOnMiss: true });
  if (!user || !user.active) {
    await revokeSession(session.id, new Date(now));
    return null;
  }

  if (now - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    await touchSession(session.id, new Date(now));
  }

  return { user: toSessionUser(user), userId: user.id, sessionId: session.id };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!isWellFormedToken(token)) return;
  ensureStoreReady();
  await revokeSessionByTokenHash(hashToken(token), new Date());
}

export async function destroyUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  ensureStoreReady();
  await revokeUserSessions(userId, new Date(), exceptSessionId);
}

// Cookie attributes for the session cookie. Pass the session's expiry so the cookie never
// outlives it; omit it for a full-length cookie. Use maxAge 0 to clear the cookie.
export function sessionCookieOptions(expiresAt?: Date): {
  httpOnly: true;
  secure: boolean;
  sameSite: "strict";
  path: "/";
  maxAge: number;
} {
  const maxAge = expiresAt
    ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
    : SESSION_MAX_AGE_SECONDS;
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge,
  };
}
