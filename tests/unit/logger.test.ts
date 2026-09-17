import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import { logger } from "@/lib/logger";
import { ApplicationModel } from "@/models/application";
import { withCapturedConsole } from "./support/console";
import { withEnvAsync } from "./support/env";

const CANDIDATE_EMAIL = "nimali.perera.private@example.com";
const CANDIDATE_NAME = "Nimali Secretname";

async function logged(nodeEnv: string, write: () => void): Promise<{ text: string; entries: Record<string, unknown>[]; streams: string[] }> {
  return withEnvAsync({ NODE_ENV: nodeEnv }, () =>
    withCapturedConsole((capture) => {
      write();
      return { text: capture.text(), entries: capture.entries(), streams: capture.lines.map((line) => line.stream) };
    })
  );
}

function duplicateKeyError(): InstanceType<typeof mongoose.mongo.MongoServerError> {
  return new mongoose.mongo.MongoServerError({
    message: `E11000 duplicate key error collection: synergy.applications index: job_email_unique dup key: { emailNormalized: "${CANDIDATE_EMAIL}" }`,
    errmsg: `E11000 duplicate key error collection: synergy.applications index: job_email_unique dup key: { emailNormalized: "${CANDIDATE_EMAIL}" }`,
    code: 11000,
    codeName: "DuplicateKey",
    keyPattern: { job: 1, emailNormalized: 1 },
    keyValue: { job: "66e9a1b2c3d4e5f601234567", emailNormalized: CANDIDATE_EMAIL },
  });
}

async function applicationValidationError(): Promise<Error> {
  const doc = new ApplicationModel({
    name: CANDIDATE_NAME.repeat(20),
    email: `${"x".repeat(300)}${CANDIDATE_EMAIL}`,
    status: "secret-status-value",
    phone: "+94 77 123 4567 000000000000000000000000000000000000000000000",
  });
  try {
    await doc.validate();
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.equal(err.name, "ValidationError");
    assert.ok(err.message.includes(CANDIDATE_EMAIL) || err.message.includes("secret-status-value"), "fixture error message should contain the values");
    return err;
  }
  assert.fail("expected a validation error");
}

describe("logger", () => {
  it("writes one JSON line per entry to the matching console stream", async () => {
    const result = await logged("production", () => {
      logger.info("unit.info", { applicationId: "abc", count: 2 });
      logger.warn("unit.warn");
      logger.error("unit.error", { code: "x" });
    });
    assert.deepEqual(result.streams, ["info", "warn", "error"]);
    assert.equal(result.entries.length, 3);
    assert.deepEqual({ ...result.entries[0], time: undefined }, { level: "info", event: "unit.info", applicationId: "abc", count: 2, time: undefined });
    assert.equal(result.entries[1].level, "warn");
    assert.equal(result.entries[2].code, "x");
    assert.ok(!Number.isNaN(Date.parse(String(result.entries[0].time))));
  });

  for (const nodeEnv of ["production", "development"]) {
    describe(`with NODE_ENV=${nodeEnv}`, () => {
      it("logs only structural details of duplicate key errors (no duplicate values)", async () => {
        const result = await logged(nodeEnv, () => logger.error("unit.duplicate", { err: duplicateKeyError() }));
        const err = result.entries[0].err as Record<string, unknown>;
        assert.equal(err.name, "MongoServerError");
        assert.equal(err.code, 11000);
        assert.deepEqual(err.keyPattern, { job: 1, emailNormalized: 1 });
        assert.equal(result.text.includes(CANDIDATE_EMAIL), false, result.text);
      });

      it("logs only field paths and kinds of validation errors (no submitted values)", async () => {
        const validation = await applicationValidationError();
        const result = await logged(nodeEnv, () => logger.warn("unit.validation", { err: validation }));
        const err = result.entries[0].err as Record<string, unknown>;
        assert.equal(err.name, "ValidationError");
        assert.ok(Array.isArray(err.fields) && (err.fields as string[]).includes("email"));
        assert.ok(Array.isArray(err.kinds));
        assert.equal(result.text.includes(CANDIDATE_EMAIL), false, result.text);
        assert.equal(result.text.includes(CANDIDATE_NAME), false, result.text);
        assert.equal(result.text.includes("secret-status-value"), false, result.text);
      });

      it("logs only the path of cast errors", async () => {
        const cast = new mongoose.Error.CastError("ObjectId", CANDIDATE_EMAIL, "_id");
        const result = await logged(nodeEnv, () => logger.warn("unit.cast", { err: cast }));
        const err = result.entries[0].err as Record<string, unknown>;
        assert.equal(err.name, "CastError");
        assert.equal(err.path, "_id");
        assert.equal(result.text.includes(CANDIDATE_EMAIL), false, result.text);
      });
    });
  }

  it("omits stack traces in production and truncates generic messages", async () => {
    const result = await logged("production", () => logger.error("unit.generic", { err: new Error("x".repeat(2000)) }));
    const err = result.entries[0].err as Record<string, unknown>;
    assert.equal(err.stack, undefined);
    assert.equal(String(err.message).length, 500);
    assert.equal(err.name, "Error");
  });

  it("includes error codes and serializes errors passed under any key", async () => {
    const withCode = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const result = await logged("production", () => logger.warn("unit.codes", { cause: withCode }));
    assert.deepEqual(result.entries[0].cause, { name: "Error", message: "connect ECONNREFUSED", code: "ECONNREFUSED" });
  });

  it("handles non-error values and unserializable metadata", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = await logged("production", () => {
      logger.error("unit.string", { err: "plain failure" });
      logger.error("unit.object", { err: { not: "an error" } });
      logger.info("unit.circular", { circular });
    });
    assert.deepEqual(result.entries[0].err, { message: "plain failure" });
    assert.deepEqual(result.entries[1].err, { message: "Non-error value thrown" });
    assert.equal(result.entries[2].event, "unit.circular");
    assert.equal(result.entries[2].note, "unserializable log meta");
  });
});
