import mongoose from "mongoose";

// Optional direct database access for states the API cannot produce on demand (e.g. a published
// job whose application deadline has already passed). Set E2E_MONGODB_URI and
// E2E_MONGODB_DB_NAME to the database used by the site under test; otherwise the dependent
// tests are skipped. Only records created by the calling test may be modified.

export function databaseConfigured(): boolean {
  return Boolean(process.env.E2E_MONGODB_URI && process.env.E2E_MONGODB_DB_NAME);
}

export async function withDatabase<T>(fn: (connection: mongoose.Connection) => Promise<T>): Promise<T> {
  const uri = process.env.E2E_MONGODB_URI;
  const dbName = process.env.E2E_MONGODB_DB_NAME;
  if (!uri || !dbName) throw new Error("E2E_MONGODB_URI and E2E_MONGODB_DB_NAME are required for this test.");
  const connection = await mongoose.createConnection(uri, { dbName, serverSelectionTimeoutMS: 5_000 }).asPromise();
  try {
    return await fn(connection);
  } finally {
    await connection.close();
  }
}
