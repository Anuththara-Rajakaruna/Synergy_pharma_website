import { APPLICATION_STATUSES, DOCUMENT_KINDS, FIELD_LIMITS, type ApplicationStatus, type DocumentKind } from "@/lib/careers/constants";
import { newId } from "@/lib/careers/server/ids";
import type { NoteEntry, OwnerType, StatusHistoryEntryRecord, StoredDocument, TalentActivityRecord } from "@/lib/careers/server/records";
import {
  decodeBoolean,
  decodeDateOr,
  decodeEnum,
  decodeEnumOrNull,
  decodeMultiline,
  decodeNumber,
  decodeText,
  decodeTextOrNull,
  encodeBoolean,
  encodeDate,
  encodeNumber,
  encodeText,
} from "@/lib/sheets-db/codec";
import { allRecords, appendRecords, updateRecord, type RecordValues } from "@/lib/sheets-db/table";

// The four tabs that hold what MongoDB kept as embedded arrays: a record's documents, HR notes,
// application status history and talent-profile activity.
//
// Giving each its own tab is what makes concurrent edits safe. Appending a note is one appended
// row, so two admins writing notes on the same application at the same moment both succeed -
// under the embedded-array model each would have had to rewrite the whole parent record.
//
// Rows are keyed by (ownerType, ownerId) and are never reordered, so a record's sub-records come
// back in the order they were written, which is the order the UI displays.

// ── Documents ────────────────────────────────────────────────────────────────

function toDocument(values: RecordValues): StoredDocument {
  const id = decodeText(values.id);
  return {
    id,
    kind: decodeEnum<DocumentKind>(values.kind, DOCUMENT_KINDS, "supporting"),
    driveFileId: decodeText(values.driveFileId),
    originalName: decodeText(values.originalName) || "document.pdf",
    size: decodeNumber(values.size, null),
    contentType: decodeText(values.contentType) || "application/pdf",
    uploadedAt: decodeDateOr(values.uploadedAt, new Date(0)),
  };
}

function documentRow(owner: { type: OwnerType; id: string }, document: StoredDocument): RecordValues {
  return {
    id: document.id,
    ownerType: owner.type,
    ownerId: owner.id,
    kind: document.kind,
    driveFileId: document.driveFileId,
    originalName: encodeText(document.originalName, FIELD_LIMITS.originalFileName + 100),
    size: encodeNumber(document.size),
    contentType: encodeText(document.contentType, 100),
    uploadedAt: encodeDate(document.uploadedAt),
    deletedAt: "",
  };
}

// Every live document, grouped by owner id, for one owner type. One read serves a whole list
// page, so the applications list does not do a lookup per row.
export async function loadDocumentsByOwner(ownerType: OwnerType, opts: { maxAgeMs?: number } = {}): Promise<Map<string, StoredDocument[]>> {
  const rows = await allRecords("Documents", opts);
  const grouped = new Map<string, StoredDocument[]>();
  for (const row of rows) {
    if (decodeText(row.values.ownerType) !== ownerType) continue;
    if (decodeText(row.values.deletedAt)) continue;
    const ownerId = decodeText(row.values.ownerId);
    if (!ownerId) continue;
    const list = grouped.get(ownerId);
    if (list) list.push(toDocument(row.values));
    else grouped.set(ownerId, [toDocument(row.values)]);
  }
  return grouped;
}

export async function insertDocuments(owner: { type: OwnerType; id: string }, documents: StoredDocument[]): Promise<void> {
  if (documents.length === 0) return;
  await appendRecords("Documents", documents.map((document) => documentRow(owner, document)));
}

// Documents are removed from the index by flagging the row, so row numbers stay stable. The
// Drive file itself is deleted separately by the caller.
export async function markDocumentsDeleted(documentIds: string[], at: Date): Promise<void> {
  for (const id of documentIds) {
    await updateRecord("Documents", id, { deletedAt: encodeDate(at) });
  }
}

