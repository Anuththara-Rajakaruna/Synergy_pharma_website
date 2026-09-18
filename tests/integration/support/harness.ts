import { integrationConfig, setEnv } from "./env";
import { deleteRows, ensureSchema, invalidateTable, loadTable, TABLE_NAMES, type TableName } from "@/lib/sheets-db";
import { getSetting } from "@/lib/sheets-db/repositories/settings";
import { acquireSuiteLock } from "./lock";
import { emptyDriveFolder } from "./drive";
import { SmtpSink, findFreeSmtpPort } from "./smtp-sink";

// Per-file setup for the integration suite. Every test file runs in its own process (the npm
// script passes --test-concurrency=1 so files never overlap; a lock file also serializes files
// started in parallel) and starts from an empty spreadsheet and Drive folder.
//
// "Empty" means the data rows of every tab are deleted and every file under the Drive folder is
// removed. That is destructive, so it is guarded twice:
//
//   1. The spreadsheet id comes only from INTEGRATION_GOOGLE_SHEETS_SPREADSHEET_ID (see env.ts).
//   2. The Settings tab of that spreadsheet must carry the row `test.spreadsheet` = `true`.
//      Nothing in the application ever writes that key: an operator types it into the sheet by
//      hand when they create the test spreadsheet. A production spreadsheet does not have it,
//      so pointing the suite at one fails before a single row is touched.

export const TEST_MARKER_KEY = "test.spreadsheet";
const TEST_MARKER_VALUE = "true";

// Settings rows that survive the reset: the marker itself and the bookkeeping ensureSchema owns.
const KEPT_SETTINGS_KEYS = new Set([TEST_MARKER_KEY, "schema.version", "schema.createdAt"]);

export type IntegrationOptions = {
  // Start an in-process SMTP capture server and point the application at it (default false).
  smtp?: boolean;
};

export type Integration = {
  smtp: SmtpSink | null;
  logs: () => string;
  stop: () => Promise<void>;
};

type ConsoleMethod = (...args: unknown[]) => void;

// The application logs JSON lines to the console. They are collected (for PII assertions) and only
// printed when INTEGRATION_VERBOSE=1.
function captureLogs(): { text: () => string; restore: () => void } {
  const original: Record<"info" | "warn" | "error", ConsoleMethod> = { info: console.info, warn: console.warn, error: console.error };
  const lines: string[] = [];
  const verbose = process.env.INTEGRATION_VERBOSE === "1";
  for (const method of ["info", "warn", "error"] as const) {
    console[method] = (...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" "));
      if (verbose) original[method](...args);
    };
  }
  return {
    text: () => lines.join("\n"),
    restore: () => {
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

function refuse(reason: string): never {
  throw new Error(
    `Refusing to run the integration suite against spreadsheet ${integrationConfig.spreadsheetId}: ${reason}\n` +
      `Create a separate spreadsheet for testing, run "npm run sheets:setup" against it, then add a row to its ` +
      `Settings tab with key "${TEST_MARKER_KEY}" and value "${TEST_MARKER_VALUE}". The suite will not write to a ` +
      `spreadsheet that does not carry that row.`
  );
}

// Reads the marker before anything is written. A Settings tab that cannot be read at all (a
// spreadsheet that was never set up, or one the service account cannot open) is reported the
// same way rather than being repaired: repairing it would be a write.
async function assertTestSpreadsheet(): Promise<void> {
  if (!integrationConfig.spreadsheetId) refuse("no spreadsheet id is configured.");
  if (process.env.GOOGLE_SHEETS_SPREADSHEET_ID !== integrationConfig.spreadsheetId) {
    refuse("the application is configured for a different spreadsheet than the suite.");
  }

  let marker: string | null = null;
  try {
    marker = await getSetting(TEST_MARKER_KEY);
  } catch (err) {
    refuse(`its Settings tab could not be read (${err instanceof Error ? err.name : "unknown error"}).`);
  }
  if (marker === null) refuse(`its Settings tab has no "${TEST_MARKER_KEY}" row.`);
  if (marker.trim().toLowerCase() !== TEST_MARKER_VALUE) {
    refuse(`its "${TEST_MARKER_KEY}" setting is not "${TEST_MARKER_VALUE}".`);
  }
}

// Deletes every data row of one tab, keeping its header. Exported because a few tests need a
// single tab back to a known state half-way through (counting audit entries, counting admins).
export async function clearTableRows(name: TableName): Promise<number> {
  const table = await loadTable(name, { maxAgeMs: 0 });
  const rows = table.records
    .filter((record) => {
      // Settings is keyed by `key`, not by `id`, and keeps the rows the harness depends on.
      if (name !== "Settings") return true;
      return !KEPT_SETTINGS_KEYS.has(String(record.values.key ?? "").trim());
    })
    .map((record) => record.rowNumber);
  if (rows.length === 0) return 0;
  // deleteRows removes bottom-up and refuses row 1, so the header row is never at risk.
  return deleteRows(name, rows);
}

// Empties every tab and the Drive folder. Exported because a few tests need to start from a
// known state again half-way through (e.g. counting administrators).
export async function resetStore(): Promise<void> {
  await assertTestSpreadsheet();
  for (const name of TABLE_NAMES) await clearTableRows(name);
  invalidateTable();
  await emptyDriveFolder();
}

export async function startIntegration(options: IntegrationOptions = {}): Promise<Integration> {
  const release = await acquireSuiteLock(`synergy-sheets-${integrationConfig.spreadsheetId}`);
  const logs = captureLogs();
  let smtp: SmtpSink | null = null;
  try {
    // The guard runs before any write, including the schema repair below.
    await assertTestSpreadsheet();
    // Idempotent: creates missing tabs and appends columns a previous release did not have.
    await ensureSchema();
    for (const name of TABLE_NAMES) await clearTableRows(name);
    invalidateTable();
    await emptyDriveFolder();
    if (options.smtp) {
      smtp = new SmtpSink(await findFreeSmtpPort());
      await smtp.start();
      setEnv("SMTP_PORT", String(smtp.port));
    }
  } catch (err) {
    logs.restore();
    release();
    throw err;
  }

  return {
    smtp,
    logs: logs.text,
    stop: async () => {
      try {
        await smtp?.stop();
        invalidateTable();
      } finally {
        logs.restore();
        release();
      }
    },
  };
}
