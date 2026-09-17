import type { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookie-name";
import { readSessionToken } from "@/lib/auth/require-admin";
import { destroySession, resolveSession, sessionCookieOptions, toAuditActor } from "@/lib/auth/session";
import { recordAudit } from "@/lib/careers/server/audit";
import { jsonResponse, toErrorResponse } from "@/lib/http/handler";
import { assertSameOrigin, getClientIp } from "@/lib/http/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE_NAME, "", { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}

// Not wrapped in requireAdmin: signing out must succeed (and clear the cookie) even when the
// session has already expired. The cookie is cleared on every response, errors included.
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const token = readSessionToken(request);
    const session = await resolveSession(token);
    await destroySession(token);
    if (session) {
      await recordAudit({
        actor: toAuditActor(session),
        action: "auth.logout",
        entityType: "admin_user",
        entityId: session.user.id,
        summary: `${session.user.name} signed out`,
        ip: getClientIp(request),
      });
    }
    return clearSessionCookie(jsonResponse({ success: true }));
  } catch (err) {
    return clearSessionCookie(toErrorResponse(err, "api.admin.logout"));
  }
}
