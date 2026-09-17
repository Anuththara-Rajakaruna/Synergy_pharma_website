// Expected failures inside API route handlers. Throw an AppError anywhere below a route
// wrapped with `apiHandler` and it is turned into the JSON error body `{ error, code, fields? }`.

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { fields?: Record<string, string>; headers?: Record<string, string> } = {}
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.fields = options.fields;
    this.headers = options.headers;
  }
}

export const badRequest = (message: string, fields?: Record<string, string>, code = "invalid_input") =>
  new AppError(400, code, message, { fields });

export const unauthorized = (message = "Authentication required.") => new AppError(401, "unauthorized", message);

export const forbidden = (message = "You do not have permission to do that.", code = "forbidden") =>
  new AppError(403, code, message);

export const notFound = (message = "Not found.", code = "not_found") => new AppError(404, code, message);

export const conflict = (message: string, code = "conflict") => new AppError(409, code, message);

export const gone = (message: string, code = "gone") => new AppError(410, code, message);

export const payloadTooLarge = (message = "The request is too large.") => new AppError(413, "payload_too_large", message);

export const unsupportedMediaType = (message = "Content-Type must be application/json.") =>
  new AppError(415, "unsupported_media_type", message);

export const tooManyRequests = (retryAfterSeconds: number, message = "Too many requests. Please wait before trying again.") =>
  new AppError(429, "rate_limited", message, { headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) } });

export const serviceUnavailable = (message = "The service is temporarily unavailable. Please try again shortly.", code = "unavailable") =>
  new AppError(503, code, message, { headers: { "Retry-After": "30" } });
