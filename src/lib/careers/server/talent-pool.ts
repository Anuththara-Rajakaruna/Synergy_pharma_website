// Talent pool: public profile submission, HR-managed profiles (create, edit, notes, tags,
// archive), considering a profile for a job, and erasure. Server-only.
//
// Ported from MongoDB to the Google Sheets store. What changed, and nothing else did:
//
//   * Filtering, searching, sorting and paging happen in this process over a cached copy of the
//     TalentPool tab instead of in an aggregation pipeline. The filter rules, the search
//     semantics (including the TP-XXXXXXXX reference suffix match) and the page shape are the
//     same.
//   * The unique index on emailNormalized is replaced by a lock on the address around a
//     read-check-append, plus reconcileDuplicate() for the cross-instance case: the earliest
//     row wins and a row that lost is superseded, its documents released, and the caller is told
//     the email is taken - exactly what the duplicate-key error used to produce.
//   * Every conditional findOneAndUpdate became withLock("talent:<id>") around a fresh read, the
//     same rule check, and a patch, so the same 404/409 codes come out of the same situations.
//   * Notes, activity and documents live on their own tabs instead of inside the row. Appending
//     one is an append of one row, so two admins writing at the same moment no longer overwrite
//     each other - but the append is no longer part of the same write as the field change, so a
//     timeline entry is written best-effort and never fails a mutation that already succeeded.

import { toAuditActor, type AdminContext } from "@/lib/auth/session";
import { FIELD_LIMITS, TALENT_SOURCES, type TalentSource } from "@/lib/careers/constants";
import { recordAudit } from "@/lib/careers/server/audit";
import { isObjectIdString, newId } from "@/lib/careers/server/ids";
import { getJobDocumentBySlug } from "@/lib/careers/server/jobs";
import {
  applicationReference,
  authorFromContext,
  compareByDateDesc,
  documentsSafeToDelete,
  hrRecipientsFor,
  makeSearchMatcher,
  newActivityEntry,
  newNoteEntry,
  paginate,
  parseTalentUpdatePayload,
  queueEmails,
  settleFailedInsert,
  talentReference,
  toPaginated,
  toTalentApplicationLink,
  toTalentDetail,
  toTalentListItem,
  validateArchiveReason,
  validateNoteBody,
  validateOptionalHrNote,
  type TalentApplicationRow,
  type TalentListRow,
} from "@/lib/careers/server/mappers";
import type {
  ApplicationRecord,
  AuditActor,
  JobRecord,
  NoteEntry,
  StoredDocument,
  TalentActivityRecord,
  TalentPoolRecord,
} from "@/lib/careers/server/records";
import { claimUploads, copyDocuments, deleteDocuments, releaseClaimedDocuments } from "@/lib/careers/server/uploads";
import {
  isValidJobSlug,
  normalizeEmail,
  parseDateFilter,
  parseSearchQuery,
  type HrTalentInput,
  type Pagination,
  type TalentSubmission,
} from "@/lib/careers/validation";
import { hrNewTalentEmail, talentReceivedEmail } from "@/lib/email/templates";
import { AppError, badRequest, conflict, notFound } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import {
  deleteRows,
  ensureStoreReady,
  findRecord,
  reconcileDuplicate,
  withLock,
  withLocks,
  type RecordValues,
  type TableRecord,
} from "@/lib/sheets-db";
import {
  findApplicationById,
  findApplicationByJobAndEmail,
  insertApplication,
  listAllApplications,
  patchApplication,
  supersedeApplication,
  type ShallowApplication,
} from "@/lib/sheets-db/repositories/applications";
import { emailRowsRelatedTo } from "@/lib/sheets-db/repositories/email";
import {
  insertActivity,
  insertDocuments,
  insertNote,
  insertStatusHistory,
  loadDocumentsByOwner,
  markDocumentsDeleted,
  newStatusHistoryEntry,
  subRecordRowsFor,
} from "@/lib/sheets-db/repositories/subrecords";
import {
  findTalentByEmail,
  findTalentById,
  insertTalent,
  listAllTalent,
  loadTalent as loadTalentRecord,
  patchTalent,
  supersedeTalent,
  talentRowNumbers,
  type ShallowTalent,
} from "@/lib/sheets-db/repositories/talent";
import type { Paginated, TalentApplyResponse, TalentDetail, TalentListItem, TalentUpdatePayload } from "@/types/careers";

export type TalentFilters = {
  q?: string;
  area?: string;
  tag?: string;
  source?: TalentSource;
  from?: Date;
  to?: Date;
  archived?: "exclude" | "only" | "include";
};

const TALENT_REFERENCE_QUERY = /^(?:TP-)?([0-9a-f]{8})$/i;
const LINKED_APPLICATIONS_LIMIT = 200;

