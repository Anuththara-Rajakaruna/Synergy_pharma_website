// Read-only health check for a deployment's configuration and MongoDB database.
//
//   npm run db:check
//
// Reports configuration problems (errors fail the check), the MongoDB connection and server
// version, collections and document counts, missing indexes (error) and indexes the schemas no
// longer declare (warning), pending data migrations (error) and whether at least one active
// administrator exists (error if not). Exits with status 1 when any error is found.

import "./lib/load-env";
import { getConfigProblems } from "@/lib/env";
import { connectToDatabase, disconnectFromDatabase } from "@/lib/mongodb";
import { AdminUserModel } from "@/models/admin-user";
import { ALL_MODELS } from "@/models/index";
import { COMMON_OPTIONS, describeError, parseScriptArgs } from "./lib/cli";
import { inspectCollectionsAndIndexes } from "./lib/indexes";
import { getMigrationStatus } from "./lib/migrations";
import { describeTarget } from "./lib/target";

const USAGE = `Usage: npm run db:check -- [options]

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

async function checkDatabase() {
  console.log("\nDatabase");
  let target: string;
  try {
    target = describeTarget();
  } catch (err) {
    fail(describeError(err));
    return;
  }

  const started = Date.now();
  const db = await connectToDatabase({ autoSchemaSetup: false })
    .then(async (mongoose) => {
      const handle = mongoose.connection.db;
      if (!handle) throw new Error("Connection has no database handle.");
      await handle.admin().ping();
      return handle;
    })
    .catch((err: unknown) => {
      fail(`Could not connect to ${target}: ${describeError(err)}`);
      return null;
    });
  if (!db) return;
  const { version } = await db.admin().buildInfo();
  ok(`Connected to ${target} (MongoDB ${version}) in ${Date.now() - started} ms`);

  console.log("\nCollections and indexes");
  const states = await inspectCollectionsAndIndexes();
  for (const state of states) {
    if (!state.exists) {
      fail(`${state.collection}: collection does not exist (run npm run db:setup)`);
      continue;
    }
    const model = ALL_MODELS.find((candidate) => candidate.collection.collectionName === state.collection);
    const count = model ? await model.countDocuments({}) : 0;
    if (state.missing.length > 0) {
      fail(`${state.collection}: ${count} document(s), missing index(es): ${state.missing.join(", ")} (run npm run db:setup)`);
    } else {
      ok(`${state.collection}: ${count} document(s), all schema indexes present`);
    }
    if (state.stale.length > 0) {
      warn(
        `${state.collection}: index(es) not declared in the schema: ${state.stale.join(", ")} ` +
          "(npm run db:setup -- --drop-stale-indexes removes them)"
      );
    }
  }

  console.log("\nData migrations");
  const migrations = await getMigrationStatus();
  if (migrations.pending.length > 0) {
    fail(`Pending: ${migrations.pending.map((migration) => migration.id).join(", ")} (run npm run db:setup)`);
  } else {
    ok(`All ${migrations.applied.length} migration(s) applied`);
  }
  for (const id of migrations.unknown) {
    warn(`${id} is recorded in the database but unknown to this version of the code (is the deployment older than the database?)`);
  }

  console.log("\nAdministrators");
  const admins = await AdminUserModel.countDocuments({ role: "admin", active: true });
  if (admins === 0) {
    fail('No active administrator account. Create one: npm run admin:user -- create --email you@example.com --name "Your Name" --role admin');
  } else {
    ok(`${admins} active administrator account(s)`);
  }
}

async function main() {
  checkConfiguration();
  await checkDatabase();
  console.log(`\n${errors} error(s), ${warnings} warning(s).`);
  if (errors > 0) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(`\n✗ Database check failed: ${describeError(err)}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectFromDatabase());
