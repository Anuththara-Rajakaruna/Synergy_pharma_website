// Authentication and authorization guard for admin route handlers and server components.
// Every admin API route calls requireAdmin() first; the proxy's cookie check is only a
// convenience redirect and is never relied on for access control.

import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookie-name";
import { resolveSession, type AdminContext } from "@/lib/auth/session";
import type { AdminRole } from "@/lib/careers/constants";
import { forbidden, unauthorized } from "@/lib/http/errors";
import { assertSameOrigin, getClientIp, getUserAgent } from "@/lib/http/request";
import type { AdminSessionUser } from "@/types/careers";

export type { AdminContext } from "@/lib/auth/session";
export { toAuditActor } from "@/lib/auth/session";

// Reads one cookie from a raw Cookie header. The first occurrence wins, matching how browsers
// order cookies (most specific path first).
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1 || part.slice(0, index).trim() !== name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

export function readSessionToken(request: Request): string | undefined {
  return readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
}

export async function requireAdmin(
  request: Request,
  options: { roles?: AdminRole[]; allowPasswordChangePending?: boolean } = {}
): Promise<AdminContext> {
  assertSameOrigin(request);
  const session = await resolveSession(readSessionToken(request));
  if (!session) throw unauthorized("Your session has expired. Please sign in again.");
  if (session.user.mustChangePassword && !options.allowPasswordChangePending) {
    throw forbidden("Change your temporary password before continuing.", "password_change_required");
  }
  if (options.roles && !options.roles.includes(session.user.role)) {
    throw forbidden();
  }
  return { ...session, ip: getClientIp(request), userAgent: getUserAgent(request) };
}

// For server components: the signed-in user, or null. Database failures propagate so the
// page's error boundary can offer a retry instead of silently signing the user out.
export async function getAdminFromCookies(): Promise<AdminSessionUser | null> {
  const cookieStore = await cookies();
  const session = await resolveSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  return session?.user ?? null;
}
