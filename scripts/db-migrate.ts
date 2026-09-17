// Applies pending MongoDB data migrations (scripts/migrations), in order, recording each one in
// the schema_migrations collection. `npm run db:setup` runs this automatically.
//
//   npm run db:migrate -- --dry-run          Report what would change; writes nothing.
//   npm run db:migrate                       Apply pending migrations.
//   npm run db:migrate -- --allow-invalid    Apply even if some upgraded documents fail validation.
//
// Writes to a non-local MongoDB server require --confirm=<MONGODB_DB_NAME>.

import "./lib/load-env";
import { connectToDatabase, disconnectFromDatabase } from "@/lib/mongodb";
import { COMMON_OPTIONS, describeError, parseScriptArgs } from "./lib/cli";
import { getMigrationStatus, MigrationAbortedError, runPendingMigrations } from "./lib/migrations";
import { assertWriteConfirmed, describeTarget } from "./lib/target";

const USAGE = `Usage: npm run db:migrate -- [options]

Options:
  --dry-run            Report what the pending migrations would change without writing anything.
  --allow-invalid      Apply migrations even if some upgraded documents fail schema validation.
  --confirm=<dbName>   Required for writes when MONGODB_URI is not a local server.
  --no-env-files       Ignore .env.local / .env and use only exported environment variables.
  --help               Show this help.`;

const args = parseScriptArgs(
  {
    ...COMMON_OPTIONS,
    "dry-run": { type: "boolean" },
    "allow-invalid": { type: "boolean" },
    confirm: { type: "string" },
  },
  USAGE
);

async function main() {
  const dryRun = args["dry-run"] === true;
  console.log(`Target: MongoDB ${describeTarget()}`);
  console.log(`Mode:   ${dryRun ? "DRY RUN (no writes)" : "APPLY"}`);
  if (!dryRun) assertWriteConfirmed(process.argv.slice(2));

  await connectToDatabase({ autoSchemaSetup: false });

  const status = await getMigrationStatus();
  for (const record of status.applied) {
    console.log(`  ✓ ${record.id} (applied ${record.appliedAt.toISOString()})`);
  }
  for (const id of status.unknown) {
    console.log(`  ! ${id} is recorded in the database but unknown to this version of the code`);
  }

  if (status.pending.length > 0) console.log(`\n${status.pending.length} pending migration(s):`);
  const result = await runPendingMigrations({
    dryRun,
    allowInvalid: args["allow-invalid"] === true,
    log: (line) => console.log(line),
  });

  if (dryRun) {
    console.log(result.pending.length > 0 ? "\nDry run complete. Nothing was written." : "\nDatabase is up to date.");
  } else if (result.applied.length > 0) {
    console.log(`\nApplied ${result.applied.length} migration(s). Run \`npm run db:setup\` to create any new indexes.`);
  }
}

main()
  .catch((err: unknown) => {
    console.error(`\n✗ Migration failed: ${err instanceof MigrationAbortedError ? err.message : describeError(err)}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectFromDatabase());
