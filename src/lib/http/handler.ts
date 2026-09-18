import { NextResponse } from "next/server";
import { AppError } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import { isStoreUnavailableError, StoreConfigError } from "@/lib/sheets-db";

// API responses carry personal data or per-user state; never let a CDN or browser cache them
// unless a route opts in explicitly.
const NO_STORE = "no-store";

export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
  const response = NextResponse.json(body, { status: init.status ?? 200 });
  response.headers.set("Cache-Control", init.headers?.["Cache-Control"] ?? NO_STORE);
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    if (key !== "Cache-Control") response.headers.set(key, value);
  }
  return response;
}

export function errorJson(status: number, code: string, message: string, extra: { fields?: Record<string, string>; headers?: Record<string, string> } = {}) {
  return jsonResponse(
    { error: message, code, ...(extra.fields ? { fields: extra.fields } : {}) },
    { status, headers: extra.headers }
  );
}

// Sheets and Drive raise the same two error classes, so the operation name inside the message is
// the only thing that says which half of the store failed. That distinction is worth keeping:
// "your CV could not be uploaded" and "the site is busy" are different messages to a candidate,
// and the client code that shows them has not changed. Every Drive failure names either the
// product ("Google Drive returned HTTP 503 for the upload.") or its operation ("Could not reach
// Google for drive.files.create."); no Sheets message contains either.
const DRIVE_OPERATION = /google drive|\bdrive\.[a-z]/i;

function isDocumentStoreFailure(err: unknown): boolean {
  return err instanceof Error && DRIVE_OPERATION.test(err.message);
}

// Everything the data store, the mail transport and this application raise is written so that
// its message is safe to log. An error that reached the last branch below made no such promise:
// a failure in the middle of a spreadsheet write can quote the row it was writing, and a row of
// the Applications tab is a candidate's name, email address and phone number. The address is the
// part that identifies a person on its own and the part that can be matched against another
// data set, so it is masked before the error is handed to the logger (message and stack alike -
// the stack begins with the message and is kept outside production).
const EMAIL_ADDRESS = /[^\s<>()[\],;:"]+@[^\s<>()[\],;:"]+\.[A-Za-z]{2,}/g;

function withoutAddresses(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const message = err.message.replace(EMAIL_ADDRESS, "[redacted]");
  if (message === err.message) return err;
  const safe = new Error(message);
  safe.name = err.name;
  if (err.stack) safe.stack = err.stack.replace(EMAIL_ADDRESS, "[redacted]");
  const code = (err as { code?: unknown }).code;
  if (code !== undefined) (safe as Error & { code?: unknown }).code = code;
  return safe;
}

// Maps any thrown value to a JSON error response and logs unexpected failures.
export function toErrorResponse(err: unknown, event: string): NextResponse {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error(`${event}.failed`, { code: err.code, status: err.status });
    return errorJson(err.status, err.code, err.message, { fields: err.fields, headers: err.headers });
  }
  if (err instanceof StoreConfigError) {
    // A missing or wrong GOOGLE_* variable, a spreadsheet or folder that is not shared with the
    // service account, a disabled API, or a Drive folder the service account has no quota for.
    // All of them are deployment bugs: the message names the variable and must never be sent on.
    logger.error("store.misconfigured", { event, err });
    return errorJson(500, "server_misconfigured", "Something went wrong. Please try again later.");
  }
  if (isStoreUnavailableError(err)) {
    if (isDocumentStoreFailure(err)) {
      logger.error(`${event}.storage_unavailable`, { err });
      return errorJson(503, "storage_unavailable", "File storage is temporarily unavailable. Please try again shortly.", {
        headers: { "Retry-After": "30" },
      });
    }
    // Event name kept from the MongoDB release so existing log alerts keep matching.
    logger.error(`${event}.database_unavailable`, { err });
    return errorJson(503, "unavailable", "The service is temporarily unavailable. Please try again shortly.", {
      headers: { "Retry-After": "30" },
    });
  }
  if (err instanceof Error && (err.name === "ValidationError" || err.name === "CastError")) {
    // Defensive net behind each route's own checks, for anything that reports a bad value the
    // way a schema validator does.
    logger.warn(`${event}.validation_failed`, { err });
    return errorJson(400, "invalid_input", "Some of the submitted values are invalid.");
  }
  logger.error(`${event}.failed`, { err: withoutAddresses(err) });
  return errorJson(500, "internal_error", "Something went wrong. Please try again.");
}

// Wraps a route handler so thrown AppErrors and infrastructure failures become consistent
// JSON responses. `event` names the route in logs, e.g. "api.admin.jobs.create".
export function apiHandler<Ctx>(
  event: string,
  handler: (request: Request, context: Ctx) => Promise<Response>
): (request: Request, context: Ctx) => Promise<Response> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (err) {
      return toErrorResponse(err, event);
    }
  };
}
