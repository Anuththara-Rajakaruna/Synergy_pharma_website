// Browser-side client for the careers admin API. Every admin component talks to the server
// through adminFetch so session expiry, forced password changes and error bodies are handled
// the same way everywhere.

import { useCallback, useEffect, useRef, useState } from "react";

// Window events shared by the admin panels (see AdminApp).
export const ADMIN_EVENTS = {
  filterApplications: "admin:filter-applications",
  openApplication: "admin:open-application",
  openTalent: "admin:open-talent",
  passwordChangeRequired: "admin:password-change-required",
} as const;

export class AdminApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  // Seconds from a 429/503 Retry-After header, when the server sent one.
  retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { fields?: Record<string, string>; retryAfterSeconds?: number | null } = {}
  ) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
    this.fields = options.fields;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export type AdminFetchInit = RequestInit & { json?: unknown };

const NETWORK_ERROR_MESSAGE = "Unable to reach the server. Check your connection and try again.";

function fallbackMessage(status: number): string {
  if (status === 400) return "Some of the submitted values are invalid.";
  if (status === 403) return "You do not have permission to do that.";
  if (status === 404) return "The requested record could not be found.";
  if (status === 409) return "This record was changed by someone else. Refresh and try again.";
  if (status === 413) return "The request is too large.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status === 503) return "The service is temporarily unavailable. Please try again shortly.";
  if (status >= 500) return "Something went wrong on the server. Please try again.";
  return "The request could not be completed.";
}

