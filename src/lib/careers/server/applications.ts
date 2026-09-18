// Job applications: public submission, HR review workflow (status, notes, archive), moving a
// candidate into the talent pool, erasure and CSV export. Server-only.
//
// This is the same service it was on MongoDB; what changed is where the guarantees come from:
//
//   * The unique index {job, emailNormalized} that enforced one application per job is gone.
//     Its replacement is withLock("apply:<jobId>:<email>") around [check -> claim -> append],
//     plus reconcileDuplicate() afterwards, which re-reads the tab and lets the earliest row
//     win. A row that lost the race is superseded (hidden everywhere) and answers with the same
//     409 duplicate_application the pre-check throws.
//   * Every conditional findOneAndUpdate ({_id, status: expectedStatus, archivedAt: null} and
//     friends) became withLock("application:<id>") around a fresh read, the comparison, and the
//     write. explainMiss() still turns "could not proceed" into the exact 404/409 the API
//     already documents.
//   * statusHistory, notes and documents are rows on their own tabs rather than embedded
//     arrays, so a status change writes two tabs. History is written first: a history entry
//     without its status change reads as an attempt and is retryable, while a status change
//     without its entry would be a permanent hole in an append-only trail.
//   * Filtering, sorting, searching and paging happen here, over a cached copy of the tab.

import { toAuditActor, type AdminContext } from "@/lib/auth/session";
import { APPLICATION_STATUS_LABELS, FIELD_LIMITS, type ApplicationStatus } from "@/lib/careers/constants";
import { recordAudit } from "@/lib/careers/server/audit";
import { applicationReference, isRecordId, newId, talentReference } from "@/lib/careers/server/ids";
import { getOpenJobDocument, openJobFilter } from "@/lib/careers/server/jobs";
import {
  authorFromContext,
  compareByDateAsc,
  compareByDateDesc,
  documentsSafeToDelete,
  hrRecipientsFor,
  makeSearchMatcher,
  newActivityEntry,
  paginate,
  parseStatusChangePayload,
  queueEmails,
  settleFailedInsert,
  toApplicationDetail,
  toApplicationListItem,
  toIso,
  toPaginated,
  validateArchiveReason,
  validateNoteBody,
  validateOptionalHrNote,
  validateTagList,
} from "@/lib/careers/server/mappers";
import type { ApplicationRecord, AuditActor, StoredDocument, TalentPoolRecord } from "@/lib/careers/server/records";
import { claimUploads, copyDocuments, deleteDocuments, releaseClaimedDocuments } from "@/lib/careers/server/uploads";
import {
  escapeCsvCell,
  isApplicationStatus,
  isValidJobSlug,
  normalizeEmail,
  parseDateFilter,
  parseSearchQuery,
  type ApplicationSubmission,
  type Pagination,
} from "@/lib/careers/validation";
import { hrNotificationRecipients, listEmailsFor } from "@/lib/email/outbox";
import { applicationReceivedEmail, applicationStatusEmail, hrNewApplicationEmail } from "@/lib/email/templates";
import { AppError, badRequest, conflict, notFound } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import {
  deleteRows,
  ensureStoreReady,
  findRecord,
  loadTables,
  reconcileDuplicate,
  withLock,
  type TableName,
  type TableRecord,
} from "@/lib/sheets-db";
import {
  applicationRowNumbers,
  findApplicationById,
  findApplicationByJobAndEmail,
  hydrateApplications,
  insertApplication,
  listAllApplications,
  loadApplication as loadApplicationRecord,
  patchApplication,
  supersedeApplication,
  type ShallowApplication,
} from "@/lib/sheets-db/repositories/applications";
import { emailRowsRelatedTo } from "@/lib/sheets-db/repositories/email";
import { findJobById, findJobBySlug } from "@/lib/sheets-db/repositories/jobs";
import {
  insertActivity,
  insertDocuments,
  insertNote,
  insertStatusHistory,
  newNote,
  newStatusHistoryEntry,
  setStatusHistoryNotified,
  subRecordRowsFor,
} from "@/lib/sheets-db/repositories/subrecords";
import {
  findTalentById,
  findTalentByEmail,
  findTalentReferencing,
  insertTalent,
  patchTalent,
  supersedeTalent,
} from "@/lib/sheets-db/repositories/talent";
import type {
  ApplicationDetail,
  ApplicationListItem,
  ApplicationStatusChangePayload,
  MoveToTalentPoolResponse,
  Paginated,
} from "@/types/careers";

export type ApplicationFilters = {
  q?: string;
  status?: ApplicationStatus;
  jobSlug?: string;
  from?: Date;
  to?: Date;
  archived?: "exclude" | "only" | "include";
  sort?: "newest" | "oldest" | "status_changed";
};

const EXPORT_MAX_ROWS = 5_000;
const APPLICATION_REFERENCE_QUERY = /^(?:APP-)?([0-9a-f]{8})$/i;

// Documents, notes and status history complete an application. Loading them as one batchGet
// keeps a list page or a detail view to a single extra Google request instead of three.
const SUB_RECORD_TABLES: TableName[] = ["Documents", "Notes", "StatusHistory"];