// One profile per email address; one writer at a time per profile. These replace the unique
// index on emailNormalized and the conditional findOneAndUpdate respectively.
//
// Claiming an email takes two keys because two services can create the same person's profile:
// this one (a public submission or an HR-added profile) and the applications service (moving an
// application to the talent pool), which keys that lock "talent:<email>". Holding both means the
// two paths are still mutually exclusive inside one instance; reconcileDuplicate settles the
// cross-instance case. withLocks always takes them in sorted order, so they cannot deadlock.
const emailLocks = (emailNormalized: string) => [`talent-email:${emailNormalized}`, `talent:${emailNormalized}`];
const talentLock = (id: string) => `talent:${id}`;
// The one-application-per-job-and-candidate rule, which used to be the job_email_unique index.
// Keyed exactly as the applications service keys it, so a candidate cannot be added to the same
// job twice by the two paths at once.
const applicationLock = (jobId: string, emailNormalized: string) => `apply:${jobId}:${emailNormalized}`;

// Deleting a row renumbers every row below it, so all row deletions in this process are
// serialised on one key - the same key the maintenance sweep uses.
const ROW_SWEEP_LOCK = "maintenance-row-sweep";

const talentNotFound = () => notFound("Talent profile not found.", "talent_not_found");

const FIELD_LABELS: Record<string, string> = { name: "name", phone: "phone", areaOfInterest: "area of interest" };

// ── Query helpers ────────────────────────────────────────────────────────────

// Reads list filters from the query string. Unknown values and "all" are ignored.
export function parseTalentFilters(params: URLSearchParams): TalentFilters {
  const q = parseSearchQuery(params);
  const area = parseSearchQuery(params, "area");
  const tag = parseSearchQuery(params, "tag").toLowerCase();
  const source = params.get("source");
  const from = parseDateFilter(params.get("from"), "start");
  const to = parseDateFilter(params.get("to"), "end");
  const archived = params.get("archived");
  return {
    q: q || undefined,
    area: area && area.toLowerCase() !== "all" ? area : undefined,
    tag: tag && tag !== "all" ? tag : undefined,
    source: (TALENT_SOURCES as readonly string[]).includes(source ?? "") ? (source as TalentSource) : undefined,
    from: from ?? undefined,
    to: to ?? undefined,
    archived: archived === "only" || archived === "include" ? archived : "exclude",
  };
}

// The $match stage, as a predicate. Same rules, evaluated here instead of in the database.
function talentMatcher(filters: TalentFilters): (entry: ShallowTalent) => boolean {
  const archived = filters.archived ?? "exclude";
  const from = filters.from ? filters.from.getTime() : null;
  const to = filters.to ? filters.to.getTime() : null;
  const matchesSearch = makeSearchMatcher<ShallowTalent>(
    filters.q ?? "",
    (entry) => [entry.name, entry.email, entry.areaOfInterest, ...(entry.tags ?? [])],
    (entry) => entry.id,
    TALENT_REFERENCE_QUERY
  );

  return (entry) => {
    if (archived === "exclude" && entry.archivedAt) return false;
    if (archived === "only" && !entry.archivedAt) return false;
    if (filters.area && entry.areaOfInterest !== filters.area) return false;
    if (filters.tag && !(entry.tags ?? []).includes(filters.tag)) return false;
    if (filters.source && entry.source !== filters.source) return false;
    if (from !== null && entry.createdAt.getTime() < from) return false;
    if (to !== null && entry.createdAt.getTime() > to) return false;
    return matchesSearch(entry);
  };
}

const NEWEST_FIRST = compareByDateDesc<ShallowTalent>(
  (entry) => entry.createdAt,
  (entry) => entry.id
);

async function loadTalent(id: string): Promise<TalentPoolRecord> {
  if (!isObjectIdString(id)) throw talentNotFound();
  ensureStoreReady();
  // A profile created seconds ago on another instance must not read as a 404, so a miss is
  // confirmed against Google before it is believed.
  const record = await loadTalentRecord(id, { refreshOnMiss: true });
  if (!record) throw talentNotFound();
  return record;
}

async function buildTalentDetail(record: TalentPoolRecord): Promise<TalentDetail> {
  const linked = new Set(record.applications ?? []);
  // The union of forward links (the profile's applications) and back links (an application
  // pointing at this profile), newest first, capped the way the query's limit used to cap it.
  const rows: TalentApplicationRow[] = (await listAllApplications())
    .filter((application) => linked.has(application.id) || application.talentPoolEntry === record.id)
    .sort(
      compareByDateDesc<TalentApplicationRow>(
        (application) => application.createdAt,
        (application) => application.id
      )
    )
    .slice(0, LINKED_APPLICATIONS_LIMIT);
  return toTalentDetail(record, rows.map(toTalentApplicationLink));
}

