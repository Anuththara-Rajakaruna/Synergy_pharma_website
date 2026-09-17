import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

// Reading the legacy PostgreSQL careers database (the release before MongoDB) and writing a
// verifiable NDJSON backup of exactly what was read.

export type LegacyJobRow = {
  id: string;
  title: string;
  department: string;
  location: string;
  type: string;
  status: string;
  description: string;
  responsibilities: unknown;
  requirements: unknown;
  created_at: Date;
  updated_at: Date;
};

export type LegacyApplicationRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  job_id: string;
  cover_letter: string;
  cv_file_name: string;
  cv_file_path: string;
  status: string;
  notes: string;
  consent_given: boolean;
  linked_in: string | null;
  portfolio: string | null;
  created_at: Date;
};

export type LegacyTalentRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  area_of_interest: string;
  notes: string;
  cv_file_name: string;
  cv_file_path: string;
  consent_given: boolean;
  created_at: Date;
};

type RawRow = Record<string, unknown>;

export type LegacySnapshot = {
  snapshotAt: Date;
  missingTables: string[];
  raw: { jobs: RawRow[]; applications: RawRow[]; talent_pool: RawRow[] };
  // The same rows serialized by PostgreSQL itself (row_to_json), read in the same transaction.
  // Used for backups so timestamps keep their full microsecond precision and original offsets.
  rawJson: { jobs: string[]; applications: string[]; talent_pool: string[] };
  jobs: LegacyJobRow[];
  applications: LegacyApplicationRow[];
  talentPool: LegacyTalentRow[];
};

type ColumnType = "string" | "nullable-string" | "boolean" | "date" | "json";

