// Failure kinds for the Google Sheets / Google Drive backend. They mirror the shape the rest
// of the application already expects from an infrastructure layer: configuration problems are
// deployment bugs (reported as 500), everything transient is a 503, and "not found" is a normal
// result that callers decide how to treat.
//
// Messages never contain credentials, access tokens, spreadsheet contents or applicant data.

export class GoogleConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GoogleConfigError";
  }
}

export class GoogleUnavailableError extends Error {
  // Seconds the caller should wait before retrying, when the API told us.
  readonly retryAfterSeconds: number | null;

  constructor(message: string, options: { cause?: unknown; retryAfterSeconds?: number | null } = {}) {
    super(message, { cause: options.cause });
    this.name = "GoogleUnavailableError";
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export class GoogleNotFoundError extends Error {
  constructor(message = "The requested Google resource does not exist.") {
    super(message);
    this.name = "GoogleNotFoundError";
  }
}

// Status codes that mean "the deployment is wrong", not "try again later".
const CONFIG_STATUSES = new Set([400, 401, 403]);

// Google's transient statuses. 429 is rate limiting, 408 a request timeout, 5xx a backend fault.
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status);
}

export function isConfigStatus(status: number): boolean {
  return CONFIG_STATUSES.has(status);
}

// True when a failure means "Google can't be reached right now" rather than a bug or bad input,
// so callers can answer with 503 Service Unavailable.
export function isGoogleUnavailableError(err: unknown): boolean {
  if (err instanceof GoogleUnavailableError) return true;
  if (!(err instanceof Error)) return false;
  // Undici / Node fetch transport failures.
  if (err.name === "TypeError" && /fetch failed/i.test(err.message)) return true;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  const code = (err as { code?: unknown }).code;
  return (
    typeof code === "string" &&
    ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(code)
  );
}