// Explains why a guarded update wrote nothing.
async function explainMiss(id: string, archivedMessage: string, otherwise: AppError): Promise<AppError> {
  const current = await findTalentById(id, { maxAgeMs: 0 });
  if (!current) return talentNotFound();
  if (current.archivedAt) return conflict(archivedMessage, "archived");
  return otherwise;
}

// ── Writing a new profile ────────────────────────────────────────────────────

// The key the unique index used to enforce.
function talentEmailKey(values: RecordValues): string | null {
  const email = String(values.emailNormalized ?? "").trim().toLowerCase();
  return email || null;
}

function applicationJobEmailKey(values: RecordValues): string | null {
  const jobId = String(values.jobId ?? "").trim();
  const email = String(values.emailNormalized ?? "").trim().toLowerCase();
  return jobId && email ? `${jobId}:${email}` : null;
}

// The timeline is a record of what happened, not the thing that happened: losing an entry must
// never fail a mutation that already succeeded, nor make a retry apply the change twice.
async function appendActivity(talentId: string, entries: TalentActivityRecord[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    await insertActivity(talentId, entries);
  } catch (err) {
    logger.error("talent.activity_write_failed", { talentId, actions: entries.map((entry) => entry.action), err });
  }
}

// Hides a row that lost a duplicate race and gives back the Drive files it claimed, so the
// candidate's documents belong to exactly one profile - the one that was written first.
async function discardLosingProfile(id: string, winnerId: string, documents: StoredDocument[]): Promise<void> {
  await supersedeTalent(id, winnerId);
  if (documents.length > 0) {
    try {
      await markDocumentsDeleted(
        documents.map((document) => document.id),
        new Date()
      );
    } catch (err) {
      logger.warn("talent.duplicate_documents_unindexed", { talentId: id, err });
    }
    await releaseClaimedDocuments(documents);
  }
  logger.warn("talent.duplicate_profile_superseded", { talentId: id, winnerId });
}

type NewTalentParts = { documents: StoredDocument[]; note: NoteEntry | null; activity: TalentActivityRecord[] };

// Writes a new profile: its documents and opening note first, then the row itself, then the
// timeline. Nothing can reach a document or note until the row exists, so a failure before that
// point leaves no profile behind and the caller can simply try again.
async function writeNewTalent(record: TalentPoolRecord, parts: NewTalentParts, duplicate: () => AppError): Promise<void> {
  const owner = { type: "talent" as const, id: record.id };
  try {
    await insertDocuments(owner, parts.documents);
    if (parts.note) await insertNote(owner, parts.note);
  } catch (err) {
    await releaseClaimedDocuments(parts.documents);
    throw err;
  }

  let row: TableRecord | null = null;
  try {
    row = await insertTalent(record);
  } catch (err) {
    const saved = await settleFailedInsert(err, parts.documents, () => findTalentById(record.id, { maxAgeMs: 0 }), {
      entityType: "talent",
      entityId: record.id,
    });
    if (!saved) throw err;
    // The append landed after all; find the row it produced so it is still reconciled.
    row = await findRecord("TalentPool", (values) => String(values.id ?? "") === record.id, { maxAgeMs: 0 });
  }

  if (row) {
    // Another instance may have appended a row for the same address a moment earlier. The
    // earliest row always wins, so both instances agree without talking to each other.
    const { isDuplicate, winner } = await reconcileDuplicate("TalentPool", row, talentEmailKey);
    if (isDuplicate) {
      await discardLosingProfile(record.id, String(winner.values.id ?? ""), parts.documents);
      throw duplicate();
    }
  }

  await appendActivity(record.id, parts.activity);
}

// ── Public submission ────────────────────────────────────────────────────────

