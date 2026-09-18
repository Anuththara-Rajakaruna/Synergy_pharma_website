import { getAccessToken, invalidateAccessToken } from "@/lib/google/auth";
import {
  GoogleConfigError,
  GoogleNotFoundError,
  GoogleUnavailableError,
  isConfigStatus,
  isGoogleUnavailableError,
  isTransientStatus,
} from "@/lib/google/errors";
import { logger } from "@/lib/logger";

// One place where every Google API call goes out: authentication, timeouts, and retries with
// exponential backoff for the transient failures these APIs are known for (429 quota, 5xx).
//
// Google Sheets allows 300 requests per minute per project and 60 per minute per user, which is
// the binding constraint for this application. The data layer above (src/lib/sheets-db) keeps
// requests well under it by caching reads and batching writes; this module handles the rest.
//
// Response bodies can contain applicant data, so they are never logged — only status codes and
// the API's own machine-readable reason.

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 400;
const MAX_BACKOFF_MS = 8_000;

export type GoogleRequestInit = {
  method?: string;
  // Absolute URL. Query parameters must already be encoded.
  url: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  timeoutMs?: number;
  // Operation name used in logs, e.g. "sheets.values.batchGet".
  operation: string;
  // Treat 404 as a normal result and return null instead of throwing.
  allowNotFound?: boolean;
  // Overrides the default retry count (e.g. 1 for non-idempotent appends the caller reconciles
  // itself, so a retried write can never silently duplicate a row).
  maxAttempts?: number;
};

type ErrorBody = { error?: { status?: unknown; message?: unknown; errors?: { reason?: unknown }[] } };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Full jitter: spreads retries from concurrent serverless instances so they do not all come
// back at the same moment and trip the quota again.
function backoffDelay(attempt: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null) return Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS);
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.round(ceiling * (0.5 + Math.random() * 0.5));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Math.max(1, Number.parseInt(trimmed, 10));
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(1, Math.ceil((date - Date.now()) / 1000));
}

// Google's machine-readable reason ("rateLimitExceeded", "storageQuotaExceeded", ...). Safe to
// log: it is a fixed vocabulary, never applicant data.
//
// The specific `errors[0].reason` is preferred over the coarse `error.status`, because the two
// disagree exactly where it matters most: a Drive upload that fails for want of storage quota
// comes back as status PERMISSION_DENIED with reason storageQuotaExceeded, and only the reason
// distinguishes "the service account has no quota" from "you forgot to share the folder" - two
// problems with completely different fixes.
function reasonOf(body: ErrorBody, fallback: string): string {
  const reason = body.error?.errors?.[0]?.reason;
  if (typeof reason === "string" && reason) return reason;
  const status = body.error?.status;
  if (typeof status === "string" && status) return status;
  return fallback;
}

function configMessage(operation: string, status: number, reason: string): string {
  if (reason === "storageQuotaExceeded") {
    return (
      "Google Drive refused the upload because the service account has no storage quota of its own. " +
      "Put GOOGLE_DRIVE_FOLDER_ID on a Shared Drive and set GOOGLE_DRIVE_SHARED_DRIVE_ID, or set GOOGLE_IMPERSONATE_USER."
    );
  }
  if (status === 403 && (reason === "accessNotConfigured" || reason === "SERVICE_DISABLED" || reason === "PERMISSION_DENIED")) {
    return (
      `Google denied ${operation}. Enable the Google Sheets API and the Google Drive API in the Cloud project, ` +
      "and share the spreadsheet and the Drive folder with GOOGLE_SERVICE_ACCOUNT_EMAIL as an Editor."
    );
  }
  if (status === 403) {
    return `Google denied ${operation} (${reason}). Check that the spreadsheet and Drive folder are shared with GOOGLE_SERVICE_ACCOUNT_EMAIL as an Editor.`;
  }
  if (status === 401) {
    return `Google rejected the credentials for ${operation}. Check GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.`;
  }
  return `Google rejected ${operation} as invalid (${reason}). This usually means GOOGLE_SHEETS_SPREADSHEET_ID or GOOGLE_DRIVE_FOLDER_ID points at the wrong resource.`;
}

// Performs one authenticated Google API call, retrying transient failures. Returns the Response
// on success (body not yet read), or null when `allowNotFound` is set and the resource is gone.
export async function googleFetch(init: GoogleRequestInit): Promise<Response | null> {
  const maxAttempts = init.maxAttempts ?? MAX_ATTEMPTS;
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let refreshedToken = false;

  for (let attempt = 0; ; attempt += 1) {
    const token = await getAccessToken();

    let response: Response;
    try {
      response = await fetch(init.url, {
        method: init.method ?? "GET",
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
        body: init.body ?? null,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      if (!isGoogleUnavailableError(err)) throw err;
      if (attempt + 1 >= maxAttempts) {
        throw new GoogleUnavailableError(`Could not reach Google for ${init.operation}.`, { cause: err });
      }
      logger.warn("google.request_retry", { operation: init.operation, attempt: attempt + 1, reason: "transport" });
      await sleep(backoffDelay(attempt, null));
      continue;
    }

    if (response.ok) return response;

    if (response.status === 404 && init.allowNotFound) {
      // Drain so the connection can be reused.
      await response.arrayBuffer().catch(() => undefined);
      return null;
    }

    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      // Non-JSON error page (proxy, gateway); the status is enough.
    }
    const reason = reasonOf(body, `http_${response.status}`);

    // A rotated key, or a token that was valid when the instance warmed up. Refresh once.
    if (response.status === 401 && !refreshedToken) {
      refreshedToken = true;
      invalidateAccessToken();
      logger.warn("google.token_refresh", { operation: init.operation });
      continue;
    }

    if (isTransientStatus(response.status) && attempt + 1 < maxAttempts) {
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      logger.warn("google.request_retry", { operation: init.operation, attempt: attempt + 1, status: response.status, reason });
      await sleep(backoffDelay(attempt, retryAfter));
      continue;
    }

    if (response.status === 404) throw new GoogleNotFoundError(`Google could not find the resource for ${init.operation}.`);

    if (isConfigStatus(response.status)) {
      // storageQuotaExceeded arrives as a 403 but is a deployment problem, not a permission one.
      logger.error("google.request_rejected", { operation: init.operation, status: response.status, reason });
      throw new GoogleConfigError(configMessage(init.operation, response.status, reason));
    }

    logger.error("google.request_failed", { operation: init.operation, status: response.status, reason });
    throw new GoogleUnavailableError(`Google returned HTTP ${response.status} for ${init.operation}.`, {
      retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
    });
  }
}

// googleFetch plus JSON decoding. Returns null only when `allowNotFound` is set.
export async function googleJson<T>(init: GoogleRequestInit): Promise<T | null> {
  const response = await googleFetch(init);
  if (!response) return null;
  try {
    return (await response.json()) as T;
  } catch (err) {
    throw new GoogleUnavailableError(`Google returned an unreadable response for ${init.operation}.`, { cause: err });
  }
}
