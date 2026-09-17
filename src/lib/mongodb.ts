import mongoose from "mongoose";
import { logger } from "@/lib/logger";

// Thrown when MONGODB_URI / MONGODB_DB_NAME are missing or malformed. This is a deployment
// problem, not a transient outage, so API routes report it as a 500 (see src/lib/http).
export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

type ConnectionCache = {
  promise: Promise<typeof mongoose> | null;
  listenersAttached: boolean;
  // Set while disconnectFromDatabase() runs so an intentional shutdown is not logged as an outage.
  closing: boolean;
};

// Next.js dev-mode hot reload re-evaluates this module on every edit, and serverless
// hosts reuse warm instances across requests; caching the connection promise on
// `globalThis` keeps a single connection pool per process in both cases.
declare global {
  var __synergyMongoose: ConnectionCache | undefined;
}

const cache: ConnectionCache = (globalThis.__synergyMongoose ??= {
  promise: null,
  listenersAttached: false,
  closing: false,
});

// MongoDB database names may not contain these characters and are capped at 63 bytes.
const INVALID_DB_NAME = /[\/\\. "$*<>:|?]/;

export function readDatabaseConfig(): { uri: string; dbName: string } {
  const uri = process.env.MONGODB_URI?.trim();
  const dbName = process.env.MONGODB_DB_NAME?.trim();

  if (!uri) {
    throw new DatabaseConfigError(
      "MONGODB_URI environment variable is required. Set it in .env.local for development and in your deployment environment for production."
    );
  }
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new DatabaseConfigError("MONGODB_URI must start with mongodb:// or mongodb+srv://.");
  }
  // Required explicitly (rather than falling back to the URI path or the driver's
  // "test" default) so the app can never silently write into the wrong database.
  if (!dbName) {
    throw new DatabaseConfigError(
      "MONGODB_DB_NAME environment variable is required. Set it in .env.local for development and in your deployment environment for production."
    );
  }
  if (INVALID_DB_NAME.test(dbName) || Buffer.byteLength(dbName) > 63) {
    throw new DatabaseConfigError("MONGODB_DB_NAME is not a valid MongoDB database name.");
  }

  return { uri, dbName };
}

function readPoolSize(): number {
  const raw = Number.parseInt(process.env.MONGODB_MAX_POOL_SIZE ?? "", 10);
  return Number.isFinite(raw) && raw > 0 && raw <= 200 ? raw : 10;
}

function attachConnectionListeners() {
  if (cache.listenersAttached) return;
  cache.listenersAttached = true;

  const connection = mongoose.connection;
  // Failed initial connection attempts are reported once, as mongodb.connect_failed, so
  // "disconnected" and "error" are only logged for a connection that was established.
  let established = false;
  connection.on("connected", () => {
    established = true;
    logger.info("mongodb.connected", { host: connection.host, dbName: connection.name });
  });
  connection.on("reconnected", () => logger.info("mongodb.reconnected", { dbName: connection.name }));
  connection.on("disconnected", () => {
    if (!established) return;
    if (cache.closing) logger.info("mongodb.closed", { dbName: connection.name });
    else logger.warn("mongodb.disconnected", { dbName: connection.name });
  });
  connection.on("error", (err) => {
    if (established) logger.error("mongodb.error", { err });
  });
}

type ConnectOptions = {
  // Whether Mongoose may create collections / build schema indexes on its own when models
  // load. Defaults to on in development and off in production, where `npm run db:setup`
  // creates them explicitly. CLI scripts turn both off and manage the schema themselves.
  autoSchemaSetup?: boolean;
};

export async function connectToDatabase(options: ConnectOptions = {}): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;

  if (!cache.promise) {
    const { uri, dbName } = readDatabaseConfig();
    const autoSchemaSetup = options.autoSchemaSetup ?? process.env.NODE_ENV !== "production";
    attachConnectionListeners();

    cache.promise = mongoose
      .connect(uri, {
        dbName,
        appName: "synergy-website",
        // Fail fast instead of queueing queries while the database is unreachable,
        // so API routes can return a 503 rather than hanging.
        bufferCommands: false,
        serverSelectionTimeoutMS: 5_000,
        connectTimeoutMS: 10_000,
        socketTimeoutMS: 30_000,
        maxPoolSize: readPoolSize(),
        // Serverless instances sit idle between requests; release idle sockets so they do
        // not count against the cluster's connection limit.
        maxIdleTimeMS: 60_000,
        autoCreate: autoSchemaSetup,
        autoIndex: autoSchemaSetup,
      })
      .catch((err) => {
        // Allow the next request to retry instead of caching a rejected promise forever.
        cache.promise = null;
        logger.error("mongodb.connect_failed", { err, dbName });
        throw err;
      });
  }

  return cache.promise;
}

// Used by CLI scripts so the process can exit cleanly.
export async function disconnectFromDatabase(): Promise<void> {
  cache.promise = null;
  cache.closing = true;
  try {
    await mongoose.disconnect();
  } finally {
    cache.closing = false;
  }
}

// Round-trips a ping to the server. Used by the health check.
export async function pingDatabase(timeoutMs = 3_000): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const started = Date.now();
  try {
    const conn = await withTimeout(connectToDatabase(), timeoutMs);
    const db = conn.connection.db;
    if (!db) return { ok: false, error: "not_connected" };
    await withTimeout(db.admin().ping(), timeoutMs);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    if (err instanceof DatabaseConfigError) return { ok: false, error: "misconfigured" };
    return { ok: false, error: err instanceof Error && err.message === "timeout" ? "timeout" : "unavailable" };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

const UNAVAILABLE_ERROR_NAMES = new Set([
  "MongooseServerSelectionError",
  "MongoServerSelectionError",
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
  "MongoNotConnectedError",
  "MongoTopologyClosedError",
  "MongoPoolClearedError",
  "MongoWaitQueueTimeoutError",
]);

// Server error codes that indicate a transient condition (elections, shutdown, maxTimeMS).
const TRANSIENT_SERVER_CODES = new Set([6, 7, 50, 89, 91, 189, 262, 9001, 10107, 11600, 11602, 13435, 13436]);

// True when a failure means "the database can't be reached right now" rather than
// a bug or bad input, so callers can answer with 503 Service Unavailable.
export function isDatabaseUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (UNAVAILABLE_ERROR_NAMES.has(err.name)) return true;
  const e = err as { code?: unknown; errorLabels?: unknown; hasErrorLabel?: (label: string) => boolean };
  if (typeof e.hasErrorLabel === "function" && (e.hasErrorLabel("RetryableWriteError") || e.hasErrorLabel("ResetPool"))) {
    return true;
  }
  if (typeof e.code === "number" && TRANSIENT_SERVER_CODES.has(e.code) && err.name.startsWith("Mongo")) return true;
  // Raised by Mongoose when a query runs while disconnected with bufferCommands disabled.
  return err.name === "MongooseError" && /before initial connection is complete|not connected/i.test(err.message);
}

// E11000. Pass an index name to only match violations of that specific unique index.
export function isDuplicateKeyError(err: unknown, indexName?: string): boolean {
  const e = err as { code?: unknown; message?: unknown; errmsg?: unknown } | undefined;
  if (e?.code !== 11000) return false;
  if (!indexName) return true;
  const text = `${typeof e.errmsg === "string" ? e.errmsg : ""} ${typeof e.message === "string" ? e.message : ""}`;
  return text.includes(`index: ${indexName} `) || text.includes(`index: ${indexName}\n`) || text.endsWith(`index: ${indexName}`);
}
