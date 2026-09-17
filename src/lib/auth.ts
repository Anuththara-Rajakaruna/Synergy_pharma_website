const DEFAULT_DEV_AUTH_SECRET = "development-local-auth-secret-change-before-production-1234567890";
const AUTH_SECRET = process.env.AUTH_SECRET ??
  (process.env.NODE_ENV === "production" ? undefined : DEFAULT_DEV_AUTH_SECRET);

if (!AUTH_SECRET && process.env.NODE_ENV === "production") {
  throw new Error(
    "AUTH_SECRET environment variable is required. Set it in .env.local for development and in your deployment environment for production."
  );
}

export const ADMIN_SESSION_COOKIE = "synergy_admin_session";
export const SESSION_MAX_AGE = 8 * 60 * 60; // 8 hours

async function getHmacKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSessionToken(): Promise<string> {
  const payload = Date.now().toString(36);
  const uuid = globalThis.crypto.randomUUID();
  const message = `${payload}.${uuid}`;
  const key = await getHmacKey();
  const encoder = new TextEncoder();
  const sigBuffer = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const sigHex = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${message}.${sigHex}`;
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length < 3) return false;
    const sigHex = parts[parts.length - 1];
    const message = parts.slice(0, -1).join(".");
    const key = await getHmacKey();
    const encoder = new TextEncoder();
    const sigBytes = new Uint8Array(
      sigHex.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []
    );
    const valid = await globalThis.crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(message));
    if (!valid) return false;
    const issuedAt = parseInt(parts[0], 36);
    return !isNaN(issuedAt) && Date.now() - issuedAt <= SESSION_MAX_AGE * 1000;
  } catch {
    return false;
  }
}

export function verifyAdminPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected || input.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < input.length; i++) {
    mismatch |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  maxAge: SESSION_MAX_AGE,
  path: "/",
};
