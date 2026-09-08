// One-time / repeatable production database setup.
//
//   npm run db:setup
//
// 1. Applies db/schema.sql (safe to re-run — every statement is idempotent).
// 2. Seeds the jobs table from src/data/jobs.json, but only if the table is
//    currently empty, so it never overwrites live edits made from the admin panel.
//
// Requires DATABASE_URL to be set (.env.local for development, your host's
// environment variables panel for production).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add it to .env.local (dev) or your host's environment variables (production).");
  process.exit(1);
}

const isLocalDatabase = /localhost|127\.0\.0\.1/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
});

async function main() {
  const schemaSql = await readFile(path.join(rootDir, "db", "schema.sql"), "utf8");
  console.log("Applying db/schema.sql ...");
  await pool.query(schemaSql);
  console.log("Schema is up to date.");

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM jobs");
  if (rows[0].count > 0) {
    console.log(`jobs table already has ${rows[0].count} row(s) — skipping seed.`);
    return;
  }

  const jobsPath = path.join(rootDir, "src", "data", "jobs.json");
  const jobs = JSON.parse(await readFile(jobsPath, "utf8"));
  console.log(`Seeding ${jobs.length} job posting(s) from src/data/jobs.json ...`);

  for (const job of jobs) {
    await pool.query(
      `INSERT INTO jobs (id, title, department, location, type, status, description, responsibilities, requirements)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        job.id,
        job.title,
        job.department,
        job.location,
        job.type,
        job.status ?? "published",
        job.description,
        JSON.stringify(job.responsibilities ?? []),
        JSON.stringify(job.requirements ?? []),
      ]
    );
  }
  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
