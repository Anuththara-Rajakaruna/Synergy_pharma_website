// Browser helpers for the careers forms: JSON API calls with consistent error parsing, and
// direct-to-storage uploads (presigned PUT URLs from POST /api/uploads) with byte-level
// progress, cancellation and stall detection. Client-only: uses fetch and XMLHttpRequest.

import { UPLOAD_LIMITS, type DocumentKind, type UploadPurpose } from "@/lib/careers/constants";
import type { UploadRequestPayload, UploadResponse, UploadTicket } from "@/types/careers";

const PDF_CONTENT_TYPE = "application/pdf";
const TICKET_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_STALL_TIMEOUT_MS = 120_000;

// ── Errors ───────────────────────────────────────────────────────────────────

export type ApiErrorInfo = {
  // HTTP status, or 0 when no response arrived (network failure, timeout, cancellation).
  status: number;
  code: string;
  message: string;
  fields: Record<string, string>;
  retryAfterSeconds: number | null;
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly retryAfterSeconds: number | null;

  constructor(info: ApiErrorInfo) {
    super(info.message);
    this.name = "ApiRequestError";
    this.status = info.status;
    this.code = info.code;
    this.fields = info.fields;
    this.retryAfterSeconds = info.retryAfterSeconds;
  }
}

export type UploadFailureReason = "network" | "forbidden" | "rejected" | "timeout" | "aborted";

export class UploadError extends Error {
  readonly reason: UploadFailureReason;
  // Status of the storage response, when one arrived.
  readonly status: number | null;

  constructor(reason: UploadFailureReason, message: string, status: number | null = null) {
    super(message);
    this.name = "UploadError";
    this.reason = reason;
    this.status = status;
  }
}

const UPLOAD_FAILURE_MESSAGES: Record<UploadFailureReason, string> = {
  network: "We couldn't upload your documents. Please check your internet connection and try again.",
  forbidden: "The upload link was rejected or has expired. Please try submitting again.",
  rejected: "Our file storage couldn't accept the upload. Please try again in a few minutes.",
  timeout: "The upload stopped responding. Please check your internet connection and try again.",
  aborted: "The upload was cancelled.",
};

// True when the user (or the component unmounting) cancelled the request.
export function isAbortError(error: unknown): boolean {
  if (error instanceof UploadError) return error.reason === "aborted";
  if (error instanceof ApiRequestError) return error.code === "aborted";
  return error instanceof DOMException && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fallbackMessage(status: number): string {
  if (status === 400) return "Some of the information you entered is invalid. Please check the form and try again.";
  if (status === 403) return "Your request was blocked. Please refresh the page and try again.";
  if (status === 404) return "The requested item could not be found.";
  if (status === 409) return "This request conflicts with information we already have.";
  if (status === 413) return "The request is too large.";
  if (status === 429) return "Too many attempts in a short time. Please wait a few minutes and try again.";
  if (status === 503) return "The service is temporarily unavailable. Please try again shortly.";
  if (status >= 500) return "Something went wrong on our side. Please try again in a few minutes.";
  return "The request could not be completed. Please try again.";
}

// Retry-After is either a number of seconds or an HTTP date.
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Math.max(1, Number.parseInt(trimmed, 10));
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(1, Math.ceil((date - Date.now()) / 1000));
}

