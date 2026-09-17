import { SESSION_COOKIE_NAME } from "@/lib/auth/cookie-name";
import { readSessionToken } from "@/lib/auth/require-admin";
import { destroySession, sessionCookieOptions } from "@/lib/auth/session";
import { authenticateAdmin } from "@/lib/careers/server/users";
import type { FieldErrors } from "@/lib/careers/validation";
import { badRequest } from "@/lib/http/errors";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { assertSameOrigin, getClientIp, getUserAgent, readJsonBody } from "@/lib/http/request";
import { logger } from "@/lib/logger";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_EMAIL_LENGTH = 320;
// Well above the password policy maximum; longer input can never match a stored password.
const MAX_PASSWORD_LENGTH = 1024;

export const POST = apiHandler("api.admin.login", async (request: Request) => {
  // Blocks login CSRF (a third-party page signing the browser into an attacker's account).
  assertSameOrigin(request);
  const ip = getClientIp(request);
  await enforceRateLimit("login-ip", ip, RATE_LIMITS["login-ip"], "Too many sign-in attempts. Please wait before trying again.");

  const body = await readJsonBody(request, 16 * 1024);
  const errors: FieldErrors = {};
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email) errors.email = "Enter your email address.";
  else if (email.length > MAX_EMAIL_LENGTH) errors.email = "Please enter a valid email address.";
  if (!password) errors.password = "Enter your password.";
  else if (password.length > MAX_PASSWORD_LENGTH) errors.password = "Invalid email or password.";
  if (Object.keys(errors).length > 0) {
    throw badRequest(Object.values(errors)[0] ?? "Enter your email address and password.", errors);
  }

  const result = await authenticateAdmin(email, password, { ip, userAgent: getUserAgent(request) });

  // Signing in again from the same browser replaces its previous session.
  const previousToken = readSessionToken(request);
  if (previousToken) {
    await destroySession(previousToken).catch((err: unknown) => logger.warn("auth.previous_session_cleanup_failed", { err }));
  }

  const response = jsonResponse({ user: result.user });
  response.cookies.set(SESSION_COOKIE_NAME, result.token, sessionCookieOptions(result.expiresAt));
  return response;
});
