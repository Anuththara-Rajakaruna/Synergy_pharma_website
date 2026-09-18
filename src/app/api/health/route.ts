import { isEmailConfigured } from "@/lib/email/transport";
import { bearerTokenMatches } from "@/lib/env";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { logger } from "@/lib/logger";
import { inspectSchema, isStoreConfigured, pingDocumentStore, pingStore } from "@/lib/sheets-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HealthStatus = {
  status: "ok" | "degraded";
  time: string;
  checks: {
    database: { status: "ok" | "error"; latencyMs?: number };
    storage: { status: "configured" | "missing" | "ok" | "error" };
    email: { status: "configured" | "missing" };
    indexes?: { status: "ok" | "missing" };
  };
};

// Every tab and every column this release expects exists in the spreadsheet.
//
// This is what the index check was: a guard against a deployment that skipped its setup step.
// `npm run sheets:setup` creates the tabs and headers, and nothing does it automatically, so a
// spreadsheet that never had it run - or a tab someone renamed in the browser - would otherwise
// show up only as records quietly losing fields. Missing columns are not fatal at runtime
// (decoders fall back to defaults), which is exactly why they have to be reported here.
async function schemaComplete(): Promise<boolean> {
  try {
    const report = await inspectSchema();
    let complete = true;
    for (const table of report.tables) {
      if (!table.exists) {
        complete = false;
        logger.warn("health.indexes_missing", { table: table.name, reason: "tab_missing" });
      } else if (table.missingColumns.length > 0) {
        complete = false;
        logger.warn("health.indexes_missing", { table: table.name, columns: table.missingColumns });
      }
    }
    return complete;
  } catch (err) {
    logger.warn("health.indexes_unreadable", { err });
    return false;
  }
}

// Liveness plus a spreadsheet ping for everyone; with `Authorization: Bearer <HEALTHCHECK_TOKEN>`
// also verifies that the Drive folder is reachable and writable and that the spreadsheet has
// every tab and column. Responses carry statuses only, never ids, hostnames or error messages.
export const GET = apiHandler("api.health", async (request: Request) => {
  const token = process.env.HEALTHCHECK_TOKEN?.trim() ?? "";
  const deep = token !== "" && bearerTokenMatches(request.headers.get("authorization"), token);

  const database = await pingStore();
  const storageConfigured = isStoreConfigured();
  const body: HealthStatus = {
    status: "ok",
    time: new Date().toISOString(),
    checks: {
      database: database.ok ? { status: "ok", latencyMs: database.latencyMs } : { status: "error" },
      storage: { status: storageConfigured ? "configured" : "missing" },
      email: { status: isEmailConfigured() ? "configured" : "missing" },
    },
  };

  if (deep) {
    if (storageConfigured) {
      const documents = await pingDocumentStore();
      if (!documents.ok) logger.warn("health.storage_unavailable", { reason: documents.error });
      body.checks.storage = { status: documents.ok ? "ok" : "error" };
    }
    if (database.ok) body.checks.indexes = { status: (await schemaComplete()) ? "ok" : "missing" };
  }

  const degraded =
    !database.ok ||
    body.checks.storage.status === "missing" ||
    body.checks.storage.status === "error" ||
    body.checks.email.status === "missing" ||
    body.checks.indexes?.status === "missing";
  if (degraded) body.status = "degraded";
  if (!database.ok) logger.warn("health.database_unavailable", { reason: database.error });

  return jsonResponse(body, { status: database.ok ? 200 : 503 });
});