// Reads `{ error, code, fields }` from a failed response without assuming it is JSON: proxies
// and platforms can answer with HTML error pages (413, 502, 504).
export async function parseApiError(response: Response): Promise<ApiErrorInfo> {
  let body: Record<string, unknown> = {};
  const contentType = response.headers.get("content-type") ?? "";
  if (/\bjson\b/i.test(contentType)) {
    try {
      const parsed: unknown = await response.json();
      if (isRecord(parsed)) body = parsed;
    } catch {
      // Malformed or truncated body: fall back to the status-based message.
    }
  }
  const fields: Record<string, string> = {};
  if (isRecord(body.fields)) {
    for (const [key, value] of Object.entries(body.fields)) {
      if (typeof value === "string" && value) fields[key] = value;
    }
  }
  const message = typeof body.error === "string" && body.error.trim() ? body.error : fallbackMessage(response.status);
  const code = typeof body.code === "string" && body.code ? body.code : `http_${response.status}`;
  return { status: response.status, code, message, fields, retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")) };
}

function transportError(code: "network_error" | "timeout" | "aborted" | "invalid_response", status = 0): ApiRequestError {
  const messages = {
    network_error: "We couldn't reach our server. Please check your internet connection and try again.",
    timeout: "The server took too long to respond. Please check your connection and try again.",
    aborted: "The request was cancelled.",
    invalid_response: "We received an unexpected response from the server. Please try again.",
  } as const;
  return new ApiRequestError({ status, code, message: messages[code], fields: {}, retryAfterSeconds: null });
}

// "in about 12 minutes", "in about 2 hours". Used for 429 responses.
export function retryAfterText(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "in a few minutes";
  if (seconds < 90) return "in about a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `in about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
  return `in about ${Math.round(hours / 24)} days`;
}

// A user-facing sentence for a failed request that the form does not handle specifically.
export function describeRequestFailure(error: unknown, options: { fallback: string; unavailable?: string }): string {
  if (error instanceof UploadError) return error.message;
  if (!(error instanceof ApiRequestError)) return options.fallback;
  if (error.status === 0) return error.message;
  if (error.status === 429) return `Too many attempts in a short time. Please try again ${retryAfterText(error.retryAfterSeconds)}.`;
  if (error.status === 503) return options.unavailable ?? error.message;
  if (error.status === 403) return fallbackMessage(403);
  if (error.status >= 500) return fallbackMessage(500);
  return error.message || options.fallback;
}

// ── JSON requests ────────────────────────────────────────────────────────────

// POSTs JSON to a same-origin API route. Non-2xx responses, network failures, timeouts and
// cancellations all reject with ApiRequestError.
export async function postJson<T>(url: string, body: unknown, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  const { signal, timeoutMs } = options;
  if (signal?.aborted) throw transportError("aborted");

  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer =
    timeoutMs && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

  const interrupted = (): ApiRequestError | null => {
    if (timedOut) return transportError("timeout");
    if (signal?.aborted) return transportError("aborted");
    return null;
  };

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      throw interrupted() ?? transportError("network_error");
    }
    if (!response.ok) {
      const info = await parseApiError(response);
      throw interrupted() ?? new ApiRequestError(info);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw interrupted() ?? transportError("invalid_response", response.status);
    }
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// ── Uploads ──────────────────────────────────────────────────────────────────

export type UploadSelection = { kind: DocumentKind; file: File };
export type UploadedDocument = UploadSelection & { uploadId: string };

export type UploadProgressInfo = {
  fraction: number; // 0..1, weighted by bytes across all files being uploaded
  loadedBytes: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
};

// Some systems label PDFs with legacy MIME types; the server verifies the actual bytes.
const PDF_TYPE_ALIASES = new Set(["application/x-pdf", "application/acrobat", "applications/vnd.pdf", "text/pdf", "text/x-pdf"]);

export function normalizePdfType(type: string): string {
  const lower = type.trim().toLowerCase();
  return PDF_TYPE_ALIASES.has(lower) ? PDF_CONTENT_TYPE : lower;
}

// Validation input for describeFileProblem from @/lib/careers/validation.
export function fileDescriptor(file: File): { name: string; size: number; type: string } {
  return { name: file.name, size: file.size, type: normalizePdfType(file.type) };
}

function isValidTicket(value: unknown, kind: DocumentKind): value is UploadTicket {
  if (!isRecord(value)) return false;
  if (typeof value.uploadId !== "string" || !value.uploadId || value.kind !== kind || value.method !== "PUT") return false;
  if (typeof value.url !== "string" || !isRecord(value.headers)) return false;
  if (!Object.values(value.headers).every((header) => typeof header === "string")) return false;
  try {
    const url = new URL(value.url);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// POST /api/uploads. Returns one ticket per file, in the same order.
export async function requestUploadTickets(purpose: UploadPurpose, files: UploadSelection[], signal?: AbortSignal): Promise<UploadTicket[]> {
  const payload: UploadRequestPayload = {
    purpose,
    files: files.map(({ kind, file }) => ({
      kind,
      name: file.name,
      size: file.size,
      contentType: normalizePdfType(file.type) || PDF_CONTENT_TYPE,
    })),
  };
  const response = await postJson<UploadResponse>("/api/uploads", payload, { signal, timeoutMs: TICKET_REQUEST_TIMEOUT_MS });
  const tickets: unknown[] = isRecord(response) && Array.isArray(response.uploads) ? response.uploads : [];
  if (tickets.length !== files.length || !tickets.every((ticket, index) => isValidTicket(ticket, files[index].kind))) {
    throw transportError("invalid_response", 201);
  }
  return tickets as UploadTicket[];
}

// Headers the browser controls itself; setting them throws or is silently ignored. The
// signed Content-Length is sent automatically from the Blob size.
const FORBIDDEN_REQUEST_HEADERS = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
]);

function isSettableHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return !FORBIDDEN_REQUEST_HEADERS.has(lower) && !lower.startsWith("proxy-") && !lower.startsWith("sec-");
}