// One lock per application, taken wherever a decision is made from the record's current state
// and then written back. Keyed the same way as the other services key theirs.
function applicationLockKey(id: string): string {
  return `application:${id}`;
}

// One lock per talent profile, keyed by whichever identifier the caller holds: the normalised
// email when a profile is being claimed for the first time, the record id afterwards. The talent
// pool service guards its own writes with the same keys.
function talentLockKey(emailOrId: string): string {
  return `talent:${emailOrId}`;
}

// Deleting rows renumbers a tab, so every deleting path in the application shares one lock: the
// maintenance sweeps and this purge both touch the EmailOutbox tab, and a row number read by one
// while the other is deleting would point at the wrong row. Kept as a literal rather than an
// import because src/lib/careers/server/maintenance.ts imports this module transitively.
const ROW_SWEEP_LOCK = "maintenance-row-sweep";

const applicationNotFound = () => notFound("Application not found.", "application_not_found");

const duplicateApplication = () =>
  conflict(
    "You have already applied for this role. We'll be in touch if your profile is shortlisted.",
    "duplicate_application"
  );

// ── Query helpers ────────────────────────────────────────────────────────────

// Reads list/export filters from the query string. Unknown values are ignored.
export function parseApplicationFilters(params: URLSearchParams): ApplicationFilters {
  const q = parseSearchQuery(params);
  const status = params.get("status");
  const job = (params.get("job") ?? "").trim().toLowerCase().slice(0, 200);
  const from = parseDateFilter(params.get("from"), "start");
  const to = parseDateFilter(params.get("to"), "end");
  const archived = params.get("archived");
  const sort = params.get("sort");
  return {
    q: q || undefined,
    status: isApplicationStatus(status) ? status : undefined,
    jobSlug: job || undefined,
    from: from ?? undefined,
    to: to ?? undefined,
    archived: archived === "only" || archived === "include" ? archived : "exclude",
    sort: sort === "oldest" || sort === "status_changed" ? sort : "newest",
  };
}

// Resolves the job filter to its id. Returns null when the filter cannot match anything.
async function resolveJobScope(filters: ApplicationFilters): Promise<{ jobId: string | null } | null> {
  if (!filters.jobSlug) return { jobId: null };
  if (!isValidJobSlug(filters.jobSlug)) return null;
  const job = await findJobBySlug(filters.jobSlug);
  return job ? { jobId: job.id } : null;
}

// The `$match` stage, as a predicate applied to the loaded tab. Same fields, same semantics:
// the date bounds are inclusive, search covers name, email and job title plus the reference, and
// nothing else (never the phone number, cover letter, notes, department or slug).
function applicationMatcher(
  filters: ApplicationFilters,
  jobId: string | null
): (application: ShallowApplication) => boolean {
  const archived = filters.archived ?? "exclude";
  const from = filters.from ? filters.from.getTime() : null;
  const to = filters.to ? filters.to.getTime() : null;
  const matchesSearch = filters.q
    ? makeSearchMatcher<ShallowApplication>(
        filters.q,
        (application) => [application.name, application.email, application.jobTitle],
        (application) => application.id,
        APPLICATION_REFERENCE_QUERY
      )
    : null;

  return (application) => {
    if (archived === "exclude" && application.archivedAt) return false;
    if (archived === "only" && !application.archivedAt) return false;
    if (filters.status && application.status !== filters.status) return false;
    if (jobId && application.job !== jobId) return false;
    if (from !== null || to !== null) {
      const createdAt = application.createdAt.getTime();
      if (from !== null && createdAt < from) return false;
      if (to !== null && createdAt > to) return false;
    }
    return matchesSearch ? matchesSearch(application) : true;
  };
}

// The `$sort` stages. The id is always the tie-breaker, as `_id` was in every index, so paging
// stays stable for records written in the same millisecond.
function applicationComparator(sort: ApplicationFilters["sort"]): (a: ShallowApplication, b: ShallowApplication) => number {
  const idOf = (application: ShallowApplication) => application.id;
  if (sort === "oldest") return compareByDateAsc<ShallowApplication>((application) => application.createdAt, idOf);
  if (sort === "status_changed") {
    return compareByDateDesc<ShallowApplication>((application) => application.statusChangedAt, idOf);
  }
  return compareByDateDesc<ShallowApplication>((application) => application.createdAt, idOf);
}

function describeFilters(filters: ApplicationFilters): Record<string, unknown> {
  return {
    status: filters.status ?? null,
    job: filters.jobSlug ?? null,
    from: filters.from?.toISOString() ?? null,
    to: filters.to?.toISOString() ?? null,
    archived: filters.archived ?? "exclude",
    sort: filters.sort ?? "newest",
    // The search text may be a candidate's name or email, so only its presence is recorded.
    search: Boolean(filters.q),
  };
}

async function loadApplication(id: string): Promise<ApplicationRecord> {
  if (!isRecordId(id)) throw applicationNotFound();
  ensureStoreReady();
  await loadTables(SUB_RECORD_TABLES);
  const record = await loadApplicationRecord(id);
  if (!record) throw applicationNotFound();
  return record;
}

