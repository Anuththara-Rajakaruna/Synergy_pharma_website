import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL environment variable is required. Set it in .env.local for development and in your deployment environment for production."
  );
}

// Managed Postgres providers (Neon, Supabase, Vercel Postgres, RDS, ...) require TLS;
// a local dev database on localhost/127.0.0.1 does not speak TLS by default.
const isLocalDatabase = /localhost|127\.0\.0\.1/.test(connectionString);

// Next.js dev-mode hot reload re-evaluates this module on every edit; caching the pool
// on `globalThis` stops each reload from opening a fresh set of connections.
declare global {
  var __synergyPgPool: Pool | undefined;
}

export const pool: Pool =
  globalThis.__synergyPgPool ??
  new Pool({
    connectionString,
    ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
    max: 5,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__synergyPgPool = pool;
}
