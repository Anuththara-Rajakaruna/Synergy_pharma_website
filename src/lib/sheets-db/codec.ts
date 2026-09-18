import type { CellValue } from "@/lib/google/sheets";

// Conversion between application values and spreadsheet cells.
//
// Two rules shape everything here. First, the spreadsheet is a real document that HR can open
// and edit, so every cell must be human-readable and every decoder must tolerate a human having
// typed something unexpected: a bad cell degrades to a default, it never throws and takes an API
// route down with it. Second, values are written with valueInputOption=RAW, so what is written
// is exactly what comes back - no locale parsing, no "0771234567" becoming the number 771234567,
// and no leading "=" turning a candidate's cover letter into a live formula.

// Google Sheets rejects any cell longer than this.
export const MAX_CELL_LENGTH = 50_000;

export type CellRow = CellValue[];

function asText(value: CellValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

// ── Encoding ─────────────────────────────────────────────────────────────────

// Truncation is a last resort that keeps a write from being rejected outright. Every field that
// can carry user input is already length-limited by src/lib/careers/validation.ts, so this only
// fires for values assembled server-side.
export function encodeText(value: string | null | undefined, limit = MAX_CELL_LENGTH): string {
  if (value === null || value === undefined) return "";
  return value.length > limit ? value.slice(0, limit) : value;
}

export function encodeDate(value: Date | null | undefined): string {
  if (!value) return "";
  const time = value.getTime();
  return Number.isFinite(time) ? value.toISOString() : "";
}

export function encodeBoolean(value: boolean | null | undefined): string {
  return value ? "TRUE" : "FALSE";
}

export function encodeNumber(value: number | null | undefined): string | number {
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

// Lists and nested objects live in one cell as JSON. They are read back by this application far
// more often than by a human, and keeping them in a single cell keeps a record to a single row.
export function encodeJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value) && value.length === 0) return "";
  try {
    const text = JSON.stringify(value);
    return text.length > MAX_CELL_LENGTH ? "" : text;
  } catch {
    return "";
  }
}

// ── Decoding ─────────────────────────────────────────────────────────────────

export function decodeText(value: CellValue | undefined): string {
  return asText(value).trim();
}

// Preserves internal whitespace and line breaks: cover letters and notes are displayed verbatim.
export function decodeMultiline(value: CellValue | undefined): string {
  return asText(value);
}

export function decodeDate(value: CellValue | undefined): Date | null {
  const text = asText(value).trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// For columns the application treats as always-present. A missing or unparseable timestamp falls
// back rather than producing an Invalid Date that would serialise as null and break the UI.
export function decodeDateOr(value: CellValue | undefined, fallback: Date): Date {
  return decodeDate(value) ?? fallback;
}

const TRUE_VALUES = new Set(["true", "yes", "y", "1", "x", "✓"]);

// Lenient on purpose: a checkbox column, a hand-typed "yes" and a real boolean all mean true.
export function decodeBoolean(value: CellValue | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return TRUE_VALUES.has(asText(value).trim().toLowerCase());
}

export function decodeNumber(value: CellValue | undefined, fallback: number | null = null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const text = asText(value).trim();
  if (!text) return fallback;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function decodeInteger(value: CellValue | undefined, fallback: number): number {
  const parsed = decodeNumber(value, null);
  return parsed === null ? fallback : Math.trunc(parsed);
}

export function decodeJson<T>(value: CellValue | undefined, fallback: T): T {
  const text = asText(value).trim();
  if (!text) return fallback;
  try {
    const parsed: unknown = JSON.parse(text);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

// A JSON array of strings, also accepting the comma-separated form a human is likely to type
// into a tags or list column by hand.
export function decodeStringList(value: CellValue | undefined): string[] {
  const text = asText(value).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    const parsed = decodeJson<unknown>(text, []);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
    }
    return [];
  }
  return text
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

// Restricts a cell to a known set of values, so an unknown status typed into the sheet cannot
// propagate into the API response as an invalid enum member.
export function decodeEnum<T extends string>(value: CellValue | undefined, allowed: readonly T[], fallback: T): T {
  const text = asText(value).trim();
  const match = allowed.find((option) => option === text) ?? allowed.find((option) => option.toLowerCase() === text.toLowerCase());
  return match ?? fallback;
}

export function decodeEnumOrNull<T extends string>(value: CellValue | undefined, allowed: readonly T[]): T | null {
  const text = asText(value).trim();
  if (!text) return null;
  return allowed.find((option) => option === text) ?? allowed.find((option) => option.toLowerCase() === text.toLowerCase()) ?? null;
}

// Empty string means "absent" everywhere in the store; there is no separate null cell.
export function decodeTextOrNull(value: CellValue | undefined): string | null {
  const text = decodeText(value);
  return text === "" ? null : text;
}