export async function submitTalentProfile(input: TalentSubmission, meta: { ip: string }): Promise<{ id: string; reference: string }> {
  ensureStoreReady();
  const emailNormalized = normalizeEmail(input.email);
  const duplicate = () =>
    conflict(
      "This email address is already in our talent pool. We'll contact you when a matching role opens.",
      "duplicate_talent_profile"
    );

  const created = await withLocks(emailLocks(emailNormalized), async () => {
    // Archived profiles count too: a public submission never silently revives someone's profile.
    if (await findTalentByEmail(emailNormalized, { refreshOnMiss: true })) throw duplicate();

    const now = new Date();
    const id = newId(now);
    const reference = talentReference(id);
    // The id is minted before the row is written so the Drive file can be named after the
    // profile it belongs to.
    const documents = await claimUploads(
      { cv: input.uploads.cv, supporting: input.uploads.supporting },
      {
        purposes: ["talent_pool"],
        target: { ownerType: "talent", ownerId: id, reference, candidateName: input.name },
        requireCv: true,
      }
    );

    const record: TalentPoolRecord = {
      id,
      name: input.name,
      email: input.email,
      emailNormalized,
      phone: input.phone,
      areaOfInterest: input.areaOfInterest,
      candidateNotes: input.candidateNotes,
      tags: [],
      notes: [],
      documents,
      consentGiven: true,
      consentAt: now,
      source: "self_submitted",
      sourceApplication: null,
      applications: [],
      createdBy: null,
      activity: [],
      archivedAt: null,
      archivedBy: null,
      archivedByName: null,
      archiveReason: "",
      supersededBy: null,
      createdAt: now,
      updatedAt: now,
    };

    await writeNewTalent(
      record,
      {
        documents,
        note: null,
        activity: [newActivityEntry("created", "Profile submitted via the careers website", null, now)],
      },
      duplicate
    );
    return { id, reference, documentCount: documents.length };
  });

  const entityId = created.id;
  const related = { entityType: "talent", entityId };
  await queueEmails(() => {
    const hrRecipients = hrRecipientsFor("hr_new_talent");
    const hrContent = hrNewTalentEmail({ name: input.name, areaOfInterest: input.areaOfInterest, entryId: entityId });
    return [
      {
        to: input.email,
        replyTo: hrRecipients[0] ?? null,
        template: "talent_received",
        content: talentReceivedEmail({ name: input.name, areaOfInterest: input.areaOfInterest }),
        related,
      },
      ...hrRecipients.map((to) => ({ to, replyTo: input.email, template: "hr_new_talent", content: hrContent, related })),
    ];
  }, related);

  await recordAudit({
    actor: null,
    action: "talent.submit",
    entityType: "talent",
    entityId,
    summary: `Talent profile ${created.reference} submitted (${input.areaOfInterest})`,
    meta: { documentCount: created.documentCount },
    ip: meta.ip,
  });

  return { id: entityId, reference: created.reference };
}

// ── Admin: create, list, detail ──────────────────────────────────────────────

export async function createTalentEntry(input: HrTalentInput, ctx: AdminContext): Promise<TalentDetail> {
  ensureStoreReady();
  const emailNormalized = normalizeEmail(input.email);
  const duplicate = () => {
    const message = "This email address is already in the talent pool.";
    return new AppError(409, "duplicate_talent_profile", message, { fields: { email: message } });
  };
  const created = await withLocks(emailLocks(emailNormalized), async () => {
    if (await findTalentByEmail(emailNormalized, { refreshOnMiss: true })) throw duplicate();

    const note = validateOptionalHrNote(input.note);
    const now = new Date();
    const id = newId(now);
    const reference = talentReference(id);
    const author = authorFromContext(ctx);
    const hasUploads = Boolean(input.uploads && (input.uploads.cv || input.uploads.supporting.length > 0));
    const documents =
      input.uploads && hasUploads
        ? await claimUploads(
            { cv: input.uploads.cv || null, supporting: input.uploads.supporting },
            {
              purposes: ["admin_talent"],
              target: { ownerType: "talent", ownerId: id, reference, candidateName: input.name },
              requireCv: false,
            }
          )
        : [];

    const opening = note ? newNoteEntry(note, author, now) : null;
    const record: TalentPoolRecord = {
      id,
      name: input.name,
      email: input.email,
      emailNormalized,
      phone: input.phone,
      areaOfInterest: input.areaOfInterest,
      candidateNotes: "",
      tags: input.tags,
      notes: opening ? [opening] : [],
      documents,
      // HR confirmed the candidate agreed to be kept on file (validated by the route).
      consentGiven: true,
      consentAt: now,
      source: "hr_added",
      sourceApplication: null,
      applications: [],
      createdBy: ctx.userId,
      activity: [],
      archivedAt: null,
      archivedBy: null,
      archivedByName: null,
      archiveReason: "",
      supersededBy: null,
      createdAt: now,
      updatedAt: now,
    };

    await writeNewTalent(
      record,
      { documents, note: opening, activity: [newActivityEntry("created", "Added by HR", author, now)] },
      duplicate
    );
    return { id, reference, documentCount: documents.length, hasNote: note.length > 0 };
  });

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "talent.create",
    entityType: "talent",
    entityId: created.id,
    summary: `Added talent profile ${created.reference} (${input.areaOfInterest})`,
    meta: { documentCount: created.documentCount, tagCount: input.tags.length, hasNote: created.hasNote },
    ip: ctx.ip,
  });

  return buildTalentDetail(await loadTalent(created.id));
}

