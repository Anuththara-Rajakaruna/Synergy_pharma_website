// Shared by the application and talent-pool services: DTO mappers, request payload parsers,
// and small persistence helpers (document cleanup, email queueing). Server-only.

import { Types } from "mongoose";
import type { AdminContext } from "@/lib/auth/session";
import { FIELD_LIMITS, type ApplicationStatus } from "@/lib/careers/constants";
import {
  escapeRegExp,
  hasControlCharacters,
  isApplicationStatus,
  normalizeTags,
  validatePersonName,
  validatePhone,
  type FieldErrors,
  type Pagination,
} from "@/lib/careers/validation";
import { toDocumentInfo } from "@/lib/careers/server/documents";
import { releaseClaimedDocuments } from "@/lib/careers/server/uploads";
import { enqueueEmails, hrNotificationRecipients, scheduleEmailDelivery, type EnqueueEmailInput } from "@/lib/email/outbox";
import { badRequest } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import { isDuplicateKeyError } from "@/lib/mongodb";
import { ApplicationModel, applicationReference, type ApplicationDoc, type StatusHistoryDoc } from "@/models/application";
import type { NoteEntry, StoredDocument } from "@/models/shared";
import { TalentPoolEntryModel, type TalentActivityDoc, type TalentPoolEntryDoc } from "@/models/talent-pool-entry";
import type {
  ApplicationDetail,
  ApplicationListItem,
  ApplicationStatusChangePayload,
  EmailDeliveryInfo,
  NoteInfo,
  Paginated,
  StatusHistoryEntry,
  TalentActivity,
  TalentApplicationLink,
  TalentDetail,
  TalentListItem,
  TalentUpdatePayload,
} from "@/types/careers";

// Upper bound for admin list and count queries so one slow search cannot pile up requests.
export const LIST_MAX_TIME_MS = 5_000;

// ── References & dates ───────────────────────────────────────────────────────

export { applicationReference };

// Short, human-friendly talent profile reference ("TP-7F3A9C21").
export function talentReference(id: Types.ObjectId | string): string {
  return `TP-${String(id).slice(-8).toUpperCase()}`;
}

export function toIso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function toIsoRequired(value: Date | null | undefined): string {
  return new Date(value ?? 0).toISOString();
}

export function toPaginated<T>(items: T[], total: number, page: Pagination): Paginated<T> {
  return {
    items,
    total,
    page: page.page,
    limit: page.limit,
    pageCount: Math.max(1, Math.ceil(total / page.limit)),
  };
}

// Builds `$or` search clauses: case-insensitive substring match (input escaped) on each field,
// plus an exact match on the record reference when the query looks like one.
export function searchClauses(q: string, fields: string[], referencePattern: RegExp): Record<string, unknown>[] {
  const pattern = escapeRegExp(q);
  const clauses: Record<string, unknown>[] = fields.map((field) => ({ [field]: { $regex: pattern, $options: "i" } }));
  const reference = referencePattern.exec(q.trim());
  if (reference) {
    clauses.push({
      $expr: { $regexMatch: { input: { $toString: "$_id" }, regex: `${reference[1].toLowerCase()}$` } },
    });
  }
  return clauses;
}

// ── DTO mappers ──────────────────────────────────────────────────────────────

export function toNoteInfo(note: NoteEntry): NoteInfo {
  return {
    id: String(note._id),
    body: note.body,
    authorName: note.authorName,
    createdAt: toIsoRequired(note.createdAt),
  };
}

function toStatusHistoryEntry(entry: StatusHistoryDoc): StatusHistoryEntry {
  return {
    id: String(entry._id),
    from: entry.from ?? null,
    to: entry.to,
    changedAt: toIsoRequired(entry.changedAt),
    changedByName: entry.changedByName ?? null,
    note: entry.note ?? "",
    candidateNotified: Boolean(entry.candidateNotified),
  };
}

