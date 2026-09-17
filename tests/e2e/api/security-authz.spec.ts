import { expect, test } from "@playwright/test";
import { api, loginAsAdmin, loginAsHr, uniqueSuffix, type ApiResult } from "../support/api";
import { e2eEnv } from "../support/env";
import type { AdminJob, AdminUserInfo } from "@/types/careers";
import { expectApiError, expectStatus } from "./lib/assertions";
import { ORIGIN_EVIL, createJob, createPendingUser, deactivateUser, jobPayload, retireJob, sendStreamedJson } from "./lib/fixtures";
import { ADMIN_ROUTES, BYPASS_HEADER_VARIANTS, UNSAFE_ADMIN_ROUTES, describeRoute, requestFollowingRscRedirects, type AdminRoute } from "./lib/routes";

// Authorization matrix for every admin API route: anonymous, HR, pending password change,
// header-based bypass attempts, percent-encoded paths, CSRF and request body limits.

function call(route: AdminRoute, options: { cookie?: string; headers?: Record<string, string>; sameOrigin?: boolean } = {}) {
  return requestFollowingRscRedirects(route.method, route.path, { json: route.json, ...options });
}

// Next.js answers "x-middleware-prefetch" requests itself with an empty `{}` body and never runs
// the route handler; that is not a bypass. Every other response must be the expected denial.
function expectDenied(result: ApiResult<unknown>, headers: Record<string, string>, status: number, code: string, label: string): void {
  if (headers["x-middleware-prefetch"] && result.status === 200) {
    expect(result.text.trim(), `${label}: short-circuited prefetch must be empty`).toBe("{}");
    return;
  }
  expect(result.status, `${label}: ${result.text.slice(0, 200)}`).toBe(status);
  expectApiError(result, status, code);
}

