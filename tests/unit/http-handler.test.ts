import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiHandler, jsonResponse, toErrorResponse } from "@/lib/http/handler";
import { AppError, badRequest, conflict, tooManyRequests } from "@/lib/http/errors";
import { GoogleConfigError, GoogleUnavailableError } from "@/lib/google/errors";
import { StoreConfigError, StoreUnavailableError } from "@/lib/sheets-db/errors";
import { withCapturedConsole } from "./support/console";

type ErrorBody = { error: string; code: string; fields?: Record<string, string> };

async function mapped(err: unknown): Promise<{ status: number; body: ErrorBody; headers: Headers; logs: Record<string, unknown>[] }> {
  return withCapturedConsole(async (capture) => {
    const response = toErrorResponse(err, "api.test");
    const body = (await response.json()) as ErrorBody;
    return { status: response.status, body, headers: response.headers, logs: capture.entries() };
  });
}

describe("toErrorResponse", () => {
  it("maps AppError to its status, code, message, fields and headers", async () => {
    const result = await mapped(badRequest("Please fix the highlighted fields.", { email: "Please enter a valid email address." }));
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, {
      error: "Please fix the highlighted fields.",
      code: "invalid_input",
      fields: { email: "Please enter a valid email address." },
    });
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.headers.get("content-type")?.startsWith("application/json"), true);
    assert.deepEqual(result.logs, [], "expected client errors are not logged");

    const limited = await mapped(tooManyRequests(90.2, "Slow down."));
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, "rate_limited");
    assert.equal(limited.headers.get("retry-after"), "91");

    const duplicate = await mapped(conflict("Already applied.", "duplicate_application"));
    assert.deepEqual(duplicate.body, { error: "Already applied.", code: "duplicate_application" });
  });

  it("logs AppErrors with a 5xx status", async () => {
    const result = await mapped(new AppError(502, "storage_delete_failed", "Some files could not be deleted."));
    assert.equal(result.status, 502);
    assert.equal(result.logs.length, 1);
    assert.equal(result.logs[0].event, "api.test.failed");
  });

  it("maps a misconfigured data store to 500 without details", async () => {
    // The message names environment variables and must never reach the browser.
    const result = await mapped(
      new GoogleConfigError("Google Sheets/Drive is not configured correctly (check GOOGLE_PRIVATE_KEY, GOOGLE_SHEETS_SPREADSHEET_ID).")
    );
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: "Something went wrong. Please try again later.", code: "server_misconfigured" });
    assert.equal(result.body.error.includes("GOOGLE_"), false);
    assert.equal(result.logs.length, 1);
  });

  it("maps a Drive quota misconfiguration to the same 500", async () => {
    // What a service account with no storage quota of its own produces in production.
    const quota = new GoogleConfigError(
      "Google Drive refused the upload because the service account has no storage quota of its own. " +
        "Move GOOGLE_DRIVE_FOLDER_ID to a Shared Drive and set GOOGLE_DRIVE_SHARED_DRIVE_ID, or set GOOGLE_IMPERSONATE_USER."
    );
    const result = await mapped(quota);
    assert.equal(result.status, 500);
    assert.equal(result.body.code, "server_misconfigured");
    assert.equal(result.body.error.includes("Shared Drive"), false);
  });

  it("recognises StoreConfigError, which is the same class under the storage-agnostic name", async () => {
    assert.equal(StoreConfigError, GoogleConfigError);
    assert.equal(StoreUnavailableError, GoogleUnavailableError);
    const result = await mapped(new StoreConfigError("The Google Sheets data store is not configured (check GOOGLE_DRIVE_FOLDER_ID)."));
    assert.equal(result.status, 500);
    assert.equal(result.body.code, "server_misconfigured");
  });

  it("maps Google outages to 503 with Retry-After", async () => {
    const quotaExceeded = new GoogleUnavailableError("Google Sheets returned HTTP 429 for sheets.values.batchGet.", { retryAfterSeconds: 42 });
    const backend = new StoreUnavailableError("Google Sheets returned HTTP 503 for sheets.values.append.");
    // Transport failures from undici / Node fetch, which never become a GoogleUnavailableError
    // before they reach the handler.
    const fetchFailed = Object.assign(new TypeError("fetch failed"), { name: "TypeError" });
    const timedOut = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const refused = Object.assign(new Error("connect ECONNREFUSED 142.250.0.1:443"), { code: "ECONNREFUSED" });
    const dns = Object.assign(new Error("getaddrinfo EAI_AGAIN sheets.googleapis.com"), { code: "EAI_AGAIN" });

    for (const err of [quotaExceeded, backend, fetchFailed, timedOut, refused, dns]) {
      const result = await mapped(err);
      assert.equal(result.status, 503, `${err.name}: ${err.message}`);
      assert.equal(result.body.code, "unavailable");
      assert.equal(result.headers.get("retry-after"), "30");
      assert.equal(result.body.error, "The service is temporarily unavailable. Please try again shortly.");
    }
  });

  it("tells a candidate that file storage is down, not that the whole site is", async () => {
    // Sheets and Drive raise the same error class, so the message is what separates "your CV
    // could not be uploaded" from "the site is busy". The client code showing them is unchanged.
    for (const err of [
      new GoogleUnavailableError("Google Drive returned HTTP 503 for the upload."),
      new GoogleUnavailableError("Could not reach Google for drive.files.create."),
    ]) {
      const result = await mapped(err);
      assert.equal(result.status, 503, err.message);
      assert.equal(result.body.code, "storage_unavailable");
      assert.equal(result.body.error, "File storage is temporarily unavailable. Please try again shortly.");
      assert.equal(result.headers.get("retry-after"), "30");
    }
  });

  it("maps unexpected errors to a generic 500 that hides the message", async () => {
    for (const err of [new Error("secret internal detail at /srv/app"), "a thrown string", { weird: true }]) {
      const result = await mapped(err);
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, { error: "Something went wrong. Please try again.", code: "internal_error" });
      assert.equal(result.logs.length, 1);
      assert.equal(result.logs[0].event, "api.test.failed");
    }
  });

  it("masks candidate email addresses before an unexpected failure is logged", async () => {
    // A failure part-way through a spreadsheet write can quote the row it was writing, and a row
    // of the Applications tab is a candidate's name, email address and phone number.
    const candidateEmail = "nimali.perera.private@example.com";
    const result = await mapped(new Error(`row ["Nimali Perera","${candidateEmail}"] could not be written to the Applications tab`));
    assert.equal(result.status, 500);
    assert.equal(JSON.stringify(result.body).includes(candidateEmail), false);
    const logged = JSON.stringify(result.logs);
    assert.equal(logged.includes(candidateEmail), false, logged);
    assert.ok(logged.includes("[redacted]"), logged);
    assert.ok(logged.includes("Applications tab"), "the rest of the message survives, so the failure is still diagnosable");
  });
});

