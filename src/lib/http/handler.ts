import { NextResponse } from "next/server";
import { AppError } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import { DatabaseConfigError, isDatabaseUnavailableError, isDuplicateKeyError } from "@/lib/mongodb";

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

// Maps any thrown value to a JSON error response and logs unexpected failures.
export function toErrorResponse(err: unknown, event: string): NextResponse {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error(`${event}.failed`, { code: err.code, status: err.status });
    return errorJson(err.status, err.code, err.message, { fields: err.fields, headers: err.headers });
  }
  if (err instanceof DatabaseConfigError) {
    logger.error("mongodb.misconfigured", { event, err });
    return errorJson(500, "server_misconfigured", "Something went wrong. Please try again later.");
  }
  if (isDatabaseUnavailableError(err)) {
    logger.error(`${event}.database_unavailable`, { err });
    return errorJson(503, "unavailable", "The service is temporarily unavailable. Please try again shortly.", {
      headers: { "Retry-After": "30" },
    });
  }
  if (err instanceof Error && err.name === "StorageUnavailableError") {
    logger.error(`${event}.storage_unavailable`, { err });
    return errorJson(503, "storage_unavailable", "File storage is temporarily unavailable. Please try again shortly.", {
      headers: { "Retry-After": "30" },
    });
  }
  if (err instanceof Error && err.name === "StorageConfigError") {
    logger.error("storage.misconfigured", { event, err });
    return errorJson(500, "server_misconfigured", "Something went wrong. Please try again later.");
  }
  if (err instanceof Error && (err.name === "ValidationError" || err.name === "CastError")) {
    // Schema validation is a safety net behind each route's own checks.
    logger.warn(`${event}.validation_failed`, { err });
    return errorJson(400, "invalid_input", "Some of the submitted values are invalid.");
  }
  if (isDuplicateKeyError(err)) {
    logger.warn(`${event}.duplicate_key`, { err });
    return errorJson(409, "conflict", "This record already exists.");
  }
  logger.error(`${event}.failed`, { err });
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
