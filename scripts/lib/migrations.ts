import { isDuplicateKeyError } from "@/lib/mongodb";
import { SchemaMigrationModel } from "@/models/schema-migration";
import { careersV2Migration } from "../migrations/20260917-001-careers-v2";
import type { Migration, MigrationContext } from "./migration-types";

export { MigrationAbortedError, type Migration, type MigrationContext } from "./migration-types";

// Data migrations for the MongoDB database. Each migration runs once per database, in id order,
// and is recorded in the schema_migrations collection. Migrations must be idempotent: two
// operators running `npm run db:setup` at the same time, or a crash between applying a migration
// and recording it, must not corrupt data when the migration runs again.

const MIGRATION_ID = /^\d{8}-\d{3}-[a-z0-9-]+$/;

export const MIGRATIONS: readonly Migration[] = [careersV2Migration].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

for (const migration of MIGRATIONS) {
  if (!MIGRATION_ID.test(migration.id)) throw new Error(`Invalid migration id "${migration.id}".`);
}
if (new Set(MIGRATIONS.map((m) => m.id)).size !== MIGRATIONS.length) throw new Error("Duplicate migration ids.");

export type MigrationStatus = {
  applied: { id: string; appliedAt: Date; summary: string }[];
  pending: Migration[];
  // Recorded in the database but unknown to this version of the code (database is newer).
  unknown: string[];
};

export async function getMigrationStatus(): Promise<MigrationStatus> {
  const records = await SchemaMigrationModel.find({}).sort({ _id: 1 }).lean();
  const appliedIds = new Set(records.map((record) => record._id));
  const knownIds = new Set(MIGRATIONS.map((migration) => migration.id));
  return {
    applied: records.map((record) => ({ id: record._id, appliedAt: record.appliedAt, summary: record.summary })),
    pending: MIGRATIONS.filter((migration) => !appliedIds.has(migration.id)),
    unknown: records.map((record) => record._id).filter((id) => !knownIds.has(id)),
  };
}

// Applies pending migrations in order and stops at the first failure (which is rethrown).
// In dry-run mode each migration reports what it would change and nothing is recorded.
export async function runPendingMigrations(options: MigrationContext): Promise<{ applied: string[]; pending: string[] }> {
  const { pending } = await getMigrationStatus();
  const applied: string[] = [];
  if (pending.length === 0) {
    options.log("  ✓ No pending migrations.");
    return { applied, pending: [] };
  }

  for (const migration of pending) {
    options.log(`  → ${migration.id}: ${migration.description}${options.dryRun ? " (dry run)" : ""}`);
    const started = Date.now();
    const summary = await migration.up({ ...options, log: (line) => options.log(`      ${line}`) });
    const durationMs = Date.now() - started;
    options.log(`    ${options.dryRun ? "Would apply" : "✓ Applied"} in ${durationMs} ms: ${summary}`);
    if (options.dryRun) continue;

    try {
      await SchemaMigrationModel.create({ _id: migration.id, appliedAt: new Date(), durationMs, summary: summary.slice(0, 2000) });
    } catch (err) {
      // Another runner recorded it concurrently; the migration is idempotent, so this is fine.
      if (!isDuplicateKeyError(err)) throw err;
    }
    applied.push(migration.id);
  }

  return { applied, pending: options.dryRun ? pending.map((migration) => migration.id) : [] };
}
