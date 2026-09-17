import { integrationConfig, setEnv } from "./env";
import mongoose from "mongoose";
import { connectToDatabase, disconnectFromDatabase } from "@/lib/mongodb";
import { ALL_MODELS } from "@/models/index";
import { acquireSuiteLock } from "./lock";
import { destroyS3Client, emptyBucket, ensureBucket } from "./s3";
import { SmtpSink, findFreeSmtpPort } from "./smtp-sink";

// Per-file setup for the integration suite. Every test file runs in its own process (the npm
// script passes --test-concurrency=1 so files never overlap; a lock file also serializes files
// started in parallel) and starts from an empty database and bucket.

export type IntegrationOptions = {
  // Create the schema's collections and indexes after dropping the database (default true).
  indexes?: boolean;
  // Start an in-process SMTP capture server and point the application at it (default false).
  smtp?: boolean;
};

export type Integration = {
  smtp: SmtpSink | null;
  logs: () => string;
  stop: () => Promise<void>;
};

type ConsoleMethod = (...args: unknown[]) => void;

// The application logs JSON lines to the console. They are collected (for PII assertions) and only
// printed when INTEGRATION_VERBOSE=1.
function captureLogs(): { text: () => string; restore: () => void } {
  const original: Record<"info" | "warn" | "error", ConsoleMethod> = { info: console.info, warn: console.warn, error: console.error };
  const lines: string[] = [];
  const verbose = process.env.INTEGRATION_VERBOSE === "1";
  for (const method of ["info", "warn", "error"] as const) {
    console[method] = (...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" "));
      if (verbose) original[method](...args);
    };
  }
  return {
    text: () => lines.join("\n"),
    restore: () => {
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

export async function resetDatabase(options: { indexes: boolean }): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Not connected to MongoDB.");
  if (db.databaseName !== integrationConfig.dbName || !db.databaseName.endsWith("_test")) {
    throw new Error(`Refusing to drop database "${db.databaseName}".`);
  }
  await db.dropDatabase();
  if (options.indexes) {
    for (const model of ALL_MODELS) {
      await model.createCollection();
      await model.createIndexes();
    }
  }
}

export async function startIntegration(options: IntegrationOptions = {}): Promise<Integration> {
  const release = await acquireSuiteLock(integrationConfig.dbName);
  const logs = captureLogs();
  let smtp: SmtpSink | null = null;
  try {
    // Schema setup is done explicitly below, never implicitly while the database is being dropped.
    await connectToDatabase({ autoSchemaSetup: false });
    await resetDatabase({ indexes: options.indexes ?? true });
    await ensureBucket();
    await emptyBucket();
    if (options.smtp) {
      smtp = new SmtpSink(await findFreeSmtpPort());
      await smtp.start();
      setEnv("SMTP_PORT", String(smtp.port));
    }
  } catch (err) {
    logs.restore();
    release();
    throw err;
  }

  return {
    smtp,
    logs: logs.text,
    stop: async () => {
      try {
        await smtp?.stop();
        await disconnectFromDatabase();
        destroyS3Client();
      } finally {
        logs.restore();
        release();
      }
    },
  };
}