async function buildDetail(record: ApplicationRecord): Promise<ApplicationDetail> {
  const [emails, job] = await Promise.all([
    listEmailsFor("application", record.id),
    // "Still exists" from the admin's point of view: the posting is still publicly available,
    // so a link to /careers/<slug> works.
    findJobById(record.job),
  ]);
  return toApplicationDetail(record, { emails, jobStillExists: Boolean(job && openJobFilter()(job)) });
}

async function detailOf(id: string): Promise<ApplicationDetail> {
  return buildDetail(await loadApplication(id));
}

// Explains why a guarded read-check-write could not proceed, with the same precedence the
// conditional MongoDB update's "matched nothing" was explained with: gone -> 404, archived ->
// 409 "archived", anything else -> the caller's own error. The record passed in is the fresh
// read the caller just took, which is exactly what the old code re-read to find out.
function explainMiss(current: ShallowApplication | null, archivedMessage: string, otherwise: AppError): AppError {
  if (!current) return applicationNotFound();
  if (current.archivedAt) return conflict(archivedMessage, "archived");
  return otherwise;
}

// ── Public submission ────────────────────────────────────────────────────────

type SubmissionContext = {
  input: ApplicationSubmission;
  job: { id: string; slug: string; title: string; department: string };
  emailNormalized: string;
  id: string;
  reference: string;
  now: Date;
};

// The append-then-reconcile half of the one-application-per-job rule, and the only place that
// writes an Applications row for a public submission.
//
// The lock orders two submissions that land on the same instance; reconcileDuplicate settles two
// that land on different ones. It re-reads the tab from Google and reports whether an earlier row
// already holds (job, email). The earliest row always wins, so both instances agree on the same
// winner without talking to each other, and the loser marks its own row superseded - which hides
// it from every listing, count and export exactly as the unique index used to stop it existing -
// releases the Drive files it claimed, and reports the same 409 the pre-check reports.
async function createApplication(context: SubmissionContext): Promise<StoredDocument[]> {
  const { input, job, emailNormalized, id, reference, now } = context;

  // Checked before claiming uploads so a duplicate never moves a file into the candidate folder.
  // refreshOnMiss matters: concluding "no application yet" from a cached copy of the tab is what
  // would let a duplicate through.
  if (await findApplicationByJobAndEmail(job.id, emailNormalized, { refreshOnMiss: true })) {
    throw duplicateApplication();
  }

  const documents = await claimUploads(
    { cv: input.uploads.cv, supporting: input.uploads.supporting },
    {
      purposes: ["application"],
      target: { ownerType: "application", ownerId: id, reference, candidateName: input.name },
      requireCv: true,
    }
  );

  const record: ApplicationRecord = {
    id,
    job: job.id,
    jobSlug: job.slug,
    jobTitle: job.title,
    department: job.department,
    name: input.name,
    email: input.email,
    emailNormalized,
    phone: input.phone,
    coverLetter: input.coverLetter,
    linkedIn: input.linkedIn || null,
    portfolio: input.portfolio || null,
    consentGiven: true,
    consentAt: now,
    documents,
    status: "submitted",
    statusChangedAt: now,
    statusHistory: [],
    notes: [],
    source: "website",
    talentPoolEntry: null,
    archivedAt: null,
    archivedBy: null,
    archivedByName: null,
    archiveReason: "",
    supersededBy: null,
    createdAt: now,
    updatedAt: now,
  };

  let row: TableRecord | null = null;
  try {
    row = await insertApplication(record);
  } catch (err) {
    const saved = await settleFailedInsert(err, documents, () => findApplicationById(id, { maxAgeMs: 0 }), {
      entityType: "application",
      entityId: id,
    });
    if (!saved) throw err;
    // The append landed despite the error; find the row it produced so the duplicate check below
    // still runs against it.
    row = await findRecord("Applications", (values) => String(values.id ?? "") === id, { maxAgeMs: 0 });
  }

  if (row) {
    const { isDuplicate, winner } = await reconcileDuplicate("Applications", row, (values) => {
      const rowJobId = String(values.jobId ?? "").trim();
      const rowEmail = String(values.emailNormalized ?? "").trim().toLowerCase();
      return rowJobId && rowEmail ? `${rowJobId}:${rowEmail}` : null;
    });
    if (isDuplicate) {
      await supersedeApplication(id, String(winner.values.id ?? ""));
      await releaseClaimedDocuments(documents);
      throw duplicateApplication();
    }
  }

  // The application itself is saved from here on. Its documents and the opening history entry
  // live on their own tabs, so they are appended afterwards; failing the request now would tell
  // the candidate their application was rejected when it was in fact recorded, and a retry would
  // answer 409 duplicate_application. A failure is therefore logged loudly instead.
  try {
    await insertDocuments({ type: "application", id }, documents);
    await insertStatusHistory(id, [
      newStatusHistoryEntry({
        from: null,
        to: "submitted",
        changedAt: now,
        changedBy: null,
        changedByName: null,
        note: "Application submitted via website",
        candidateNotified: false,
      }),
    ]);
  } catch (err) {
    logger.error("application.subrecords_failed", { applicationId: id, documentCount: documents.length, err });
  }

  return documents;
}

