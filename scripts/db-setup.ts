// Prepares a MongoDB database for the careers portal. Safe to re-run after every release.
//
//   npm run db:setup
//   npm run db:setup -- --drop-stale-indexes      Also drop indexes the schemas no longer declare.
//   npm run db:setup -- --seed-sample-jobs        Add the sample postings from src/data/jobs.json
//                                                 as drafts (only into an empty jobs collection).
//
// 1. Applies pending data migrations (scripts/migrations), which also remove indexes from the
//    first MongoDB release that contradict the current rules.
// 2. Creates every collection and every schema index (unique constraints and TTL indexes included).
//    Indexes that are no longer declared are reported, and dropped only with --drop-stale-indexes.
// 3. Optionally seeds sample job postings as drafts, so nothing is published by accident.
//
// Requires MONGODB_URI and MONGODB_DB_NAME. Writes to a non-local server require
// --confirm=<MONGODB_DB_NAME>.

import "./lib/load-env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { connectToDatabase, disconnectFromDatabase } from "@/lib/mongodb";
import { JobModel } from "@/models/job";
import { COMMON_OPTIONS, describeError, parseScriptArgs } from "./lib/cli";
import { ensureCollectionsAndIndexes } from "./lib/indexes";
import { buildValidated, type PlainDoc } from "./lib/legacy";
import { MigrationAbortedError, runPendingMigrations } from "./lib/migrations";
import { assertWriteConfirmed, describeTarget } from "./lib/target";

const USAGE = `Usage: npm run db:setup -- [options]

Options:
  --drop-stale-indexes   Drop indexes that the schemas no longer declare (and rebuild changed ones).
  --seed-sample-jobs     Insert the postings from src/data/jobs.json as drafts if there are no jobs yet.
  --confirm=<dbName>     Required when MONGODB_URI is not a local server.
  --no-env-files         Ignore .env.local / .env and use only exported environment variables.
  --help                 Show this help.`;

const args = parseScriptArgs(
  {
    ...COMMON_OPTIONS,
    "drop-stale-indexes": { type: "boolean" },
    "seed-sample-jobs": { type: "boolean" },
    confirm: { type: "string" },
  },
  USAGE
);

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

async function seedSampleJobs(): Promise<boolean> {
  const existing = await JobModel.countDocuments({});
  if (existing > 0) {
    console.log(`  jobs collection already has ${existing} document(s); sample postings were not added.`);
    return true;
  }

  const file = path.join(process.cwd(), "src", "data", "jobs.json");
  const samples = JSON.parse(await readFile(file, "utf8")) as SampleJob[];
  const now = Date.now();
  const docs: PlainDoc[] = [];
  let valid = true;

  for (const [index, sample] of samples.entries()) {
    // Earlier entries get later timestamps so the admin list (newest first) matches the file order.
    const createdAt = new Date(now - index * 1000);
    const built = await buildValidated(JobModel, {
      slug: sample.id,
      title: sample.title,
      department: sample.department,
      location: sample.location,
      type: sample.type,
      experience: "",
      description: sample.description,
      responsibilities: sample.responsibilities ?? [],
      requirements: sample.requirements ?? [],
      qualifications: [],
      benefits: [],
      applicationDeadline: null,
      status: "draft",
      publishedAt: null,
      closedAt: null,
      archivedAt: null,
      origin: "seed",
      createdAt,
      updatedAt: createdAt,
    });
    if (built.ok) docs.push({ ...built.doc, __v: 0 });
    else {
      valid = false;
      console.log(`  ✗ sample job "${sample.id}" is invalid: ${built.problems.join(", ")}`);
    }
  }

  if (!valid) return false;
  await JobModel.collection.insertMany(docs);
  console.log(`  ✓ Added ${docs.length} sample posting(s) as drafts. Review and publish them from the admin panel.`);
  return true;
}

async function main() {
  const dropStale = args["drop-stale-indexes"] === true;
  console.log(`Target: MongoDB ${describeTarget()}`);
  assertWriteConfirmed(process.argv.slice(2));

  await connectToDatabase({ autoSchemaSetup: false });

  console.log("\nApplying data migrations ...");
  await runPendingMigrations({ dryRun: false, allowInvalid: false, log: (line) => console.log(line) });

  console.log("\nEnsuring collections and indexes ...");
  const report = await ensureCollectionsAndIndexes((line) => console.log(line), { dropStale });

  let ok = report.failures.length === 0;
  if (args["seed-sample-jobs"] === true) {
    console.log("\nSample job postings ...");
    ok = (await seedSampleJobs()) && ok;
  }

  console.log("");
  if (report.stale.length > 0) {
    console.log(`! ${report.stale.length} index(es) are not declared in the schemas: ${report.stale.join(", ")}`);
    console.log("  They are harmless unless they enforce a rule the application no longer has; drop them with --drop-stale-indexes.");
  }
  if (!ok) {
    console.log("✗ Setup finished with problems (see above).");
    process.exitCode = 1;
    return;
  }

  console.log("✓ Database is ready.");
  console.log("\nNext steps:");
  console.log('  1. Create the first administrator:  npm run admin:user -- create --email you@example.com --name "Your Name" --role admin');
  console.log("  2. Verify the deployment:           npm run db:check");
}

main()
  .catch((err: unknown) => {
    console.error(`\n✗ Setup failed: ${err instanceof MigrationAbortedError ? err.message : describeError(err)}`);
    if (err instanceof MigrationAbortedError) {
      console.error("  Inspect with `npm run db:migrate -- --dry-run`; `npm run db:migrate -- --allow-invalid` applies it anyway.");
    }
    process.exitCode = 1;
  })
  .finally(() => disconnectFromDatabase());
