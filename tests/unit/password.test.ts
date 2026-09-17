import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import { generateTemporaryPassword, hashPassword, verifyDummyPassword, verifyPassword } from "@/lib/auth/password";
import { validatePassword, type FieldErrors } from "@/lib/careers/validation";

const STORED_FORMAT = /^scrypt\$32768\$8\$1\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

async function median(runs: number, fn: () => Promise<unknown>): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    await fn();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

describe("hashPassword / verifyPassword", () => {
  it("stores scrypt parameters, a 16-byte salt and a 64-byte key", async () => {
    const stored = await hashPassword("correct horse battery staple");
    const match = STORED_FORMAT.exec(stored);
    assert.ok(match, stored);
    assert.equal(Buffer.from(match[1], "base64").length, 16);
    assert.equal(Buffer.from(match[2], "base64").length, 64);
    assert.equal(stored.includes("correct horse"), false);
  });

  it("uses a fresh salt for every hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same password 123"), hashPassword("same password 123")]);
    assert.notEqual(a, b);
  });

  it("verifies the right password and rejects wrong ones", async () => {
    const stored = await hashPassword("Correct-Horse-42");
    assert.equal(await verifyPassword("Correct-Horse-42", stored), true);
    assert.equal(await verifyPassword("correct-horse-42", stored), false);
    assert.equal(await verifyPassword("Correct-Horse-42 ", stored), false);
    assert.equal(await verifyPassword("", stored), false);
  });

  it("treats composed and decomposed Unicode input as the same password", async () => {
    const composed = `caf${String.fromCharCode(0x00e9)} au lait 2026`;
    const decomposed = `cafe${String.fromCharCode(0x0301)} au lait 2026`;
    const stored = await hashPassword(composed);
    assert.equal(await verifyPassword(decomposed, stored), true);
  });

  it("verifies hashes created with other supported parameters", async () => {
    const salt = randomBytes(16);
    const key = scryptSync("legacy-params-password", salt, 64, { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const stored = `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
    assert.equal(await verifyPassword("legacy-params-password", stored), true);
    assert.equal(await verifyPassword("other-password", stored), false);
  });

  it("returns false without throwing for malformed or tampered hashes", async () => {
    const stored = await hashPassword("Tamper-Proof-Password");
    const parts = stored.split("$");
    const salt = parts[4];
    const hash = parts[5];
    const flippedHash = Buffer.from(hash, "base64");
    flippedHash[0] ^= 0xff;
    const malformed = [
      "",
      "plaintext-password",
      `bcrypt$32768$8$1$${salt}$${hash}`,
      `scrypt$32768$8$1$${salt}`,
      `scrypt$32768$8$1$${salt}$${flippedHash.toString("base64")}`,
      `scrypt$30000$8$1$${salt}$${hash}`, // N not a power of two
      `scrypt$2097152$8$1$${salt}$${hash}`, // N too large (memory exhaustion)
      `scrypt$1024$8$1$${salt}$${hash}`, // N too small
      `scrypt$32768$0$1$${salt}$${hash}`,
      `scrypt$32768$8$99$${salt}$${hash}`,
      `scrypt$32768$8$1$not*base64$${hash}`,
      `scrypt$32768$8$1$${Buffer.alloc(8).toString("base64")}$${hash}`, // salt too short
      `scrypt$32768$8$1$${salt}$${Buffer.alloc(16).toString("base64")}`, // hash too short
    ];
    for (const value of malformed) {
      assert.equal(await verifyPassword("Tamper-Proof-Password", value), false, value);
    }
    assert.equal(await verifyPassword("Tamper-Proof-Password", null as unknown as string), false);
    assert.equal(await verifyPassword(undefined as unknown as string, stored), false);
  });

  it("spends comparable time on malformed hashes (dummy verification)", async () => {
    const stored = await hashPassword("Timing-Password-1");
    await verifyPassword("warm-up", stored);
    const real = await median(3, () => verifyPassword("wrong-password-1", stored));
    const dummy = await median(3, () => verifyPassword("wrong-password-1", "not-a-hash"));
    assert.ok(dummy >= real * 0.25, `dummy verification took ${dummy.toFixed(1)} ms, real verification ${real.toFixed(1)} ms`);
  });

  it("verifyDummyPassword resolves for any input", async () => {
    assert.equal(await verifyDummyPassword("anything"), undefined);
    assert.equal(await verifyDummyPassword(42 as unknown as string), undefined);
  });
});

describe("generateTemporaryPassword", () => {
  it("returns 20 characters mixing lower case, upper case and digits without look-alikes", () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generateTemporaryPassword();
      assert.equal(password.length, 20);
      assert.match(password, /[a-z]/);
      assert.match(password, /[A-Z]/);
      assert.match(password, /[0-9]/);
      assert.doesNotMatch(password, /[0O1lIo]/);
      assert.match(password, /^[A-Za-z0-9]+$/);
    }
  });

  it("always passes the password policy", () => {
    for (let i = 0; i < 50; i += 1) {
      const errors: FieldErrors = {};
      validatePassword(generateTemporaryPassword(), errors);
      assert.deepEqual(errors, {});
    }
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()));
    assert.equal(seen.size, 200);
  });

  it("round-trips through hashing", async () => {
    const password = generateTemporaryPassword();
    assert.equal(await verifyPassword(password, await hashPassword(password)), true);
  });
});