export async function submitApplication(input: ApplicationSubmission, meta: { ip: string }): Promise<{ id: string; reference: string }> {
  ensureStoreReady();
  const job = await getOpenJobDocument(input.jobSlug);
  if (!job) throw notFound("This role is no longer accepting applications.", "job_not_found");

  const emailNormalized = normalizeEmail(input.email);
  const now = new Date();
  // Minted before the write: the candidate-facing reference and the Drive file names are both
  // derived from the id, and both are decided before the row exists.
  const entityId = newId(now);
  const reference = applicationReference(entityId);

  const documents = await withLock(`apply:${job.id}:${emailNormalized}`, () =>
    createApplication({
      input,
      // Snapshots, taken from the job document and never from client input, so editing the job
      // later cannot rewrite historical applications.
      job: { id: job.id, slug: job.slug, title: job.title, department: job.department },
      emailNormalized,
      id: entityId,
      reference,
      now,
    })
  );

  const related = { entityType: "application", entityId };
  await queueEmails(() => {
    const hrRecipients = hrRecipientsFor("hr_new_application");
    const hrContent = hrNewApplicationEmail({
      name: input.name,
      jobTitle: job.title,
      reference,
      applicationId: entityId,
      hasCoverLetter: input.coverLetter.length > 0,
      documentCount: documents.length,
    });
    return [
      {
        to: input.email,
        replyTo: hrRecipients[0] ?? null,
        template: "application_received",
        content: applicationReceivedEmail({ name: input.name, jobTitle: job.title, reference }),
        related,
      },
      ...hrRecipients.map((to) => ({ to, replyTo: input.email, template: "hr_new_application", content: hrContent, related })),
    ];
  }, related);

  await recordAudit({
    actor: null,
    action: "application.submit",
    entityType: "application",
    entityId,
    summary: `Application ${reference} submitted for ${job.title}`,
    meta: { jobSlug: job.slug, documentCount: documents.length },
    ip: meta.ip,
  });

  return { id: entityId, reference };
}

// ── Admin: list & detail ─────────────────────────────────────────────────────

export async function listApplications(filters: ApplicationFilters, page: Pagination): Promise<Paginated<ApplicationListItem>> {
  ensureStoreReady();
  const scope = await resolveJobScope(filters);
  if (!scope) return toPaginated([], 0, page);

  const matched = (await listAllApplications()).filter(applicationMatcher(filters, scope.jobId));
  matched.sort(applicationComparator(filters.sort));
  // The total is the full match count, as the separate countDocuments over the same filter was.
  const total = matched.length;
  const rows = paginate(matched, page);
  if (rows.length === 0) return toPaginated([], total, page);

  // documentCount and noteCount were a $size projection; they now come from the sub-record tabs,
  // loaded together so one page view costs one extra request at most.
  await loadTables(SUB_RECORD_TABLES);
  const hydrated = await hydrateApplications(rows);
  return toPaginated(
    hydrated.map((record) =>
      toApplicationListItem({ ...record, documentCount: record.documents.length, noteCount: record.notes.length })
    ),
    total,
    page
  );
}

export async function getApplicationDetail(id: string, ctx: AdminContext): Promise<ApplicationDetail> {
  const record = await loadApplication(id);
  const detail = await buildDetail(record);
  await recordAudit({
    actor: toAuditActor(ctx),
    action: "application.view",
    entityType: "application",
    entityId: record.id,
    summary: `Viewed application ${detail.reference} (${record.jobTitle})`,
    meta: { jobSlug: record.jobSlug },
    ip: ctx.ip,
  });
  return detail;
}

// ── Admin: workflow ──────────────────────────────────────────────────────────

