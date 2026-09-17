import { expect, test } from "@playwright/test";
import { api, login, loginAsAdmin, loginAsHr, uniqueSuffix } from "../support/api";
import { e2eEnv } from "../support/env";
import type { AdminUserInfo, AuditLogEntry, CreateAdminUserResponse, Paginated } from "@/types/careers";
import { expectApiError, expectExactKeys, expectIsoDate, expectNoSensitiveData, expectStatus } from "./lib/assertions";
import { createActiveUser, createUser, deactivateUser, lettersOnly, randomObjectId } from "./lib/fixtures";

// Team management and the audit log (administrators only).

const USER_INFO_KEYS = ["id", "email", "name", "role", "active", "mustChangePassword", "lastLoginAt", "lockedUntil", "createdAt"] as const;
const AUDIT_KEYS = ["id", "at", "actorName", "actorEmail", "action", "entityType", "entityId", "summary", "ip"] as const;

test.describe("admin users API", () => {
  let admin = "";
  let hr = "";
  const createdUsers: string[] = [];

  test.beforeAll(async () => {
    admin = await loginAsAdmin();
    hr = await loginAsHr();
  });

  test.afterAll(async () => {
    for (const id of createdUsers) await deactivateUser(admin, id);
  });

  test("lists accounts without credentials", async () => {
    const result = await api<{ items: AdminUserInfo[] }>("GET", "/api/admin/users", { cookie: admin });
    expectStatus(result, 200);
    expectExactKeys(result.body, ["items"], "users body");
    const emails = result.body.items.map((user) => user.email);
    expect(emails).toContain(e2eEnv.adminEmail);
    expect(emails).toContain(e2eEnv.hrEmail);
    for (const user of result.body.items) {
      expectExactKeys(user, USER_INFO_KEYS, `user ${user.id}`);
      expectIsoDate(user.createdAt, "createdAt");
    }
    expectNoSensitiveData(result.body, "user list");
    expect(result.text).not.toMatch(/scrypt|passwordHash|failedLoginAttempts/);
  });

  test("creates an account with a one-time temporary password", async () => {
    const suffix = uniqueSuffix();
    const email = `E2E.Create.${suffix}@SynergyPharma.lk`;
    const result = await api<CreateAdminUserResponse>("POST", "/api/admin/users", {
      cookie: admin,
      json: { email, name: `  Amal  ${lettersOnly(suffix)}  Silva `, role: "hr" },
    });
    expectStatus(result, 201);
    createdUsers.push(result.body.user.id);
    expectExactKeys(result.body, ["user", "temporaryPassword"], "create response");
    expectExactKeys(result.body.user, USER_INFO_KEYS, "created user");
    expect(result.body.user).toMatchObject({
      email: email.toLowerCase(),
      name: `Amal ${lettersOnly(suffix)} Silva`,
      role: "hr",
      active: true,
      mustChangePassword: true,
      lastLoginAt: null,
      lockedUntil: null,
    });
    expect(result.body.temporaryPassword).toMatch(/^\S{20}$/);
    expectStatus(await api("POST", "/api/admin/login", { json: { email, password: result.body.temporaryPassword } }), 200);

    const duplicate = await api("POST", "/api/admin/users", { cookie: admin, json: { email: email.toUpperCase(), name: "Another Person", role: "admin" } });
    expectApiError(duplicate, 409, "duplicate_email", { fields: ["email"] });
  });

  test("validates new accounts", async () => {
    const invalid = await api("POST", "/api/admin/users", { cookie: admin, json: { email: "not-an-email", name: "Agent 007", role: "superadmin" } });
    expectApiError(invalid, 400, "invalid_input", { fields: ["email", "name", "role"] });
    const operators = await api("POST", "/api/admin/users", {
      cookie: admin,
      json: { email: `e2e.ops.${uniqueSuffix()}@synergypharma.lk`, name: "Valid Name", role: { $ne: "hr" } },
    });
    expectApiError(operators, 400, "invalid_input", { fields: ["role"] });
    expectApiError(await api("POST", "/api/admin/users", { cookie: admin, json: { email: ["a@b.co"], name: "Valid Name", role: "hr" } }), 400, "invalid_input", {
      fields: ["email"],
    });
  });

  test("updates name, role and active status", async () => {
    const { user } = await createUser(admin, "hr", "users-update");
    createdUsers.push(user.id);
    const renamed = await api<{ user: AdminUserInfo }>("PATCH", `/api/admin/users/${user.id}`, { cookie: admin, json: { name: "Renamed Person" } });
    expectStatus(renamed, 200);
    expectExactKeys(renamed.body, ["user"], "update body");
    expect(renamed.body.user).toMatchObject({ id: user.id, name: "Renamed Person", role: "hr", active: true });

    const promoted = await api<{ user: AdminUserInfo }>("PATCH", `/api/admin/users/${user.id}`, { cookie: admin, json: { role: "admin" } });
    expect(promoted.body.user.role).toBe("admin");
    const demoted = await api<{ user: AdminUserInfo }>("PATCH", `/api/admin/users/${user.id}`, { cookie: admin, json: { role: "hr", active: false } });
    expect(demoted.body.user).toMatchObject({ role: "hr", active: false });

    expectApiError(await api("PATCH", `/api/admin/users/${user.id}`, { cookie: admin, json: {} }), 400, "invalid_input");
    expectApiError(await api("PATCH", `/api/admin/users/${user.id}`, { cookie: admin, json: { active: "false" } }), 400, "invalid_input", { fields: ["active"] });
    expectApiError(await api("PATCH", `/api/admin/users/${user.id}`, { cookie: admin, json: { role: "owner" } }), 400, "invalid_input", { fields: ["role"] });
    // Unknown fields such as a password hash are never applied.
    const smuggled = await api<{ user: AdminUserInfo }>("PATCH", `/api/admin/users/${user.id}`, {
      cookie: admin,
      json: { name: "Renamed Again", passwordHash: "scrypt$1$1$1$AAAA$BBBB", mustChangePassword: false, email: "hijack@example.com" },
    });
    expectStatus(smuggled, 200);
    expect(smuggled.body.user).toMatchObject({ name: "Renamed Again", mustChangePassword: true, email: user.email });
  });

  test("role changes apply to existing sessions immediately", async () => {
    const promoted = await createActiveUser(admin, "admin", "users-demote");
    createdUsers.push(promoted.id);
    expectStatus(await api("GET", "/api/admin/users", { cookie: promoted.cookie }), 200);
    expectStatus(await api("PATCH", `/api/admin/users/${promoted.id}`, { cookie: admin, json: { role: "hr" } }), 200);
    expectApiError(await api("GET", "/api/admin/users", { cookie: promoted.cookie }), 403, "forbidden");
    const me = await api<{ user: { role: string } }>("GET", "/api/admin/me", { cookie: promoted.cookie });
    expect(me.body.user.role).toBe("hr");
  });

  test("unknown and malformed user ids are 404", async () => {
    for (const id of [randomObjectId(), "not-an-id", "6aabaf9b96b77f9a5b230f0z", "%24ne"]) {
      expectApiError(await api("PATCH", `/api/admin/users/${id}`, { cookie: admin, json: { name: "Nobody Here" } }), 404, "user_not_found");
      expectApiError(await api("POST", `/api/admin/users/${id}/reset-password`, { cookie: admin }), 404, "user_not_found");
    }
  });

  test("administrators cannot demote, deactivate or reset themselves", async () => {
    const self = await createActiveUser(admin, "admin", "users-self");
    createdUsers.push(self.id);
    expectApiError(await api("PATCH", `/api/admin/users/${self.id}`, { cookie: self.cookie, json: { active: false } }), 400, "cannot_modify_self");
    expectApiError(await api("PATCH", `/api/admin/users/${self.id}`, { cookie: self.cookie, json: { role: "hr" } }), 400, "cannot_modify_self");
    expectApiError(await api("POST", `/api/admin/users/${self.id}/reset-password`, { cookie: self.cookie }), 400, "cannot_modify_self");
    const renamed = await api<{ user: AdminUserInfo }>("PATCH", `/api/admin/users/${self.id}`, { cookie: self.cookie, json: { name: "Self Renamed" } });
    expectStatus(renamed, 200);
    const users = await api<{ items: AdminUserInfo[] }>("GET", "/api/admin/users", { cookie: admin });
    expect(users.body.items.find((item) => item.id === self.id)).toMatchObject({ role: "admin", active: true, name: "Self Renamed" });
  });

  test("resetting a password issues a new temporary password", async () => {
    const target = await createActiveUser(admin, "hr", "users-reset");
    createdUsers.push(target.id);
    const reset = await api<{ temporaryPassword: string }>("POST", `/api/admin/users/${target.id}/reset-password`, { cookie: admin });
    expectStatus(reset, 200);
    expectExactKeys(reset.body, ["temporaryPassword"], "reset body");
    expect(reset.body.temporaryPassword).toMatch(/^\S{20}$/);
    expectApiError(await api("POST", "/api/admin/login", { json: { email: target.email, password: target.password } }), 401, "invalid_credentials");
    const cookie = await login(target.email, reset.body.temporaryPassword);
    const me = await api<{ user: { mustChangePassword: boolean } }>("GET", "/api/admin/me", { cookie });
    expect(me.body.user.mustChangePassword).toBe(true);
  });

  test("HR users cannot manage accounts", async () => {
    const id = randomObjectId();
    expectApiError(await api("GET", "/api/admin/users", { cookie: hr }), 403, "forbidden");
    expectApiError(await api("POST", "/api/admin/users", { cookie: hr, json: { email: `e2e.hr.${uniqueSuffix()}@example.com`, name: "Sneaky Admin", role: "admin" } }), 403, "forbidden");
    expectApiError(await api("PATCH", `/api/admin/users/${id}`, { cookie: hr, json: { role: "admin" } }), 403, "forbidden");
    expectApiError(await api("POST", `/api/admin/users/${id}/reset-password`, { cookie: hr }), 403, "forbidden");
  });
});

