// Server-side admin sessions. The browser only holds a random token; MongoDB stores its
// SHA-256 so a database leak does not expose usable session tokens.

import { createHash, randomBytes } from "node:crypto";
import type { Types } from "mongoose";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth/cookie-name";
import { connectToDatabase } from "@/lib/mongodb";
import { AdminSessionModel } from "@/models/admin-session";
import type { AuditActor } from "@/models/audit-log";
import { AdminUserModel, type AdminUserDoc } from "@/models/admin-user";
import type { AdminSessionUser } from "@/types/careers";

export type AdminContext = {
  user: AdminSessionUser;
  userId: Types.ObjectId;
  sessionId: Types.ObjectId;
  ip: string;
  userAgent: string | null;
};

export type ResolvedSession = { user: AdminSessionUser; userId: Types.ObjectId; sessionId: Types.ObjectId };

const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
// lastSeenAt is written at most this often, so ordinary browsing does not write on every request.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
// 32 random bytes in base64url.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isWellFormedToken(token: string | undefined): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

export function toSessionUser(user: Pick<AdminUserDoc, "_id" | "email" | "name" | "role" | "mustChangePassword">): AdminSessionUser {
  return {
    id: String(user._id),
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
  userId: Types.ObjectId,
  meta: { ip: string; userAgent: string | null }
): Promise<{ token: string; expiresAt: Date }> {
  await connectToDatabase();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  await AdminSessionModel.create({
    tokenHash: hashToken(token),
    user: userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    ip: meta.ip && meta.ip !== "unknown" ? meta.ip.slice(0, 100) : null,
    userAgent: meta.userAgent ? meta.userAgent.slice(0, 400) : null,
  });
  return { token, expiresAt };
}

// Returns the signed-in user for a session token, or null when the token is unknown, expired,
// idle for too long, or belongs to a deactivated account. Dead sessions are deleted on sight.
export async function resolveSession(token: string | undefined): Promise<ResolvedSession | null> {
  if (!isWellFormedToken(token)) return null;
  await connectToDatabase();

  const session = await AdminSessionModel.findOne({ tokenHash: hashToken(token) })
    .select({ user: 1, lastSeenAt: 1, expiresAt: 1 })
    .lean();
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() >= IDLE_TIMEOUT_MS) {
    await AdminSessionModel.deleteOne({ _id: session._id });
    return null;
  }

  const user = await AdminUserModel.findById(session.user)
    .select({ email: 1, name: 1, role: 1, active: 1, mustChangePassword: 1 })
    .lean();
  if (!user || !user.active) {
    await AdminSessionModel.deleteOne({ _id: session._id });
    return null;
  }

  if (now - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    await AdminSessionModel.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date(now) } });
  }

  return { user: toSessionUser(user), userId: user._id, sessionId: session._id };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!isWellFormedToken(token)) return;
  await connectToDatabase();
  await AdminSessionModel.deleteOne({ tokenHash: hashToken(token) });
}

export async function destroyUserSessions(userId: Types.ObjectId, exceptSessionId?: Types.ObjectId): Promise<void> {
  await connectToDatabase();
  await AdminSessionModel.deleteMany(exceptSessionId ? { user: userId, _id: { $ne: exceptSessionId } } : { user: userId });
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
