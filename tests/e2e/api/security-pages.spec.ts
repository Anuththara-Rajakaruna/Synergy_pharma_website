import { expect, test } from "@playwright/test";
import { api, loginAsHr, type ApiResult } from "../support/api";
import { e2eEnv } from "../support/env";
import { BYPASS_HEADER_VARIANTS, requestFollowingRscRedirects } from "./lib/routes";

// Security headers on pages and APIs, and the admin page's server-side session check (including
// the proxy-bypass and encoded-path tricks that used to expose it).

function directives(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) map.set(name.toLowerCase(), values);
  }
  return map;
}

function expectCommonHeaders(result: ApiResult<unknown>, label: string): void {
  const headers = result.headers;
  expect(headers.get("x-frame-options"), label).toBe("DENY");
  expect(headers.get("x-content-type-options"), label).toBe("nosniff");
  expect(headers.get("referrer-policy"), label).toBe("strict-origin-when-cross-origin");
  expect(headers.get("cross-origin-opener-policy"), label).toBe("same-origin");
  expect(headers.get("strict-transport-security"), label).toBe("max-age=63072000; includeSubDomains");
  expect(headers.get("permissions-policy"), label).toContain("camera=()");
  expect(headers.get("x-powered-by"), label).toBeNull();
}

// The admin workspace is rendered only for a valid session: the payload then carries the
// signed-in user. Anything else must redirect to the sign-in page without that payload.
function expectNoAdminWorkspace(result: ApiResult<unknown>, label: string): void {
  expect(result.status, `${label}: ${result.status}`).not.toBe(500);
  expect(result.text, label).not.toContain("currentUser");
  expect(result.text, label).not.toContain(e2eEnv.hrEmail);
  expect(result.text, label).not.toContain(e2eEnv.adminEmail);
  if (result.status >= 300 && result.status < 400) {
    const location = result.headers.get("location") ?? "";
    expect(location, label).toMatch(/^\/careers\/admin(?:\/login|\?|$)|^\/careers\/admin\/login/);
  }
}

