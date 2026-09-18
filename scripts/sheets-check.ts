// Read-only health check for a deployment's configuration and its Google Sheets / Google Drive
// data store.
//
//   npm run sheets:check
//
// Reports configuration problems (errors fail the check), whether the spreadsheet can be read
// and how long that took, every tab with its row count, tabs or columns that are missing (error)
// and columns the application does not use (warning), the schema version recorded in the sheet,
// whether the Drive folder is reachable and writable, and whether at least one active
// administrator exists (error if not). Writes nothing. Exits with status 1 when any error is
// found.

import "./lib/load-env";
import { getConfigProblems } from "@/lib/env";
import { inspectSchema, pingDocumentStore, pingStore, SCHEMA_VERSION, TABLE_NAMES } from "@/lib/sheets-db";
import { countActiveAdmins } from "@/lib/sheets-db/repositories/admin";
import { getSetting } from "@/lib/sheets-db/repositories/settings";
import { SETTINGS_KEYS } from "@/lib/sheets-db/schema";
import { COMMON_OPTIONS, describeError, parseScriptArgs, printTable } from "./lib/cli";
import { driveFolderUrl, printStoreTarget, spreadsheetUrl, storeTarget } from "./lib/store";

const USAGE = `Usage: npm run sheets:check -- [options]

Options:
  --no-env-files   Ignore .env.local / .env and use only exported environment variables.
  --help           Show this help.`;

parseScriptArgs({ ...COMMON_OPTIONS }, USAGE);

let errors = 0;
let warnings = 0;

function ok(line: string) {
  console.log(`  ✓ ${line}`);
}
function warn(line: string) {
  warnings += 1;
  console.log(`  ! ${line}`);
}
function fail(line: string) {
  errors += 1;
  console.log(`  ✗ ${line}`);
}

function checkConfiguration() {
  console.log("Configuration");
  try {
    const problems = getConfigProblems();
    for (const problem of problems) {
      if (problem.level === "error") fail(`${problem.variable}: ${problem.message}`);
      else warn(`${problem.variable}: ${problem.message}`);
    }
    if (problems.length === 0) ok("No configuration problems found.");
  } catch (err) {
    fail(`Configuration could not be checked: ${describeError(err)}`);
  }
}

// The tabs, their columns and how many records each one holds.
async function checkSchema(): Promise<void> {
  console.log("\nTabs");
  const report = await inspectSchema();
  ok(`Spreadsheet "${report.spreadsheetTitle}"`);

  printTable(
    ["Tab", "Rows"],
    report.tables.map((table) => [table.name, table.exists ? table.rowCount : "-"])
  );

  for (const problem of report.problems) {
    if (problem.level === "error") fail(problem.message);
    else warn(problem.message);
  }
  for (const table of report.tables) {
    if (table.extraColumns.length > 0) {
      warn(`"${table.name}" has column(s) the application does not use: ${table.extraColumns.join(", ")} (they are ignored).`);
    }
  }
  if (report.problems.length === 0) ok(`All ${TABLE_NAMES.length} tab(s) present with every expected column.`);

  const recorded = await getSetting(SETTINGS_KEYS.schemaVersion);
  if (recorded === SCHEMA_VERSION) {
    ok(`Schema version ${SCHEMA_VERSION}.`);
  } else if (recorded === null) {
    warn(`The Settings tab has no ${SETTINGS_KEYS.schemaVersion} row. Run: npm run sheets:setup`);
  } else {
    warn(`The spreadsheet records schema version ${recorded}, this release expects ${SCHEMA_VERSION}. Run: npm run sheets:setup`);
  }
}

async function checkDocuments(driveFolderId: string): Promise<void> {
  console.log("\nDocuments (Google Drive)");
  const drive = await pingDocumentStore();
  if (drive.ok) {
    ok("The folder is reachable and writable.");
    return;
  }
  switch (drive.error) {
    case "folder_not_found":
      fail(`The folder was not found. Check GOOGLE_DRIVE_FOLDER_ID and share ${driveFolderUrl(driveFolderId)} with the service account as Editor.`);
      return;
    case "not_a_folder":
      fail("GOOGLE_DRIVE_FOLDER_ID points at a file, not a folder.");
      return;
    case "not_writable":
      fail(`The service account can read the folder but not add files to it. Share ${driveFolderUrl(driveFolderId)} as Editor, not Viewer.`);
      return;
    case "misconfigured":
      fail("The Google service-account variables are incomplete or malformed.");
      return;
    default:
      fail("Google Drive could not be reached.");
  }
}

async function checkAdministrators(): Promise<void> {
  console.log("\nAdministrators");
  const admins = await countActiveAdmins({ maxAgeMs: 0 });
  if (admins === 0) {
    fail('No active administrator account. Create one: npm run admin:user -- create --email you@example.com --name "Your Name" --role admin');
  } else {
    ok(`${admins} active administrator account(s)`);
  }
}

async function checkStore(): Promise<void> {
  console.log("\nData store");
  const target = storeTarget();
  if (!target) {
    fail("The Google Sheets data store is not configured; the live checks were skipped.");
    return;
  }
  printStoreTarget(target);

  const ping = await pingStore();
  if (!ping.ok) {
    switch (ping.error) {
      case "spreadsheet_not_found":
        fail(`The spreadsheet was not found. Check GOOGLE_SHEETS_SPREADSHEET_ID: ${spreadsheetUrl(target.spreadsheetId)}`);
        break;
      case "misconfigured":
        fail("Google refused the credentials, or the service account is not allowed to open the spreadsheet.");
        console.log(`    Share ${spreadsheetUrl(target.spreadsheetId)} with ${target.clientEmail} as Editor.`);
        break;
      default:
        fail("The spreadsheet could not be read: Google could not be reached.");
    }
    return;
  }
  ok(`Read the spreadsheet in ${ping.latencyMs} ms`);

  // Each of the remaining checks is independent: a missing tab must not hide a Drive problem.
  for (const step of [checkSchema, () => checkDocuments(target.driveFolderId), checkAdministrators]) {
    try {
      await step();
    } catch (err) {
      fail(describeError(err));
    }
  }
}

async function main() {
  checkConfiguration();
  await checkStore();
  console.log(`\n${errors} error(s), ${warnings} warning(s).`);
  if (errors > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`\n✗ Check failed: ${describeError(err)}`);
  process.exitCode = 1;
});
