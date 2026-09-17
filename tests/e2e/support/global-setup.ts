import { api, loginAsAdmin, loginAsHr } from "./api";
import { e2eEnv } from "./env";

// Fails fast with actionable messages when the environment is not ready. It never resets or
// deletes data, so several suites can share one test database.
export default async function globalSetup(): Promise<void> {
  const health = await api<{ status: string; checks: Record<string, { status: string }> }>("GET", "/api/health", {
    headers: e2eEnv.healthToken ? { authorization: `Bearer ${e2eEnv.healthToken}` } : {},
  });
  if (health.status !== 200) {
    throw new Error(`Site under test is not healthy (${health.status}): ${health.text}`);
  }
  const checks = health.body.checks ?? {};
  for (const name of ["database", "storage", "email"]) {
    const status = checks[name]?.status;
    if (!status || status === "missing" || status === "error") {
      throw new Error(`Health check "${name}" is ${status ?? "absent"}; configure it on the server under test.`);
    }
  }
  await loginAsAdmin();
  await loginAsHr();
}
