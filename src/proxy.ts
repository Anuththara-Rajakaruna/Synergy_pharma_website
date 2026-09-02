import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// In-memory rate limiter: keyed by IP, stores { count, windowStart }
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 5;
const LOGIN_RATE_LIMIT_MAX = 10;

function isRateLimited(ip: string, bucket: string, max: number): boolean {
  const key = `${ip}:${bucket}`;
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

function getIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

async function isAuthenticated(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return false;
  return verifySessionToken(token);
}

const isDev = process.env.NODE_ENV === "development";

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' trusts scripts loaded by a nonced script (e.g. Next's chunk
    // loader); 'self' is kept as a fallback for browsers that don't support it.
    // Turbopack's dev runtime needs 'unsafe-eval' for module evaluation.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://images.unsplash.com",
    "font-src 'self' data:",
    // ws: needed for Turbopack HMR WebSocket in dev.
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

function withCsp(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const method = request.method;

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const nextOptions = { request: { headers: requestHeaders } };

  // Rate limiting for public submission endpoints
  if (pathname === "/api/apply" || pathname === "/api/talent-pool") {
    if (method === "POST") {
      const ip = getIp(request);
      if (isRateLimited(ip, pathname, RATE_LIMIT_MAX)) {
        return withCsp(
          NextResponse.json(
            { error: "Too many requests. Please wait before submitting again." },
            { status: 429, headers: { "Retry-After": "900" } }
          ),
          csp
        );
      }
    }
  }

  // Rate limiting for admin login
  if (pathname === "/api/admin/login" && method === "POST") {
    const ip = getIp(request);
    if (isRateLimited(ip, "/api/admin/login", LOGIN_RATE_LIMIT_MAX)) {
      return withCsp(
        NextResponse.json(
          { error: "Too many login attempts. Please wait before trying again." },
          { status: 429, headers: { "Retry-After": "900" } }
        ),
        csp
      );
    }
  }

  // Admin page routes — redirect to login if not authenticated
  if (pathname.startsWith("/careers/admin") && !pathname.startsWith("/careers/admin/login")) {
    if (!(await isAuthenticated(request))) {
      const loginUrl = new URL("/careers/admin/login", request.url);
      loginUrl.searchParams.set("from", pathname + search);
      return withCsp(NextResponse.redirect(loginUrl), csp);
    }
  }

  // Admin API routes — return 401 if not authenticated
  const isAdminApi =
    pathname.startsWith("/api/applicants") ||
    pathname.startsWith("/api/files") ||
    (pathname === "/api/jobs" && method === "POST") ||
    (pathname.startsWith("/api/jobs/") && (method === "PUT" || method === "DELETE"));

  if (isAdminApi) {
    if (!(await isAuthenticated(request))) {
      return withCsp(NextResponse.json({ error: "Authentication required." }, { status: 401 }), csp);
    }
  }

  return withCsp(NextResponse.next(nextOptions), csp);
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