export async function listTalent(filters: TalentFilters, page: Pagination): Promise<Paginated<TalentListItem>> {
  ensureStoreReady();
  const matches = talentMatcher(filters);
  const entries = (await listAllTalent()).filter(matches);
  entries.sort(NEWEST_FIRST);

  // One pass over the Documents tab serves the whole page, the way the $size projection used to
  // come free with the row.
  const documents = await loadDocumentsByOwner("talent");
  const items = paginate(entries, page).map((entry) => {
    const row: TalentListRow = {
      ...entry,
      applicationCount: (entry.applications ?? []).length,
      documentCount: (documents.get(entry.id) ?? []).length,
    };
    return toTalentListItem(row);
  });
  return toPaginated(items, entries.length, page);
}

// Tags in use on active (non-archived) profiles, for the admin filter drop-down.
export async function listTalentTags(): Promise<string[]> {
  ensureStoreReady();
  const tags = new Set<string>();
  for (const entry of await listAllTalent()) {
    if (entry.archivedAt) continue;
    for (const tag of entry.tags ?? []) {
      if (tag) tags.add(tag);
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b, "en"));
}

export async function getTalentDetail(id: string, ctx: AdminContext): Promise<TalentDetail> {
  const record = await loadTalent(id);
  const detail = await buildTalentDetail(record);
  await recordAudit({
    actor: toAuditActor(ctx),
    action: "talent.view",
    entityType: "talent",
    entityId: record.id,
    summary: `Viewed talent profile ${talentReference(record.id)}`,
    meta: {},
    ip: ctx.ip,
  });
  return detail;
}

// ── Admin: edits ─────────────────────────────────────────────────────────────

// Exact, order-sensitive comparison, the way { tags: <previous array> } matched in a filter.
function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

export async function updateTalentEntry(id: string, patch: TalentUpdatePayload, ctx: AdminContext): Promise<TalentDetail> {
  if (!isObjectIdString(id)) throw talentNotFound();
  // Idempotent normalization; the route has usually parsed the raw body already.
  const input = parseTalentUpdatePayload(patch);
  const current = await loadTalent(id);
  if (current.archivedAt) throw conflict("Restore the talent profile before editing it.", "archived");

  const set: Partial<TalentPoolRecord> = {};
  const changedFields: string[] = [];
  for (const field of ["name", "phone", "areaOfInterest"] as const) {
    const value = input[field];
    if (value !== undefined && value !== current[field]) {
      set[field] = value;
      changedFields.push(field);
    }
  }
  const currentTags = current.tags ?? [];
  const added = input.tags ? input.tags.filter((tag) => !currentTags.includes(tag)) : [];
  const removed = input.tags ? currentTags.filter((tag) => !input.tags?.includes(tag)) : [];
  const tagsChanged = added.length > 0 || removed.length > 0;
  if (tagsChanged && input.tags) set.tags = input.tags;

  // Nothing actually changed (e.g. a retried request): return the profile as it is.
  if (Object.keys(set).length === 0) return buildTalentDetail(current);

  const now = new Date();
  const author = authorFromContext(ctx);
  const activity: TalentActivityRecord[] = [];
  if (changedFields.length > 0) {
    activity.push(
      newActivityEntry("profile_updated", `Updated ${changedFields.map((field) => FIELD_LABELS[field]).join(", ")}`, author, now)
    );
  }
  if (tagsChanged) {
    const parts = [
      added.length > 0 ? `added ${added.join(", ")}` : "",
      removed.length > 0 ? `removed ${removed.join(", ")}` : "",
    ].filter(Boolean);
    activity.push(newActivityEntry("tags_changed", `Tags ${parts.join("; ")}`, author, now));
  }

  const conflictError = () => conflict("This profile was updated by someone else. Refresh and try again.", "talent_conflict");

  await withLock(talentLock(id), async () => {
    const fresh = await findTalentById(id, { maxAgeMs: 0 });
    if (!fresh) throw talentNotFound();
    if (fresh.archivedAt) throw conflict("Restore the talent profile before editing it.", "archived");
    // Tags are replaced as a whole, so require the tags the editor started from: a concurrent tag
    // change must not be silently lost.
    if (tagsChanged && !sameTags(fresh.tags ?? [], currentTags)) throw conflictError();

    if (!(await patchTalent(id, { ...set, updatedAt: now }))) {
      throw await explainMiss(id, "Restore the talent profile before editing it.", conflictError());
    }
  });

  await appendActivity(id, activity);

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "talent.update",
    entityType: "talent",
    entityId: id,
    summary: `Updated talent profile ${talentReference(id)}`,
    meta: {
      fields: tagsChanged ? [...changedFields, "tags"] : changedFields,
      tagsAdded: added.length,
      tagsRemoved: removed.length,
    },
    ip: ctx.ip,
  });
  return buildTalentDetail(await loadTalent(id));
}

