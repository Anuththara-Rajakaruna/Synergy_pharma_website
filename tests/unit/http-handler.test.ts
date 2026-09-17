import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import { apiHandler, jsonResponse, toErrorResponse } from "@/lib/http/handler";
import { AppError, badRequest, conflict, tooManyRequests } from "@/lib/http/errors";
import { DatabaseConfigError } from "@/lib/mongodb";
import { StorageConfigError, StorageUnavailableError } from "@/lib/storage";
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

  it("maps database configuration errors to 500 without details", async () => {
    const result = await mapped(new DatabaseConfigError("MONGODB_URI environment variable is required."));
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: "Something went wrong. Please try again later.", code: "server_misconfigured" });
  });

  it("maps database outages to 503 with Retry-After", async () => {
    const network = new mongoose.mongo.MongoNetworkError("connect ECONNREFUSED 127.0.0.1:27017");
    const selection = Object.assign(new Error("Server selection timed out"), { name: "MongooseServerSelectionError" });
    const shutdown = new mongoose.mongo.MongoServerError({ message: "interrupted at shutdown", code: 11600 });
    const notConnected = Object.assign(new Error("Operation `jobs.find()` buffering timed out: not connected"), { name: "MongooseError" });
    for (const err of [network, selection, shutdown, notConnected]) {
      const result = await mapped(err);
      assert.equal(result.status, 503, err.name);
      assert.equal(result.body.code, "unavailable");
      assert.equal(result.headers.get("retry-after"), "30");
    }
  });

  it("maps storage errors by name", async () => {
    const unavailable = await mapped(new StorageUnavailableError("Object storage HeadObject failed (TimeoutError)."));
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.code, "storage_unavailable");
    assert.equal(unavailable.headers.get("retry-after"), "30");

    const misconfigured = await mapped(new StorageConfigError("Object storage rejected CopyObject (AccessDenied, HTTP 403)."));
    assert.equal(misconfigured.status, 500);
    assert.equal(misconfigured.body.code, "server_misconfigured");
    assert.equal(misconfigured.body.error.includes("AccessDenied"), false);
  });

  it("maps Mongoose validation and cast errors to 400 invalid_input", async () => {
    const validation = new mongoose.Error.ValidationError();
    const cast = new mongoose.Error.CastError("ObjectId", "not-an-id", "_id");
    for (const err of [validation, cast]) {
      const result = await mapped(err);
      assert.equal(result.status, 400);
      assert.deepEqual(result.body, { error: "Some of the submitted values are invalid.", code: "invalid_input" });
    }
  });

  it("maps duplicate key errors to 409 without echoing the duplicate value", async () => {
    const duplicate = new mongoose.mongo.MongoServerError({
      message: "E11000 duplicate key error collection: synergy.applications index: job_email_unique dup key: { emailNormalized: \"nimal@example.com\" }",
      code: 11000,
      keyPattern: { job: 1, emailNormalized: 1 },
      keyValue: { emailNormalized: "nimal@example.com" },
    });
    const result = await mapped(duplicate);
    assert.equal(result.status, 409);
    assert.deepEqual(result.body, { error: "This record already exists.", code: "conflict" });
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
});
