import { isGoogleConfigured, readGoogleEnv } from "@/lib/google/config";
import { checkFolderAccess } from "@/lib/google/drive";
import { GoogleConfigError, GoogleNotFoundError, isGoogleUnavailableError } from "@/lib/google/errors";
import { pingSheets } from "@/lib/google/sheets";

// The data layer's public face. Everything above this point imports from here rather than from
// the Google clients directly, so the store can be swapped again without touching services.
//
// This module replaces src/lib/mongodb.ts. The differences worth knowing:
//
//   * There is no connection to open. `ensureStoreReady()` exists so the call sites that used to
//     call connectToDatabase() keep a single obvious place to fail fast on a misconfiguration,
//     but it makes no network request.
//   * "Unavailable" now means Google returned 429/5xx or could not be reached, and is still
//     answered with 503 by src/lib/http/handler.ts.
//   * Uniqueness is enforced by the store (src/lib/sheets-db/table.ts), not by an index, so
//     there is no duplicate-key error to classify.

export { StoreConfigError, StoreUnavailableError } from "@/lib/sheets-db/errors";

export type { LoadedTable, RecordValues, TableRecord } from "@/lib/sheets-db/table";
export {
  allRecords,
  appendRecord,
  appendRecords,
  findById,
  findRecord,
  findRecords,
  invalidateTable,
  loadTable,
  loadTables,
  reconcileDuplicate,
  updateRecord,
  updateRecordsBatch,
} from "@/lib/sheets-db/table";

export { withLock, withLocks } from "@/lib/sheets-db/locks";
export { deleteRows, ensureSchema, inspectSchema } from "@/lib/sheets-db/bootstrap";
export { SCHEMA_VERSION, TABLES, TABLE_NAMES, type TableName } from "@/lib/sheets-db/schema";

// Throws when the Google configuration is incomplete, so a request fails with a clear
// server_misconfigured response instead of an obscure error deeper in a service. Makes no
// network call: the first real Sheets request does that.
export function ensureStoreReady(): void {
  const { settings, problems } = readGoogleEnv();
  if (settings) return;
  const variables = [...new Set(problems.map((problem) => problem.variable))].join(", ");
  throw new GoogleConfigError(`The Google Sheets data store is not configured (check ${variables}).`);
}

export function isStoreConfigured(): boolean {
  return isGoogleConfigured();
}

// True when a failure means "Google can't be reached right now" rather than a bug or bad input.
// src/lib/http/handler.ts turns this into 503 Service Unavailable.
export function isStoreUnavailableError(err: unknown): boolean {
  return isGoogleUnavailableError(err);
}

export function isStoreConfigError(err: unknown): boolean {
  return err instanceof GoogleConfigError || (err instanceof Error && err.name === "GoogleConfigError");
}

export function isStoreNotFoundError(err: unknown): boolean {
  return err instanceof GoogleNotFoundError || (err instanceof Error && err.name === "GoogleNotFoundError");
}

// Round-trips a request to the spreadsheet and the Drive folder. Used by the health check.
export async function pingStore(): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  return pingSheets();
}

export async function pingDocumentStore(): Promise<{ ok: boolean; error?: string }> {
  return checkFolderAccess();
}
