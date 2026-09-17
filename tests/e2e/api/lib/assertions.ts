import { expect } from "@playwright/test";
import type { ApiResult } from "../../support/api";
import type { ApiErrorBody } from "@/types/careers";

// Assertion helpers shared by the API contract suites.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describe(result: ApiResult<unknown>): string {
  return `HTTP ${result.status}: ${result.text.slice(0, 600)}`;
}

export function expectStatus(result: ApiResult<unknown>, status: number): void {
  expect(result.status, describe(result)).toBe(status);
}

// Every API error is JSON `{ error, code, fields? }` that is never cached.
export function expectApiError(
  result: ApiResult<unknown>,
  status: number,
  code: string,
  options: { fields?: string[]; message?: string | RegExp } = {}
): ApiErrorBody {
  expectStatus(result, status);
  expect(result.headers.get("content-type") ?? "", describe(result)).toContain("application/json");
  expect(result.headers.get("cache-control") ?? "").toContain("no-store");
  const body = result.body;
  if (!isRecord(body)) throw new Error(`Expected a JSON error object, got ${describe(result)}`);
  expect(typeof body.error, describe(result)).toBe("string");
  expect(String(body.error).length).toBeGreaterThan(0);
  expect(body.code, describe(result)).toBe(code);
  const fields = body.fields;
  if (options.fields) {
    if (!isRecord(fields)) throw new Error(`Expected field errors ${options.fields.join(", ")}, got ${describe(result)}`);
    for (const field of options.fields) {
      expect(typeof fields[field], `field "${field}" in ${describe(result)}`).toBe("string");
    }
  }
  if (options.message !== undefined) {
    if (typeof options.message === "string") expect(body.error).toBe(options.message);
    else expect(String(body.error)).toMatch(options.message);
  }
  return body as ApiErrorBody;
}

// Values an API must never expose: credential hashes, internal identifiers and storage keys.
const FORBIDDEN_KEYS = new Set(["passwordHash", "tokenHash", "emailNormalized", "legacyIds", "key", "storageKey", "_id", "__v"]);
const STORAGE_KEY_VALUE = /^(?:incoming|applications|talent-pool|cvs)\//;

export function findSensitiveData(value: unknown, path = "$"): string[] {
  const problems: string[] = [];
  if (typeof value === "string") {
    if (STORAGE_KEY_VALUE.test(value)) problems.push(`${path} looks like a storage key`);
    if (/scrypt\$\d+\$/.test(value)) problems.push(`${path} looks like a password hash`);
    return problems;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => problems.push(...findSensitiveData(item, `${path}[${index}]`)));
    return problems;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) problems.push(`${path}.${key} must not be exposed`);
      problems.push(...findSensitiveData(item, `${path}.${key}`));
    }
  }
  return problems;
}

export function expectNoSensitiveData(value: unknown, label = "response"): void {
  expect(findSensitiveData(value), `${label} exposes internal data`).toEqual([]);
}

export function expectExactKeys(value: unknown, keys: readonly string[], label = "object"): void {
  if (!isRecord(value)) throw new Error(`${label} is not an object`);
  expect(Object.keys(value).sort(), label).toEqual([...keys].sort());
}

export function expectIsoDate(value: unknown, label = "date"): void {
  expect(typeof value, label).toBe("string");
  const text = String(value);
  expect(text, label).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  expect(Number.isNaN(new Date(text).getTime()), label).toBe(false);
}

export function expectRetryAfter(result: ApiResult<unknown>, maxSeconds: number): number {
  const header = result.headers.get("retry-after");
  expect(header, `Retry-After on ${describe(result)}`).not.toBeNull();
  const seconds = Number(header);
  expect(Number.isInteger(seconds), `Retry-After "${header}" is an integer`).toBe(true);
  expect(seconds).toBeGreaterThan(0);
  expect(seconds).toBeLessThanOrEqual(maxSeconds);
  return seconds;
}

export type ParsedCookie = { name: string; value: string; attributes: Map<string, string> };

export function parseSetCookie(header: string): ParsedCookie {
  const [pair, ...rest] = header.split(";");
  const index = pair.indexOf("=");
  const attributes = new Map<string, string>();
  for (const part of rest) {
    const [rawKey, ...valueParts] = part.split("=");
    attributes.set(rawKey.trim().toLowerCase(), valueParts.join("=").trim());
  }
  return { name: pair.slice(0, index).trim(), value: pair.slice(index + 1).trim(), attributes };
}

export function sessionCookieFrom(result: ApiResult<unknown>): ParsedCookie | null {
  const header = result.headers.getSetCookie().find((cookie) => cookie.includes("synergy_admin="));
  return header ? parseSetCookie(header) : null;
}
