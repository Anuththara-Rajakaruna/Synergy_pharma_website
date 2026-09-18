// Fixed-window rate limiting, held in the memory of this server process.
//
// WHAT CHANGED, AND WHY
//
// The counters used to live in MongoDB, so one limit was shared by every instance and survived a
// restart. They are now per server instance: a deployment running N warm instances allows up to
// N x the limit before anyone is turned away, and a cold start forgets the window entirely.
//
// That is a deliberate trade, not an oversight. The store behind this application is a Google
// Spreadsheet, and the Sheets API allows on the order of 60 writes per minute for the whole
// project. Writing a row for every upload ticket, form submission and login attempt - including
// the attempts that are being rejected, which is precisely when the traffic is highest - would
// exhaust that quota outright and take the entire portal down with it. A limiter that costs
// nothing is worth far more here than one that is exact.
//
// The controls that actually protect the data are durable and unchanged, because they are
// enforced against the store rather than against a counter:
//
//   * one application per job and email address (a locked read-check-write plus duplicate
//     reconciliation, in src/lib/careers/server/applications.ts), and one talent profile per
//     email address - a flood of retries still cannot create a second record;
//   * admin account lockout after repeated failed sign-ins (failedLoginAttempts / lockedUntil on
//     the AdminUsers tab, in src/lib/auth/*), which no amount of instance-hopping can bypass.
//
// What is left to this module is what it was always best at: absorbing bursts, making scripted
// abuse expensive, and keeping a single client from monopolising an endpoint.
//
// Keys (IP addresses, email addresses, user ids) are still hashed before they are used, so no
// personal data is held in memory here.

import { createHash } from "node:crypto";
import { tooManyRequests } from "@/lib/http/errors";

export type RateLimitOptions = { limit: number; windowSeconds: number };
export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export const RATE_LIMITS = {
  "upload-ip": { limit: 40, windowSeconds: 15 * 60 },
  "apply-ip": { limit: 10, windowSeconds: 60 * 60 },
  "apply-email": { limit: 5, windowSeconds: 60 * 60 },
  "talent-ip": { limit: 5, windowSeconds: 60 * 60 },
  "talent-email": { limit: 3, windowSeconds: 24 * 60 * 60 },
  "contact-ip": { limit: 5, windowSeconds: 15 * 60 },
  "login-ip": { limit: 20, windowSeconds: 15 * 60 },
  // Current-password guesses from a signed-in session (keyed by user id).
  "password-user": { limit: 10, windowSeconds: 15 * 60 },
} as const satisfies Record<string, RateLimitOptions>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

const BUCKET_PATTERN = /^[a-z0-9-]{1,40}$/;

// Ceiling on how many windows are held at once. The longest window is 24 hours, so an endpoint
// under sustained attack from many addresses is the only way to approach this; at roughly a
// hundred bytes per entry the cap is a few megabytes.
const MAX_WINDOWS = 20_000;
// How often finished windows are swept out, independently of the cap.
const SWEEP_INTERVAL_MS = 60_000;

type Window = {
  count: number;
  // The limit in force when the window opened, so eviction can tell a window that is currently
  // blocking someone from one that is not.
  limit: number;
  expiresAt: number;
};

type LimiterState = { windows: Map<string, Window>; lastSweepAt: number };

declare global {
  var __synergyRateLimiter: LimiterState | undefined;
}

// On globalThis so a dev-mode hot reload does not hand out a fresh, empty set of counters on
// every edit.
const state: LimiterState = (globalThis.__synergyRateLimiter ??= { windows: new Map(), lastSweepAt: Date.now() });

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

// Removes finished windows, and - if the map is still over its cap - the windows whose loss
// matters least. Dropping a window resets its counter, so the ones that are currently turning
// requests away are kept the longest; among the rest the soonest to expire goes first, since it
// was about to reset anyway.
function sweep(now: number): void {
  state.lastSweepAt = now;
  for (const [id, window] of state.windows) {
    if (window.expiresAt <= now) state.windows.delete(id);
  }
  if (state.windows.size <= MAX_WINDOWS) return;

  const excess = state.windows.size - MAX_WINDOWS;
  const ordered = [...state.windows.entries()].sort((a, b) => {
    const blocking = Number(a[1].count > a[1].limit) - Number(b[1].count > b[1].limit);
    return blocking !== 0 ? blocking : a[1].expiresAt - b[1].expiresAt;
  });
  for (let index = 0; index < excess; index += 1) state.windows.delete(ordered[index][0]);
}

export async function consumeRateLimit(bucket: string, key: string, options: RateLimitOptions): Promise<RateLimitResult> {
  const { limit, windowSeconds } = options;
  if (!BUCKET_PATTERN.test(bucket)) throw new Error(`Invalid rate limit bucket name: ${bucket}`);
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error(`Invalid rate limit options for bucket ${bucket}`);
  }

  const now = Date.now();
  if (now - state.lastSweepAt >= SWEEP_INTERVAL_MS || state.windows.size > MAX_WINDOWS) sweep(now);

  const id = `${bucket}:${hashKey(key)}`;
  const current = state.windows.get(id);
  // A missing window, or one that has finished, starts a new window at count 1 - the rule the
  // aggregation-pipeline update applied with its $cond on expiresAt. JavaScript runs this to
  // completion without interleaving, so concurrent requests on this instance cannot lose an
  // increment the way a read-modify-write against a database could.
  const window: Window =
    current && current.expiresAt > now
      ? { count: current.count + 1, limit, expiresAt: current.expiresAt }
      : { count: 1, limit, expiresAt: now + windowSeconds * 1000 };
  state.windows.set(id, window);

  const allowed = window.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - window.count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((window.expiresAt - now) / 1000)),
  };
}

// Throws 429 `rate_limited` (with Retry-After) once the limit is exceeded.
export async function enforceRateLimit(
  bucket: string,
  key: string,
  options: RateLimitOptions,
  message?: string
): Promise<RateLimitResult> {
  const result = await consumeRateLimit(bucket, key, options);
  if (!result.allowed) throw tooManyRequests(result.retryAfterSeconds, message);
  return result;
}
