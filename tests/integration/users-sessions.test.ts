import "./support/env";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth/cookie-name";
import { createSession, destroySession, destroyUserSessions, resolveSession, sessionCookieOptions, type AdminContext } from "@/lib/auth/session";
import { newId } from "@/lib/careers/server/ids";
import {
  authenticateAdmin,
  changeOwnPassword,
  createAdminUser,
  listAdminUsers,
  resetAdminPassword,
  setAdminPassword,
  updateAdminUser,
} from "@/lib/careers/server/users";
import { allRecords, updateRecord, type RecordValues } from "@/lib/sheets-db";
import { decodeText, encodeDate } from "@/lib/sheets-db/codec";
import { findAdminUserById, listAdminUsers as listAdminUserRecords, patchAdminUser } from "@/lib/sheets-db/repositories/admin";
import { suiteSkip } from "./support/env";
import { assertNoPersonalData, auditEntries, expectAppError, uniqueSuffix } from "./support/fixtures";
import { clearTableRows, resetStore, startIntegration, type Integration } from "./support/harness";

const MINUTE = 60 * 1000;
const meta = { ip: "203.0.113.50", userAgent: "integration-tests" };

type TestUser = { id: string; email: string; password: string };

// Creates an active account with a known password (as the CLI bootstrap does).
async function userWithPassword(role: "admin" | "hr" = "hr", name = "Dinuka Admin"): Promise<TestUser> {
  const email = `user.${uniqueSuffix()}@synergypharma.test`;
  const { user, temporaryPassword } = await createAdminUser({ email, name, role }, null);
  const password = `Known-Password-${uniqueSuffix()}`;
  await setAdminPassword(user.id, password, null);
  assert.notEqual(temporaryPassword, password);
  return { id: user.id, email, password };
}