test.describe("admin audit log API", () => {
  let admin = "";
  let hr = "";
  let subject: CreateAdminUserResponse;

  test.beforeAll(async () => {
    admin = await loginAsAdmin();
    hr = await loginAsHr();
    subject = await createUser(admin, "hr", "audit-subject");
  });

  test.afterAll(async () => {
    await deactivateUser(admin, subject.user.id);
  });

  test("returns paginated entries filtered by record", async () => {
    const result = await api<Paginated<AuditLogEntry>>("GET", `/api/admin/audit?entityType=admin_user&entityId=${subject.user.id}`, { cookie: admin });
    expectStatus(result, 200);
    expectExactKeys(result.body, ["items", "total", "page", "limit", "pageCount"], "audit page");
    expect(result.body).toMatchObject({ page: 1, limit: 25 });
    const actions = result.body.items.map((entry) => entry.action);
    expect(actions).toContain("user.create");
    for (const entry of result.body.items) {
      expectExactKeys(entry, AUDIT_KEYS, "audit entry");
      expect(entry.entityType).toBe("admin_user");
      expect(entry.entityId).toBe(subject.user.id);
      expectIsoDate(entry.at, "at");
    }
    const created = result.body.items.find((entry) => entry.action === "user.create");
    expect(created?.actorEmail).toBe(e2eEnv.adminEmail);
    expectNoSensitiveData(result.body, "audit log");
    expect(result.text).not.toContain(subject.temporaryPassword);
  });

  test("filters by action prefix or exact action, and paginates", async () => {
    const prefix = await api<Paginated<AuditLogEntry>>("GET", "/api/admin/audit?action=auth&limit=50", { cookie: admin });
    expectStatus(prefix, 200);
    expect(prefix.body.limit).toBe(50);
    expect(prefix.body.items.length).toBeGreaterThan(0);
    for (const entry of prefix.body.items) expect(entry.action.startsWith("auth.")).toBe(true);

    const exact = await api<Paginated<AuditLogEntry>>("GET", "/api/admin/audit?action=auth.login&limit=5&page=2", { cookie: admin });
    expectStatus(exact, 200);
    expect(exact.body).toMatchObject({ page: 2, limit: 5 });
    for (const entry of exact.body.items) expect(entry.action).toBe("auth.login");

    const clamped = await api<Paginated<AuditLogEntry>>("GET", "/api/admin/audit?limit=100000&page=-4", { cookie: admin });
    expectStatus(clamped, 200);
    expect(clamped.body).toMatchObject({ page: 1, limit: 100 });

    const today = new Date().toISOString().slice(0, 10);
    const ranged = await api<Paginated<AuditLogEntry>>("GET", `/api/admin/audit?from=2020-01-01&to=${today}&entityId=${subject.user.id}`, { cookie: admin });
    expectStatus(ranged, 200);
  });

  test("rejects malformed and injected filters", async () => {
    const cases: [string, string][] = [
      ["action=$where", "action"],
      ["action=auth.login.extra", "action"],
      ["action=.*", "action"],
      ["entityType=admin_user%7C%7C1", "entityType"],
      [`entityId=${encodeURIComponent('{"$ne":null}')}`, "entityId"],
      ["actorId=not-an-id", "actorId"],
      ["from=2026-13-01", "from"],
      ["to=yesterday", "to"],
      ["from=2026-09-10&to=2026-09-01", "to"],
    ];
    for (const [query, field] of cases) {
      expectApiError(await api("GET", `/api/admin/audit?${query}`, { cookie: admin }), 400, "invalid_input", { fields: [field] });
    }
    // Bracket syntax is not parsed into operators; the unknown parameter is ignored.
    expectStatus(await api("GET", "/api/admin/audit?action[$ne]=x", { cookie: admin }), 200);
  });

  test("failed sign-ins are audited without the attempted email address", async () => {
    const attempted = `e2e.unknown.${uniqueSuffix()}@synergypharma.lk`;
    const failed = await api("POST", "/api/admin/login", { json: { email: attempted, password: "Wrong-Password-12345" } });
    expect(failed.status).toBe(401);
    const audit = await api<Paginated<AuditLogEntry>>("GET", "/api/admin/audit?action=auth.login_failed&limit=50", { cookie: admin });
    expectStatus(audit, 200);
    expect(audit.body.items.length).toBeGreaterThan(0);
    expect(audit.text.toLowerCase()).not.toContain(attempted.toLowerCase());
    expect(audit.text).not.toContain("Wrong-Password-12345");
  });

  test("HR users cannot read the audit log", async () => {
    expectApiError(await api("GET", "/api/admin/audit", { cookie: hr }), 403, "forbidden");
  });
});