export type ApplicationListRow = Pick<
  ApplicationDoc,
  | "_id"
  | "name"
  | "email"
  | "phone"
  | "jobSlug"
  | "jobTitle"
  | "department"
  | "status"
  | "source"
  | "createdAt"
  | "statusChangedAt"
  | "archivedAt"
  | "talentPoolEntry"
> & { documentCount: number; noteCount: number };

// Aggregation `$project` stage for list rows: no cover letter, note bodies, history or storage keys.
export const APPLICATION_LIST_PROJECTION = {
  name: 1,
  email: 1,
  phone: 1,
  jobSlug: 1,
  jobTitle: 1,
  department: 1,
  status: 1,
  source: 1,
  createdAt: 1,
  statusChangedAt: 1,
  archivedAt: 1,
  talentPoolEntry: 1,
  documentCount: { $size: { $ifNull: ["$documents", []] } },
  noteCount: { $size: { $ifNull: ["$notes", []] } },
} as const;

export function toApplicationListItem(row: ApplicationListRow): ApplicationListItem {
  return {
    id: String(row._id),
    reference: applicationReference(row._id),
    name: row.name,
    email: row.email,
    phone: row.phone,
    jobId: row.jobSlug,
    jobTitle: row.jobTitle,
    department: row.department ?? "",
    status: row.status,
    source: row.source,
    createdAt: toIsoRequired(row.createdAt),
    statusChangedAt: toIsoRequired(row.statusChangedAt ?? row.createdAt),
    archived: Boolean(row.archivedAt),
    inTalentPool: Boolean(row.talentPoolEntry),
    documentCount: row.documentCount,
    noteCount: row.noteCount,
  };
}

export function toApplicationDetail(
  doc: ApplicationDoc,
  extra: { emails: EmailDeliveryInfo[]; jobStillExists: boolean }
): ApplicationDetail {
  const documents = doc.documents ?? [];
  const notes = doc.notes ?? [];
  return {
    ...toApplicationListItem({ ...doc, documentCount: documents.length, noteCount: notes.length }),
    coverLetter: doc.coverLetter ?? "",
    linkedIn: doc.linkedIn || null,
    portfolio: doc.portfolio || null,
    consentGiven: Boolean(doc.consentGiven),
    consentAt: toIso(doc.consentAt),
    documents: documents.map(toDocumentInfo),
    notes: notes.map(toNoteInfo),
    statusHistory: (doc.statusHistory ?? []).map(toStatusHistoryEntry),
    talentPoolEntryId: doc.talentPoolEntry ? String(doc.talentPoolEntry) : null,
    jobStillExists: extra.jobStillExists,
    archivedAt: toIso(doc.archivedAt),
    archivedByName: doc.archivedByName ?? null,
    archiveReason: doc.archiveReason ?? "",
    emails: extra.emails,
    updatedAt: toIsoRequired(doc.updatedAt),
  };
}

export type TalentListRow = Pick<
  TalentPoolEntryDoc,
  "_id" | "name" | "email" | "phone" | "areaOfInterest" | "tags" | "source" | "createdAt" | "updatedAt" | "archivedAt"
> & { applicationCount: number; documentCount: number };

export const TALENT_LIST_PROJECTION = {
  name: 1,
  email: 1,
  phone: 1,
  areaOfInterest: 1,
  tags: 1,
  source: 1,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: 1,
  applicationCount: { $size: { $ifNull: ["$applications", []] } },
  documentCount: { $size: { $ifNull: ["$documents", []] } },
} as const;

export function toTalentListItem(row: TalentListRow): TalentListItem {
  return {
    id: String(row._id),
    name: row.name,
    email: row.email,
    phone: row.phone,
    areaOfInterest: row.areaOfInterest,
    tags: row.tags ?? [],
    source: row.source,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt ?? row.createdAt),
    archived: Boolean(row.archivedAt),
    applicationCount: row.applicationCount,
    documentCount: row.documentCount,
  };
}

