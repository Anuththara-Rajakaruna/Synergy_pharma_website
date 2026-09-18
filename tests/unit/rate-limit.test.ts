import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, it } from "node:test";
import { consumeRateLimit, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { AppError } from "@/lib/http/errors";
import { APP_ENV_VARIABLES, withEnvAsync } from "./support/env";

// Rate limiting is now per server instance and held in memory: writing a row to Google Sheets
// per request would exhaust the API quota (300 requests/minute/project). This test therefore
// lives with the unit tests - it needs no store at all - and asserts the same counting
// behaviour the MongoDB-backed limiter had, minus the cross-instance guarantee.
//
// The durable anti-abuse controls are elsewhere and are covered by the integration suite: the
// one-application-per-job rule (tests/integration/applications.test.ts) and the admin account
// lockout (tests/integration/users-sessions.test.ts).

function uniqueKey(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

// Each test uses its own bucket so the in-process state of one test cannot reach another.
function uniqueBucket(): string {
  return `test-${randomBytes(6).toString("hex")}`;
}

async function expectRateLimited(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof AppError, String(err));
    assert.equal(`${err.status} ${err.code}`, "429 rate_limited");
    return err;
  }
  assert.fail("expected the request to be rate limited");
}

describe("rate limiting", () => {
  it("uses the limits from the design", () => {
    assert.deepEqual(
      { ...RATE_LIMITS, "password-user": undefined },
      {
        "upload-ip": { limit: 40, windowSeconds: 900 },
        "apply-ip": { limit: 10, windowSeconds: 3600 },
        "apply-email": { limit: 5, windowSeconds: 3600 },
        "talent-ip": { limit: 5, windowSeconds: 3600 },
        "talent-email": { limit: 3, windowSeconds: 86_400 },
        "contact-ip": { limit: 5, windowSeconds: 900 },
        "login-ip": { limit: 20, windowSeconds: 900 },
        "password-user": undefined,
      }
    );
    assert.deepEqual(RATE_LIMITS["password-user"], { limit: 10, windowSeconds: 900 });
  });

  it("counts requests in a fixed window and reports when to retry", async () => {
    const bucket = uniqueBucket();
    const key = uniqueKey("198.51.100.7");
    const options = { limit: 3, windowSeconds: 600 };
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await consumeRateLimit(bucket, key, options));
    assert.deepEqual(
      results.slice(0, 3).map((result) => [result.allowed, result.remaining, result.retryAfterSeconds]),
      [
        [true, 2, 0],
        [true, 1, 0],
        [true, 0, 0],
      ]
    );
    assert.equal(results[3].allowed, false);
    assert.equal(results[3].remaining, 0);
    assert.ok(results[3].retryAfterSeconds > 590 && results[3].retryAfterSeconds <= 600, String(results[3].retryAfterSeconds));
  });

  it("starts a new window once the previous one has expired", async () => {
    const bucket = uniqueBucket();
    const key = uniqueKey("reset");
    const options = { limit: 2, windowSeconds: 1 };
    assert.equal((await consumeRateLimit(bucket, key, options)).allowed, true);
    assert.equal((await consumeRateLimit(bucket, key, options)).allowed, true);
    assert.equal((await consumeRateLimit(bucket, key, options)).allowed, false);

    // The window is one second long; after it passes the key is allowed again from scratch.
    await sleep(1100);
    const fresh = await consumeRateLimit(bucket, key, options);
    assert.deepEqual([fresh.allowed, fresh.remaining], [true, 1]);
  });

  it("keeps buckets and keys independent", async () => {
    const a = uniqueBucket();
    const b = uniqueBucket();
    const email = uniqueKey("Nimal.Perera@Example.com");
    const options = { limit: 1, windowSeconds: 60 };
    assert.equal((await consumeRateLimit(a, email, options)).allowed, true);
    assert.equal((await consumeRateLimit(a, email, options)).allowed, false);
    assert.equal((await consumeRateLimit(b, email, options)).allowed, true, "other bucket");
    assert.equal((await consumeRateLimit(a, `${email}x`, options)).allowed, true, "other key");
    assert.equal((await consumeRateLimit(a, email.toUpperCase(), options)).allowed, true, "keys are compared exactly, callers normalise");
  });

  it("never allows more than the limit under concurrent requests", async () => {
    const bucket = uniqueBucket();
    const key = uniqueKey("burst");
    const results = await Promise.all(Array.from({ length: 25 }, () => consumeRateLimit(bucket, key, { limit: 10, windowSeconds: 60 })));
    assert.equal(results.filter((result) => result.allowed).length, 10);
    assert.deepEqual(
      results.filter((result) => result.allowed).map((result) => result.remaining).sort((x, y) => x - y),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    );
  });

  it("enforceRateLimit throws 429 rate_limited with Retry-After once exceeded", async () => {
    const bucket = uniqueBucket();
    const key = uniqueKey("enforce");
    const options = { limit: 1, windowSeconds: 120 };
    const first = await enforceRateLimit(bucket, key, options);
    assert.equal(first.allowed, true);
    const err = await expectRateLimited(enforceRateLimit(bucket, key, options, "Too many applications. Please wait."));
    assert.equal(err.message, "Too many applications. Please wait.");
    const retryAfter = Number(err.headers?.["Retry-After"]);
    assert.ok(retryAfter > 100 && retryAfter <= 120, String(retryAfter));
  });

  it("rejects invalid bucket names and options", async () => {
    await assert.rejects(async () => consumeRateLimit("Bad Bucket!", "k", { limit: 1, windowSeconds: 1 }), /Invalid rate limit bucket/);
    await assert.rejects(async () => consumeRateLimit(uniqueBucket(), "k", { limit: 0, windowSeconds: 1 }), /Invalid rate limit options/);
    await assert.rejects(async () => consumeRateLimit(uniqueBucket(), "k", { limit: 1, windowSeconds: 0.5 }), /Invalid rate limit options/);
    await assert.rejects(async () => consumeRateLimit(uniqueBucket(), "k", { limit: 1.5, windowSeconds: 60 }), /Invalid rate limit options/);
  });

  it("works with no data store configured at all", async () => {
    // The limiter must never reach for Google Sheets: with no GOOGLE_* variables set, a request
    // that touched the store would fail rather than be counted.
    const bucket = uniqueBucket();
    const key = uniqueKey("no-store");
    const cleared = Object.fromEntries(APP_ENV_VARIABLES.filter((name) => name.startsWith("GOOGLE_")).map((name) => [name, undefined]));
    const result = await withEnvAsync(cleared, () => consumeRateLimit(bucket, key, { limit: 2, windowSeconds: 60 }));
    assert.deepEqual([result.allowed, result.remaining], [true, 1]);
  });
});