export async function addTalentNote(id: string, body: string, ctx: AdminContext): Promise<TalentDetail> {
  if (!isObjectIdString(id)) throw talentNotFound();
  const text = validateNoteBody(body);
  ensureStoreReady();
  const now = new Date();
  const author = authorFromContext(ctx);
  const note = newNoteEntry(text, author, now);

  await withLock(talentLock(id), async () => {
    const fresh = await findTalentById(id, { maxAgeMs: 0 });
    if (!fresh) throw talentNotFound();
    if (fresh.archivedAt) throw conflict("Restore the talent profile before adding notes.", "archived");

    // The profile is touched first: if its row has gone the note is never written, so a retry
    // cannot leave two copies of the same note behind. Notes are append-only - there is no edit
    // or delete path for one.
    if (!(await patchTalent(id, { updatedAt: now }))) {
      throw await explainMiss(
        id,
        "Restore the talent profile before adding notes.",
        conflict("The talent profile changed while saving. Please try again.")
      );
    }
    await insertNote({ type: "talent", id }, note);
  });

  await appendActivity(id, [newActivityEntry("note_added", "Added an HR note", author, now)]);

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "talent.note_add",
    entityType: "talent",
    entityId: id,
    summary: `Added a note to talent profile ${talentReference(id)}`,
    meta: { noteId: note.id },
    ip: ctx.ip,
  });
  return buildTalentDetail(await loadTalent(id));
}

export async function setTalentArchived(id: string, archived: boolean, reason: string, ctx: AdminContext): Promise<TalentDetail> {
  if (!isObjectIdString(id)) throw talentNotFound();
  const archiveReason = archived ? validateArchiveReason(reason) : "";
  ensureStoreReady();
  const now = new Date();
  const author = authorFromContext(ctx);

  const changed = await withLock(talentLock(id), async () => {
    const fresh = await findTalentById(id, { maxAgeMs: 0 });
    // Already in the requested state, or gone: nothing to write.
    if (!fresh) return false;
    if (archived === Boolean(fresh.archivedAt)) return false;

    const patch: Partial<TalentPoolRecord> = archived
      ? {
          archivedAt: now,
          archivedBy: ctx.userId,
          archivedByName: ctx.user.name,
          archiveReason,
          updatedAt: now,
        }
      : { archivedAt: null, archivedBy: null, archivedByName: null, archiveReason: "", updatedAt: now };
    return patchTalent(id, patch);
  });

  // Already in the requested state (e.g. a retried request): nothing changes, nothing is audited.
  if (!changed) return buildTalentDetail(await loadTalent(id));

  await appendActivity(id, [
    archived
      ? newActivityEntry("archived", archiveReason ? `Archived: ${archiveReason}` : "Archived", author, now)
      : newActivityEntry("restored", "Restored from archive", author, now),
  ]);

  await recordAudit({
    actor: toAuditActor(ctx),
    action: archived ? "talent.archive" : "talent.restore",
    entityType: "talent",
    entityId: id,
    summary: `${archived ? "Archived" : "Restored"} talent profile ${talentReference(id)}`,
    meta: archived ? { hasReason: archiveReason.length > 0 } : {},
    ip: ctx.ip,
  });
  return buildTalentDetail(await loadTalent(id));
}

// ── Admin: consider for a job ────────────────────────────────────────────────

type OwnershipRow = Pick<ShallowApplication, "id" | "source" | "talentPoolEntry">;

// An application created earlier from this same profile (e.g. by a request whose response was
// lost). Treating it as the result makes retries converge instead of failing as duplicates.
function isCreatedFromEntry(row: OwnershipRow, entryId: string): boolean {
  return row.source === "talent_pool" && row.talentPoolEntry === entryId;
}

async function findApplicationFor(
  job: JobRecord,
  entry: TalentPoolRecord,
  opts: { maxAgeMs?: number; refreshOnMiss?: boolean } = {}
): Promise<ShallowApplication | null> {
  return findApplicationByJobAndEmail(job.id, entry.emailNormalized, opts);
}