function toTalentActivity(entry: TalentActivityDoc): TalentActivity {
  return {
    id: String(entry._id),
    action: entry.action,
    at: toIsoRequired(entry.at),
    actorName: entry.actorName ?? null,
    detail: entry.detail ?? "",
  };
}

export type TalentApplicationRow = Pick<ApplicationDoc, "_id" | "jobSlug" | "jobTitle" | "status" | "createdAt" | "archivedAt">;

export function toTalentApplicationLink(row: TalentApplicationRow): TalentApplicationLink {
  return {
    id: String(row._id),
    jobId: row.jobSlug,
    jobTitle: row.jobTitle,
    status: row.status,
    createdAt: toIsoRequired(row.createdAt),
    archived: Boolean(row.archivedAt),
  };
}

export function toTalentDetail(doc: TalentPoolEntryDoc, applications: TalentApplicationLink[]): TalentDetail {
  const documents = doc.documents ?? [];
  return {
    ...toTalentListItem({
      ...doc,
      applicationCount: Math.max(applications.length, (doc.applications ?? []).length),
      documentCount: documents.length,
    }),
    candidateNotes: doc.candidateNotes ?? "",
    consentGiven: Boolean(doc.consentGiven),
    consentAt: toIso(doc.consentAt),
    documents: documents.map(toDocumentInfo),
    notes: (doc.notes ?? []).map(toNoteInfo),
    applications,
    sourceApplicationId: doc.sourceApplication ? String(doc.sourceApplication) : null,
    archivedAt: toIso(doc.archivedAt),
    archivedByName: doc.archivedByName ?? null,
    archiveReason: doc.archiveReason ?? "",
    activity: (doc.activity ?? []).map(toTalentActivity),
  };
}

// ── Request parsing ──────────────────────────────────────────────────────────

type TextOptions = { field: string; label: string; max: number; required?: boolean; multiline?: boolean };

// Trims a free-text value and records an error instead of truncating. Non-strings are errors.
export function readText(raw: unknown, options: TextOptions, errors: FieldErrors): string {
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    errors[options.field] = `${options.label} must be text.`;
    return "";
  }
  const value = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!value) {
    if (options.required) errors[options.field] = `${options.label} is required.`;
    return "";
  }
  if (hasControlCharacters(value, options.multiline)) {
    errors[options.field] = `${options.label} contains characters that are not allowed.`;
  } else if (value.length > options.max) {
    errors[options.field] = `${options.label} must be ${options.max} characters or fewer.`;
  }
  return value;
}

export function throwIfInvalid(errors: FieldErrors): void {
  const messages = Object.values(errors);
  if (messages.length > 0) throw badRequest(messages[0], errors);
}

export function validateNoteBody(raw: unknown): string {
  const errors: FieldErrors = {};
  const body = readText(raw, { field: "body", label: "Note", max: FIELD_LIMITS.hrNote, required: true, multiline: true }, errors);
  throwIfInvalid(errors);
  return body;
}

export function validateArchiveReason(raw: unknown): string {
  const errors: FieldErrors = {};
  const reason = readText(raw, { field: "reason", label: "Reason", max: FIELD_LIMITS.archiveReason, multiline: true }, errors);
  throwIfInvalid(errors);
  return reason;
}

export function validateOptionalHrNote(raw: unknown, field = "note"): string {
  const errors: FieldErrors = {};
  const note = readText(raw, { field, label: "Note", max: FIELD_LIMITS.hrNote, multiline: true }, errors);
  throwIfInvalid(errors);
  return note;
}

export function validateTagList(raw: unknown): string[] {
  const errors: FieldErrors = {};
  const tags = normalizeTags(raw, errors);
  throwIfInvalid(errors);
  return tags;
}

export function parseNotePayload(body: Record<string, unknown>): string {
  return validateNoteBody(body.body);
}

