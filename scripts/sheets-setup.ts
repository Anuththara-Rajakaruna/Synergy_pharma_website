// Prepares the Google Spreadsheet that backs the careers portal. Safe to re-run after every
// release, and safe to run against a spreadsheet that is full of live data.
//
//   npm run sheets:setup
//   npm run sheets:setup -- --seed-sample-jobs     Add the sample postings from src/data/jobs.json
//                                                  as drafts (only into an empty Jobs tab).
//
// 1. Creates every tab that does not exist yet and writes its header row.
// 2. Appends any column a previous release did not have. Existing columns are never moved,
//    renamed or removed, and no row is ever touched: rows are addressed by number, so repairing
//    the structure cannot disturb the records already in the sheet.
// 3. Freezes and bolds row 1 and widens tabs that need more columns than the default grid has.
// 4. Records the schema version on the Settings tab.
//
// It then verifies the result, checks that the Drive folder can be written to, and prints the
// two things no script can do for itself: sharing the spreadsheet and the Drive folder with the
// service account.
//
// Requires the Google service-account variables (see .env.example). Nothing is deleted.

import "./lib/load-env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FIELD_LIMITS, JOB_TYPES, type JobType } from "@/lib/careers/constants";
import { newId } from "@/lib/careers/server/ids";
import type { JobRecord } from "@/lib/careers/server/records";
import { isValidJobSlug } from "@/lib/careers/validation";
import { appendRecords, ensureSchema, inspectSchema, pingDocumentStore, TABLE_NAMES } from "@/lib/sheets-db";
import { jobRow, listAllJobs } from "@/lib/sheets-db/repositories/jobs";
import { COMMON_OPTIONS, describeError, parseScriptArgs } from "./lib/cli";
import { driveFolderUrl, printStoreTarget, requireStoreTarget, sharingChecklist, spreadsheetUrl } from "./lib/store";

const USAGE = `Usage: npm run sheets:setup -- [options]

Options:
  --seed-sample-jobs     Insert the postings from src/data/jobs.json as drafts if the Jobs tab is empty.
  --no-env-files         Ignore .env.local / .env and use only exported environment variables.
  --help                 Show this help.`;

const args = parseScriptArgs({ ...COMMON_OPTIONS, "seed-sample-jobs": { type: "boolean" } }, USAGE);

let problems = 0;

function ok(line: string) {
  console.log(`  ✓ ${line}`);
}
function warn(line: string) {
  console.log(`  ! ${line}`);
}
function fail(line: string) {
  problems += 1;
  console.log(`  ✗ ${line}`);
}

// ── Sample postings ──────────────────────────────────────────────────────────

type SampleJob = {
  id: string;
  title: string;
  department: string;
  location: string;
  type: string;
  description: string;
  responsibilities?: string[];
  requirements?: string[];
};

// src/data/jobs.json is edited by hand, so it is checked before anything is written. These are
// the rules the store cannot repair on its own: a slug that is not URL-safe, an unknown
// employment type, empty required text and text past a column's limit.
function sampleProblems(sample: SampleJob): string[] {
  const found: string[] = [];
  if (!isValidJobSlug(String(sample.id ?? "").trim().toLowerCase())) found.push("id (not a valid slug)");
  if (!String(sample.title ?? "").trim()) found.push("title (required)");
  if (String(sample.title ?? "").length > FIELD_LIMITS.jobTitle) found.push("title (too long)");
  if (!String(sample.department ?? "").trim()) found.push("department (required)");
  if (!String(sample.location ?? "").trim()) found.push("location (required)");
  if (!String(sample.description ?? "").trim()) found.push("description (required)");
  if (String(sample.description ?? "").length > FIELD_LIMITS.jobDescription) found.push("description (too long)");
  if (!(JOB_TYPES as readonly string[]).includes(String(sample.type ?? ""))) found.push("type (not an employment type)");
  return found;
}

function toDraftJob(sample: SampleJob, createdAt: Date): JobRecord {
  return {
    id: newId(createdAt),
    slug: sample.id.trim().toLowerCase(),
    title: sample.title,
    department: sample.department,
    location: sample.location,
    type: sample.type as JobType,
    experience: "",
    description: sample.description,
    responsibilities: sample.responsibilities ?? [],
    requirements: sample.requirements ?? [],
    qualifications: [],
    benefits: [],
    applicationDeadline: null,
    // Never published by accident: the operator reviews and publishes them from the admin panel.
    status: "draft",
    publishedAt: null,
    closedAt: null,
    archivedAt: null,
    createdBy: null,
    createdByName: null,
    updatedBy: null,
    updatedByName: null,
    origin: "seed",
    createdAt,
    updatedAt: createdAt,
  };
}