// Finds one document anywhere in the index, with the record that owns it. Backs
// /api/admin/documents/<id>.
export async function findDocument(
  documentId: string
): Promise<{ document: StoredDocument; ownerType: OwnerType; ownerId: string } | null> {
  const rows = await allRecords("Documents");
  const row = rows.find((item) => decodeText(item.values.id) === documentId && !decodeText(item.values.deletedAt));
  if (!row) return null;
  const ownerType = decodeText(row.values.ownerType) === "talent" ? "talent" : "application";
  return { document: toDocument(row.values), ownerType, ownerId: decodeText(row.values.ownerId) };
}

// Every live row that points at the same Drive file. Migrated records could share one file, and
// a shared file must never be deleted while another record still references it.
export async function countDocumentsUsingDriveFile(driveFileId: string): Promise<number> {
  if (!driveFileId) return 0;
  const rows = await allRecords("Documents", { maxAgeMs: 0 });
  return rows.filter((row) => decodeText(row.values.driveFileId) === driveFileId && !decodeText(row.values.deletedAt)).length;
}

// ── Notes ────────────────────────────────────────────────────────────────────

function toNote(values: RecordValues): NoteEntry {
  return {
    id: decodeText(values.id),
    body: decodeMultiline(values.body),
    author: decodeTextOrNull(values.authorId),
    authorName: decodeText(values.authorName) || "Unknown",
    createdAt: decodeDateOr(values.createdAt, new Date(0)),
  };
}

export async function loadNotesByOwner(ownerType: OwnerType, opts: { maxAgeMs?: number } = {}): Promise<Map<string, NoteEntry[]>> {
  const rows = await allRecords("Notes", opts);
  const grouped = new Map<string, NoteEntry[]>();
  for (const row of rows) {
    if (decodeText(row.values.ownerType) !== ownerType) continue;
    const ownerId = decodeText(row.values.ownerId);
    if (!ownerId) continue;
    const list = grouped.get(ownerId);
    if (list) list.push(toNote(row.values));
    else grouped.set(ownerId, [toNote(row.values)]);
  }
  return grouped;
}

export async function insertNote(owner: { type: OwnerType; id: string }, note: NoteEntry): Promise<void> {
  await appendRecords("Notes", [
    {
      id: note.id,
      ownerType: owner.type,
      ownerId: owner.id,
      body: encodeText(note.body, FIELD_LIMITS.hrNote),
      authorId: note.author ?? "",
      authorName: encodeText(note.authorName, 200),
      createdAt: encodeDate(note.createdAt),
    },
  ]);
}

export function newNote(body: string, author: { userId: string; name: string }, now: Date): NoteEntry {
  return { id: newId(now), body, author: author.userId, authorName: author.name, createdAt: now };
}

// ── Application status history ───────────────────────────────────────────────

function toStatusHistory(values: RecordValues): StatusHistoryEntryRecord {
  return {
    id: decodeText(values.id),
    from: decodeEnumOrNull<ApplicationStatus>(values.from, APPLICATION_STATUSES),
    to: decodeEnum<ApplicationStatus>(values.to, APPLICATION_STATUSES, "submitted"),
    changedAt: decodeDateOr(values.changedAt, new Date(0)),
    changedBy: decodeTextOrNull(values.changedBy),
    changedByName: decodeTextOrNull(values.changedByName),
    note: decodeMultiline(values.note),
    candidateNotified: decodeBoolean(values.candidateNotified),
  };
}

function statusHistoryRow(applicationId: string, entry: StatusHistoryEntryRecord): RecordValues {
  return {
    id: entry.id,
    applicationId,
    from: entry.from ?? "",
    to: entry.to,
    changedAt: encodeDate(entry.changedAt),
    changedBy: entry.changedBy ?? "",
    changedByName: encodeText(entry.changedByName, 200),
    note: encodeText(entry.note, FIELD_LIMITS.hrNote),
    candidateNotified: encodeBoolean(entry.candidateNotified),
  };
}

export async function loadStatusHistoryByApplication(opts: { maxAgeMs?: number } = {}): Promise<Map<string, StatusHistoryEntryRecord[]>> {
  const rows = await allRecords("StatusHistory", opts);
  const grouped = new Map<string, StatusHistoryEntryRecord[]>();
  for (const row of rows) {
    const applicationId = decodeText(row.values.applicationId);
    if (!applicationId) continue;
    const entry = toStatusHistory(row.values);
    const list = grouped.get(applicationId);
    if (list) list.push(entry);
    else grouped.set(applicationId, [entry]);
  }
  return grouped;
}