export function parseArchivePayload(body: Record<string, unknown>): { archived: boolean; reason: string } {
  if (typeof body.archived !== "boolean") {
    throw badRequest("Specify whether to archive or restore the record.", { archived: "Must be true or false." });
  }
  return { archived: body.archived, reason: body.archived ? validateArchiveReason(body.reason) : "" };
}

// Returns a fully normalized payload (note and message trimmed, notify flag explicit).
export function parseStatusChangePayload(body: Record<string, unknown>): Required<ApplicationStatusChangePayload> {
  const errors: FieldErrors = {};
  const status = body.status;
  const expectedStatus = body.expectedStatus;
  if (!isApplicationStatus(status)) errors.status = "Choose a valid status.";
  if (!isApplicationStatus(expectedStatus)) errors.expectedStatus = "The current status is missing. Refresh and try again.";
  const note = readText(body.note, { field: "note", label: "Note", max: FIELD_LIMITS.statusNote, multiline: true }, errors);
  if (body.notifyCandidate !== undefined && typeof body.notifyCandidate !== "boolean") {
    errors.notifyCandidate = "Must be true or false.";
  }
  const notifyCandidate = body.notifyCandidate === true;
  const candidateMessage = notifyCandidate
    ? readText(
        body.candidateMessage,
        { field: "candidateMessage", label: "Message to the candidate", max: FIELD_LIMITS.candidateMessage, multiline: true },
        errors
      )
    : "";
  throwIfInvalid(errors);
  return {
    status: status as ApplicationStatus,
    expectedStatus: expectedStatus as ApplicationStatus,
    note,
    notifyCandidate,
    candidateMessage,
  };
}

export function parseMoveToTalentPoolPayload(body: Record<string, unknown>): { tags: string[]; note: string } {
  const errors: FieldErrors = {};
  const tags = normalizeTags(body.tags, errors);
  const note = readText(body.note, { field: "note", label: "Note", max: FIELD_LIMITS.hrNote, multiline: true }, errors);
  throwIfInvalid(errors);
  return { tags, note };
}

// Validates the provided fields only; absent fields stay undefined. Email is not editable.
export function parseTalentUpdatePayload(body: Record<string, unknown>): TalentUpdatePayload {
  const errors: FieldErrors = {};
  const patch: TalentUpdatePayload = {};
  if (body.name !== undefined) {
    patch.name = validatePersonName(typeof body.name === "string" ? body.name : undefined, errors);
  }
  if (body.phone !== undefined) {
    patch.phone = validatePhone(typeof body.phone === "string" ? body.phone : undefined, errors);
  }
  if (body.areaOfInterest !== undefined) {
    patch.areaOfInterest = readText(
      body.areaOfInterest,
      { field: "areaOfInterest", label: "Area of interest", max: FIELD_LIMITS.areaOfInterest, required: true },
      errors
    );
  }
  if (body.tags !== undefined) patch.tags = normalizeTags(body.tags, errors);
  throwIfInvalid(errors);
  if (Object.keys(patch).length === 0) {
    throw badRequest("Nothing to update.", undefined, "nothing_to_update");
  }
  return patch;
}

export function parseTalentApplyPayload(body: Record<string, unknown>): { jobSlug: string; note: string } {
  const errors: FieldErrors = {};
  const jobSlug = typeof body.jobId === "string" ? body.jobId.trim().toLowerCase() : "";
  if (!jobSlug) errors.jobId = "Choose a job.";
  const note = readText(body.note, { field: "note", label: "Note", max: FIELD_LIMITS.hrNote, multiline: true }, errors);
  throwIfInvalid(errors);
  return { jobSlug, note };
}

// ── Persistence helpers ──────────────────────────────────────────────────────

function isDefiniteWriteFailure(err: unknown): boolean {
  if (isDuplicateKeyError(err)) return true;
  if (!(err instanceof Error)) return false;
  return err.name === "ValidationError" || err.name === "CastError" || err.name === "StrictModeError" || err.name === "AppError";
}

