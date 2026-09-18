// Shared by the application and talent-pool services: DTO mappers, request payload parsers,
// and small persistence helpers (document cleanup, email queueing). Server-only.

import type { AdminContext } from "@/lib/auth/session";
import { FIELD_LIMITS, type ApplicationStatus } from "@/lib/careers/constants";
import { toDocumentInfo } from "@/lib/careers/server/documents";
import { applicationReference, newId, talentReference } from "@/lib/careers/server/ids";
import type {
  ApplicationRecord,
  NoteEntry,
  StatusHistoryEntryRecord,
  StoredDocument,
  TalentActivityRecord,
  TalentPoolRecord,
} from "@/lib/careers/server/records";
import { releaseClaimedDocuments } from "@/lib/careers/server/uploads";
import {
  hasControlCharacters,
  isApplicationStatus,
  normalizeTags,
  validatePersonName,
  validatePhone,
  type FieldErrors,
  type Pagination,
} from "@/lib/careers/validation";
import { enqueueEmails, hrNotificationRecipients, scheduleEmailDelivery, type EnqueueEmailInput } from "@/lib/email/outbox";
import { badRequest } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import { countDocumentsUsingDriveFile } from "@/lib/sheets-db/repositories/subrecords";
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

// Soft ceiling for how many records an admin list or export will scan. The MongoDB version used
// this as a query timeout; filtering now happens in this process over a cached copy of the tab,
// so it bounds work rather than wall-clock time.
export const LIST_MAX_TIME_MS = 5_000;

// ── References & dates ───────────────────────────────────────────────────────

// Defined next to the id format in ids.ts; re-exported here because every caller already
// imports the DTO mappers.
export { applicationReference, talentReference };

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

// ── Searching, sorting and paging ────────────────────────────────────────────

// Case-insensitive substring match across the given fields, plus an exact match on the tail of
// the record id when the query looks like a reference ("APP-7F3A9C21" or a bare "7f3a9c21").
//
// The MongoDB version compiled this into a `$or` of escaped regexes. Matching substrings
// directly gives the same results and removes the escaping problem entirely: a query containing
// regex metacharacters is now simply a string that does not occur in the data.
export function makeSearchMatcher<T>(
  q: string,
  fieldsOf: (item: T) => (string | null | undefined)[],
  idOf: (item: T) => string,
  referencePattern: RegExp
): (item: T) => boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return () => true;
  const reference = referencePattern.exec(q.trim());
  const idTail = reference ? reference[1].toLowerCase() : null;

  return (item: T) => {
    if (idTail && idOf(item).toLowerCase().endsWith(idTail)) return true;
    return fieldsOf(item).some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
  };
}

// Newest-first with the id as a stable tie-breaker, matching the {field:-1, _id:-1} sorts the
// indexes used to provide. Without the tie-break, two records written in the same millisecond
// could swap places between pages.
export function compareByDateDesc<T>(dateOf: (item: T) => Date, idOf: (item: T) => string) {
  return (a: T, b: T): number => {
    const diff = dateOf(b).getTime() - dateOf(a).getTime();
    if (diff !== 0) return diff;
    return idOf(b).localeCompare(idOf(a));
  };
}

export function compareByDateAsc<T>(dateOf: (item: T) => Date, idOf: (item: T) => string) {
  return (a: T, b: T): number => {
    const diff = dateOf(a).getTime() - dateOf(b).getTime();
    if (diff !== 0) return diff;
    return idOf(a).localeCompare(idOf(b));
  };
}

// Applies skip/limit to an already-sorted list.
export function paginate<T>(items: T[], page: Pagination): T[] {
  const start = (page.page - 1) * page.limit;
  return items.slice(start, start + page.limit);
}

// ── DTO mappers ──────────────────────────────────────────────────────────────

export function toNoteInfo(note: NoteEntry): NoteInfo {
  return {
    id: note.id,
    body: note.body,
    authorName: note.authorName,
    createdAt: toIsoRequired(note.createdAt),
  };
}

function toStatusHistoryEntry(entry: StatusHistoryEntryRecord): StatusHistoryEntry {
  return {
    id: entry.id,
    from: entry.from ?? null,
    to: entry.to,
    changedAt: toIsoRequired(entry.changedAt),
    changedByName: entry.changedByName ?? null,
    note: entry.note ?? "",
    candidateNotified: Boolean(entry.candidateNotified),
  };
}

// Everything the list view shows: no cover letter, note bodies, history or Drive file ids.
export type ApplicationListRow = Pick<
  ApplicationRecord,
  | "id"
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