// PUTs one file to its presigned URL with the ticket's headers. Resolves on 2xx. The timeout
// is an inactivity timeout (no upload progress for `stallTimeoutMs`, default 120 s), so large
// files on slow connections are not cut off while they are still moving.
export function uploadFileWithProgress(
  ticket: UploadTicket,
  file: Blob,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal; stallTimeoutMs?: number } = {}
): Promise<void> {
  const { onProgress, signal } = options;
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_UPLOAD_STALL_TIMEOUT_MS;

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadError("aborted", UPLOAD_FAILURE_MESSAGES.aborted));
      return;
    }

    const xhr = new XMLHttpRequest();
    let settled = false;
    let timedOut = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const onAbort = () => xhr.abort();
    const armStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        timedOut = true;
        xhr.abort();
      }, stallTimeoutMs);
    };
    const finish = (error?: UploadError) => {
      if (settled) return;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };

    xhr.open(ticket.method, ticket.url, true);
    for (const [name, value] of Object.entries(ticket.headers)) {
      if (isSettableHeader(name)) xhr.setRequestHeader(name, value);
    }

    xhr.upload.onprogress = (event) => {
      armStallTimer();
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
      if (total > 0) onProgress?.(Math.min(1, event.loaded / total));
    };
    xhr.onprogress = armStallTimer;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        finish();
      } else if (xhr.status === 403) {
        finish(new UploadError("forbidden", UPLOAD_FAILURE_MESSAGES.forbidden, xhr.status));
      } else {
        finish(new UploadError("rejected", UPLOAD_FAILURE_MESSAGES.rejected, xhr.status));
      }
    };
    // CORS rejections and dropped connections both surface as a plain network error.
    xhr.onerror = () => finish(new UploadError("network", UPLOAD_FAILURE_MESSAGES.network));
    xhr.onabort = () =>
      finish(timedOut ? new UploadError("timeout", UPLOAD_FAILURE_MESSAGES.timeout) : new UploadError("aborted", UPLOAD_FAILURE_MESSAGES.aborted));

    signal?.addEventListener("abort", onAbort, { once: true });
    armStallTimer();
    try {
      xhr.send(file);
    } catch {
      finish(new UploadError("network", UPLOAD_FAILURE_MESSAGES.network));
    }
  });
}

// Remembers upload ids of files already uploaded in this page session, so retrying a submission
// (after a rate limit, outage or field error) doesn't upload the same bytes again. Entries are
// used only well within the server's unclaimed-upload lifetime.
export class UploadCache {
  private entries = new WeakMap<File, { kind: DocumentKind; uploadId: string; storedAt: number }>();
  private readonly maxAgeMs = Math.max(0, UPLOAD_LIMITS.intentTtlSeconds - 15 * 60) * 1000;

  get(file: File, kind: DocumentKind): string | null {
    const entry = this.entries.get(file);
    if (!entry || entry.kind !== kind || Date.now() - entry.storedAt > this.maxAgeMs) return null;
    return entry.uploadId;
  }

  set(file: File, kind: DocumentKind, uploadId: string): void {
    this.entries.set(file, { kind, uploadId, storedAt: Date.now() });
  }

  // Call after a successful submission (ids are consumed) or when the server reports an
  // upload as expired, missing or invalid.
  clear(): void {
    this.entries = new WeakMap();
  }
}

// Requests tickets for every file not already uploaded and uploads them one after another.
// Returns the upload ids in the order of `selections`.
export async function uploadDocuments(
  purpose: UploadPurpose,
  selections: UploadSelection[],
  options: { onProgress?: (progress: UploadProgressInfo) => void; signal?: AbortSignal; cache?: UploadCache } = {}
): Promise<UploadedDocument[]> {
  const { onProgress, signal, cache } = options;
  const uploadIds = selections.map((selection) => cache?.get(selection.file, selection.kind) ?? null);
  const pending = selections.map((selection, index) => ({ selection, index })).filter(({ index }) => uploadIds[index] === null);
  const totalBytes = pending.reduce((sum, { selection }) => sum + selection.file.size, 0);
  const report = (loadedBytes: number, completedFiles: number) =>
    onProgress?.({
      fraction: totalBytes > 0 ? Math.min(1, loadedBytes / totalBytes) : 1,
      loadedBytes,
      totalBytes,
      completedFiles,
      totalFiles: pending.length,
    });

  report(0, 0);
  if (pending.length > 0) {
    const tickets = await requestUploadTickets(
      purpose,
      pending.map(({ selection }) => selection),
      signal
    );
    let completedBytes = 0;
    for (let position = 0; position < pending.length; position += 1) {
      const { selection, index } = pending[position];
      const ticket = tickets[position];
      await uploadFileWithProgress(ticket, selection.file, {
        signal,
        onProgress: (fraction) => report(completedBytes + fraction * selection.file.size, position),
      });
      completedBytes += selection.file.size;
      uploadIds[index] = ticket.uploadId;
      cache?.set(selection.file, selection.kind, ticket.uploadId);
      report(completedBytes, position + 1);
    }
  }

  return selections.map((selection, index) => {
    const uploadId = uploadIds[index];
    if (!uploadId) throw transportError("invalid_response");
    return { ...selection, uploadId };
  });
}
