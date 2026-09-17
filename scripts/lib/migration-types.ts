// Types shared by the migration runner (scripts/lib/migrations.ts) and the migrations in
// scripts/migrations. Kept separate so migrations never import the runner (no import cycle).

export type MigrationContext = {
  dryRun: boolean;
  // Apply the migration even if some upgraded documents fail schema validation (they are listed).
  allowInvalid: boolean;
  log: (line: string) => void;
};

export type Migration = {
  // "YYYYMMDD-NNN-short-name"; the order in which migrations run.
  id: string;
  description: string;
  // Returns a one-line summary stored with the migration record.
  up: (ctx: MigrationContext) => Promise<string>;
};

// Thrown by a migration that refuses to continue (e.g. documents would become invalid).
export class MigrationAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationAbortedError";
  }
}
