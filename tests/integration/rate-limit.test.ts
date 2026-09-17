import "./support/env";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { consumeRateLimit, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { RateLimitModel } from "@/models/rate-limit";
import { expectAppError, uniqueSuffix } from "./support/fixtures";
import { startIntegration, type Integration } from "./support/harness";

function storedId(bucket: string, key: string): string {
  return `${bucket}:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

describe("rate limiting", { timeout: 60_000 }, () => {
  let integration: Integration;

  before(async () => {
    integration = await startIntegration();
  });

  after(async () => {
    await integration.stop();
  });

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
  });

  it("counts requests in a fixed window and reports when to retry", async () => {
    const key = `198.51.100.${Math.floor(Math.random() * 250)}-${uniqueSuffix()}`;
    const options = { limit: 3, windowSeconds: 600 };
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await consumeRateLimit("test-window", key, options));
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

    const doc = await RateLimitModel.findById(storedId("test-window", key)).lean();
    assert.ok(doc);
    assert.equal(doc.count, 4);
    assert.ok(Math.abs(doc.expiresAt.getTime() - doc.windowStartedAt.getTime() - 600_000) < 5);
  });

  it("starts a new window once the previous one has expired", async () => {
    const key = `reset-${uniqueSuffix()}`;
    const options = { limit: 2, windowSeconds: 60 };
    await consumeRateLimit("test-reset", key, options);
    await consumeRateLimit("test-reset", key, options);
    assert.equal((await consumeRateLimit("test-reset", key, options)).allowed, false);

    const past = new Date(Date.now() - 1000);
    await RateLimitModel.updateOne({ _id: storedId("test-reset", key) }, { $set: { expiresAt: past, windowStartedAt: new Date(past.getTime() - 60_000) } });
    const fresh = await consumeRateLimit("test-reset", key, options);
    assert.deepEqual([fresh.allowed, fresh.remaining], [true, 1]);
    const doc = await RateLimitModel.findById(storedId("test-reset", key)).lean();
    assert.equal(doc?.count, 1);
    assert.ok(doc && doc.windowStartedAt.getTime() > past.getTime());
  });

  it("keeps buckets and keys independent and stores only hashed keys", async () => {
    const email = `Nimal.${uniqueSuffix()}@Example.com`;
    const ip = "203.0.113.77";
    const options = { limit: 1, windowSeconds: 60 };
    assert.equal((await consumeRateLimit("test-a", email, options)).allowed, true);
    assert.equal((await consumeRateLimit("test-a", email, options)).allowed, false);
    assert.equal((await consumeRateLimit("test-b", email, options)).allowed, true, "other bucket");
    assert.equal((await consumeRateLimit("test-a", `${email}x`, options)).allowed, true, "other key");
    await consumeRateLimit("test-a", ip, options);

    const stored = JSON.stringify(await RateLimitModel.find({}).lean());
    assert.equal(stored.toLowerCase().includes(email.toLowerCase()), false);
    assert.equal(stored.includes(ip), false);
    assert.ok(await RateLimitModel.exists({ _id: storedId("test-a", email) }));
  });

  it("never allows more than the limit under concurrent requests", async () => {
    const key = `burst-${uniqueSuffix()}`;
    const results = await Promise.all(Array.from({ length: 25 }, () => consumeRateLimit("test-burst", key, { limit: 10, windowSeconds: 60 })));
    assert.equal(results.filter((result) => result.allowed).length, 10);
    assert.equal((await RateLimitModel.findById(storedId("test-burst", key)).lean())?.count, 25);
  });

  it("enforceRateLimit throws 429 rate_limited with Retry-After once exceeded", async () => {
    const key = `enforce-${uniqueSuffix()}`;
    const options = { limit: 1, windowSeconds: 120 };
    const first = await enforceRateLimit("test-enforce", key, options);
    assert.equal(first.allowed, true);
    const err = await expectAppError(enforceRateLimit("test-enforce", key, options, "Too many applications. Please wait."), 429, "rate_limited");
    assert.equal(err.message, "Too many applications. Please wait.");
    const retryAfter = Number(err.headers?.["Retry-After"]);
    assert.ok(retryAfter > 100 && retryAfter <= 120, String(retryAfter));
  });

  it("rejects invalid bucket names and options", async () => {
    await assert.rejects(consumeRateLimit("Bad Bucket!", "k", { limit: 1, windowSeconds: 1 }), /Invalid rate limit bucket/);
    await assert.rejects(consumeRateLimit("test-x", "k", { limit: 0, windowSeconds: 1 }), /Invalid rate limit options/);
    await assert.rejects(consumeRateLimit("test-x", "k", { limit: 1, windowSeconds: 0.5 }), /Invalid rate limit options/);
  });
});