const COLUMNS: Record<"jobs" | "applications" | "talent_pool", Record<string, ColumnType>> = {
  jobs: {
    id: "string",
    title: "string",
    department: "string",
    location: "string",
    type: "string",
    status: "string",
    description: "string",
    responsibilities: "json",
    requirements: "json",
    created_at: "date",
    updated_at: "date",
  },
  applications: {
    id: "string",
    name: "string",
    email: "string",
    phone: "string",
    position: "string",
    job_id: "string",
    cover_letter: "string",
    cv_file_name: "string",
    cv_file_path: "string",
    status: "string",
    notes: "string",
    consent_given: "boolean",
    linked_in: "nullable-string",
    portfolio: "nullable-string",
    created_at: "date",
  },
  talent_pool: {
    id: "string",
    name: "string",
    email: "string",
    phone: "string",
    area_of_interest: "string",
    notes: "string",
    cv_file_name: "string",
    cv_file_path: "string",
    consent_given: "boolean",
    created_at: "date",
  },
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const SSL_PARAMS = ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert", "sslnegotiation", "uselibpqcompat"];

function parseConnectionUrl(connectionString: string): URL {
  try {
    const url = new URL(connectionString);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("protocol");
    return url;
  } catch {
    throw new Error("DATABASE_URL must be a postgres:// or postgresql:// connection URL.");
  }
}

// A `host` query parameter overrides the URL host; a value starting with "/" is a Unix socket.
function effectiveHost(url: URL): string {
  return url.searchParams.get("host") ?? url.hostname;
}

function isLocalPostgres(url: URL): boolean {
  const host = effectiveHost(url);
  return host === "" || host.startsWith("/") || LOCAL_HOSTS.has(host.toLowerCase());
}

// "db.example.com:5432/careers" (no credentials).
export function describePostgresTarget(connectionString: string): string {
  const url = parseConnectionUrl(connectionString);
  const host = effectiveHost(url);
  const hostLabel = host === "" || host.startsWith("/") ? "local socket" : `${host}${url.port ? `:${url.port}` : ""}`;
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || url.searchParams.get("dbname") || "(default database)";
  return `${hostLabel}/${database}`;
}

// Non-local servers always use TLS with certificate verification, whatever the URL says, unless
// --insecure-tls is given. A CA / client certificate can be supplied with sslrootcert, sslcert and
// sslkey URL parameters or PGSSLROOTCERT / PGSSLCERT / PGSSLKEY.
async function clientConfig(connectionString: string, insecureTls: boolean): Promise<pg.ClientConfig> {
  const url = parseConnectionUrl(connectionString);
  const base: pg.ClientConfig = { connectionTimeoutMillis: 15_000, application_name: "synergy-careers-migration" };
  if (isLocalPostgres(url)) return { ...base, connectionString };

  const sslmode = url.searchParams.get("sslmode");
  const files = {
    ca: url.searchParams.get("sslrootcert") ?? process.env.PGSSLROOTCERT ?? null,
    cert: url.searchParams.get("sslcert") ?? process.env.PGSSLCERT ?? null,
    key: url.searchParams.get("sslkey") ?? process.env.PGSSLKEY ?? null,
  };
  for (const name of SSL_PARAMS) url.searchParams.delete(name);
  const sanitized = url.toString();

  if (sslmode === "disable") {
    if (!insecureTls) {
      throw new Error(
        "DATABASE_URL sets sslmode=disable for a non-local server, so candidate data would be read unencrypted. " +
          "Remove sslmode=disable, or pass --insecure-tls if the connection is otherwise protected."
      );
    }
    return { ...base, connectionString: sanitized, ssl: false };
  }

  const read = async (file: string | null) => (file ? await readFile(file, "utf8") : undefined);
  return {
    ...base,
    connectionString: sanitized,
    ssl: {
      rejectUnauthorized: !insecureTls,
      ca: await read(files.ca),
      cert: await read(files.cert),
      key: await read(files.key),
    },
  };
}

function checkRows(table: keyof typeof COLUMNS, rows: RawRow[]): void {
  const columns = COLUMNS[table];
  rows.forEach((row, index) => {
    for (const [column, type] of Object.entries(columns)) {
      const value = row[column];
      const valid =
        type === "string"
          ? typeof value === "string"
          : type === "nullable-string"
            ? value === null || typeof value === "string"
            : type === "boolean"
              ? typeof value === "boolean"
              : type === "date"
                ? value instanceof Date && !Number.isNaN(value.getTime())
                : column in row;
      if (!valid) {
        const id = typeof row.id === "string" ? row.id : `row ${index + 1}`;
        throw new Error(`${table}.${column} has an unexpected type or is missing (${id}). Is DATABASE_URL the careers database?`);
      }
    }
  });
}

// Reads the three legacy tables from one consistent snapshot. PostgreSQL is never modified.
export async function readLegacySnapshot(connectionString: string, options: { insecureTls: boolean }): Promise<LegacySnapshot> {
  const client = new pg.Client(await clientConfig(connectionString, options.insecureTls));
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshotAt = (await client.query<{ now: Date }>("SELECT now() AS now")).rows[0].now;

    const tables = ["jobs", "applications", "talent_pool"] as const;
    const missingTables: string[] = [];
    const raw: LegacySnapshot["raw"] = { jobs: [], applications: [], talent_pool: [] };
    const rawJson: LegacySnapshot["rawJson"] = { jobs: [], applications: [], talent_pool: [] };
    for (const table of tables) {
      const exists = (await client.query<{ ok: boolean }>("SELECT to_regclass($1) IS NOT NULL AS ok", [table])).rows[0].ok;
      if (!exists) {
        missingTables.push(table);
        continue;
      }
      // Table names come from the fixed list above, never from input.
      raw[table] = (await client.query<RawRow>(`SELECT * FROM ${table} ORDER BY created_at, id`)).rows;
      checkRows(table, raw[table]);
      rawJson[table] = (await client.query<{ json: string }>(`SELECT row_to_json(t)::text AS json FROM ${table} t ORDER BY created_at, id`)).rows.map(
        (row) => row.json
      );
      if (rawJson[table].length !== raw[table].length) {
        throw new Error(`${table}: row count changed between reads inside one snapshot; aborting.`);
      }
    }
    await client.query("COMMIT");

    if (missingTables.length === tables.length) {
      throw new Error("None of the legacy tables (jobs, applications, talent_pool) exist. Is DATABASE_URL the careers database?");
    }
    return {
      snapshotAt,
      missingTables,
      raw,
      rawJson,
      jobs: raw.jobs as LegacyJobRow[],
      applications: raw.applications as LegacyApplicationRow[],
      talentPool: raw.talent_pool as LegacyTalentRow[],
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

const BACKUP_FILES = { jobs: "jobs.ndjson", applications: "applications.ndjson", talent_pool: "talent_pool.ndjson" } as const;

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

// Fails before anything is read if the directory already holds a backup, so an earlier backup is
// never overwritten.
export async function assertBackupDirUsable(dir: string): Promise<void> {
  for (const name of [...Object.values(BACKUP_FILES), "manifest.json"]) {
    if (await exists(path.join(dir, name))) {
      throw new Error(`Backup directory ${dir} already contains ${name}. Choose a new, empty directory.`);
    }
  }
}

export type BackupManifest = {
  tool: string;
  createdAt: string;
  snapshotAt: string;
  source: string;
  isolation: string;
  missingTables: string[];
  files: Record<string, { table: string; rows: number; bytes: number; sha256: string }>;
};

// One JSON object per line, serialized by PostgreSQL (row_to_json), so values including
// microsecond timestamps are exactly as stored. The files contain candidate personal data: they
// are created with owner-only permissions where the OS supports it.
export async function writeBackup(dir: string, snapshot: LegacySnapshot, source: string): Promise<BackupManifest> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const manifest: BackupManifest = {
    tool: "scripts/migrate-postgres-to-mongodb.ts",
    createdAt: new Date().toISOString(),
    snapshotAt: snapshot.snapshotAt.toISOString(),
    source,
    isolation: "REPEATABLE READ, READ ONLY",
    missingTables: snapshot.missingTables,
    files: {},
  };
  for (const [table, name] of Object.entries(BACKUP_FILES) as [keyof typeof BACKUP_FILES, string][]) {
    const rows = snapshot.rawJson[table];
    const content = rows.map((row) => `${row}\n`).join("");
    const bytes = Buffer.from(content, "utf8");
    await writeFile(path.join(dir, name), bytes, { mode: 0o600, flag: "wx" });
    manifest.files[name] = {
      table,
      rows: rows.length,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  await writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return manifest;
}