export async function changeApplicationStatus(
  id: string,
  payload: ApplicationStatusChangePayload,
  ctx: AdminContext
): Promise<ApplicationDetail> {
  if (!isRecordId(id)) throw applicationNotFound();
  // Idempotent normalization; the route has usually parsed the raw body already.
  const input = parseStatusChangePayload(payload);
  if (input.status === input.expectedStatus) {
    throw badRequest("The application already has this status.", { status: "Choose a different status." }, "status_unchanged");
  }
  const { note, candidateMessage } = input;

  ensureStoreReady();
  const now = new Date();
  // Candidates are only emailed about decisions, never about the initial "submitted" state.
  const notify = input.notifyCandidate === true && input.status !== "submitted";

  // The optimistic-concurrency point: expectedStatus used to be part of the update filter, so
  // only one of two simultaneous changes from the same status could win. Here the comparison is
  // made against a fresh read inside the lock, and the write follows without releasing it.
  const { entry, record } = await withLock(applicationLockKey(id), async () => {
    const current = await findApplicationById(id, { maxAgeMs: 0, refreshOnMiss: true });
    if (!current || current.archivedAt || current.status !== input.expectedStatus) {
      throw explainMiss(
        current,
        "Restore the application before changing its status.",
        conflict("This application was updated by someone else. Refresh to see the latest status.", "status_conflict")
      );
    }

    const historyEntry = newStatusHistoryEntry({
      from: input.expectedStatus,
      to: input.status,
      changedAt: now,
      changedBy: ctx.userId,
      changedByName: ctx.user.name,
      note,
      candidateNotified: notify,
    });

    // History first. The two writes cannot be one operation any more, and of the two possible
    // half-states this is the recoverable one: an entry whose status change did not land reads
    // as an attempt and the admin's retry still matches expectedStatus, whereas a status change
    // with no entry would be a permanent gap in an append-only trail.
    await insertStatusHistory(id, [historyEntry]);
    if (!(await patchApplication(id, { status: input.status, statusChangedAt: now, updatedAt: now }))) {
      throw explainMiss(
        await findApplicationById(id, { maxAgeMs: 0 }),
        "Restore the application before changing its status.",
        conflict("This application was updated by someone else. Refresh to see the latest status.", "status_conflict")
      );
    }
    return { entry: historyEntry, record: current };
  });

  const reference = applicationReference(id);
  let candidateNotified = entry.candidateNotified;

  if (notify) {
    const status = input.status;
    const queued = await queueEmails(
      () => [
        {
          to: record.email,
          replyTo: hrNotificationRecipients()[0] ?? null,
          template: "application_status_update",
          content: applicationStatusEmail({
            name: record.name,
            jobTitle: record.jobTitle,
            reference,
            status,
            message: candidateMessage,
          }),
          related: { entityType: "application", entityId: id },
        },
      ],
      { entityType: "application", entityId: id }
    );
    if (!queued) {
      // Keep the history truthful: the candidate was not notified.
      candidateNotified = false;
      try {
        await setStatusHistoryNotified(entry.id, false);
      } catch (err) {
        logger.error("application.notify_flag_reset_failed", { applicationId: id, err });
      }
    }
  }

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "application.status_change",
    entityType: "application",
    entityId: id,
    summary: `Changed ${reference} from ${APPLICATION_STATUS_LABELS[input.expectedStatus]} to ${APPLICATION_STATUS_LABELS[input.status]}`,
    meta: { from: input.expectedStatus, to: input.status, candidateNotified },
    ip: ctx.ip,
  });

  return detailOf(id);
}

export async function addApplicationNote(id: string, body: string, ctx: AdminContext): Promise<ApplicationDetail> {
  if (!isRecordId(id)) throw applicationNotFound();
  const text = validateNoteBody(body);
  ensureStoreReady();
  const now = new Date();
  const note = newNote(text, authorFromContext(ctx), now);

  await withLock(applicationLockKey(id), async () => {
    const current = await findApplicationById(id, { maxAgeMs: 0, refreshOnMiss: true });
    if (!current || current.archivedAt) {
      throw explainMiss(
        current,
        "Restore the application before adding notes.",
        conflict("The application changed while saving. Please try again.")
      );
    }
    // Notes are append-only; there is no edit and no delete.
    await insertNote({ type: "application", id }, note);
    if (!(await patchApplication(id, { updatedAt: now }))) {
      throw explainMiss(
        await findApplicationById(id, { maxAgeMs: 0 }),
        "Restore the application before adding notes.",
        conflict("The application changed while saving. Please try again.")
      );
    }
  });

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "application.note_add",
    entityType: "application",
    entityId: id,
    summary: `Added a note to ${applicationReference(id)}`,
    // The note body is never audited.
    meta: { noteId: note.id },
    ip: ctx.ip,
  });
  return detailOf(id);
}

export async function setApplicationArchived(
  id: string,
  archived: boolean,
  reason: string,
  ctx: AdminContext
): Promise<ApplicationDetail> {
  if (!isRecordId(id)) throw applicationNotFound();
  const archiveReason = archived ? validateArchiveReason(reason) : "";
  ensureStoreReady();
  const now = new Date();

  const changed = await withLock(applicationLockKey(id), async () => {
    const current = await findApplicationById(id, { maxAgeMs: 0, refreshOnMiss: true });
    if (!current) throw applicationNotFound();
    // Already in the requested state (e.g. a retried request): nothing changes, nothing is audited.
    if (archived === Boolean(current.archivedAt)) return false;

    const patch = archived
      ? { archivedAt: now, archivedBy: ctx.userId, archivedByName: ctx.user.name, archiveReason, updatedAt: now }
      : { archivedAt: null, archivedBy: null, archivedByName: null, archiveReason: "", updatedAt: now };
    if (!(await patchApplication(id, patch))) throw applicationNotFound();
    return true;
  });

  const record = await loadApplication(id);
  if (!changed) return buildDetail(record);

  const reference = applicationReference(record.id);
  await recordAudit({
    actor: toAuditActor(ctx),
    action: archived ? "application.archive" : "application.restore",
    entityType: "application",
    entityId: record.id,
    summary: archived ? `Archived ${reference} (${record.jobTitle})` : `Restored ${reference} (${record.jobTitle})`,
    meta: archived ? { hasReason: archiveReason.length > 0 } : {},
    ip: ctx.ip,
  });
  return buildDetail(record);
}

// ── Admin: move to talent pool ───────────────────────────────────────────────

type MoveContext = {
  app: ApplicationRecord;
  reference: string;
  tags: string[];
  note: string;
  author: { userId: string; name: string };
  now: Date;
};

