import { api, type ApiResult, type CallOptions } from "../../support/api";
import { randomObjectId } from "./fixtures";

// Every admin API route, with a harmless body, for the authorization and CSRF matrices. Ids are
// random so that a guard that fails open would hit a 404 instead of modifying real data.

export type AdminRoute = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  json?: unknown;
  // Only the "admin" role may call it (HR gets 403).
  adminOnly?: boolean;
  // Still allowed while the user must change a temporary password.
  allowPasswordChangePending?: boolean;
};

const id = randomObjectId();
const jobSlug = "e2e-matrix-no-such-job";

export const ADMIN_ROUTES: AdminRoute[] = [
  { method: "GET", path: "/api/admin/me", allowPasswordChangePending: true },
  { method: "POST", path: "/api/admin/password", json: {}, allowPasswordChangePending: true },
  { method: "GET", path: "/api/admin/users", adminOnly: true },
  { method: "POST", path: "/api/admin/users", json: {}, adminOnly: true },
  { method: "PATCH", path: `/api/admin/users/${id}`, json: { name: "Matrix Test" }, adminOnly: true },
  { method: "POST", path: `/api/admin/users/${id}/reset-password`, adminOnly: true },
  { method: "GET", path: "/api/admin/audit", adminOnly: true },
  { method: "GET", path: "/api/admin/jobs" },
  { method: "POST", path: "/api/admin/jobs", json: {} },
  { method: "GET", path: `/api/admin/jobs/${jobSlug}` },
  { method: "PATCH", path: `/api/admin/jobs/${jobSlug}`, json: {} },
  { method: "DELETE", path: `/api/admin/jobs/${jobSlug}` },
  { method: "POST", path: `/api/admin/jobs/${jobSlug}/status`, json: { action: "archive" } },
  { method: "GET", path: "/api/admin/applications" },
  { method: "GET", path: "/api/admin/applications/export" },
  { method: "GET", path: `/api/admin/applications/${id}` },
  { method: "DELETE", path: `/api/admin/applications/${id}`, adminOnly: true },
  { method: "POST", path: `/api/admin/applications/${id}/status`, json: { status: "rejected", expectedStatus: "submitted" } },
  { method: "POST", path: `/api/admin/applications/${id}/notes`, json: { body: "Matrix note" } },
  { method: "POST", path: `/api/admin/applications/${id}/archive`, json: { archived: true } },
  { method: "POST", path: `/api/admin/applications/${id}/talent-pool`, json: {} },
  { method: "GET", path: "/api/admin/talent-pool" },
  { method: "POST", path: "/api/admin/talent-pool", json: {} },
  { method: "GET", path: "/api/admin/talent-pool/tags" },
  { method: "GET", path: `/api/admin/talent-pool/${id}` },
  { method: "PATCH", path: `/api/admin/talent-pool/${id}`, json: { name: "Matrix Test" } },
  { method: "DELETE", path: `/api/admin/talent-pool/${id}`, adminOnly: true },
  { method: "POST", path: `/api/admin/talent-pool/${id}/notes`, json: { body: "Matrix note" } },
  { method: "POST", path: `/api/admin/talent-pool/${id}/archive`, json: { archived: true } },
  { method: "POST", path: `/api/admin/talent-pool/${id}/apply`, json: { jobId: jobSlug } },
  { method: "GET", path: "/api/admin/stats" },
  { method: "GET", path: `/api/admin/documents/${id}` },
  { method: "GET", path: "/api/admin/candidates/export?email=matrix@example.com", adminOnly: true },
  {
    method: "POST",
    path: "/api/uploads",
    json: { purpose: "admin_talent", files: [{ kind: "cv", name: "cv.pdf", size: 1024, contentType: "application/pdf" }] },
  },
];

export const UNSAFE_ADMIN_ROUTES = ADMIN_ROUTES.filter((route) => route.method !== "GET");

// Headers that once let requests skip the proxy (prefetch matcher conditions) or that ask Next.js
// for special handling. None of them may change an authorization decision.
export const BYPASS_HEADER_VARIANTS: Record<string, string>[] = [
  {},
  { "next-router-prefetch": "1" },
  { purpose: "prefetch" },
  { "sec-purpose": "prefetch" },
  { rsc: "1" },
  { rsc: "1", "next-router-prefetch": "1" },
  { "next-router-segment-prefetch": "/_tree" },
  { "x-middleware-subrequest": "src/proxy:src/proxy:src/proxy:src/proxy:src/proxy" },
  { "x-middleware-prefetch": "1", "x-nextjs-data": "1" },
];

export function describeRoute(route: AdminRoute): string {
  return `${route.method} ${route.path}`;
}

// Next.js answers React Server Component requests ("rsc: 1") that lack the cache-busting "_rsc"
// query parameter with a redirect to the same URL including it. Follow those hops so the
// assertion applies to the response the client finally gets.
export async function requestFollowingRscRedirects(method: string, path: string, options: CallOptions = {}): Promise<ApiResult<unknown>> {
  let current = path;
  let result = await api(method, current, options);
  for (let hop = 0; hop < 3 && (result.status === 307 || result.status === 308); hop += 1) {
    const location = result.headers.get("location") ?? "";
    if (!location.includes("_rsc")) break;
    const next = new URL(location, "http://placeholder.invalid");
    const target = next.pathname + next.search;
    if (new URL(current, "http://placeholder.invalid").pathname !== next.pathname) break;
    current = target;
    result = await api(method, current, options);
  }
  return result;
}
