import { isEmailConfigured } from "@/lib/email/transport";
import { bearerTokenMatches } from "@/lib/env";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { logger } from "@/lib/logger";
import { pingDatabase } from "@/lib/mongodb";
import { checkBucketAccess, isStorageConfigured } from "@/lib/storage";
import { ALL_MODELS } from "@/models";

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

// Default index names as MongoDB/Mongoose generate them, for schema indexes without a name.
function indexName(fields: Record<string, unknown>, options: { name?: unknown }): string {
  if (typeof options.name === "string") return options.name;
  return Object.entries(fields)
    .map(([key, direction]) => `${key}_${String(direction)}`)
    .join("_");
}

// Every index declared in the schemas exists (production runs with autoIndex off, so a missed
// `npm run db:setup` would otherwise silently drop the unique constraints).
async function schemaIndexesPresent(): Promise<boolean> {
  let allPresent = true;
  for (const model of ALL_MODELS) {
    const expected = model.schema.indexes().map(([fields, options]) => indexName(fields, options));
    if (expected.length === 0) continue;
    try {
      const existing = new Set(
        (await model.listIndexes()).map((index: { name?: unknown }) => (typeof index.name === "string" ? index.name : ""))
      );
      const missing = expected.filter((name) => !existing.has(name));
      if (missing.length > 0) {
        allPresent = false;
        logger.warn("health.indexes_missing", { collection: model.collection.collectionName, indexes: missing });
      }
    } catch (err) {
      allPresent = false;
      logger.warn("health.indexes_unreadable", { collection: model.collection.collectionName, err });
    }
  }
  return allPresent;
}

// Liveness plus a database ping for everyone; with `Authorization: Bearer <HEALTHCHECK_TOKEN>`
// also verifies bucket access and indexes. Responses carry statuses only, never hostnames or
// error messages.
export const GET = apiHandler("api.health", async (request: Request) => {
  const token = process.env.HEALTHCHECK_TOKEN?.trim() ?? "";
  const deep = token !== "" && bearerTokenMatches(request.headers.get("authorization"), token);

  const database = await pingDatabase();
  const storageConfigured = isStorageConfigured();
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
    if (storageConfigured) body.checks.storage = { status: (await checkBucketAccess()) ? "ok" : "error" };
    if (database.ok) body.checks.indexes = { status: (await schemaIndexesPresent()) ? "ok" : "missing" };
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