const talentArchived = () =>
  conflict("This candidate's talent profile is archived. Restore it first.", "talent_archived");

// Links the application to the existing profile with the same email. Returns null when no
// profile exists. Converges on retry: the note and the "linked" activity are only written once
// the link itself has been made, and tags are merged rather than replaced.
//
// Callers hold the talent-email lock, so the read below and the write that follows it cannot be
// interleaved by another move on this instance; the read is taken fresh so a profile created on
// another instance a moment ago is still seen.
async function linkExistingTalent(move: MoveContext): Promise<string | null> {
  const { app } = move;
  const entry = await findTalentByEmail(app.emailNormalized, { maxAgeMs: 0, refreshOnMiss: true });
  if (!entry) return null;
  if (entry.archivedAt) throw talentArchived();

  const currentTags = entry.tags ?? [];
  const newTags = move.tags.filter((tag) => !currentTags.includes(tag));
  if (currentTags.length + newTags.length > FIELD_LIMITS.tags) {
    const message = `This talent profile already has ${currentTags.length} tags. Profiles can have at most ${FIELD_LIMITS.tags}.`;
    throw badRequest(message, { tags: message });
  }
  const linked = (entry.applications ?? []).includes(app.id);
  if (linked && newTags.length === 0) return entry.id;

  const patch: Partial<TalentPoolRecord> = { updatedAt: move.now };
  if (!linked) patch.applications = [...(entry.applications ?? []), app.id];
  if (newTags.length > 0) patch.tags = [...currentTags, ...newTags];

  // The link is written first, so a failure afterwards can never produce a second copy of the
  // note or of the timeline entry: a retry re-reads, sees the link, and stops.
  if (!(await patchTalent(entry.id, patch))) {
    // The row went away between the read and the write.
    const again = await findTalentById(entry.id, { maxAgeMs: 0 });
    if (!again) return null;
    if (again.archivedAt) throw talentArchived();
    if ((again.applications ?? []).includes(app.id)) return again.id;
    throw conflict("The talent profile was updated by someone else. Please try again.", "talent_conflict");
  }

  const activity = [
    ...(linked
      ? []
      : [newActivityEntry("application_linked", `Linked application ${move.reference} (${app.jobTitle})`, move.author, move.now)]),
    ...(newTags.length > 0 ? [newActivityEntry("tags_changed", `Tags added: ${newTags.join(", ")}`, move.author, move.now)] : []),
  ];
  try {
    if (activity.length > 0) await insertActivity(entry.id, activity);
    if (!linked && move.note) await insertNote({ type: "talent", id: entry.id }, newNote(move.note, move.author, move.now));
  } catch (err) {
    // The profile is linked, which is what the caller asked for and what the response reports.
    logger.error("talent.link_subrecords_failed", { talentId: entry.id, applicationId: app.id, err });
  }
  return entry.id;
}

// Creates a profile from the application. Returns null when a profile with the same email was
// created concurrently on another instance (the caller then links to that one instead).
async function createTalentFromApplication(move: MoveContext): Promise<string | null> {
  const { app } = move;
  const entryId = newId(move.now);
  const reference = talentReference(entryId);

  let area = (app.department ?? "").trim();
  if (!area) {
    const job = await findJobById(app.job);
    area = (job?.department ?? "").trim() || app.jobTitle;
  }
  area = area.slice(0, FIELD_LIMITS.areaOfInterest);

  const documents =
    (app.documents ?? []).length > 0
      ? await copyDocuments(app.documents, {
          ownerType: "talent",
          ownerId: entryId,
          reference,
          candidateName: app.name,
        })
      : [];

  const record: TalentPoolRecord = {
    id: entryId,
    name: app.name,
    email: app.email,
    emailNormalized: app.emailNormalized,
    phone: app.phone,
    areaOfInterest: area,
    candidateNotes: "",
    tags: move.tags,
    notes: [],
    documents,
    consentGiven: app.consentGiven,
    consentAt: app.consentAt,
    source: "application",
    sourceApplication: app.id,
    applications: [app.id],
    createdBy: move.author.userId,
    activity: [],
    archivedAt: null,
    archivedBy: null,
    archivedByName: null,
    archiveReason: "",
    supersededBy: null,
    createdAt: move.now,
    updatedAt: move.now,
  };

  let row: TableRecord | null = null;
  try {
    row = await insertTalent(record);
  } catch (err) {
    const saved = await settleFailedInsert(err, documents, () => findTalentById(entryId, { maxAgeMs: 0 }), {
      entityType: "talent",
      entityId: entryId,
    });
    if (!saved) throw err;
    row = await findRecord("TalentPool", (values) => String(values.id ?? "") === entryId, { maxAgeMs: 0 });
  }

  if (row) {
    // One profile per person: the unique index on emailNormalized is replaced by the same
    // earliest-row-wins reconciliation the applications tab uses.
    const { isDuplicate, winner } = await reconcileDuplicate("TalentPool", row, (values) =>
      String(values.emailNormalized ?? "").trim().toLowerCase() || null
    );
    if (isDuplicate) {
      await supersedeTalent(entryId, String(winner.values.id ?? ""));
      await releaseClaimedDocuments(documents);
      return null;
    }
  }

  try {
    await insertDocuments({ type: "talent", id: entryId }, documents);
    if (move.note) await insertNote({ type: "talent", id: entryId }, newNote(move.note, move.author, move.now));
    await insertActivity(entryId, [
      newActivityEntry("created", `Added from application ${move.reference} (${app.jobTitle})`, move.author, move.now),
    ]);
  } catch (err) {
    logger.error("talent.create_subrecords_failed", { talentId: entryId, documentCount: documents.length, err });
  }
  return entryId;
}

