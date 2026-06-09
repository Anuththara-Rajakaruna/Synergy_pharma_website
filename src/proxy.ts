import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// In-memory rate limiter: keyed by IP, stores { count, windowStart }
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 5;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
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

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const method = request.method;

  // Rate limiting for public submission endpoints
  if (pathname === "/api/apply" || pathname === "/api/talent-pool") {
    if (method === "POST") {
      const ip = getIp(request);
      if (isRateLimited(ip)) {
        return NextResponse.json(
          { error: "Too many requests. Please wait before submitting again." },
          { status: 429, headers: { "Retry-After": "900" } }
        );
      }
    }
  }

  // Admin page routes — redirect to login if not authenticated
  if (pathname.startsWith("/careers/admin") && !pathname.startsWith("/careers/admin/login")) {
    if (!(await isAuthenticated(request))) {
      const loginUrl = new URL("/careers/admin/login", request.url);
      loginUrl.searchParams.set("from", pathname + search);
      return NextResponse.redirect(loginUrl);
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
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/careers/admin/:path*",
    "/api/applicants/:path*",
    "/api/jobs",
    "/api/jobs/:path*",
    "/api/apply",
    "/api/talent-pool",
    "/api/files/:path*",
  ],
};