async function contextFor(user: TestUser): Promise<AdminContext> {
  const auth = await authenticateAdmin(user.email, user.password, meta);
  const resolved = await resolveSession(auth.token);
  assert.ok(resolved);
  return { ...resolved, ...meta };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function sessionRows(): Promise<RecordValues[]> {
  return (await allRecords("AdminSessions", { maxAgeMs: 0 })).map((row) => row.values);
}

// Sessions are revoked rather than deleted (deleting a row would renumber the tab), so "how many
// sessions does this user have" means "how many of their rows are not revoked".
async function sessionCount(userId: string): Promise<number> {
  const rows = await sessionRows();
  return rows.filter((values) => decodeText(values.userId) === userId && !decodeText(values.revokedAt)).length;
}

async function sessionRowFor(token: string): Promise<RecordValues | null> {
  const hash = hashToken(token);
  return (await sessionRows()).find((values) => decodeText(values.tokenHash) === hash) ?? null;
}

// Ages a session in the sheet, which is how the old test moved lastSeenAt/expiresAt with an update.
async function patchSession(token: string, patch: { lastSeenAt?: Date; expiresAt?: Date; createdAt?: Date }): Promise<void> {
  const row = await sessionRowFor(token);
  assert.ok(row, "session row not found");
  const values: RecordValues = {};
  if (patch.lastSeenAt) values.lastSeenAt = encodeDate(patch.lastSeenAt);
  if (patch.expiresAt) values.expiresAt = encodeDate(patch.expiresAt);
  if (patch.createdAt) values.createdAt = encodeDate(patch.createdAt);
  assert.ok(await updateRecord("AdminSessions", decodeText(row.id), values));
}

describe("admin users and sessions", { timeout: 300_000, skip: suiteSkip() }, () => {
  let integration: Integration;
  const secrets: string[] = [];

  before(async () => {
    integration = await startIntegration();
  });

  after(async () => {
    try {
      assertNoPersonalData(JSON.stringify(await auditEntries()), secrets, "audit log");
      assertNoPersonalData(integration.logs(), secrets, "logs");
    } finally {
      await integration.stop();
    }
  });

  describe("authenticateAdmin", () => {
    it("signs in with a case-insensitive email, stores only a token hash and audits the login", async () => {
      const user = await userWithPassword("hr", "Dinuka Perera");
      secrets.push(user.password);
      await patchAdminUser(user.id, { failedLoginAttempts: 2 });

      const started = Date.now();
      const result = await authenticateAdmin(`  ${user.email.toUpperCase()} `, user.password, meta);
      secrets.push(result.token);
      assert.deepEqual(result.user, { id: user.id, email: user.email, name: "Dinuka Perera", role: "hr", mustChangePassword: false });
      assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
      assert.ok(Math.abs(result.expiresAt.getTime() - (started + SESSION_MAX_AGE_SECONDS * 1000)) < 5000);

      const session = await sessionRowFor(result.token);
      assert.ok(session);
      assert.equal(decodeText(session.tokenHash), hashToken(result.token));
      assert.equal(JSON.stringify(session).includes(result.token), false, "the token itself never reaches the spreadsheet");
      assert.equal(decodeText(session.ip), meta.ip);
      assert.equal(decodeText(session.userId), user.id);

      const stored = await findAdminUserById(user.id, { maxAgeMs: 0 });
      assert.equal(stored?.failedLoginAttempts, 0);
      assert.ok(stored?.lastLoginAt && stored.lastLoginAt.getTime() >= started - 1000);
      const [audit] = await auditEntries({ action: "auth.login", entityId: user.id });
      assert.equal(audit.actor?.user, user.id);
    });

    it("gives the same 401 for unknown and inactive accounts and audits without the email", async () => {
      const unknownEmail = `nobody.${uniqueSuffix()}@synergypharma.test`;
      const err = await expectAppError(authenticateAdmin(unknownEmail, "Whatever-Password-1", meta), 401, "invalid_credentials");
      assert.equal(err.message, "Invalid email or password.");
      const failures = await auditEntries({ action: "auth.login_failed", entityId: "unknown" });
      assert.equal(failures.length, 1);
      assert.equal(failures[0].actor, null);
      assert.deepEqual(failures[0].meta, { reason: "unknown_account" });
      assertNoPersonalData(JSON.stringify(failures), [unknownEmail], "failed login audit");

      const inactive = await userWithPassword();
      await patchAdminUser(inactive.id, { active: false });
      await expectAppError(authenticateAdmin(inactive.email, inactive.password, meta), 401, "invalid_credentials");
    });

    it("locks the account for 15 minutes after 5 failed attempts", async () => {
      const user = await userWithPassword();
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await expectAppError(authenticateAdmin(user.email, `Wrong-Password-${attempt}`, meta), 401, "invalid_credentials");
        assert.equal((await findAdminUserById(user.id, { maxAgeMs: 0 }))?.failedLoginAttempts, attempt);
      }
      const started = Date.now();
      const locked = await expectAppError(authenticateAdmin(user.email, "Wrong-Password-5", meta), 429, "account_locked");
      assert.equal(locked.message, "Too many failed attempts. Try again in 15 minutes.");
      assert.equal(locked.headers?.["Retry-After"], "900");
      const stored = await findAdminUserById(user.id, { maxAgeMs: 0 });
      assert.equal(stored?.failedLoginAttempts, 0);
      assert.ok(stored?.lockedUntil && Math.abs(stored.lockedUntil.getTime() - (started + 15 * MINUTE)) < 5000);

      await expectAppError(authenticateAdmin(user.email, user.password, meta), 429, "account_locked");
      assert.equal(await sessionCount(user.id), 0, "no session while locked");
      const [info] = (await listAdminUsers()).filter((item) => item.id === user.id);
      assert.ok(info.lockedUntil);

      const reasons = (await auditEntries({ action: "auth.login_failed", entityId: user.id })).map((entry) => entry.meta.reason);
      assert.deepEqual(reasons, ["wrong_password", "wrong_password", "wrong_password", "wrong_password", "wrong_password_locked", "locked"]);

      await patchAdminUser(user.id, { lockedUntil: new Date(Date.now() - 1000) });
      const result = await authenticateAdmin(user.email, user.password, meta);
      assert.ok(result.token);
      const unlocked = await findAdminUserById(user.id, { maxAgeMs: 0 });
      assert.equal(unlocked?.lockedUntil, null);
      assert.equal((await listAdminUsers()).find((item) => item.id === user.id)?.lockedUntil, null);
    });

    it("counts parallel wrong guesses on one instance exactly", async () => {
      // The lockout is the durable anti-abuse control now that rate limiting is per instance, so
      // five simultaneous guesses must still lock the account.
      const user = await userWithPassword();
      const outcomes = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => authenticateAdmin(user.email, `Parallel-Wrong-${i}`, meta)));
      assert.ok(outcomes.every((outcome) => outcome.status === "rejected"));
      const stored = await findAdminUserById(user.id, { maxAgeMs: 0 });
      assert.ok(stored?.lockedUntil && stored.lockedUntil.getTime() > Date.now(), "five parallel failures lock the account");
    });
  });

  describe("sessions", () => {
    it("resolves valid sessions and rejects malformed or unknown tokens", async () => {
      const user = await userWithPassword();
      const { token, expiresAt } = await createSession(user.id, meta);
      const resolved = await resolveSession(token);
      assert.equal(resolved?.user.id, user.id);
      assert.ok(resolved?.sessionId);
      assert.ok(expiresAt.getTime() > Date.now());
      for (const bad of [undefined, "", "short", `${token}x`, token.replace(/.$/, "*"), "A".repeat(43)]) {
        assert.equal(await resolveSession(bad), null, String(bad));
      }
    });

    it("expires sessions idle for 60 minutes and revokes them", async () => {
      const user = await userWithPassword();
      const { token } = await createSession(user.id, meta);
      await patchSession(token, { lastSeenAt: new Date(Date.now() - 59 * MINUTE) });
      assert.ok(await resolveSession(token), "still valid just under the idle timeout");
      await patchSession(token, { lastSeenAt: new Date(Date.now() - 61 * MINUTE) });
      assert.equal(await resolveSession(token), null);
      // The row stays (deleting would renumber the tab) but is revoked, so the token is dead and
      // the maintenance job removes the row later.
      const row = await sessionRowFor(token);
      assert.ok(row && decodeText(row.revokedAt), "the dead session is revoked");
      assert.equal(await sessionCount(user.id), 0);
    });

    it("expires sessions after their absolute lifetime even when active", async () => {
      const user = await userWithPassword();
      const { token } = await createSession(user.id, meta);
      await patchSession(token, {
        createdAt: new Date(Date.now() - 8 * 60 * MINUTE - 1000),
        expiresAt: new Date(Date.now() - 1000),
        lastSeenAt: new Date(),
      });
      assert.equal(await resolveSession(token), null);
      assert.equal(await sessionCount(user.id), 0);
    });

    it("refreshes lastSeenAt at most every 5 minutes", async () => {
      const user = await userWithPassword();
      const { token } = await createSession(user.id, meta);
      const recent = new Date(Date.now() - 2 * MINUTE);
      await patchSession(token, { lastSeenAt: recent });
      await resolveSession(token);
      const unchanged = await sessionRowFor(token);
      assert.equal(decodeText(unchanged?.lastSeenAt), encodeDate(recent));

      const stale = new Date(Date.now() - 6 * MINUTE);
      await patchSession(token, { lastSeenAt: stale });
      await resolveSession(token);
      const refreshed = await sessionRowFor(token);
      assert.ok(Date.parse(decodeText(refreshed?.lastSeenAt)) > Date.now() - 5000);
    });

    it("ends sessions of deactivated or missing users", async () => {
      const user = await userWithPassword();
      const { token } = await createSession(user.id, meta);
      await patchAdminUser(user.id, { active: false });
      assert.equal(await resolveSession(token), null);
      assert.equal(await sessionCount(user.id), 0);

      const orphan = await createSession(newId(), meta);
      assert.equal(await resolveSession(orphan.token), null);
    });

    it("destroySession and destroyUserSessions end the right sessions", async () => {
      const user = await userWithPassword();
      const a = await createSession(user.id, meta);
      const b = await createSession(user.id, meta);
      const c = await createSession(user.id, meta);
      await destroySession(a.token);
      assert.equal(await resolveSession(a.token), null);
      assert.equal(await sessionCount(user.id), 2);

      const keep = await resolveSession(b.token);
      assert.ok(keep);
      await destroyUserSessions(user.id, keep.sessionId);
      assert.ok(await resolveSession(b.token));
      assert.equal(await resolveSession(c.token), null);
      await destroyUserSessions(user.id);
      assert.equal(await sessionCount(user.id), 0);
      await destroySession("not-a-token");
    });

    it("builds cookie options that never outlive the session", () => {
      const inOneHour = new Date(Date.now() + 60 * MINUTE);
      const options = sessionCookieOptions(inOneHour);
      assert.deepEqual({ ...options, maxAge: undefined }, { httpOnly: true, secure: false, sameSite: "strict", path: "/", maxAge: undefined });
      assert.ok(options.maxAge <= 3600 && options.maxAge >= 3595);
      assert.equal(sessionCookieOptions().maxAge, SESSION_MAX_AGE_SECONDS);
      assert.equal(sessionCookieOptions(new Date(Date.now() - 1000)).maxAge, 0);
    });
  });

  describe("password changes", () => {
    it("changeOwnPassword keeps the current session and ends all others", async () => {
      const user = await userWithPassword();
      const current = await contextFor(user);
      await contextFor(user);
      await contextFor(user);
      assert.equal(await sessionCount(user.id), 3);
      await patchAdminUser(user.id, { mustChangePassword: true });

      const next = `Brand-New-Password-${uniqueSuffix()}`;
      secrets.push(user.password, next);
      await changeOwnPassword(current, user.password, next);
      assert.equal(await sessionCount(user.id), 1);
      assert.ok(await resolveSession((await authenticateAdmin(user.email, next, meta)).token), "the new password works");
      assert.equal((await findAdminUserById(user.id, { maxAgeMs: 0 }))?.mustChangePassword, false);
      await expectAppError(authenticateAdmin(user.email, user.password, meta), 401, "invalid_credentials");
      assert.equal((await auditEntries({ action: "auth.password_change", entityId: user.id })).length, 1);
    });

    it("changeOwnPassword validates the current and new passwords", async () => {
      const user = await userWithPassword();
      const ctx = await contextFor(user);
      const wrong = await expectAppError(changeOwnPassword(ctx, "Not-The-Password-1", "Another-Password-99"), 400, "invalid_current_password");
      assert.deepEqual(Object.keys(wrong.fields ?? {}), ["currentPassword"]);
      const same = await expectAppError(changeOwnPassword(ctx, user.password, user.password), 400, "invalid_input");
      assert.deepEqual(Object.keys(same.fields ?? {}), ["newPassword"]);
      await expectAppError(changeOwnPassword(ctx, user.password, "short"), 400, "invalid_input");
      await expectAppError(changeOwnPassword(ctx, "", "Another-Password-99"), 400, "invalid_input");
    });

    it("limits current-password guesses per user", async () => {
      const user = await userWithPassword();
      const ctx = await contextFor(user);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await expectAppError(changeOwnPassword(ctx, `Wrong-Current-${attempt}`, "Another-Password-99"), 400, "invalid_current_password");
      }
      const limited = await expectAppError(changeOwnPassword(ctx, user.password, "Another-Password-99"), 429, "rate_limited");
      assert.ok(Number(limited.headers?.["Retry-After"]) > 0);
      await expectAppError(authenticateAdmin(user.email, "Another-Password-99", meta), 401, "invalid_credentials");
    });

    it("resetAdminPassword issues a temporary password and ends every session of the user", async () => {
      const admin = await contextFor(await userWithPassword("admin", "Asela Administrator"));
      const target = await userWithPassword();
      await contextFor(target);
      await contextFor(target);
      await patchAdminUser(target.id, { lockedUntil: new Date(Date.now() + 10 * MINUTE), failedLoginAttempts: 3 });

      const { temporaryPassword } = await resetAdminPassword(target.id, admin);
      secrets.push(temporaryPassword, target.password);
      assert.equal(temporaryPassword.length, 20);
      assert.equal(await sessionCount(target.id), 0);
      const stored = await findAdminUserById(target.id, { maxAgeMs: 0 });
      assert.equal(stored?.mustChangePassword, true);
      assert.equal(stored?.lockedUntil, null);
      assert.equal(stored?.failedLoginAttempts, 0);
      const login = await authenticateAdmin(target.email, temporaryPassword, meta);
      assert.equal(login.user.mustChangePassword, true);
      await expectAppError(authenticateAdmin(target.email, target.password, meta), 401, "invalid_credentials");

      await expectAppError(resetAdminPassword(admin.user.id, admin), 400, "cannot_modify_self");
      await expectAppError(resetAdminPassword(newId(), admin), 404, "user_not_found");
      const audits = await auditEntries({ action: "user.reset_password", entityId: target.id });
      assert.deepEqual(
        audits.map((entry) => entry.meta),
        [
          { temporary: false, source: "cli" },
          { temporary: true, source: "admin" },
        ],
        "the fixture's CLI password, then the admin reset"
      );
      assert.equal(audits[1].actor?.user, admin.userId);
    });
  });

  describe("user management", () => {
    it("creates users with a temporary password, one row each, and rejects duplicate emails", async () => {
      const email = `New.User.${uniqueSuffix()}@SynergyPharma.test`;
      const { user, temporaryPassword } = await createAdminUser({ email, name: "Tharushi Silva", role: "hr" }, null);
      secrets.push(temporaryPassword);
      assert.equal(user.email, email.toLowerCase());
      assert.equal(user.mustChangePassword, true);
      assert.equal(user.active, true);
      assert.equal("passwordHash" in user, false);
      const err = await expectAppError(createAdminUser({ email: email.toUpperCase(), name: "Someone Else", role: "admin" }, null), 409, "duplicate_email");
      assert.ok(err.fields?.email);
      await expectAppError(createAdminUser({ email: "bad", name: "", role: "owner" }, null), 400, "invalid_input");

      const rows = (await listAdminUserRecords({ maxAgeMs: 0 })).filter((item) => item.email === email.toLowerCase());
      assert.equal(rows.length, 1, "the rejected duplicate left no row behind");
      const listed = await listAdminUsers();
      assert.equal(JSON.stringify(listed).includes("passwordHash"), false);
    });

    it("stores passwords only as scrypt hashes", async () => {
      const user = await userWithPassword("hr", "Hashed Account");
      secrets.push(user.password);
      const row = (await allRecords("AdminUsers", { maxAgeMs: 0 })).find((item) => decodeText(item.values.id) === user.id);
      assert.ok(row);
      const hash = decodeText(row.values.passwordHash);
      assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
      assert.equal(hash.includes(user.password), false);
      assert.equal(JSON.stringify(row.values).includes(user.password), false);
    });

    it("deactivating a user ends their sessions and blocks sign-in", async () => {
      const admin = await contextFor(await userWithPassword("admin", "Asela Administrator"));
      const target = await userWithPassword();
      await contextFor(target);
      const updated = await updateAdminUser(target.id, { active: false }, admin);
      assert.equal(updated.active, false);
      assert.equal(await sessionCount(target.id), 0);
      await expectAppError(authenticateAdmin(target.email, target.password, meta), 401, "invalid_credentials");
      await updateAdminUser(target.id, { active: true }, admin);
      assert.ok((await authenticateAdmin(target.email, target.password, meta)).token);
    });

    it("prevents admins from demoting or deactivating themselves", async () => {
      const admin = await contextFor(await userWithPassword("admin", "Asela Administrator"));
      await expectAppError(updateAdminUser(admin.user.id, { role: "hr" }, admin), 400, "cannot_modify_self");
      await expectAppError(updateAdminUser(admin.user.id, { active: false }, admin), 400, "cannot_modify_self");
      const renamed = await updateAdminUser(admin.user.id, { name: "Asela Perera" }, admin);
      assert.equal(renamed.name, "Asela Perera");
      await expectAppError(updateAdminUser(admin.user.id, {}, admin), 400, "invalid_input");
      await expectAppError(updateAdminUser("not-an-id", { name: "X Y" }, admin), 404, "user_not_found");
    });

    it("never removes the last active administrator", async () => {
      // Start from an empty AdminUsers tab so the count of administrators is known.
      await resetStore();
      const first = await userWithPassword("admin", "First Admin");
      const second = await userWithPassword("admin", "Second Admin");
      const firstCtx = await contextFor(first);

      const demoted = await updateAdminUser(second.id, { role: "hr" }, firstCtx);
      assert.equal(demoted.role, "hr");
      const err = await expectAppError(updateAdminUser(first.id, { role: "hr" }, null), 409, "last_admin");
      assert.equal(err.message, "At least one active administrator account is required.");
      await expectAppError(updateAdminUser(first.id, { active: false }, null), 409, "last_admin");

      const inactiveAdmin = await userWithPassword("admin", "Inactive Admin");
      await updateAdminUser(inactiveAdmin.id, { active: false }, firstCtx);
      await expectAppError(updateAdminUser(first.id, { active: false }, null), 409, "last_admin");
      assert.equal((await findAdminUserById(first.id, { maxAgeMs: 0 }))?.role, "admin");

      await updateAdminUser(second.id, { role: "admin" }, null);
      const nowHr = await updateAdminUser(first.id, { role: "hr" }, null);
      assert.equal(nowHr.role, "hr");
      const [audit] = await auditEntries({ action: "user.update", entityId: first.id });
      assert.equal(audit.actor, null);
      assert.equal(audit.meta.source, "cli");
    });

    it("keeps an administrator when the last two demote each other at the same time", async () => {
      await resetStore();
      await clearTableRows("AuditLog");
      const a = await contextFor(await userWithPassword("admin", "Admin Alpha"));
      const b = await contextFor(await userWithPassword("admin", "Admin Beta"));
      for (let round = 0; round < 5; round += 1) {
        await Promise.allSettled([updateAdminUser(b.user.id, { role: "hr" }, a), updateAdminUser(a.user.id, { role: "hr" }, b)]);
        const admins = (await listAdminUserRecords({ maxAgeMs: 0 })).filter((user) => user.role === "admin" && user.active);
        assert.ok(admins.length >= 1, `round ${round}: no active administrator left`);
        await patchAdminUser(a.user.id, { role: "admin" });
        await patchAdminUser(b.user.id, { role: "admin" });
      }
    });
  });
});