export async function moveApplicationToTalentPool(
  id: string,
  payload: { tags: string[]; note: string },
  ctx: AdminContext
): Promise<MoveToTalentPoolResponse> {
  const tags = validateTagList(payload.tags);
  const note = validateOptionalHrNote(payload.note);
  const app = await loadApplication(id);
  if (app.archivedAt) throw conflict("Restore the application before moving it to the talent pool.", "archived");

  const move: MoveContext = {
    app,
    reference: applicationReference(app.id),
    tags,
    note,
    author: authorFromContext(ctx),
    now: new Date(),
  };

  // Everything that decides which profile this candidate belongs to happens under one lock on
  // their email, so two simultaneous moves produce exactly one profile.
  const outcome = await withLock(talentLockKey(app.emailNormalized), async () => {
    const linkedId = await linkExistingTalent(move);
    if (linkedId) return { entryId: linkedId, created: false };
    const createdId = await createTalentFromApplication(move);
    if (createdId) return { entryId: createdId, created: true };
    // A profile with this email was created elsewhere while this one was being written; link to it.
    return { entryId: await linkExistingTalent(move), created: false };
  });

  const entryId = outcome.entryId;
  if (!entryId) {
    throw conflict("The talent pool changed while saving. Please try again.", "talent_conflict");
  }

  // This is what makes ApplicationListItem.inTalentPool true and fills the CSV's "In Talent
  // Pool" column.
  if (app.talentPoolEntry !== entryId) {
    await withLock(applicationLockKey(app.id), async () => {
      await patchApplication(app.id, { talentPoolEntry: entryId, updatedAt: new Date() });
    });
  }

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "application.move_to_talent_pool",
    entityType: "application",
    entityId: app.id,
    summary: outcome.created
      ? `Moved ${move.reference} to the talent pool (new profile)`
      : `Linked ${move.reference} to an existing talent profile`,
    meta: { talentPoolEntryId: entryId, created: outcome.created, tagCount: tags.length },
    ip: ctx.ip,
  });

  return { talentPoolEntryId: entryId, created: outcome.created };
}

// ── Erasure ──────────────────────────────────────────────────────────────────

export type PurgeOptions = {
  actor: AuditActor | null;
  ip: string | null;
  // HR erasure requires the record to be archived first; the retention job does not.
  requireArchived: boolean;
  action: "application.purge" | "retention.purge";
};

// Removes the candidate's details from every talent profile that still points at this
// application: the link itself, and the "created from" reference on a profile that was made from
// it. Each profile is edited under its own lock because `applications` is a list in one cell, so
// dropping one id is a read-modify-write.
async function unlinkTalentProfiles(applicationId: string, reference: string, now: Date): Promise<void> {
  const linked = await findTalentReferencing(applicationId);
  for (const profile of linked) {
    await withLock(talentLockKey(profile.id), async () => {
      const current = await findTalentById(profile.id, { maxAgeMs: 0 });
      if (!current) return;

      const wasLinked = (current.applications ?? []).includes(applicationId);
      const patch: Partial<TalentPoolRecord> = { updatedAt: now };
      if (wasLinked) patch.applications = (current.applications ?? []).filter((item) => item !== applicationId);
      if (current.sourceApplication === applicationId) patch.sourceApplication = null;
      if (!wasLinked && patch.sourceApplication === undefined) return;

      await patchTalent(profile.id, patch);
      if (wasLinked) {
        await insertActivity(profile.id, [
          newActivityEntry("application_deleted", `Application ${reference} was permanently deleted`, null, now),
        ]);
      }
    });
  }
}

