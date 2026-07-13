import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/session";

// ─── Rate limiting (in-memory, single-instance) ───────────────────────────────
// Tracks submission counts per IP using a sliding 1-hour window.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5; // 5 submissions per IP per hour

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count += 1;
  return true;
}

// ─── Protected admin paths ────────────────────────────────────────────────────
// /api/jobs GET is public (candidates browse job listings).
// All mutations (POST/PUT/DELETE) and applicant/CV routes require admin auth.
const ALWAYS_PROTECTED = ["/careers/admin", "/api/applicants", "/api/cvs", "/api/admin"];
const WRITE_PROTECTED = ["/api/jobs"]; // only non-GET requires auth

function isAdminPath(pathname: string, method: string): boolean {
  if (ALWAYS_PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?"))) {
    return true;
  }
  if (method !== "GET" && WRITE_PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return true;
  }
  return false;
}

function isLoginPage(pathname: string): boolean {
  return pathname === "/careers/admin/login" ||
    pathname === "/api/admin/login" ||
    pathname === "/api/admin/logout";
}

// ─── Rate-limited submission paths ───────────────────────────────────────────
const SUBMIT_PATHS = ["/api/apply", "/api/talent-pool"];

function isSubmitPath(pathname: string): boolean {
  return SUBMIT_PATHS.some((p) => pathname.startsWith(p));
}

// ─── Middleware ───────────────────────────────────────────────────────────────
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rate limit submission endpoints (POST only)
  if (isSubmitPath(pathname) && request.method === "POST") {
    const ip = getClientIp(request);
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many submissions. Please try again later." },
        { status: 429 }
      );
    }
  }

  // Skip auth check for login page itself
  if (isLoginPage(pathname)) {
    return NextResponse.next();
  }

  // Protect admin routes
  if (isAdminPath(pathname, request.method)) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const valid = token ? await verifySessionToken(token) : false;

    if (!valid) {
      // For API requests return 401; for page requests redirect to login
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
      }
      const loginUrl = new URL("/careers/admin/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/careers/admin/:path*",
    "/api/jobs/:path*",
    "/api/applicants/:path*",
    "/api/cvs/:path*",
    "/api/admin/:path*",
    "/api/apply",
    "/api/talent-pool",
  ],
};