export async function insertStatusHistory(applicationId: string, entries: StatusHistoryEntryRecord[]): Promise<void> {
  if (entries.length === 0) return;
  await appendRecords("StatusHistory", entries.map((entry) => statusHistoryRow(applicationId, entry)));
}

// Corrects the recorded "we emailed the candidate" flag when queuing the email failed, so the
// history never claims a message was sent that was not.
export async function setStatusHistoryNotified(entryId: string, notified: boolean): Promise<void> {
  await updateRecord("StatusHistory", entryId, { candidateNotified: encodeBoolean(notified) });
}

export function newStatusHistoryEntry(input: Omit<StatusHistoryEntryRecord, "id">): StatusHistoryEntryRecord {
  return { id: newId(input.changedAt), ...input };
}

// ── Talent activity ──────────────────────────────────────────────────────────

function toTalentActivity(values: RecordValues): TalentActivityRecord {
  return {
    id: decodeText(values.id),
    action: decodeText(values.action),
    at: decodeDateOr(values.at, new Date(0)),
    actor: decodeTextOrNull(values.actorId),
    actorName: decodeTextOrNull(values.actorName),
    detail: decodeMultiline(values.detail),
  };
}

export async function loadActivityByTalent(opts: { maxAgeMs?: number } = {}): Promise<Map<string, TalentActivityRecord[]>> {
  const rows = await allRecords("TalentActivity", opts);
  const grouped = new Map<string, TalentActivityRecord[]>();
  for (const row of rows) {
    const talentId = decodeText(row.values.talentId);
    if (!talentId) continue;
    const entry = toTalentActivity(row.values);
    const list = grouped.get(talentId);
    if (list) list.push(entry);
    else grouped.set(talentId, [entry]);
  }
  return grouped;
}

export async function insertActivity(talentId: string, entries: TalentActivityRecord[]): Promise<void> {
  if (entries.length === 0) return;
  await appendRecords(
    "TalentActivity",
    entries.map((entry) => ({
      id: entry.id,
      talentId,
      action: encodeText(entry.action, 60),
      at: encodeDate(entry.at),
      actorId: entry.actor ?? "",
      actorName: encodeText(entry.actorName, 200),
      detail: encodeText(entry.detail, 1000),
    }))
  );
}

export function newActivity(
  action: string,
  detail: string,
  author: { userId: string; name: string } | null,
  now: Date
): TalentActivityRecord {
  return { id: newId(now), action, at: now, actor: author?.userId ?? null, actorName: author?.name ?? null, detail };
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

// Row numbers of every sub-record belonging to the given owners, for the retention purge. The
// purge is the only code that deletes rows, and it invalidates the cache afterwards.
export async function subRecordRowsFor(
  ownerType: OwnerType,
  ownerIds: Set<string>
): Promise<{ Documents: number[]; Notes: number[]; StatusHistory: number[]; TalentActivity: number[] }> {
  const [documents, notes, history, activity] = await Promise.all([
    allRecords("Documents", { maxAgeMs: 0 }),
    allRecords("Notes", { maxAgeMs: 0 }),
    ownerType === "application" ? allRecords("StatusHistory", { maxAgeMs: 0 }) : Promise.resolve([]),
    ownerType === "talent" ? allRecords("TalentActivity", { maxAgeMs: 0 }) : Promise.resolve([]),
  ]);

  const ownedBy = (values: RecordValues) => decodeText(values.ownerType) === ownerType && ownerIds.has(decodeText(values.ownerId));
  return {
    Documents: documents.filter((row) => ownedBy(row.values)).map((row) => row.rowNumber),
    Notes: notes.filter((row) => ownedBy(row.values)).map((row) => row.rowNumber),
    StatusHistory: history.filter((row) => ownerIds.has(decodeText(row.values.applicationId))).map((row) => row.rowNumber),
    TalentActivity: activity.filter((row) => ownerIds.has(decodeText(row.values.talentId))).map((row) => row.rowNumber),
  };
}
