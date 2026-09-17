// Fixed-window rate limiting backed by MongoDB, so limits hold across serverless instances and
// restarts. Keys (IP addresses, email addresses) are stored hashed to keep PII out of the
// rate_limits collection; the TTL index on expiresAt removes finished windows.

import { createHash } from "node:crypto";
import { tooManyRequests } from "@/lib/http/errors";
import { connectToDatabase, isDuplicateKeyError } from "@/lib/mongodb";
import { RateLimitModel } from "@/models/rate-limit";

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

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

async function incrementWindow(id: string, now: Date, windowSeconds: number): Promise<{ count: number; expiresAt: Date }> {
  const windowEnd = new Date(now.getTime() + windowSeconds * 1000);
  // A missing document (upsert) or a finished window starts a new window at count 1.
  const expired = { $lte: [{ $ifNull: ["$expiresAt", new Date(0)] }, now] };
  // One pipeline update is atomic per document, so concurrent requests never lose increments.
  const doc = await RateLimitModel.findOneAndUpdate(
    { _id: id },
    [
      {
        $set: {
          count: { $cond: [expired, 1, { $add: ["$count", 1] }] },
          windowStartedAt: { $cond: [expired, now, "$windowStartedAt"] },
          expiresAt: { $cond: [expired, windowEnd, "$expiresAt"] },
        },
      },
    ],
    { upsert: true, returnDocument: "after", updatePipeline: true }
  )
    .select({ count: 1, expiresAt: 1 })
    .lean();
  if (!doc) throw new Error("Rate limit update returned no document.");
  return { count: doc.count, expiresAt: doc.expiresAt };
}

export async function consumeRateLimit(bucket: string, key: string, options: RateLimitOptions): Promise<RateLimitResult> {
  const { limit, windowSeconds } = options;
  if (!BUCKET_PATTERN.test(bucket)) throw new Error(`Invalid rate limit bucket name: ${bucket}`);
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error(`Invalid rate limit options for bucket ${bucket}`);
  }

  await connectToDatabase();
  const id = `${bucket}:${hashKey(key)}`;
  const now = new Date();

  let state: { count: number; expiresAt: Date };
  try {
    state = await incrementWindow(id, now, windowSeconds);
  } catch (err) {
    // Two first requests for the same key can both try to insert; the loser retries as an update.
    if (!isDuplicateKeyError(err)) throw err;
    state = await incrementWindow(id, now, windowSeconds);
  }

  const allowed = state.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - state.count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((state.expiresAt.getTime() - now.getTime()) / 1000)),
  };
}

// Throws 429 `rate_limited` (with Retry-After) once the limit is exceeded. Store failures are
// rethrown so the request fails as unavailable instead of silently skipping the limit.
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