test.describe("security headers", () => {
  test("pages send a nonce-based CSP and hardening headers", async () => {
    const nonces = new Set<string>();
    for (const path of ["/", "/careers", "/contact", "/careers/admin/login"]) {
      const result = await api("GET", path, { headers: { accept: "text/html" } });
      expect(result.status, path).toBe(200);
      expectCommonHeaders(result, path);
      const csp = result.headers.get("content-security-policy") ?? "";
      const policy = directives(csp);
      const scriptSrc = policy.get("script-src") ?? [];
      const nonce = scriptSrc.find((value) => value.startsWith("'nonce-"))?.slice(7, -1) ?? "";
      expect(nonce, `${path} script-src nonce`).toMatch(/^[A-Za-z0-9+/=]{16,}$/);
      nonces.add(nonce);
      expect(scriptSrc, path).toContain("'strict-dynamic'");
      expect(scriptSrc, path).not.toContain("'unsafe-inline'");
      expect(scriptSrc, path).not.toContain("'unsafe-eval'");
      expect(policy.get("object-src"), path).toEqual(["'none'"]);
      expect(policy.get("frame-ancestors"), path).toEqual(["'none'"]);
      expect(policy.get("base-uri"), path).toEqual(["'self'"]);
      expect(policy.get("form-action"), path).toEqual(["'self'"]);
      expect(policy.get("default-src"), path).toEqual(["'self'"]);
      // Executable scripts carry the nonce; only inert JSON-LD may omit it.
      const scripts = result.text.match(/<script\b[^>]*>/g) ?? [];
      expect(scripts.length, path).toBeGreaterThan(0);
      for (const tag of scripts) {
        if (/type="application\/ld\+json"/.test(tag)) continue;
        expect(tag, `${path} script tag`).toContain(`nonce="${nonce}"`);
      }
    }
    expect(nonces.size, "a fresh nonce per response").toBe(4);
  });

  test("the CSP lets forms upload to the storage origin and nowhere else", async () => {
    const presign = await api<{ uploads: { url: string }[] }>("POST", "/api/uploads", {
      json: { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: 1024, contentType: "application/pdf" }] },
    });
    expect(presign.status).toBe(201);
    const storageOrigin = new URL(presign.body.uploads[0].url).origin;
    const page = await api("GET", "/careers");
    const connectSrc = directives(page.headers.get("content-security-policy") ?? "").get("connect-src") ?? [];
    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain(storageOrigin);
    expect(connectSrc).not.toContain("*");
    expect(connectSrc).not.toContain("ws:");
  });

  test("API responses are not cacheable, not indexable and not embeddable cross-origin", async () => {
    const hr = await loginAsHr();
    const responses: [string, ApiResult<unknown>][] = [
      ["GET /api/jobs", await api("GET", "/api/jobs")],
      ["GET /api/health", await api("GET", "/api/health")],
      ["GET /api/admin/me (401)", await api("GET", "/api/admin/me")],
      ["GET /api/admin/stats", await api("GET", "/api/admin/stats", { cookie: hr })],
      ["POST /api/apply (400)", await api("POST", "/api/apply", { json: {} })],
      ["GET /api/jobs/missing (404)", await api("GET", "/api/jobs/e2e-no-such-job")],
    ];
    for (const [label, result] of responses) {
      expectCommonHeaders(result, label);
      expect(result.headers.get("cache-control"), label).toContain("no-store");
      expect(result.headers.get("x-robots-tag"), label).toBe("noindex");
      expect(result.headers.get("cross-origin-resource-policy"), label).toBe("same-origin");
      expect(result.headers.get("content-type"), label).toContain("application/json");
      expect(result.headers.get("access-control-allow-origin"), label).toBeNull();
    }
  });

  test("CORS preflights from other origins are not granted", async () => {
    const preflight = await api("OPTIONS", "/api/admin/jobs", {
      sameOrigin: false,
      headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
  });

  test("admin pages are never indexed", async () => {
    for (const path of ["/careers/admin", "/careers/admin/login", "/careers/admin?tab=jobs"]) {
      const result = await api("GET", path);
      expect(result.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
    }
  });
});

test.describe("admin page access", () => {
  test("signed-out visitors are redirected to sign-in, whatever headers they send", async () => {
    for (const headers of BYPASS_HEADER_VARIANTS) {
      const label = `/careers/admin ${JSON.stringify(headers)}`;
      const result = await requestFollowingRscRedirects("GET", "/careers/admin?tab=users", { headers });
      expectNoAdminWorkspace(result, label);
      expect(result.status, label).toBe(307);
      expect(result.headers.get("location"), label).toMatch(/^\/careers\/admin\/login\?from=/);
    }
  });

  test("forged session cookies never render the workspace", async () => {
    const cookies = [`__Host-synergy_admin=${"A".repeat(43)}`, "__Host-synergy_admin=forged", "synergy_admin=forged"];
    for (const cookie of cookies) {
      for (const headers of BYPASS_HEADER_VARIANTS) {
        const result = await requestFollowingRscRedirects("GET", "/careers/admin", { cookie, headers });
        expectNoAdminWorkspace(result, `${cookie} ${JSON.stringify(headers)}`);
        if (result.status === 200 && (result.headers.get("content-type") ?? "").includes("text/html")) {
          expect(result.text).toContain("/careers/admin/login");
        }
      }
    }
  });

  test("percent-encoded and case-variant admin page paths do not expose the workspace", async () => {
    const paths = ["/careers/%61dmin", "/careers/admin%2F", "/CAREERS/ADMIN", "/careers/Admin", "/careers//admin", "/careers/admin/", "/careers/admin/%2e%2e/admin", "/careers/admin/login/..%2F"];
    for (const path of paths) {
      const result = await api("GET", path, { headers: { "next-router-prefetch": "1" } });
      expectNoAdminWorkspace(result, path);
    }
  });

  test("a valid session renders the workspace (control)", async () => {
    const hr = await loginAsHr();
    const result = await api("GET", "/careers/admin", { cookie: hr });
    expect(result.status).toBe(200);
    expect(result.text).toContain("currentUser");
    expect(result.text).toContain(e2eEnv.hrEmail);
    expect(result.headers.get("cache-control") ?? "").toContain("no-store");
  });

  test("the sign-in page never redirects a signed-in user off-site", async () => {
    const hr = await loginAsHr();
    for (const from of ["https://evil.example", "//evil.example", "/\\evil.example", "/careers/admin/../../evil", "javascript:alert(1)", "/careers/adminx"]) {
      const result = await api("GET", `/careers/admin/login?from=${encodeURIComponent(from)}`, { cookie: hr });
      const target = result.status >= 300 && result.status < 400 ? (result.headers.get("location") ?? "") : (/NEXT_REDIRECT;[a-z]+;([^;]+);/.exec(result.text)?.[1] ?? "");
      expect(target, from).toMatch(/^\/careers\/admin(?:[?#]|$)/);
    }
  });
});
