import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GoogleConfigError, GoogleNotFoundError, GoogleUnavailableError } from "@/lib/google/errors";
import { AppError } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import { withCapturedConsole } from "./support/console";
import { withEnvAsync } from "./support/env";

// The property under test has not changed with the data store: nothing that could carry
// applicant data reaches the log. What changed is the shapes: there is no MongoDB driver any
// more, so the error objects the application produces are AppError, the Google client's error
// classes, and whatever the SMTP transport throws. The rule that keeps those safe is that only
// an error's name, message and code are serialised - never its other properties, which are
// exactly where a driver puts the offending value.

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
      it("logs only the name, message and code of an error, never its other properties", async () => {
        // The shape a rejected SMTP delivery has: the recipient appears in `response` and
        // `rejected`, which is exactly what must not be written to the log.
        const smtpFailure = Object.assign(new Error("Message failed with code 550"), {
          code: "EENVELOPE",
          responseCode: 550,
          response: `550 5.1.1 <${CANDIDATE_EMAIL}> recipient unknown`,
          rejected: [CANDIDATE_EMAIL],
          envelope: { from: "careers@synergypharma.lk", to: [CANDIDATE_EMAIL] },
        });
        const result = await logged(nodeEnv, () => logger.error("unit.smtp", { err: smtpFailure }));
        const err = result.entries[0].err as Record<string, unknown>;
        assert.equal(err.name, "Error");
        assert.equal(err.message, "Message failed with code 550");
        assert.equal(err.code, "EENVELOPE");
        assert.equal(err.response, undefined);
        assert.equal(err.rejected, undefined);
        assert.equal(err.envelope, undefined);
        assert.equal(result.text.includes(CANDIDATE_EMAIL), false, result.text);
      });

      it("logs a Google API failure structurally, without its message", async () => {
        // A GoogleConfigError names environment variables and a Drive failure can carry a file
        // name, so only the structural fields of the store's error classes are kept.
        const unavailable = new GoogleUnavailableError("Google Sheets returned HTTP 429 for sheets.values.batchGet.", { retryAfterSeconds: 30 });
        const misconfigured = new GoogleConfigError(
          `Google Drive denied the upload of "${CANDIDATE_NAME} - CV.pdf". Check GOOGLE_DRIVE_FOLDER_ID and GOOGLE_PRIVATE_KEY.`
        );
        const missing = new GoogleNotFoundError();
        const result = await logged(nodeEnv, () => {
          logger.error("unit.google.unavailable", { err: unavailable });
          logger.error("unit.google.config", { err: misconfigured });
          logger.warn("unit.google.missing", { err: missing });
        });
        assert.deepEqual(
          result.entries.map((entry) => (entry.err as Record<string, unknown>).name),
          ["GoogleUnavailableError", "GoogleConfigError", "GoogleNotFoundError"]
        );
        assert.equal((result.entries[0].err as Record<string, unknown>).message, undefined, "the message is not logged for store errors");
        assert.equal((result.entries[0].err as Record<string, unknown>).retryAfterSeconds, 30, "how long to wait is structural, and is kept");
        assert.equal((result.entries[1].err as Record<string, unknown>).message, undefined);
        assert.equal(result.text.includes("GOOGLE_PRIVATE_KEY"), false, result.text);
        assert.equal(result.text.includes(CANDIDATE_NAME), false, result.text);
      });

      it("logs a spreadsheet row failure without the row's contents", async () => {
        // A record id and a tab name are safe to log; a cell value never is.
        const rowFailure = Object.assign(new Error("The Applications tab rejected a write."), {
          code: "sheets.values.update",
          row: [CANDIDATE_NAME, CANDIDATE_EMAIL, "+94 77 123 4567"],
          values: { name: CANDIDATE_NAME, email: CANDIDATE_EMAIL },
        });
        const result = await logged(nodeEnv, () => logger.error("unit.sheets", { err: rowFailure, table: "Applications", applicationId: "66e9a1b2c3d4e5f601234567" }));
        assert.equal(result.entries[0].table, "Applications");
        assert.equal(result.entries[0].applicationId, "66e9a1b2c3d4e5f601234567");
        assert.equal(result.text.includes(CANDIDATE_EMAIL), false, result.text);
        assert.equal(result.text.includes(CANDIDATE_NAME), false, result.text);
      });

      it("logs an AppError without its fields map", async () => {
        const appError = new AppError(409, "duplicate_application", "You have already applied for this role.", {
          fields: { email: `${CANDIDATE_EMAIL} has already applied.` },
        });
        const result = await logged(nodeEnv, () => logger.warn("unit.app_error", { err: appError }));
        const err = result.entries[0].err as Record<string, unknown>;
        assert.equal(err.name, "AppError");
        assert.equal(err.fields, undefined);
        assert.equal(err.status, undefined);
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