// Returns the new application id, or null when an application for this job and email was
// created concurrently.
async function createApplicationFromTalent(
  entry: TalentPoolRecord,
  job: JobRecord,
  note: string,
  author: { userId: string; name: string },
  now: Date
): Promise<string | null> {
  const applicationId = newId(now);
  const reference = applicationReference(applicationId);
  // The files are copied, not moved: the profile keeps its own.
  const documents =
    (entry.documents ?? []).length > 0
      ? await copyDocuments(entry.documents, {
          ownerType: "application",
          ownerId: applicationId,
          reference,
          candidateName: entry.name,
        })
      : [];

  const notes = note ? [newNoteEntry(note, author, now)] : [];
  const statusHistory = [
    newStatusHistoryEntry({
      from: null,
      to: "submitted",
      changedAt: now,
      changedBy: author.userId,
      changedByName: author.name,
      note: `Created from talent pool by ${author.name}`.slice(0, FIELD_LIMITS.hrNote),
      candidateNotified: false,
    }),
  ];

  const record: ApplicationRecord = {
    id: applicationId,
    job: job.id,
    jobSlug: job.slug,
    jobTitle: job.title,
    department: job.department,
    name: entry.name,
    email: entry.email,
    emailNormalized: entry.emailNormalized,
    phone: entry.phone,
    coverLetter: "",
    linkedIn: null,
    portfolio: null,
    consentGiven: entry.consentGiven,
    consentAt: entry.consentAt,
    documents,
    status: "submitted",
    statusChangedAt: now,
    statusHistory,
    notes,
    source: "talent_pool",
    talentPoolEntry: entry.id,
    archivedAt: null,
    archivedBy: null,
    archivedByName: null,
    archiveReason: "",
    supersededBy: null,
    createdAt: now,
    updatedAt: now,
  };

  const owner = { type: "application" as const, id: applicationId };
  try {
    await insertDocuments(owner, documents);
    for (const item of notes) await insertNote(owner, item);
    await insertStatusHistory(applicationId, statusHistory);
  } catch (err) {
    await releaseClaimedDocuments(documents);
    throw err;
  }

  let row: TableRecord | null = null;
  try {
    row = await insertApplication(record);
  } catch (err) {
    const saved = await settleFailedInsert(err, documents, () => findApplicationById(applicationId, { maxAgeMs: 0 }), {
      entityType: "application",
      entityId: applicationId,
    });
    if (!saved) throw err;
    row = await findRecord("Applications", (values) => String(values.id ?? "") === applicationId, { maxAgeMs: 0 });
  }

  if (row) {
    const { isDuplicate, winner } = await reconcileDuplicate("Applications", row, applicationJobEmailKey);
    if (isDuplicate) {
      await supersedeApplication(applicationId, String(winner.values.id ?? ""));
      if (documents.length > 0) {
        try {
          await markDocumentsDeleted(
            documents.map((document) => document.id),
            new Date()
          );
        } catch (err) {
          logger.warn("application.duplicate_documents_unindexed", { applicationId, err });
        }
        await releaseClaimedDocuments(documents);
      }
      logger.warn("application.duplicate_superseded", { applicationId, jobSlug: job.slug });
      return null;
    }
  }
  return applicationId;
}

export async function applyTalentToJob(
  id: string,
  payload: { jobSlug: string; note: string },
  ctx: AdminContext
): Promise<TalentApplyResponse> {
  if (!isObjectIdString(id)) throw talentNotFound();
  const note = validateOptionalHrNote(payload.note);
  const jobSlug = (payload.jobSlug ?? "").trim().toLowerCase();
  if (!jobSlug) throw badRequest("Choose a job.", { jobId: "Choose a job." });

  const entry = await loadTalent(id);
  if (entry.archivedAt) throw conflict("Restore the talent profile before considering it for a job.", "archived");
  const job = isValidJobSlug(jobSlug) ? await getJobDocumentBySlug(jobSlug) : null;
  if (!job) throw notFound("Job not found.", "job_not_found");
  if (job.status === "archived") {
    throw conflict("This job is archived. Restore it before adding candidates.", "job_archived");
  }

  const duplicate = () => conflict("This candidate has already applied for this role.", "duplicate_application");
  const adopt = (row: OwnershipRow): string => {
    if (!isCreatedFromEntry(row, entry.id)) throw duplicate();
    return row.id;
  };
  const now = new Date();
  const author = authorFromContext(ctx);

  const existing = await findApplicationFor(job, entry, { refreshOnMiss: true });
  const applicationId = existing
    ? adopt(existing)
    : await withLock(applicationLock(job.id, entry.emailNormalized), async () => {
        const concurrent = await findApplicationFor(job, entry, { maxAgeMs: 0 });
        if (concurrent) return adopt(concurrent);

        const createdId = await createApplicationFromTalent(entry, job, note, author, now);
        if (createdId) return createdId;

        const winner = await findApplicationFor(job, entry, { maxAgeMs: 0 });
        if (!winner) throw duplicate();
        return adopt(winner);
      });

  const reference = applicationReference(applicationId);
  // Conditioned on the link not already being there, so the timeline entry and the audit entry
  // are written at most once however often the request is retried.
  const linked = await withLock(talentLock(entry.id), async () => {
    const current = await findTalentById(entry.id, { maxAgeMs: 0 });
    if (!current) return false;
    const applications = current.applications ?? [];
    if (applications.includes(applicationId)) return false;
    return patchTalent(entry.id, { applications: [...applications, applicationId], updatedAt: now });
  });

  if (linked) {
    await appendActivity(entry.id, [
      newActivityEntry("applied_to_job", `Considered for ${job.title} (${reference})`, author, now),
    ]);
    await recordAudit({
      actor: toAuditActor(ctx),
      action: "talent.apply_to_job",
      entityType: "talent",
      entityId: entry.id,
      summary: `Talent profile ${talentReference(entry.id)} added as application ${reference} for ${job.title}`,
      meta: { applicationId, jobSlug: job.slug },
      ip: ctx.ip,
    });
  }

  return { applicationId };
}