// Deletes the Drive files first (keeping the record if Drive fails, so the purge can be
// retried), then unlinks talent profiles, removes queued/sent emails that contain the
// candidate's details, and finally the record's own rows.
export async function purgeApplicationRecord(id: string, options: PurgeOptions): Promise<void> {
  ensureStoreReady();
  const app = await findApplicationById(id, { maxAgeMs: 0, refreshOnMiss: true });
  if (!app) throw applicationNotFound();
  if (options.requireArchived && !app.archivedAt) {
    throw conflict("Archive the application before deleting it permanently.", "not_archived");
  }

  const entityId = app.id;
  const reference = applicationReference(entityId);
  await loadTables(SUB_RECORD_TABLES, { maxAgeMs: 0 });
  const [full] = await hydrateApplications([app]);
  const documents = full?.documents ?? [];

  const deletable = await documentsSafeToDelete(documents, { type: "application", id: entityId });
  if (deletable.length > 0) {
    const { failedIds } = await deleteDocuments(deletable);
    if (failedIds.length > 0) {
      logger.error("application.purge_storage_failed", { applicationId: entityId, failedCount: failedIds.length });
      throw new AppError(
        502,
        "storage_delete_failed",
        "Some files could not be deleted from storage. The record was kept; please try again later."
      );
    }
  }

  const now = new Date();
  await unlinkTalentProfiles(entityId, reference, now);

  // Row deletion renumbers a tab, so the rows are read and removed under the shared sweep lock:
  // nothing else may be reading row numbers for these tabs while this runs.
  const deleted = await withLock(ROW_SWEEP_LOCK, async () => {
    const owned = new Set([entityId]);

    const emailRows = await emailRowsRelatedTo("application", owned);
    if (emailRows.length > 0) await deleteRows("EmailOutbox", emailRows);

    // Sub-records carry the note bodies and the document index, so they go before the row that
    // points at them: a half-finished purge must never leave the candidate's data behind.
    const subRecords = await subRecordRowsFor("application", owned);
    if (subRecords.Documents.length > 0) await deleteRows("Documents", subRecords.Documents);
    if (subRecords.Notes.length > 0) await deleteRows("Notes", subRecords.Notes);
    if (subRecords.StatusHistory.length > 0) await deleteRows("StatusHistory", subRecords.StatusHistory);

    const rows = await applicationRowNumbers(owned);
    return rows.length > 0 ? deleteRows("Applications", rows) : 0;
  });

  // A concurrent purge of the same record got there first; it writes the one audit entry.
  if (deleted === 0) throw applicationNotFound();

  await recordAudit({
    actor: options.actor,
    action: options.action,
    entityType: "application",
    entityId,
    summary:
      options.action === "retention.purge"
        ? `Retention period ended: permanently deleted application ${reference} (${app.jobSlug})`
        : `Permanently deleted application ${reference} (${app.jobSlug})`,
    meta: {
      reference,
      jobSlug: app.jobSlug,
      documentCount: documents.length,
      keptSharedDocuments: documents.length - deletable.length,
      createdAt: toIso(app.createdAt),
    },
    ip: options.ip,
  });
}

export async function purgeApplication(id: string, ctx: AdminContext): Promise<void> {
  if (!isRecordId(id)) throw applicationNotFound();
  await purgeApplicationRecord(id, {
    actor: toAuditActor(ctx),
    ip: ctx.ip,
    requireArchived: true,
    action: "application.purge",
  });
}

// ── CSV export ───────────────────────────────────────────────────────────────

type ExportRow = Pick<
  ApplicationRecord,
  | "id"
  | "name"
  | "email"
  | "phone"
  | "jobSlug"
  | "jobTitle"
  | "department"
  | "status"
  | "createdAt"
  | "statusChangedAt"
  | "linkedIn"
  | "portfolio"
  | "archivedAt"
  | "talentPoolEntry"
>;

const CSV_HEADER = [
  "Reference",
  "Name",
  "Email",
  "Phone",
  "Job ID",
  "Job Title",
  "Department",
  "Status",
  "Submitted",
  "Status Changed",
  "LinkedIn",
  "Portfolio",
  "Archived",
  "In Talent Pool",
];

export async function exportApplicationsCsv(
  filters: ApplicationFilters,
  ctx: AdminContext
): Promise<{ csv: string; rowCount: number }> {
  ensureStoreReady();
  const scope = await resolveJobScope(filters);
  let rows: ExportRow[] = [];
  if (scope) {
    const matched = (await listAllApplications()).filter(applicationMatcher(filters, scope.jobId));
    matched.sort(applicationComparator(filters.sort));
    rows = matched.slice(0, EXPORT_MAX_ROWS);
  }

  const lines = [CSV_HEADER, ...rows.map(toCsvRow)].map((cells) => cells.map(escapeCsvCell).join(","));
  const crlf = String.fromCharCode(13, 10);
  // A byte-order mark makes Excel read the file as UTF-8 (Sinhala and Tamil names).
  const csv = String.fromCharCode(0xfeff) + lines.join(crlf) + crlf;

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "application.export",
    entityType: "application",
    entityId: "export",
    summary: `Exported ${rows.length} application${rows.length === 1 ? "" : "s"} to CSV`,
    meta: { filters: describeFilters(filters), rowCount: rows.length, truncated: rows.length >= EXPORT_MAX_ROWS },
    ip: ctx.ip,
  });

  return { csv, rowCount: rows.length };
}

function toCsvRow(row: ExportRow): string[] {
  return [
    applicationReference(row.id),
    row.name,
    row.email,
    row.phone,
    row.jobSlug,
    row.jobTitle,
    row.department ?? "",
    APPLICATION_STATUS_LABELS[row.status] ?? row.status,
    row.createdAt ? new Date(row.createdAt).toISOString() : "",
    row.statusChangedAt ? new Date(row.statusChangedAt).toISOString() : "",
    row.linkedIn ?? "",
    row.portfolio ?? "",
    row.archivedAt ? "Yes" : "No",
    row.talentPoolEntry ? "Yes" : "No",
  ];
}
