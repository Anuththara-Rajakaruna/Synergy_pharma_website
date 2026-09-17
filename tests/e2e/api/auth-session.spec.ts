import { expect, test } from "@playwright/test";
import { api, login, loginAsAdmin, uniqueSuffix } from "../support/api";
import { e2eEnv } from "../support/env";
import type { AdminSessionUser, AdminUserInfo } from "@/types/careers";
import { expectApiError, expectExactKeys, expectNoSensitiveData, expectRetryAfter, expectStatus, sessionCookieFrom } from "./lib/assertions";
import {
  ORIGIN_EVIL,
  createActiveUser,
  createPendingUser,
  deactivateUser,
  isolatedClientIp,
  strongPassword,
  type FreshUser,
} from "./lib/fixtures";

// Admin sign-in, sessions, lockout and password changes. Shared accounts are only ever used
// with their correct password; every failure scenario runs against a freshly created user.

const SESSION_USER_KEYS = ["id", "email", "name", "role", "mustChangePassword"] as const;

function tokenFromCookie(cookie: string): string {
  return cookie.slice(cookie.indexOf("=") + 1);
}

function me(cookie?: string) {
  return api<{ user: AdminSessionUser }>("GET", "/api/admin/me", { cookie });
}

test.describe("admin authentication", () => {
  let admin = "";
  const createdUsers: string[] = [];

  test.beforeAll(async () => {
    admin = await loginAsAdmin();
  });

  test.afterAll(async () => {
    for (const id of createdUsers) await deactivateUser(admin, id);
  });

  async function freshUser(role: "admin" | "hr", label: string): Promise<FreshUser> {
    const user = await createActiveUser(admin, role, label);
    createdUsers.push(user.id);
    return user;
  }

  test("login returns the session user and a hardened session cookie", async () => {
    const result = await api<{ user: AdminSessionUser }>("POST", "/api/admin/login", {
      json: { email: `  ${e2eEnv.hrEmail.toUpperCase()}  `, password: e2eEnv.hrPassword },
    });
    expectStatus(result, 200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expectExactKeys(result.body, ["user"], "login body");
    expectExactKeys(result.body.user, SESSION_USER_KEYS, "session user");
    expect(result.body.user).toMatchObject({ email: e2eEnv.hrEmail, role: "hr", mustChangePassword: false });
    expectNoSensitiveData(result.body, "login response");

    const cookie = sessionCookieFrom(result);
    if (!cookie) throw new Error("No session cookie was set.");
    expect(cookie.name).toBe("__Host-synergy_admin");
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie.attributes.has("httponly")).toBe(true);
    expect(cookie.attributes.has("secure")).toBe(true);
    expect(cookie.attributes.get("samesite")?.toLowerCase()).toBe("strict");
    expect(cookie.attributes.get("path")).toBe("/");
    expect(cookie.attributes.has("domain")).toBe(false);
    const maxAge = Number(cookie.attributes.get("max-age"));
    expect(maxAge).toBeGreaterThan(8 * 60 * 60 - 120);
    expect(maxAge).toBeLessThanOrEqual(8 * 60 * 60);

    const session = await me(`${cookie.name}=${cookie.value}`);
    expectStatus(session, 200);
    expect(session.body.user).toEqual(result.body.user);
  });

  test("login validates its input and never accepts operators or non-strings", async () => {
    expectApiError(await api("POST", "/api/admin/login", { json: {} }), 400, "invalid_input", { fields: ["email", "password"] });
    expectApiError(await api("POST", "/api/admin/login", { json: { email: e2eEnv.adminEmail } }), 400, "invalid_input", { fields: ["password"] });
    const operators = await api("POST", "/api/admin/login", { json: { email: { $ne: null }, password: { $ne: null } } });
    expectApiError(operators, 400, "invalid_input", { fields: ["email", "password"] });
    const regex = await api("POST", "/api/admin/login", { json: { email: { $regex: ".*" }, password: "x" } });
    expectApiError(regex, 400, "invalid_input", { fields: ["email"] });
    const longPassword = await api("POST", "/api/admin/login", { json: { email: "nobody@example.com", password: "p".repeat(1025) } });
    expectApiError(longPassword, 400, "invalid_input", { fields: ["password"] });
    expectApiError(await api("POST", "/api/admin/login", { body: "email=a&password=b", headers: { "content-type": "application/x-www-form-urlencoded" } }), 415, "unsupported_media_type");
    expectApiError(await api("POST", "/api/admin/login", { json: { email: "a@b.co", password: "p".repeat(20 * 1024) } }), 413, "payload_too_large");
  });

  test("unknown accounts and wrong passwords get the same 401", async () => {
    const user = await freshUser("hr", "auth-wrong");
    const unknown = await api("POST", "/api/admin/login", { json: { email: `nobody.${uniqueSuffix()}@synergypharma.lk`, password: "Wrong-Password-123" } });
    expectApiError(unknown, 401, "invalid_credentials", { message: "Invalid email or password." });
    const wrong = await api("POST", "/api/admin/login", { json: { email: user.email, password: "Wrong-Password-123" } });
    expectApiError(wrong, 401, "invalid_credentials", { message: "Invalid email or password." });
    expect(sessionCookieFrom(wrong)).toBeNull();
  });

  test("GET /api/admin/me requires a valid session", async () => {
    expectApiError(await me(), 401, "unauthorized");
    expectApiError(await me("__Host-synergy_admin=garbage"), 401, "unauthorized");
    expectApiError(await me(`__Host-synergy_admin=${"A".repeat(43)}`), 401, "unauthorized");
    // The development cookie name is not accepted by a production deployment.
    const token = admin.split("=")[1];
    expectApiError(await me(`synergy_admin=${token}`), 401, "unauthorized");
    const result = await me(admin);
    expectStatus(result, 200);
    expectExactKeys(result.body.user, SESSION_USER_KEYS, "session user");
    expect(result.body.user.email).toBe(e2eEnv.adminEmail);
  });

  test("logout destroys the server-side session, not just the cookie", async () => {
    const cookie = await login(e2eEnv.hrEmail, e2eEnv.hrPassword);
    expectStatus(await me(cookie), 200);
    const logout = await api("POST", "/api/admin/logout", { cookie });
    expectStatus(logout, 200);
    expect(logout.body).toEqual({ success: true });
    const cleared = sessionCookieFrom(logout);
    if (!cleared) throw new Error("Logout did not clear the cookie.");
    expect(cleared.value).toBe("");
    expect(cleared.attributes.get("max-age")).toBe("0");
    expectApiError(await me(cookie), 401, "unauthorized");
    // Signing out again (expired session) still succeeds.
    expectStatus(await api("POST", "/api/admin/logout", { cookie }), 200);
    expectStatus(await api("POST", "/api/admin/logout"), 200);
  });

  test("signing in again replaces the browser's previous session, and GET cannot sign out", async () => {
    const first = await login(e2eEnv.hrEmail, e2eEnv.hrPassword);
    const again = await api("POST", "/api/admin/login", { cookie: first, json: { email: e2eEnv.hrEmail, password: e2eEnv.hrPassword } });
    expectStatus(again, 200);
    const second = sessionCookieFrom(again);
    if (!second) throw new Error("No session cookie was set.");
    expect(second.value).not.toBe(tokenFromCookie(first));
    expectApiError(await me(first), 401, "unauthorized");
    const secondCookie = `${second.name}=${second.value}`;
    expectStatus(await me(secondCookie), 200);

    expect((await api("GET", "/api/admin/logout", { cookie: secondCookie })).status).toBe(405);
    expectStatus(await me(secondCookie), 200);
    await api("POST", "/api/admin/logout", { cookie: secondCookie });
  });

  test("cross-site login and logout requests are refused", async () => {
    const crossLogin = await api("POST", "/api/admin/login", {
      json: { email: e2eEnv.hrEmail, password: e2eEnv.hrPassword },
      headers: { origin: ORIGIN_EVIL },
    });
    expectApiError(crossLogin, 403, "cross_site_request");
    expect(sessionCookieFrom(crossLogin)).toBeNull();

    const cookie = await login(e2eEnv.hrEmail, e2eEnv.hrPassword);
    const crossLogout = await api("POST", "/api/admin/logout", { cookie, headers: { origin: ORIGIN_EVIL } });
    expect(crossLogout.status).toBe(403);
    expectStatus(await me(cookie), 200);
    await api("POST", "/api/admin/logout", { cookie });
  });

  test("the login-ip bucket allows 20 attempts per 15 minutes per client", async () => {
    const ip = isolatedClientIp();
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const result = await api("POST", "/api/admin/login", { json: {}, ip });
      expect(result.status, `attempt ${attempt}`).toBe(400);
    }
    const limited = await api("POST", "/api/admin/login", { json: { email: e2eEnv.hrEmail, password: e2eEnv.hrPassword }, ip });
    expectApiError(limited, 429, "rate_limited");
    expectRetryAfter(limited, 15 * 60);
    expect(sessionCookieFrom(limited)).toBeNull();
  });

  test("five wrong passwords lock the account for 15 minutes, even for the right password", async () => {
    const user = await freshUser("hr", "auth-lockout");
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = await api("POST", "/api/admin/login", { json: { email: user.email, password: `Wrong-${attempt}-password` } });
      expectApiError(result, 401, "invalid_credentials");
    }
    const locking = await api("POST", "/api/admin/login", { json: { email: user.email, password: "Wrong-5-password" } });
    expectApiError(locking, 429, "account_locked", { message: /Try again in 15 minutes/ });
    expectRetryAfter(locking, 15 * 60);

    const correct = await api("POST", "/api/admin/login", { json: { email: user.email, password: user.password } });
    expectApiError(correct, 429, "account_locked");
    expect(sessionCookieFrom(correct)).toBeNull();
    // Existing sessions are not a way around the lock screen, but they stay valid.
    expectStatus(await me(user.cookie), 200);

    const users = await api<{ items: AdminUserInfo[] }>("GET", "/api/admin/users", { cookie: admin });
    const listed = users.body.items.find((item) => item.id === user.id);
    expect(listed?.lockedUntil).not.toBeNull();

    const reset = await api<{ temporaryPassword: string }>("POST", `/api/admin/users/${user.id}/reset-password`, { cookie: admin });
    expectStatus(reset, 200);
    const unlocked = await api<{ user: AdminSessionUser }>("POST", "/api/admin/login", {
      json: { email: user.email, password: reset.body.temporaryPassword },
    });
    expectStatus(unlocked, 200);
    expect(unlocked.body.user.mustChangePassword).toBe(true);
  });

  test("a temporary password must be changed before anything else", async () => {
    const pending = await createPendingUser(admin, "hr", "auth-pending");
    createdUsers.push(pending.user.id);
    expect(pending.user.mustChangePassword).toBe(true);
    expect(pending.temporaryPassword).toHaveLength(20);

    const session = await me(pending.cookie);
    expectStatus(session, 200);
    expect(session.body.user.mustChangePassword).toBe(true);
    expectApiError(await api("GET", "/api/admin/stats", { cookie: pending.cookie }), 403, "password_change_required");

    const change = (json: unknown) => api("POST", "/api/admin/password", { cookie: pending.cookie, json });
    expectApiError(await change({ currentPassword: "Not-the-temp-password-1", newPassword: strongPassword() }), 400, "invalid_current_password", {
      fields: ["currentPassword"],
    });
    expectApiError(await change({ currentPassword: pending.temporaryPassword, newPassword: pending.temporaryPassword }), 400, "invalid_input", {
      fields: ["newPassword"],
    });
    expectApiError(await change({ currentPassword: pending.temporaryPassword, newPassword: "short" }), 400, "invalid_input", { fields: ["newPassword"] });
    expectApiError(await change({ currentPassword: pending.temporaryPassword, newPassword: "aaaaaaaaaaaaaaaaaaaa" }), 400, "invalid_input", {
      fields: ["newPassword"],
    });
    expectApiError(await change({ currentPassword: { $ne: "" }, newPassword: strongPassword() }), 400, "invalid_input", { fields: ["currentPassword"] });
    expectApiError(await change({}), 400, "invalid_input", { fields: ["currentPassword", "newPassword"] });

    const password = strongPassword();
    const changed = await change({ currentPassword: pending.temporaryPassword, newPassword: password });
    expectStatus(changed, 200);
    expect(changed.body).toEqual({ success: true });

    const after = await me(pending.cookie);
    expect(after.body.user.mustChangePassword).toBe(false);
    expectStatus(await api("GET", "/api/admin/stats", { cookie: pending.cookie }), 200);
    expectApiError(await api("POST", "/api/admin/login", { json: { email: pending.user.email, password: pending.temporaryPassword } }), 401, "invalid_credentials");
    expectStatus(await api("POST", "/api/admin/login", { json: { email: pending.user.email, password } }), 200);
  });

  test("changing the password signs out every other session", async () => {
    const user = await freshUser("hr", "auth-sessions");
    const other = await login(user.email, user.password);
    expectStatus(await me(other), 200);
    const next = strongPassword();
    expectStatus(await api("POST", "/api/admin/password", { cookie: user.cookie, json: { currentPassword: user.password, newPassword: next } }), 200);
    expectApiError(await me(other), 401, "unauthorized");
    expectStatus(await me(user.cookie), 200);
  });

  test("deactivating a user or resetting their password ends their sessions", async () => {
    const deactivated = await freshUser("hr", "auth-deactivate");
    const patch = await api<{ user: AdminUserInfo }>("PATCH", `/api/admin/users/${deactivated.id}`, { cookie: admin, json: { active: false } });
    expectStatus(patch, 200);
    expect(patch.body.user.active).toBe(false);
    expectApiError(await me(deactivated.cookie), 401, "unauthorized");
    expectApiError(await api("POST", "/api/admin/login", { json: { email: deactivated.email, password: deactivated.password } }), 401, "invalid_credentials");
    expectStatus(await api("PATCH", `/api/admin/users/${deactivated.id}`, { cookie: admin, json: { active: true } }), 200);
    expectStatus(await api("POST", "/api/admin/login", { json: { email: deactivated.email, password: deactivated.password } }), 200);

    const reset = await freshUser("hr", "auth-reset");
    expectStatus(await api("POST", `/api/admin/users/${reset.id}/reset-password`, { cookie: admin }), 200);
    expectApiError(await me(reset.cookie), 401, "unauthorized");
    expectApiError(await api("POST", "/api/admin/login", { json: { email: reset.email, password: reset.password } }), 401, "invalid_credentials");
  });

  test("current-password guesses from a session are rate limited", async () => {
    // A user who has not changed the temporary password yet, so no attempt has been counted.
    const pending = await createPendingUser(admin, "hr", "auth-guess");
    createdUsers.push(pending.user.id);
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const result = await api("POST", "/api/admin/password", {
        cookie: pending.cookie,
        json: { currentPassword: `Guess-${attempt}-password`, newPassword: strongPassword() },
      });
      expectApiError(result, 400, "invalid_current_password");
    }
    const limited = await api("POST", "/api/admin/password", {
      cookie: pending.cookie,
      json: { currentPassword: pending.temporaryPassword, newPassword: strongPassword() },
    });
    expectApiError(limited, 429, "rate_limited");
    expectRetryAfter(limited, 15 * 60);
  });
});