// ── Erasure ──────────────────────────────────────────────────────────────────

export type TalentPurgeOptions = {
  actor: AuditActor | null;
  ip: string | null;
  // HR erasure requires the profile to be archived first; the retention job does not.
  requireArchived: boolean;
  action: "talent.purge" | "retention.purge";
};

// Deletes stored documents first (keeping the profile if Drive fails, so the purge can be
// retried), then unlinks applications, removes emails containing the candidate's details, and
// finally the profile's own rows.
export async function purgeTalentRecord(id: string, options: TalentPurgeOptions): Promise<void> {
  if (!isObjectIdString(id)) throw talentNotFound();
  ensureStoreReady();
  const entry = await loadTalentRecord(id, { refreshOnMiss: true });
  if (!entry) throw talentNotFound();
  if (options.requireArchived && !entry.archivedAt) {
    throw conflict("Archive the talent profile before deleting it permanently.", "not_archived");
  }

  const entityId = entry.id;
  const reference = talentReference(entry.id);
  const documents = entry.documents ?? [];
  const deletable = await documentsSafeToDelete(documents, { type: "talent", id: entry.id });
  if (deletable.length > 0) {
    const { failedIds } = await deleteDocuments(deletable);
    if (failedIds.length > 0) {
      logger.error("talent.purge_storage_failed", { talentId: entityId, failedCount: failedIds.length });
      throw new AppError(
        502,
        "storage_delete_failed",
        "Some files could not be deleted from storage. The profile was kept; please try again later."
      );
    }
  }

  // The applications themselves survive; only the link to the erased profile goes.
  const now = new Date();
  for (const application of await listAllApplications({ maxAgeMs: 0 })) {
    if (application.talentPoolEntry !== entityId) continue;
    await patchApplication(application.id, { talentPoolEntry: null, updatedAt: now });
  }

  // Row numbers are read and used inside one lock, so nothing can move between reading them and
  // deleting them, and a concurrent purge of the same profile finds no row left to delete.
  const deleted = await withLock(ROW_SWEEP_LOCK, async () => {
    const emailRows = await emailRowsRelatedTo("talent", new Set([entityId]));
    if (emailRows.length > 0) await deleteRows("EmailOutbox", emailRows);

    const subRecords = await subRecordRowsFor("talent", new Set([entityId]));
    if (subRecords.Documents.length > 0) await deleteRows("Documents", subRecords.Documents);
    if (subRecords.Notes.length > 0) await deleteRows("Notes", subRecords.Notes);
    if (subRecords.TalentActivity.length > 0) await deleteRows("TalentActivity", subRecords.TalentActivity);

    return deleteRows("TalentPool", await talentRowNumbers(new Set([entityId])));
  });
  // A concurrent purge of the same profile got there first; it writes the one audit entry.
  if (deleted === 0) throw talentNotFound();

  await recordAudit({
    actor: options.actor,
    action: options.action,
    entityType: "talent",
    entityId,
    summary:
      options.action === "retention.purge"
        ? `Retention period ended: permanently deleted talent profile ${reference}`
        : `Permanently deleted talent profile ${reference}`,
    meta: {
      reference,
      source: entry.source,
      documentCount: documents.length,
      keptSharedDocuments: documents.length - deletable.length,
      createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : null,
    },
    ip: options.ip,
  });
}

export async function purgeTalentEntry(id: string, ctx: AdminContext): Promise<void> {
  if (!isObjectIdString(id)) throw talentNotFound();
  await purgeTalentRecord(id, {
    actor: toAuditActor(ctx),
    ip: ctx.ip,
    requireArchived: true,
    action: "talent.purge",
  });
}