function readRetryAfter(response: Response): number | null {
  const seconds = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function readFields(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const fields: Record<string, string> = {};
  for (const [key, message] of Object.entries(value as Record<string, unknown>)) {
    if (typeof message === "string") fields[key] = message;
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

async function parseErrorResponse(response: Response): Promise<AdminApiError> {
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    // Non-JSON error pages (proxies, platform errors) fall back to a generic message.
  }
  const message = typeof body.error === "string" && body.error.trim() ? body.error : fallbackMessage(response.status);
  const code = typeof body.code === "string" && body.code ? body.code : `http_${response.status}`;
  return new AdminApiError(response.status, code, message, {
    fields: readFields(body.fields),
    retryAfterSeconds: readRetryAfter(response),
  });
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// Normalizes anything thrown by adminFetch (or a component) into an AdminApiError.
export function toAdminApiError(err: unknown): AdminApiError {
  if (err instanceof AdminApiError) return err;
  if (err instanceof TypeError) return new AdminApiError(0, "network_error", NETWORK_ERROR_MESSAGE);
  return new AdminApiError(0, "client_error", "Something went wrong. Please try again.");
}

let redirectingToLogin = false;

// A full page load (not client navigation) so no candidate data stays in memory once the
// session is gone.
function redirectToLogin(): void {
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  const target = new URL("/careers/admin/login", window.location.origin);
  target.searchParams.set("from", `${window.location.pathname}${window.location.search}`);
  window.location.assign(target.href);
}

export async function adminFetch<T>(path: string, init: AdminFetchInit = {}): Promise<T> {
  const { json, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  let body = rest.body;
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  let response: Response;
  try {
    response = await fetch(path, { ...rest, body, headers, credentials: "same-origin", cache: "no-store" });
  } catch (err) {
    // Aborts are expected (stale requests, unmounts); callers check isAbortError.
    if (isAbortError(err)) throw err;
    throw new AdminApiError(0, "network_error", NETWORK_ERROR_MESSAGE);
  }

  if (response.status === 401) {
    redirectToLogin();
    throw new AdminApiError(401, "unauthorized", "Your session has ended. Redirecting to the sign-in page…");
  }

  if (!response.ok) {
    const error = await parseErrorResponse(response);
    if (response.status === 403 && error.code === "password_change_required") {
      window.dispatchEvent(new CustomEvent(ADMIN_EVENTS.passwordChangeRequired));
    }
    throw error;
  }

  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new AdminApiError(response.status, "invalid_response", "The server returned an unexpected response. Please try again.");
  }
}

// "?a=1&b=x", skipping undefined, null and empty values. Returns "" when nothing is set.
export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    const text = String(value);
    if (text === "") continue;
    search.set(key, text);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

type QueryState<T> = {
  key: string | null;
  path: string | null;
  data: T | null;
  error: AdminApiError | null;
};

export type AdminQueryOptions = {
  // Re-fetch in the background every N milliseconds while the page is visible, and whenever the
  // browser tab regains focus or becomes visible again. Lists stay current (e.g. new applications
  // appear) without a manual refresh. Background results replace the data silently: loading
  // stays false, and a failed background refresh keeps the current data without an error.
  autoRefreshMs?: number;
};

// How often open admin lists and dashboard counts re-check the server for changes (e.g. new
// applications submitted on the public site).
export const ADMIN_AUTO_REFRESH_MS = 30_000;

// Focus/visibility refreshes closer together than this are skipped.
const MIN_FOCUS_REFRESH_GAP_MS = 5_000;

export type AdminQueryResult<T> = {
  data: T | null;
  error: AdminApiError | null;
  loading: boolean;
  reload: () => void;
};

// Loads `path` with adminFetch and re-fetches when the path, `deps` (JSON-serializable values)
// or reload() change. Responses for superseded requests are aborted and ignored. Data from the
// previous request stays visible while the same path reloads, but is cleared when the path
// changes so a view never shows one record's data under another record's heading.
// `path: null` disables the query.
export function useAdminQuery<T>(path: string | null, deps: unknown[] = [], options: AdminQueryOptions = {}): AdminQueryResult<T> {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<QueryState<T>>({ key: null, path: null, data: null, error: null });
  const depsKey = JSON.stringify(deps);
  const requestKey = path === null ? null : `${nonce}|${depsKey}|${path}`;
  const autoRefreshMs = options.autoRefreshMs && options.autoRefreshMs > 0 ? options.autoRefreshMs : null;

  // Read by the background refresher, which must not restart its timers on every render.
  const latest = useRef({ requestKey, settled: false, lastFetchAt: 0 });
  const settledNow = state.key === requestKey;
  useEffect(() => {
    latest.current.requestKey = requestKey;
    latest.current.settled = settledNow;
  }, [requestKey, settledNow]);

  useEffect(() => {
    if (path === null || requestKey === null) return;
    const controller = new AbortController();
    latest.current.lastFetchAt = Date.now();
    adminFetch<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (controller.signal.aborted) return;
        setState({ key: requestKey, path, data, error: null });
      },
      (err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setState((previous) => ({
          key: requestKey,
          path,
          data: previous.path === path ? previous.data : null,
          error: toAdminApiError(err),
        }));
      }
    );
    return () => controller.abort();
  }, [path, requestKey]);

  useEffect(() => {
    if (path === null || autoRefreshMs === null) return;
    let controller: AbortController | null = null;

    const refresh = (reason: "interval" | "focus") => {
      if (document.visibilityState !== "visible") return;
      const snapshot = latest.current;
      // Never race a foreground load (first load, filter change, explicit reload).
      if (!snapshot.settled || snapshot.requestKey === null || controller) return;
      if (reason === "focus" && Date.now() - snapshot.lastFetchAt < MIN_FOCUS_REFRESH_GAP_MS) return;
      const keyAtStart = snapshot.requestKey;
      const current = new AbortController();
      controller = current;
      snapshot.lastFetchAt = Date.now();
      adminFetch<T>(path, { signal: current.signal })
        .then(
          (data) => {
            if (current.signal.aborted || latest.current.requestKey !== keyAtStart) return;
            setState((previous) =>
              previous.key === keyAtStart && previous.error === null && JSON.stringify(previous.data) === JSON.stringify(data)
                ? previous
                : { key: keyAtStart, path, data, error: null }
            );
          },
          () => {
            // Keep showing the current data; the next refresh or a manual reload will retry.
          }
        )
        .finally(() => {
          if (controller === current) controller = null;
        });
    };

    const interval = window.setInterval(() => refresh("interval"), autoRefreshMs);
    const onFocus = () => refresh("focus");
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh("focus");
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      controller?.abort();
    };
  }, [path, autoRefreshMs]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  if (path === null) return { data: null, error: null, loading: false, reload };
  const settled = state.key === requestKey;
  return {
    data: state.path === path ? state.data : null,
    error: settled ? state.error : null,
    loading: !settled,
    reload,
  };
}