export function toApplicationListItem(row: ApplicationListRow): ApplicationListItem {
  return {
    id: row.id,
    reference: applicationReference(row.id),
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
  record: ApplicationRecord,
  extra: { emails: EmailDeliveryInfo[]; jobStillExists: boolean }
): ApplicationDetail {
  const documents = record.documents ?? [];
  const notes = record.notes ?? [];
  return {
    ...toApplicationListItem({ ...record, documentCount: documents.length, noteCount: notes.length }),
    coverLetter: record.coverLetter ?? "",
    linkedIn: record.linkedIn || null,
    portfolio: record.portfolio || null,
    consentGiven: Boolean(record.consentGiven),
    consentAt: toIso(record.consentAt),
    documents: documents.map(toDocumentInfo),
    notes: notes.map(toNoteInfo),
    statusHistory: (record.statusHistory ?? []).map(toStatusHistoryEntry),
    talentPoolEntryId: record.talentPoolEntry ? String(record.talentPoolEntry) : null,
    jobStillExists: extra.jobStillExists,
    archivedAt: toIso(record.archivedAt),
    archivedByName: record.archivedByName ?? null,
    archiveReason: record.archiveReason ?? "",
    emails: extra.emails,
    updatedAt: toIsoRequired(record.updatedAt),
  };
}

export type TalentListRow = Pick<
  TalentPoolRecord,
  "id" | "name" | "email" | "phone" | "areaOfInterest" | "tags" | "source" | "createdAt" | "updatedAt" | "archivedAt"
> & { applicationCount: number; documentCount: number };

export function toTalentListItem(row: TalentListRow): TalentListItem {
  return {
    id: row.id,
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

function toTalentActivity(entry: TalentActivityRecord): TalentActivity {
  return {
    id: entry.id,
    action: entry.action,
    at: toIsoRequired(entry.at),
    actorName: entry.actorName ?? null,
    detail: entry.detail ?? "",
  };
}

export type TalentApplicationRow = Pick<ApplicationRecord, "id" | "jobSlug" | "jobTitle" | "status" | "createdAt" | "archivedAt">;

export function toTalentApplicationLink(row: TalentApplicationRow): TalentApplicationLink {
  return {
    id: row.id,
    jobId: row.jobSlug,
    jobTitle: row.jobTitle,
    status: row.status,
    createdAt: toIsoRequired(row.createdAt),
    archived: Boolean(row.archivedAt),
  };
}

export function toTalentDetail(record: TalentPoolRecord, applications: TalentApplicationLink[]): TalentDetail {
  const documents = record.documents ?? [];
  return {
    ...toTalentListItem({
      ...record,
      applicationCount: Math.max(applications.length, (record.applications ?? []).length),
      documentCount: documents.length,
    }),
    candidateNotes: record.candidateNotes ?? "",
    consentGiven: Boolean(record.consentGiven),
    consentAt: toIso(record.consentAt),
    documents: documents.map(toDocumentInfo),
    notes: (record.notes ?? []).map(toNoteInfo),
    applications,
    sourceApplicationId: record.sourceApplication ? String(record.sourceApplication) : null,
    archivedAt: toIso(record.archivedAt),
    archivedByName: record.archivedByName ?? null,
    archiveReason: record.archiveReason ?? "",
    activity: (record.activity ?? []).map(toTalentActivity),
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

// A failure the store reports before writing anything: bad input, or a rule the service
// enforced itself (AppError). The record definitely does not exist.
function isDefiniteWriteFailure(err: unknown): boolean {
  return err instanceof Error && (err.name === "AppError" || err.name === "GoogleConfigError");
}

// Called when writing a record that owns freshly uploaded documents fails. A definite failure
// releases the Drive files immediately. After an ambiguous failure (network error, timeout) the
// append may still have landed, so the files are only released once the record is known not to
// exist. Returns true when the record does exist (the caller treats it as saved).
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
      // Neither confirmed nor refuted: keep the files. An orphan in Drive is recoverable; a
      // record whose CV was deleted is not.
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

// Before erasing a record, keep any Drive file another record still references. Documents
// migrated from the previous system could share one file between records.
export async function documentsSafeToDelete(
  documents: StoredDocument[],
  owner: { type: "application" | "talent"; id: string }
): Promise<StoredDocument[]> {
  const result: StoredDocument[] = [];
  for (const document of documents) {
    const references = await countDocumentsUsingDriveFile(document.driveFileId);
    // One reference is this record's own row.
    if (references > 1) {
      logger.warn("documents.shared_file_kept", { recordType: owner.type, recordId: owner.id, documentId: document.id });
      continue;
    }
    result.push(document);
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
export type RecordAuthor = { userId: string; name: string } | null;

export function authorFromContext(ctx: AdminContext): { userId: string; name: string } {
  return { userId: ctx.userId, name: ctx.user.name };
}

export function newNoteEntry(body: string, author: { userId: string; name: string }, now: Date): NoteEntry {
  return { id: newId(now), body, author: author.userId, authorName: author.name, createdAt: now };
}

export function newActivityEntry(action: string, detail: string, author: RecordAuthor, now: Date): TalentActivityRecord {
  return {
    id: newId(now),
    action,
    at: now,
    actor: author?.userId ?? null,
    actorName: author?.name ?? null,
    detail: detail.slice(0, 1000),
  };
}
