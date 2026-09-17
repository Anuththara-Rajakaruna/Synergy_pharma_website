import { Types, type Model } from "mongoose";
import { FIELD_LIMITS } from "@/lib/careers/constants";
import { isValidJobSlug, slugify } from "@/lib/careers/validation";
import type { NoteEntry, StoredDocument } from "@/models/shared";
import { validationProblems } from "./cli";

// Mapping helpers shared by the MongoDB v1 → v2 migration and the PostgreSQL import, so records
// from the previous systems look the same whichever path brought them in.

export const LEGACY_AUTHOR = "Legacy system";
export const PLACEHOLDER_JOB_DESCRIPTION = "Archived posting imported from the previous system.";
// Required text fields that the previous systems allowed to be empty.
export const NOT_SPECIFIED = "Not specified";

export type PlainDoc = Record<string, unknown>;

// "a***@example.com": enough to tell records apart in console output without printing the address.
export function maskEmail(email: string): string {
  const value = email.trim();
  const at = value.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${value[0]}***@${value.slice(at + 1)}`;
}

export function isObjectIdValue(value: unknown): value is Types.ObjectId {
  return (
    value instanceof Types.ObjectId ||
    (typeof value === "object" && value !== null && (value as { _bsontype?: unknown })._bsontype === "ObjectId")
  );
}

export function asDate(value: unknown): Date | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// The URL id a legacy job id should use. Valid ids are kept unchanged; others (upper case,
// spaces, punctuation, too short) are converted to the closest valid slug.
export function legacySlugCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (isValidJobSlug(trimmed)) return trimmed;
  const base = slugify(trimmed);
  if (base.length >= FIELD_LIMITS.jobSlugMin) return base;
  return base ? `job-${base}` : "legacy-job";
}

// `base`, or `base-2`, `base-3`, ... (kept within the slug length limit) when taken.
export function uniqueSlug(base: string, isTaken: (slug: string) => boolean): string {
  if (!isTaken(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, FIELD_LIMITS.jobSlugMax - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
}

// Avoids cutting a UTF-16 surrogate pair in half when splitting long text.
function safeCut(text: string, index: number): number {
  if (index >= text.length) return text.length;
  const code = text.charCodeAt(index - 1);
  return code >= 0xd800 && code <= 0xdbff ? index - 1 : index;
}

// Only for synthesized labels (e.g. a placeholder job title); record content is never truncated.
export function truncateText(text: string, max: number): string {
  const value = text.trim();
  return value.length <= max ? value : value.slice(0, safeCut(value, max)).trimEnd();
}

// Free text from a previous system as HR note entries authored "Legacy system". Text longer than
// a note allows is split into numbered parts instead of being truncated.
export function legacyNotes(text: string, createdAt: Date, heading = ""): NoteEntry[] {
  const body = text.replace(/\r\n/g, "\n").trim();
  if (!body) return [];
  const make = (content: string): NoteEntry => ({
    _id: new Types.ObjectId(),
    body: content,
    author: null,
    authorName: LEGACY_AUTHOR,
    createdAt,
  });
  const single = heading ? `${heading}\n${body}` : body;
  if (single.length <= FIELD_LIMITS.hrNote) return [make(single)];

  const room = FIELD_LIMITS.hrNote - heading.length - 32;
  const parts: string[] = [];
  let start = 0;
  while (start < body.length) {
    const end = safeCut(body, start + room);
    parts.push(body.slice(start, end));
    start = end;
  }
  return parts.map((part, i) => make(`${heading ? `${heading} ` : ""}(part ${i + 1} of ${parts.length})\n${part}`));
}

const ORIGINAL_NAME_MAX = FIELD_LIMITS.originalFileName + 100;

// A CV stored by a previous system. The object key is kept exactly as it was written; the stored
// file name doubles as the display name.
export function legacyDocument(prefix: "cvs" | "talent-pool", fileName: unknown, uploadedAt: Date): StoredDocument | null {
  if (typeof fileName !== "string" || fileName === "") return null;
  const display = fileName.trim() || "document.pdf";
  return {
    _id: new Types.ObjectId(),
    kind: "cv",
    key: `${prefix}/${fileName}`,
    originalName: truncateText(display, ORIGINAL_NAME_MAX),
    size: null,
    contentType: "application/pdf",
    uploadedAt,
    legacy: true,
  };
}

export type BuildResult = { ok: true; doc: PlainDoc } | { ok: false; problems: string[] };

// Validates a document against the application's schema and returns it fully cast (ObjectIds,
// Dates, trimmed strings, defaults), ready for a raw collection insert that keeps the given
// createdAt/updatedAt. Uses validate() rather than validateSync(): the latter is deprecated in
// Mongoose 9 and emits a process warning on every call.
export async function buildValidated<T>(model: Model<T>, doc: PlainDoc): Promise<BuildResult> {
  try {
    const instance = new model(doc);
    await instance.validate();
    return { ok: true, doc: instance.toObject({ depopulate: true, versionKey: false }) as PlainDoc };
  } catch (err) {
    return { ok: false, problems: validationProblems(err) };
  }
}

// Order-sensitive, _id-insensitive (for subdocuments) representation used to compare a mapped
// document with the one stored in MongoDB.
function canonical(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (isObjectIdValue(value)) return `oid:${value.toHexString()}`;
  if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (depth > 0 && key === "_id") continue;
      out[key] = canonical((value as PlainDoc)[key], depth + 1);
    }
    return out;
  }
  return value;
}

export function differingFields(expected: PlainDoc, actual: PlainDoc, fields: readonly string[]): string[] {
  return fields.filter((field) => JSON.stringify(canonical(expected[field], 1)) !== JSON.stringify(canonical(actual[field], 1)));
}

// Keeps the ids of documents that already exist (matched by storage key), so admin download
// links and audit references stay valid when a record is rewritten.
export function reuseDocumentIds(documents: StoredDocument[], existing: unknown): StoredDocument[] {
  if (!Array.isArray(existing)) return documents;
  const idsByKey = new Map<string, Types.ObjectId>();
  for (const item of existing) {
    const entry = item as { key?: unknown; _id?: unknown };
    if (typeof entry.key === "string" && isObjectIdValue(entry._id)) idsByKey.set(entry.key, entry._id);
  }
  return documents.map((doc) => ({ ...doc, _id: idsByKey.get(doc.key) ?? doc._id }));
}