test.describe("admin API authorization", () => {
  let admin = "";
  let hr = "";

  test.beforeAll(async () => {
    admin = await loginAsAdmin();
    hr = await loginAsHr();
  });

  test("anonymous requests get 401 on every admin route, whatever headers they send", async () => {
    for (const route of ADMIN_ROUTES) {
      for (const headers of BYPASS_HEADER_VARIANTS) {
        const result = await call(route, { headers });
        expectDenied(result, headers, 401, "unauthorized", `${describeRoute(route)} ${JSON.stringify(headers)}`);
      }
    }
  });

  test("invalid session cookies are rejected on every admin route", async () => {
    const forged = [
      `__Host-synergy_admin=${"A".repeat(43)}`,
      "__Host-synergy_admin=",
      "__Host-synergy_admin=undefined",
      `synergy_admin=${admin.split("=")[1]}`,
      `__Host-synergy_admin=${admin.split("=")[1]}x`,
      `__host-synergy_admin=${admin.split("=")[1]}`,
    ];
    for (const route of ADMIN_ROUTES) {
      for (const cookie of forged) {
        const result = await call(route, { cookie });
        expect(result.status, `${describeRoute(route)} with ${cookie.slice(0, 30)}`).toBe(401);
      }
    }
  });

  test("HR users get 403 on administrator-only routes, with or without bypass headers", async () => {
    for (const route of ADMIN_ROUTES.filter((item) => item.adminOnly)) {
      for (const headers of BYPASS_HEADER_VARIANTS) {
        const result = await call(route, { cookie: hr, headers });
        expectDenied(result, headers, 403, "forbidden", `${describeRoute(route)} ${JSON.stringify(headers)}`);
      }
    }
    // Everything else is open to HR (the random ids simply do not exist).
    for (const route of ADMIN_ROUTES.filter((item) => !item.adminOnly)) {
      const result = await call(route, { cookie: hr });
      expect([200, 201, 400, 404], `${describeRoute(route)} → ${result.status} ${result.text.slice(0, 200)}`).toContain(result.status);
    }
  });

  test("a user with a temporary password can only see themselves, change the password or sign out", async () => {
    const pending = await createPendingUser(admin, "admin", "matrix-pending");
    try {
      for (const route of ADMIN_ROUTES) {
        const result = await call(route, { cookie: pending.cookie });
        if (route.allowPasswordChangePending) {
          expect(result.status, describeRoute(route)).not.toBe(403);
          expect(result.status, describeRoute(route)).not.toBe(401);
        } else {
          expectApiError(result, 403, "password_change_required");
        }
      }
      const logout = await api("POST", "/api/admin/logout", { cookie: pending.cookie });
      expectStatus(logout, 200);
      expectApiError(await api("GET", "/api/admin/me", { cookie: pending.cookie }), 401, "unauthorized");
    } finally {
      await deactivateUser(admin, pending.user.id);
    }
  });

  test("HEAD and OPTIONS requests reveal nothing and enforce the same rules", async () => {
    for (const route of ADMIN_ROUTES.filter((item) => item.method === "GET")) {
      const anonymous = await api("HEAD", route.path);
      expect(anonymous.status, `HEAD ${route.path} anonymous`).toBe(401);
      expect(anonymous.text).toBe("");
      if (route.adminOnly) expect((await api("HEAD", route.path, { cookie: hr })).status, `HEAD ${route.path} as HR`).toBe(403);
      const options = await api("OPTIONS", route.path, { sameOrigin: false });
      expect([204, 405], `OPTIONS ${route.path}`).toContain(options.status);
      expect(options.text).toBe("");
      expect(options.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  test("prototype-pollution payloads neither crash handlers nor grant privileges", async () => {
    const payloads = [
      '{"__proto__":{"role":"admin","roles":["hr"],"allowPasswordChangePending":true,"mustChangePassword":false}}',
      '{"constructor":{"prototype":{"role":"admin","active":true}},"name":"Polluted Name"}',
      '{"__proto__":{"archivedAt":null},"archived":{"__proto__":{"valueOf":1}}}',
    ];
    const targets = ["/api/admin/jobs", "/api/admin/talent-pool", `/api/admin/applications/${"0".repeat(24)}/archive`, "/api/admin/login", "/api/apply", "/api/contact"];
    for (const path of targets) {
      for (const body of payloads) {
        const result = await api("POST", path, { cookie: hr, body, headers: { "content-type": "application/json" } });
        expect(result.status, `${path} ${body}: ${result.text.slice(0, 200)}`).toBeLessThan(500);
        expect(result.status, `${path} ${body}`).not.toBe(200);
        expect(result.status, `${path} ${body}`).not.toBe(201);
      }
    }
    expectApiError(await api("GET", "/api/admin/users", { cookie: hr }), 403, "forbidden");
    const me = await api<{ user: { role: string } }>("GET", "/api/admin/me", { cookie: hr });
    expect(me.body.user.role).toBe("hr");
  });

  test("percent-encoded and case-variant admin paths never bypass authorization", async () => {
    const paths = [
      "/api/%61dmin/users",
      "/api/admin/%75sers",
      "/api/admin%2Fusers",
      "/%61pi/admin/users",
      "/api/ADMIN/users",
      "/api/Admin/Stats",
      "/api/admin/users%2F",
      "/api/admin/users/",
      "//api/admin/users",
      "/api/admin/users;.css",
      "/api/admin/users%3F.js",
      "/api/admin/stats.json",
      "/api/admin/%2e%2e/admin/users",
    ];
    for (const path of paths) {
      for (const cookie of [undefined, hr]) {
        const result = await api("GET", path, { cookie, headers: { "next-router-prefetch": "1" } });
        expect(result.status, `${path} (${cookie ? "hr" : "anonymous"})`).not.toBe(200);
        expect(result.text, path).not.toContain(e2eEnv.adminEmail);
        expect(result.text, path).not.toContain('"byStatus"');
      }
    }
  });

  test("cross-site requests are blocked on every unsafe admin method before anything runs", async () => {
    const crossSite: { label: string; headers: Record<string, string>; sameOrigin?: boolean }[] = [
      { label: "foreign Origin", headers: { origin: ORIGIN_EVIL } },
      { label: "null Origin", headers: { origin: "null" } },
      { label: "look-alike Origin", headers: { origin: `${e2eEnv.baseUrl}.evil.example` } },
      { label: "Origin with credentials", headers: { origin: `http://user@${new URL(e2eEnv.baseUrl).host}.evil.example` } },
      { label: "Sec-Fetch-Site cross-site", headers: { "sec-fetch-site": "cross-site" }, sameOrigin: false },
      { label: "Sec-Fetch-Site same-site", headers: { "sec-fetch-site": "same-site" }, sameOrigin: false },
      { label: "foreign Origin with Sec-Fetch-Site cross-site", headers: { origin: ORIGIN_EVIL, "sec-fetch-site": "cross-site" } },
    ];
    const routes = [
      ...UNSAFE_ADMIN_ROUTES,
      { method: "POST" as const, path: "/api/admin/logout" },
      { method: "POST" as const, path: "/api/admin/login", json: { email: e2eEnv.adminEmail, password: e2eEnv.adminPassword } },
    ];
    for (const route of routes) {
      for (const variant of crossSite) {
        const result = await call(route, { cookie: admin, headers: variant.headers, sameOrigin: variant.sameOrigin });
        expect(result.status, `${describeRoute(route)} with ${variant.label}: ${result.text.slice(0, 200)}`).toBe(403);
        expectApiError(result, 403, "cross_site_request");
      }
    }
    // The admin session survived the blocked logout attempts.
    expectStatus(await api("GET", "/api/admin/me", { cookie: admin }), 200);
  });

  test("blocked cross-site writes leave data untouched; same-origin and non-browser requests pass", async () => {
    const job: AdminJob = await createJob(admin, jobPayload("matrix-csrf"));
    try {
      const patch = await api("PATCH", `/api/admin/jobs/${job.id}`, {
        cookie: admin,
        json: { ...jobPayload("matrix-csrf-edit"), title: "Changed by CSRF" },
        headers: { origin: ORIGIN_EVIL },
      });
      expect(patch.status).toBe(403);
      expectApiError(await api("DELETE", `/api/admin/jobs/${job.id}`, { cookie: admin, headers: { origin: ORIGIN_EVIL } }), 403, "cross_site_request");
      const email = `e2e.csrf.${uniqueSuffix()}@synergypharma.lk`;
      const createUser = await api("POST", "/api/admin/users", {
        cookie: admin,
        json: { email, name: "Csrf Victim", role: "admin" },
        headers: { "sec-fetch-site": "cross-site" },
        sameOrigin: false,
      });
      expect(createUser.status).toBe(403);

      const current = await api<{ job: AdminJob }>("GET", `/api/admin/jobs/${job.id}`, { cookie: admin });
      expect(current.body.job.title).toBe(job.title);
      const users = await api<{ items: AdminUserInfo[] }>("GET", "/api/admin/users", { cookie: admin });
      expect(users.body.items.map((user) => user.email)).not.toContain(email);

      const edit = { ...jobPayload("matrix-csrf-edit"), title: "Edited same-origin" };
      const sameOrigin = await api<{ job: AdminJob }>("PATCH", `/api/admin/jobs/${job.id}`, {
        cookie: admin,
        json: edit,
        sameOrigin: false,
        headers: { "sec-fetch-site": "same-origin" },
      });
      expectStatus(sameOrigin, 200);
      const nonBrowser = await api<{ job: AdminJob }>("PATCH", `/api/admin/jobs/${job.id}`, { cookie: admin, json: { ...edit, title: "Edited by script" }, sameOrigin: false });
      expectStatus(nonBrowser, 200);
      const matchingOrigin = await api<{ job: AdminJob }>("PATCH", `/api/admin/jobs/${job.id}`, {
        cookie: admin,
        json: { ...edit, title: "Edited with Origin" },
        headers: { origin: e2eEnv.baseUrl, "sec-fetch-site": "same-origin" },
      });
      expectStatus(matchingOrigin, 200);
      expect(matchingOrigin.body.job.title).toBe("Edited with Origin");
    } finally {
      await retireJob(admin, job.id);
    }
  });

  test("admin JSON bodies must be JSON and within each route's size limit", async () => {
    const textJob = await api("POST", "/api/admin/jobs", { cookie: hr, body: JSON.stringify(jobPayload("matrix-text")), headers: { "content-type": "text/plain" } });
    expectApiError(textJob, 415, "unsupported_media_type");
    const formNote = await api("POST", "/api/admin/applications/000000000000000000000000/notes", {
      cookie: hr,
      body: "body=hello",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expectApiError(formNote, 415, "unsupported_media_type");
    const multipart = await api("POST", "/api/admin/talent-pool", { cookie: hr, body: "--x--", headers: { "content-type": "multipart/form-data; boundary=x" } });
    expectApiError(multipart, 415, "unsupported_media_type");
    expectApiError(await api("PATCH", "/api/admin/talent-pool/000000000000000000000000", { cookie: hr, json: ["name"] }), 400, "invalid_json");

    const hugeJob = await api("POST", "/api/admin/jobs", { cookie: hr, json: { ...jobPayload("matrix-huge"), description: "d".repeat(600 * 1024) } });
    expectApiError(hugeJob, 413, "payload_too_large");
    const hugeNote = await api("POST", "/api/admin/applications/000000000000000000000000/notes", { cookie: hr, json: { body: "n".repeat(300 * 1024) } });
    expectApiError(hugeNote, 413, "payload_too_large");
    const hugeUser = await api("POST", "/api/admin/users", { cookie: admin, json: { email: "a@b.co", name: "n".repeat(20 * 1024), role: "hr" } });
    expectApiError(hugeUser, 413, "payload_too_large");
    const hugeStatus = await api("POST", "/api/admin/jobs/e2e-matrix-no-such-job/status", { cookie: hr, json: { action: "publish", padding: "p".repeat(8 * 1024) } });
    expectApiError(hugeStatus, 413, "payload_too_large");
    const hugePassword = await api("POST", "/api/admin/password", { cookie: hr, json: { currentPassword: "x", newPassword: "p".repeat(20 * 1024) } });
    expectApiError(hugePassword, 413, "payload_too_large");

    const streamed = await sendStreamedJson("POST", "/api/admin/jobs", 700 * 1024, { cookie: hr });
    expect(streamed.status, streamed.text.slice(0, 200)).toBe(413);
  });
});
