import { NextResponse, type NextRequest } from "next/server";
import { gaBootstrapScript } from "@/lib/analytics";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookie-name";
import { SITE_URL } from "@/lib/site";
import { getStorageUploadOrigin } from "@/lib/storage-origin";

// The proxy only sets the Content-Security-Policy and redirects signed-out visitors away from
// the admin pages. It is not an access-control boundary: API routes and the admin page check
// the session themselves, and rate limiting happens in the route handlers.

const isDev = process.env.NODE_ENV === "development";
// Only for HTTPS deployments: a production build served over plain http (local smoke tests)
// would otherwise have every script and upload URL rewritten to an https URL that does not exist.
const upgradeInsecureRequests = process.env.NODE_ENV === "production" && SITE_URL.startsWith("https://");
const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const gaEnabled = Boolean(gaMeasurementId);

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Buffer.from(digest).toString("base64");
}

// The GA bootstrap script (src/lib/analytics.ts) is static per deployment, so its
// CSP hash only needs to be computed once and can be cached for the process lifetime.
let gaScriptHashPromise: Promise<string> | null = null;
function getGaScriptHash(): Promise<string> {
  if (!gaScriptHashPromise) {
    gaScriptHashPromise = sha256Base64(gaBootstrapScript(gaMeasurementId!));
  }
  return gaScriptHashPromise;
}

// Browsers upload CVs straight to object storage with presigned PUT requests, so the bucket
// origin must be allowed in connect-src. Configuration does not change while the process runs.
let storageOrigin: string | null | undefined;
function getStorageOrigin(): string | null {
  if (storageOrigin === undefined) storageOrigin = getStorageUploadOrigin();
  return storageOrigin;
}

async function buildCsp(nonce: string): Promise<string> {
  const gaScriptSrc = gaEnabled
    ? ` 'sha256-${await getGaScriptHash()}' https://www.googletagmanager.com`
    : "";

  const connectSrc = ["'self'"];
  const uploadOrigin = getStorageOrigin();
  if (uploadOrigin) connectSrc.push(uploadOrigin);
  // GA4 sends its collection requests to google-analytics.com, which connect-src must allow
  // explicitly ('strict-dynamic' only relaxes script-src, not connect-src).
  if (gaEnabled) connectSrc.push("https://www.google-analytics.com", "https://region1.google-analytics.com");
  // ws: needed for Turbopack HMR WebSocket in dev.
  if (isDev) connectSrc.push("ws:");

  return [
    "default-src 'self'",
    // 'strict-dynamic' trusts scripts loaded by a nonced/hashed script (e.g. Next's
    // chunk loader, or the GA bootstrap script); 'self' is kept as a fallback for
    // browsers that don't support strict-dynamic.
    // Turbopack's dev runtime needs 'unsafe-eval' for module evaluation.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${gaScriptSrc}${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://images.unsplash.com",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(upgradeInsecureRequests ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

function withCsp(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

// Admin pages other than the login page. Percent-encoded paths are decoded first so an encoded
// variant of the URL gets the same redirect (the page itself still enforces authentication).
function isProtectedAdminPath(pathname: string): boolean {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: compare the raw path.
  }
  if (path !== "/careers/admin" && !path.startsWith("/careers/admin/")) return false;
  return path !== "/careers/admin/login" && !path.startsWith("/careers/admin/login/");
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = await buildCsp(nonce);

  // Cheap presence check only; the admin page validates the session against the database.
  if (isProtectedAdminPath(pathname) && !request.cookies.get(SESSION_COOKIE_NAME)?.value) {
    const loginUrl = new URL("/careers/admin/login", request.url);
    loginUrl.searchParams.set("from", `${pathname}${search}`);
    return withCsp(NextResponse.redirect(loginUrl), csp);
  }

  // Next.js reads the nonce from the request's CSP header and applies it to its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  return withCsp(NextResponse.next({ request: { headers: requestHeaders } }), csp);
}

export const config = {
  // Pages only. No `has`/`missing` conditions: a matcher condition that a client can satisfy
  // with a request header would let that client skip the proxy entirely.
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|txt|xml|woff2?|ttf|pdf|mp4|webm)$).*)",
  ],
};