// Called when inserting a record that owns freshly copied documents fails. A definite failure
// (duplicate key, validation) releases the objects. After an ambiguous failure (network error,
// timeout) the insert may still have committed, so the objects are only released once the record
// is known not to exist. Returns true when the record does exist (the caller treats it as saved).
export async function settleFailedInsert(
  err: unknown,
  documents: StoredDocument[],
  recordExists: () => Promise<unknown>,
  context: { entityType: string; entityId: string }
): Promise<boolean> {
  if (!isDefiniteWriteFailure(err)) {
    let exists: boolean;
    try {
      exists = Boolean(await recordExists());
    } catch (checkErr) {
      if (documents.length > 0) {
        logger.error("documents.release_skipped", { ...context, documentCount: documents.length, err: checkErr });
      }
      return false;
    }
    if (exists) {
      logger.warn("record.insert_committed_after_error", { ...context, err });
      return true;
    }
  }
  if (documents.length > 0) await releaseClaimedDocuments(documents);
  return false;
}

// Legacy documents (migrated from the previous system) used keys that were not unique per record.
// Before erasing a record, keep any legacy object that another record still references.
export async function documentsSafeToDelete(
  documents: StoredDocument[],
  owner: { type: "application" | "talent"; id: Types.ObjectId }
): Promise<StoredDocument[]> {
  const result: StoredDocument[] = [];
  for (const doc of documents) {
    if (!doc.legacy) {
      result.push(doc);
      continue;
    }
    const [otherApplication, otherTalent] = await Promise.all([
      ApplicationModel.exists(
        owner.type === "application" ? { _id: { $ne: owner.id }, "documents.key": doc.key } : { "documents.key": doc.key }
      ),
      TalentPoolEntryModel.exists(
        owner.type === "talent" ? { _id: { $ne: owner.id }, "documents.key": doc.key } : { "documents.key": doc.key }
      ),
    ]);
    if (otherApplication || otherTalent) {
      logger.warn("documents.shared_legacy_key_kept", { recordType: owner.type, recordId: String(owner.id), documentId: String(doc._id) });
      continue;
    }
    result.push(doc);
  }
  return result;
}

// HR recipients for new-submission notifications; logs once per call when none are configured.
export function hrRecipientsFor(template: string): string[] {
  const recipients = hrNotificationRecipients();
  if (recipients.length === 0) logger.warn("email.hr_recipients_missing", { template });
  return recipients;
}

// Renders emails, writes them to the outbox and schedules delivery. The triggering record is
// already saved, so a failure here is logged rather than failing the request. Returns whether
// the emails were queued.
export async function queueEmails(
  build: () => EnqueueEmailInput[],
  context: { entityType: string; entityId: string }
): Promise<boolean> {
  let items: EnqueueEmailInput[] = [];
  try {
    items = build();
    if (items.length === 0) return true;
    const ids = await enqueueEmails(items);
    scheduleEmailDelivery(ids);
    return true;
  } catch (err) {
    logger.error("email.enqueue_failed", { ...context, count: items.length, templates: items.map((item) => item.template), err });
    return false;
  }
}

// The acting HR user (null for public submissions and system jobs), as stored on records.
export type RecordAuthor = { userId: Types.ObjectId; name: string } | null;

export function authorFromContext(ctx: AdminContext): { userId: Types.ObjectId; name: string } {
  return { userId: ctx.userId, name: ctx.user.name };
}

export function newNoteEntry(body: string, author: { userId: Types.ObjectId; name: string }, now: Date): NoteEntry {
  return { _id: new Types.ObjectId(), body, author: author.userId, authorName: author.name, createdAt: now };
}

export function newActivityEntry(action: string, detail: string, author: RecordAuthor, now: Date): TalentActivityDoc {
  return {
    _id: new Types.ObjectId(),
    action,
    at: now,
    actor: author?.userId ?? null,
    actorName: author?.name ?? null,
    detail: detail.slice(0, 1000),
  };
}
