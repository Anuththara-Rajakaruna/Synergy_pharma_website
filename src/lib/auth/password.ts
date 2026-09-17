// Password hashing for admin accounts: scrypt from node:crypto, stored as
// `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>` so parameters can be raised later without
// invalidating existing hashes.

import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { validatePassword } from "@/lib/careers/validation";

type ScryptParams = { N: number; r: number; p: number; keylen: number };

const CURRENT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;
const SALT_BYTES = 16;

function deriveKey(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // NFC normalization makes visually identical input (e.g. composed vs. decomposed
    // accents from different keyboards) hash the same.
    scrypt(
      password.normalize("NFC"),
      salt,
      params.keylen,
      { N: params.N, r: params.r, p: params.p, maxmem: MAX_MEMORY_BYTES },
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, CURRENT_PARAMS);
  const { N, r, p } = CURRENT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function parseStoredHash(stored: string): { params: ScryptParams; salt: Buffer; hash: Buffer } | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [N, r, p] = parts.slice(1, 4).map((part) => (/^\d{1,8}$/.test(part) ? Number(part) : Number.NaN));
  const [saltText, hashText] = parts.slice(4);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  // Bounds keep a tampered or corrupt hash from demanding excessive CPU or memory.
  if (N < 2 ** 14 || N > 2 ** 20 || (N & (N - 1)) !== 0 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  if (128 * N * r * p > MAX_MEMORY_BYTES) return null;
  if (!BASE64.test(saltText) || !BASE64.test(hashText)) return null;
  const salt = Buffer.from(saltText, "base64");
  const hash = Buffer.from(hashText, "base64");
  if (salt.length < 16 || hash.length < 32 || hash.length > 128) return null;
  return { params: { N, r, p, keylen: hash.length }, salt, hash };
}

const DUMMY_SALT = randomBytes(SALT_BYTES);

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = typeof stored === "string" ? parseStoredHash(stored) : null;
  if (typeof password !== "string" || !parsed) {
    await verifyDummyPassword(password);
    return false;
  }
  const key = await deriveKey(password, parsed.salt, parsed.params);
  return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
}

// Spends the time of one password verification with the current parameters without checking
// anything, so failures for unknown accounts take as long as failures for real ones.
export async function verifyDummyPassword(password: string): Promise<void> {
  await deriveKey(typeof password === "string" ? password : "", DUMMY_SALT, CURRENT_PARAMS);
}

// No look-alike characters (0/O/o, 1/l/I) so the password can be read out or retyped safely.
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const ALPHABET = `${LOWER}${UPPER}${DIGITS}`;
const TEMPORARY_PASSWORD_LENGTH = 20;

// 20 characters from a 56-symbol alphabet (about 116 bits), always mixing lower case,
// upper case and digits.
export function generateTemporaryPassword(): string {
  for (;;) {
    let password = "";
    for (let i = 0; i < TEMPORARY_PASSWORD_LENGTH; i += 1) {
      password += ALPHABET[randomInt(ALPHABET.length)];
    }
    const mixed =
      [...password].some((ch) => LOWER.includes(ch)) &&
      [...password].some((ch) => UPPER.includes(ch)) &&
      [...password].some((ch) => DIGITS.includes(ch));
    const errors: Record<string, string> = {};
    validatePassword(password, errors);
    if (mixed && Object.keys(errors).length === 0) return password;
  }
}
