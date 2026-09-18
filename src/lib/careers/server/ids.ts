import { randomBytes } from "node:crypto";

// Record identifiers for the Google Sheets store.
//
// The format is deliberately identical to a MongoDB ObjectId - 24 lower-case hex characters,
// with a 4-byte big-endian seconds timestamp at the front - because it is part of the public
// API contract: route parameters, the admin UI, saved bookmarks and the candidate-facing
// reference (APP-7F3A9C21, the last 8 characters) all assume it. Keeping the shape means ids
// minted before the migration stay valid and nothing in the frontend has to change.
//
// The timestamp prefix also makes ids sort by creation time, which the store relies on for
// stable ordering of rows that were written in the same second.

const RECORD_ID = /^[a-f0-9]{24}$/;

// 4 bytes of seconds since the epoch + 8 random bytes. Collisions would need two ids in the
// same second sharing 64 random bits.
export function newId(at: Date = new Date()): string {
  const seconds = Math.floor(at.getTime() / 1000);
  const timestamp = Buffer.alloc(4);
  timestamp.writeUInt32BE(seconds >>> 0, 0);
  return `${timestamp.toString("hex")}${randomBytes(8).toString("hex")}`;
}

// Strict 24-hex check. Route parameters are validated with this before they are used to look up
// a record, so an arbitrary string can never reach the store as an id.
export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && RECORD_ID.test(value);
}

// The creation time encoded in an id, or null when the value is not an id. Used only as a
// fallback for records whose createdAt cell is missing.
export function idTimestamp(value: string): Date | null {
  if (!isRecordId(value)) return null;
  const seconds = Number.parseInt(value.slice(0, 8), 16);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

// Kept under the previous name so existing call sites and tests keep reading naturally.
export const isObjectIdString = isRecordId;

// Short, human-friendly references shown to candidates and HR. They are derived from the id
// rather than stored, and appear in emails, the CSV export, audit summaries and the admin UI.
// They live here, next to the id format they depend on, so that the DTO mappers and the
// document service can both use them without importing each other.
export function applicationReference(id: string): string {
  return `APP-${String(id).slice(-8).toUpperCase()}`;
}

export function talentReference(id: string): string {
  return `TP-${String(id).slice(-8).toUpperCase()}`;
}