describe("jsonResponse", () => {
  it("defaults to 200 and Cache-Control: no-store", async () => {
    const response = jsonResponse({ ok: true });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: true });
  });

  it("applies status and extra headers, and lets a route override Cache-Control", () => {
    const response = jsonResponse({ created: true }, { status: 201, headers: { "X-Row-Count": "3", "Cache-Control": "private, max-age=60" } });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-row-count"), "3");
    assert.equal(response.headers.get("cache-control"), "private, max-age=60");
  });
});

describe("apiHandler", () => {
  it("passes successful responses through and converts thrown errors", async () => {
    const ok = apiHandler("api.test.ok", async (_request: Request, context: { params: Promise<{ id: string }> }) => {
      const { id } = await context.params;
      return jsonResponse({ id });
    });
    const okResponse = await ok(new Request("http://localhost/api/x"), { params: Promise.resolve({ id: "abc" }) });
    assert.deepEqual(await okResponse.json(), { id: "abc" });

    const failing = apiHandler("api.test.fail", async () => {
      throw conflict("This job was changed by someone else.", "job_conflict");
    });
    const failResponse = await failing(new Request("http://localhost/api/x"), {});
    assert.equal(failResponse.status, 409);
    assert.deepEqual(await failResponse.json(), { error: "This job was changed by someone else.", code: "job_conflict" });
  });

  it("turns a data store outage inside a route into 503", async () => {
    const handler = apiHandler("api.test.store", async () => {
      throw new StoreUnavailableError("Google Sheets returned HTTP 429 for sheets.values.batchGet.");
    });
    const response = await withCapturedConsole(() => handler(new Request("http://localhost/api/x"), {}));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "30");
  });
});
