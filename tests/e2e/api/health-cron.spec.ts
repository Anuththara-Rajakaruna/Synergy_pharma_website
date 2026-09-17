import { expect, test } from "@playwright/test";
import { api } from "../support/api";
import { e2eEnv } from "../support/env";
import { expectApiError, expectExactKeys, expectIsoDate, expectStatus, isRecord } from "./lib/assertions";

// GET /api/health (shallow for everyone, deep with the monitoring token) and the scheduled
// maintenance endpoint protected by CRON_SECRET.

type HealthBody = {
  status: string;
  time: string;
  checks: Record<string, { status: string; latencyMs?: number }>;
};

// Health output is public: it must never reveal hosts, bucket names or connection strings.
function expectNoInfrastructureDetails(text: string): void {
  for (const secret of ["mongodb", "127.0.0.1", "localhost", "synergy-cvs", "s3", "smtp", e2eEnv.healthToken]) {
    if (secret) expect(text.toLowerCase(), `health output mentions "${secret}"`).not.toContain(secret.toLowerCase());
  }
}

test.describe("GET /api/health", () => {
  test("shallow check reports statuses only", async () => {
    const result = await api<HealthBody>("GET", "/api/health");
    expectStatus(result, 200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expectExactKeys(result.body, ["status", "time", "checks"], "health body");
    expect(["ok", "degraded"]).toContain(result.body.status);
    expectIsoDate(result.body.time, "time");
    expectExactKeys(result.body.checks, ["database", "storage", "email"], "shallow checks");
    expect(result.body.checks.database.status).toBe("ok");
    expect(typeof result.body.checks.database.latencyMs).toBe("number");
    expect(result.body.checks.storage.status).toBe("configured");
    expect(result.body.checks.email.status).toBe("configured");
    expectNoInfrastructureDetails(result.text);
  });

  test("deep check with the monitoring token verifies bucket access and indexes", async () => {
    test.skip(!e2eEnv.healthToken, "E2E_HEALTHCHECK_TOKEN is not set.");
    const result = await api<HealthBody>("GET", "/api/health", { headers: { authorization: `Bearer ${e2eEnv.healthToken}` } });
    expectStatus(result, 200);
    expectExactKeys(result.body.checks, ["database", "storage", "email", "indexes"], "deep checks");
    expect(result.body.checks.storage.status).toBe("ok");
    expect(["ok", "missing"]).toContain(result.body.checks.indexes.status);
    expect(result.body.status).toBe(result.body.checks.indexes.status === "ok" ? "ok" : "degraded");
    expectNoInfrastructureDetails(result.text);
  });

  test("a wrong, malformed or query-string token only gets the shallow check", async () => {
    const variants: { path: string; headers: Record<string, string> }[] = [
      { path: "/api/health", headers: { authorization: "Bearer wrong-token-000000000000000000000000000" } },
      { path: "/api/health", headers: { authorization: `Basic ${e2eEnv.healthToken}` } },
      { path: "/api/health", headers: { authorization: `Bearer ${e2eEnv.healthToken}x` } },
      { path: `/api/health?token=${encodeURIComponent(e2eEnv.healthToken)}`, headers: {} },
    ];
    for (const variant of variants) {
      const result = await api<HealthBody>("GET", variant.path, { headers: variant.headers });
      expectStatus(result, 200);
      expect(Object.keys(result.body.checks).sort(), JSON.stringify(variant)).toEqual(["database", "email", "storage"]);
    }
  });
});

test.describe("/api/cron/maintenance", () => {
  test("rejects requests without the cron secret", async () => {
    const variants: { method: string; path: string; headers: Record<string, string> }[] = [
      { method: "GET", path: "/api/cron/maintenance", headers: {} },
      { method: "POST", path: "/api/cron/maintenance", headers: {} },
      { method: "GET", path: "/api/cron/maintenance", headers: { authorization: "Bearer not-the-secret" } },
      { method: "GET", path: "/api/cron/maintenance", headers: { authorization: e2eEnv.cronSecret } },
      { method: "GET", path: "/api/cron/maintenance", headers: { authorization: `Bearer ${e2eEnv.cronSecret.slice(0, -1)}` } },
      { method: "GET", path: `/api/cron/maintenance?secret=${encodeURIComponent(e2eEnv.cronSecret)}`, headers: {} },
      { method: "GET", path: "/api/cron/maintenance", headers: { "x-vercel-cron": "1", "user-agent": "vercel-cron/1.0" } },
    ];
    for (const variant of variants) {
      const result = await api(variant.method, variant.path, { headers: variant.headers });
      expectApiError(result, 401, "unauthorized");
    }
  });

  test("runs maintenance with the cron secret over GET and POST", async () => {
    test.skip(!e2eEnv.cronSecret, "E2E_CRON_SECRET is not set.");
    for (const method of ["GET", "POST"]) {
      const result = await api<Record<string, unknown>>(method, "/api/cron/maintenance", {
        headers: { authorization: `Bearer ${e2eEnv.cronSecret}` },
      });
      expectStatus(result, 200);
      expect(result.headers.get("cache-control")).toContain("no-store");
      const report = result.body;
      expectExactKeys(report, ["emails", "uploads", "retention", "durationMs"], "maintenance report");
      expectExactKeys(report.emails, ["sent", "failed", "retried", "skipped"], "emails");
      expectExactKeys(report.uploads, ["deletedObjects", "errors"], "uploads");
      expectExactKeys(
        report.retention,
        ["overdueApplications", "overdueTalent", "purgedApplications", "purgedTalent", "autoPurge"],
        "retention"
      );
      if (!isRecord(report.retention)) throw new Error("retention missing");
      expect(report.retention.autoPurge).toBe(false);
      expect(report.retention.purgedApplications).toBe(0);
      expect(typeof report.durationMs).toBe("number");
    }
  });
});