async function seedSampleJobs(): Promise<boolean> {
  const existing = await listAllJobs({ maxAgeMs: 0 });
  if (existing.length > 0) {
    console.log(`  The Jobs tab already has ${existing.length} row(s); sample postings were not added.`);
    return true;
  }

  const file = path.join(process.cwd(), "src", "data", "jobs.json");
  const samples = JSON.parse(await readFile(file, "utf8")) as SampleJob[];
  const now = Date.now();
  const jobs: JobRecord[] = [];
  let valid = true;

  for (const [index, sample] of samples.entries()) {
    // Earlier entries get later timestamps so the admin list (newest first) matches the file order.
    const createdAt = new Date(now - index * 1000);
    const found = sampleProblems(sample);
    if (found.length > 0) {
      valid = false;
      console.log(`  ✗ sample job "${sample.id}" is invalid: ${found.join(", ")}`);
      continue;
    }
    jobs.push(toDraftJob(sample, createdAt));
  }

  const duplicates = jobs.map((job) => job.slug).filter((slug, index, all) => all.indexOf(slug) !== index);
  if (duplicates.length > 0) {
    console.log(`  ✗ src/data/jobs.json uses the same id more than once: ${[...new Set(duplicates)].join(", ")}`);
    valid = false;
  }
  if (!valid) return false;

  await appendRecords("Jobs", jobs.map(jobRow));
  console.log(`  ✓ Added ${jobs.length} sample posting(s) as drafts. Review and publish them from the admin panel.`);
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const target = requireStoreTarget();
  console.log("Target");
  printStoreTarget(target);

  console.log("\nCreating and repairing tabs ...");
  const result = await ensureSchema();
  if (result.createdTables.length > 0) ok(`Created ${result.createdTables.length} tab(s): ${result.createdTables.join(", ")}`);
  if (result.repairedTables.length > 0) ok(`Added the missing column(s) to: ${result.repairedTables.join(", ")}`);
  if (result.createdTables.length === 0 && result.repairedTables.length === 0) {
    ok(`All ${TABLE_NAMES.length} tab(s) were already correct; nothing was changed.`);
  } else if (result.alreadyCorrect.length > 0) {
    ok(`${result.alreadyCorrect.length} tab(s) were already correct.`);
  }

  console.log("\nVerifying ...");
  const report = await inspectSchema();
  ok(`Spreadsheet "${report.spreadsheetTitle}"`);
  for (const problem of report.problems) {
    if (problem.level === "error") fail(problem.message);
    else warn(problem.message);
  }
  if (report.problems.length === 0) {
    const rows = report.tables.reduce((total, table) => total + table.rowCount, 0);
    ok(`${report.tables.length} tab(s) present with every expected column, ${rows} data row(s) in total.`);
  }
  for (const table of report.tables) {
    if (table.extraColumns.length > 0) {
      warn(`"${table.name}" has column(s) the application does not use: ${table.extraColumns.join(", ")} (they are ignored).`);
    }
  }

  console.log("\nGoogle Drive ...");
  const drive = await pingDocumentStore();
  if (drive.ok) {
    ok("The documents folder is reachable and writable.");
  } else {
    fail(`The documents folder is not usable (${drive.error ?? "unknown"}). ${driveHint(drive.error)}`);
  }

  if (args["seed-sample-jobs"] === true) {
    console.log("\nSample job postings ...");
    if (!(await seedSampleJobs())) problems += 1;
  }

  console.log("\nChecklist - the service account cannot do these for itself:");
  for (const line of sharingChecklist(target)) console.log(`  ${line}`);

  console.log("");
  if (problems > 0) {
    console.log(`✗ Setup finished with ${problems} problem(s) (see above).`);
    process.exitCode = 1;
    return;
  }

  console.log("✓ The spreadsheet is ready.");
  console.log("\nNext steps:");
  console.log('  1. Create the first administrator:  npm run admin:user -- create --email you@example.com --name "Your Name" --role admin');
  console.log("  2. Verify the deployment:           npm run sheets:check");
}

function driveHint(error: string | undefined): string {
  switch (error) {
    case "folder_not_found":
      return "Check GOOGLE_DRIVE_FOLDER_ID and share the folder with the service account (step 2 below).";
    case "not_a_folder":
      return "GOOGLE_DRIVE_FOLDER_ID points at a file, not a folder.";
    case "not_writable":
      return "The service account can see it but not add files: share it as Editor, not Viewer (step 2 below).";
    case "misconfigured":
      return "The Google service-account variables are incomplete or malformed.";
    default:
      return "Google could not be reached; try again in a moment.";
  }
}

main().catch((err: unknown) => {
  console.error(`\n✗ Setup failed: ${describeError(err)}`);
  const target = (() => {
    try {
      return requireStoreTarget();
    } catch {
      return null;
    }
  })();
  if (target) {
    console.error(`  If Google refused the request, the service account ${target.clientEmail} is probably not an Editor on`);
    console.error(`  ${spreadsheetUrl(target.spreadsheetId)}`);
    console.error(`  and ${driveFolderUrl(target.driveFolderId)}`);
  }
  process.exitCode = 1;
});
