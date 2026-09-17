// Job applications: public submission, HR review workflow (status, notes, archive), moving a
// candidate into the talent pool, erasure and CSV export. Server-only.

import { Types, type QueryFilter } from "mongoose";
import { APPLICATION_STATUS_LABELS, FIELD_LIMITS, type ApplicationStatus } from "@/lib/careers/constants";
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
import { toAuditActor, type AdminContext } from "@/lib/auth/session";
import { recordAudit } from "@/lib/careers/server/audit";
import { isObjectIdString, toObjectId } from "@/lib/careers/server/ids";
import { getOpenJobDocument, openJobFilter } from "@/lib/careers/server/jobs";
import {
  APPLICATION_LIST_PROJECTION,
  LIST_MAX_TIME_MS,
  applicationReference,
  authorFromContext,
  documentsSafeToDelete,
  hrRecipientsFor,
  newActivityEntry,
  newNoteEntry,
  parseStatusChangePayload,
  queueEmails,
  searchClauses,
  settleFailedInsert,
  toApplicationDetail,
  toApplicationListItem,
  toPaginated,
  validateArchiveReason,
  validateNoteBody,
  validateOptionalHrNote,
  validateTagList,
  type ApplicationListRow,
} from "@/lib/careers/server/mappers";
import { claimUploads, copyDocuments, deleteDocuments } from "@/lib/careers/server/uploads";
import { hrNotificationRecipients, listEmailsFor } from "@/lib/email/outbox";
import { applicationReceivedEmail, applicationStatusEmail, hrNewApplicationEmail } from "@/lib/email/templates";
import { AppError, badRequest, conflict, notFound } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import { connectToDatabase, isDuplicateKeyError } from "@/lib/mongodb";
import { ApplicationModel, type ApplicationDoc } from "@/models/application";
import type { AuditActor } from "@/models/audit-log";
import { EmailOutboxModel } from "@/models/email-outbox";
import { JobModel } from "@/models/job";
import { TalentPoolEntryModel, type TalentActivityDoc, type TalentPoolEntryDoc } from "@/models/talent-pool-entry";
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
const EXPORT_MAX_TIME_MS = 15_000;
const APPLICATION_REFERENCE_QUERY = /^(?:APP-)?([0-9a-f]{8})$/i;

const SORTS: Record<NonNullable<ApplicationFilters["sort"]>, Record<string, 1 | -1>> = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  status_changed: { statusChangedAt: -1, _id: -1 },
};

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
async function resolveJobScope(filters: ApplicationFilters): Promise<{ jobId: Types.ObjectId | null } | null> {
  if (!filters.jobSlug) return { jobId: null };
  if (!isValidJobSlug(filters.jobSlug)) return null;
  const job = await JobModel.findOne({ slug: filters.jobSlug })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId }>();
  return job ? { jobId: job._id } : null;
}

// Built fresh for each query: Mongoose casts filters in place.
function buildApplicationMatch(filters: ApplicationFilters, jobId: Types.ObjectId | null): Record<string, unknown> {
  const match: Record<string, unknown> = {};
  const archived = filters.archived ?? "exclude";
  if (archived === "exclude") match.archivedAt = null;
  else if (archived === "only") match.archivedAt = { $ne: null };
  if (filters.status) match.status = filters.status;
  if (jobId) match.job = jobId;
  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = filters.from;
    if (filters.to) range.$lte = filters.to;
    match.createdAt = range;
  }
  if (filters.q) match.$or = searchClauses(filters.q, ["name", "email", "jobTitle"], APPLICATION_REFERENCE_QUERY);
  return match;
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

async function loadApplication(id: string): Promise<ApplicationDoc> {
  if (!isObjectIdString(id)) throw applicationNotFound();
  await connectToDatabase();
  const doc = await ApplicationModel.findById(toObjectId(id)).lean<ApplicationDoc>();
  if (!doc) throw applicationNotFound();
  return doc;
}

async function buildDetail(doc: ApplicationDoc): Promise<ApplicationDetail> {
  const [emails, openJob] = await Promise.all([
    listEmailsFor("application", String(doc._id)),
    // "Still exists" from the admin's point of view: the posting is still publicly available,
    // so a link to /careers/<slug> works.
    JobModel.exists({ ...openJobFilter(), _id: doc.job }),
  ]);
  return toApplicationDetail(doc, { emails, jobStillExists: Boolean(openJob) });
}

// Explains why a conditional update matched nothing.
async function explainMiss(id: Types.ObjectId, archivedMessage: string, otherwise: AppError): Promise<AppError> {
  const current = await ApplicationModel.findById(id)
    .select({ archivedAt: 1 })
    .lean<Pick<ApplicationDoc, "_id" | "archivedAt">>();
  if (!current) return applicationNotFound();
  if (current.archivedAt) return conflict(archivedMessage, "archived");
  return otherwise;
}

// ── Public submission ────────────────────────────────────────────────────────

export async function submitApplication(input: ApplicationSubmission, meta: { ip: string }): Promise<{ id: string; reference: string }> {
  await connectToDatabase();
  const job = await getOpenJobDocument(input.jobSlug);
  if (!job) throw notFound("This role is no longer accepting applications.", "job_not_found");

  const emailNormalized = normalizeEmail(input.email);
  // Checked before claiming uploads so a duplicate never copies files; the unique index still
  // decides races below.
  if (await ApplicationModel.exists({ job: job._id, emailNormalized })) throw duplicateApplication();

  const id = new Types.ObjectId();
  const entityId = String(id);
  const reference = applicationReference(id);
  const documents = await claimUploads(
    { cv: input.uploads.cv, supporting: input.uploads.supporting },
    { purposes: ["application"], destinationPrefix: `applications/${entityId}`, requireCv: true }
  );

  const now = new Date();
  try {
    await ApplicationModel.create({
      _id: id,
      job: job._id,
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
      statusHistory: [
        {
          _id: new Types.ObjectId(),
          from: null,
          to: "submitted",
          changedAt: now,
          changedBy: null,
          changedByName: null,
          note: "Application submitted via website",
          candidateNotified: false,
        },
      ],
      notes: [],
      source: "website",
      talentPoolEntry: null,
      legacyIds: [],
    });
  } catch (err) {
    const saved = await settleFailedInsert(err, documents, () => ApplicationModel.exists({ _id: id }), {
      entityType: "application",
      entityId,
    });
    if (!saved) {
      if (isDuplicateKeyError(err, "job_email_unique")) throw duplicateApplication();
      throw err;
    }
  }

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
  await connectToDatabase();
  const scope = await resolveJobScope(filters);
  if (!scope) return toPaginated([], 0, page);

  const [rows, total] = await Promise.all([
    ApplicationModel.aggregate<ApplicationListRow>([
      { $match: buildApplicationMatch(filters, scope.jobId) },
      { $sort: SORTS[filters.sort ?? "newest"] },
      { $skip: page.skip },
      { $limit: page.limit },
      { $project: APPLICATION_LIST_PROJECTION },
    ]).option({ maxTimeMS: LIST_MAX_TIME_MS }),
    ApplicationModel.countDocuments(buildApplicationMatch(filters, scope.jobId) as QueryFilter<ApplicationDoc>).maxTimeMS(
      LIST_MAX_TIME_MS
    ),
  ]);
  return toPaginated(rows.map(toApplicationListItem), total, page);
}

export async function getApplicationDetail(id: string, ctx: AdminContext): Promise<ApplicationDetail> {
  const doc = await loadApplication(id);
  const detail = await buildDetail(doc);
  await recordAudit({
    actor: toAuditActor(ctx),
    action: "application.view",
    entityType: "application",
    entityId: String(doc._id),
    summary: `Viewed application ${detail.reference} (${doc.jobTitle})`,
    meta: { jobSlug: doc.jobSlug },
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
  if (!isObjectIdString(id)) throw applicationNotFound();
  // Idempotent normalization; the route has usually parsed the raw body already.
  const input = parseStatusChangePayload(payload);
  if (input.status === input.expectedStatus) {
    throw badRequest("The application already has this status.", { status: "Choose a different status." }, "status_unchanged");
  }
  const { note, candidateMessage } = input;

  await connectToDatabase();
  const objectId = toObjectId(id);
  const now = new Date();
  // Candidates are only emailed about decisions, never about the initial "submitted" state.
  const notify = input.notifyCandidate === true && input.status !== "submitted";
  const entryId = new Types.ObjectId();

  const updated = await ApplicationModel.findOneAndUpdate(
    { _id: objectId, status: input.expectedStatus, archivedAt: null },
    {
      $set: { status: input.status, statusChangedAt: now },
      $push: {
        statusHistory: {
          _id: entryId,
          from: input.expectedStatus,
          to: input.status,
          changedAt: now,
          changedBy: ctx.userId,
          changedByName: ctx.user.name,
          note,
          candidateNotified: notify,
        },
      },
    },
    { returnDocument: "after", runValidators: true }
  ).lean<ApplicationDoc>();

  if (!updated) {
    throw await explainMiss(
      objectId,
      "Restore the application before changing its status.",
      conflict("This application was updated by someone else. Refresh to see the latest status.", "status_conflict")
    );
  }

  const reference = applicationReference(updated._id);
  const entityId = String(updated._id);

  if (notify) {
    const status = input.status;
    const queued = await queueEmails(
      () => [
        {
          to: updated.email,
          replyTo: hrNotificationRecipients()[0] ?? null,
          template: "application_status_update",
          content: applicationStatusEmail({
            name: updated.name,
            jobTitle: updated.jobTitle,
            reference,
            status,
            message: candidateMessage,
          }),
          related: { entityType: "application", entityId },
        },
      ],
      { entityType: "application", entityId }
    );
    if (!queued) {
      // Keep the history truthful: the candidate was not notified.
      const entry = updated.statusHistory.find((item) => item._id.equals(entryId));
      if (entry) entry.candidateNotified = false;
      try {
        await ApplicationModel.updateOne(
          { _id: updated._id, "statusHistory._id": entryId },
          { $set: { "statusHistory.$.candidateNotified": false } }
        );
      } catch (err) {
        logger.error("application.notify_flag_reset_failed", { applicationId: entityId, err });
      }
    }
  }

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "application.status_change",
    entityType: "application",
    entityId,
    summary: `Changed ${reference} from ${APPLICATION_STATUS_LABELS[input.expectedStatus]} to ${APPLICATION_STATUS_LABELS[input.status]}`,
    meta: {
      from: input.expectedStatus,
      to: input.status,
      candidateNotified: updated.statusHistory.find((item) => item._id.equals(entryId))?.candidateNotified ?? false,
    },
    ip: ctx.ip,
  });

  return buildDetail(updated);
}

export async function addApplicationNote(id: string, body: string, ctx: AdminContext): Promise<ApplicationDetail> {
  if (!isObjectIdString(id)) throw applicationNotFound();
  const text = validateNoteBody(body);
  await connectToDatabase();
  const objectId = toObjectId(id);
  const note = newNoteEntry(text, authorFromContext(ctx), new Date());

  const updated = await ApplicationModel.findOneAndUpdate(
    { _id: objectId, archivedAt: null },
    { $push: { notes: note } },
    { returnDocument: "after", runValidators: true }
  ).lean<ApplicationDoc>();
  if (!updated) {
    throw await explainMiss(
      objectId,
      "Restore the application before adding notes.",
      conflict("The application changed while saving. Please try again.")
    );
  }

  const reference = applicationReference(updated._id);
  await recordAudit({
    actor: toAuditActor(ctx),
    action: "application.note_add",
    entityType: "application",
    entityId: String(updated._id),
    summary: `Added a note to ${reference}`,
    meta: { noteId: String(note._id) },
    ip: ctx.ip,
  });
  return buildDetail(updated);
}

export async function setApplicationArchived(
  id: string,
  archived: boolean,
  reason: string,
  ctx: AdminContext
): Promise<ApplicationDetail> {
  if (!isObjectIdString(id)) throw applicationNotFound();
  const archiveReason = archived ? validateArchiveReason(reason) : "";
  await connectToDatabase();
  const objectId = toObjectId(id);
  const now = new Date();

  const updated = archived
    ? await ApplicationModel.findOneAndUpdate(
        { _id: objectId, archivedAt: null },
        { $set: { archivedAt: now, archivedBy: ctx.userId, archivedByName: ctx.user.name, archiveReason } },
        { returnDocument: "after", runValidators: true }
      ).lean<ApplicationDoc>()
    : await ApplicationModel.findOneAndUpdate(
        { _id: objectId, archivedAt: { $ne: null } },
        { $set: { archivedAt: null, archivedBy: null, archivedByName: null, archiveReason: "" } },
        { returnDocument: "after" }
      ).lean<ApplicationDoc>();

  // Already in the requested state (e.g. a retried request): nothing changes, nothing is audited.
  if (!updated) return buildDetail(await loadApplication(id));

  const reference = applicationReference(updated._id);
  await recordAudit({
    actor: toAuditActor(ctx),
    action: archived ? "application.archive" : "application.restore",
    entityType: "application",
    entityId: String(updated._id),
    summary: archived ? `Archived ${reference} (${updated.jobTitle})` : `Restored ${reference} (${updated.jobTitle})`,
    meta: archived ? { hasReason: archiveReason.length > 0 } : {},
    ip: ctx.ip,
  });
  return buildDetail(updated);
}

// ── Admin: move to talent pool ───────────────────────────────────────────────

type MoveContext = {
  app: ApplicationDoc;
  reference: string;
  tags: string[];
  note: string;
  author: { userId: Types.ObjectId; name: string };
  now: Date;
};

const talentArchived = () =>
  conflict("This candidate's talent profile is archived. Restore it first.", "talent_archived");

// Links the application to the existing profile with the same email. Returns null when no
// profile exists. Converges on retry: the note and "linked" activity are only added together
// with the link itself, and tags are merged with $addToSet.
async function linkExistingTalent(move: MoveContext): Promise<Types.ObjectId | null> {
  const { app } = move;
  const entry = await TalentPoolEntryModel.findOne({ emailNormalized: app.emailNormalized })
    .select({ archivedAt: 1, tags: 1, applications: 1 })
    .lean<Pick<TalentPoolEntryDoc, "_id" | "archivedAt" | "tags" | "applications">>();
  if (!entry) return null;
  if (entry.archivedAt) throw talentArchived();

  const currentTags = entry.tags ?? [];
  const newTags = move.tags.filter((tag) => !currentTags.includes(tag));
  if (currentTags.length + newTags.length > FIELD_LIMITS.tags) {
    const message = `This talent profile already has ${currentTags.length} tags. Profiles can have at most ${FIELD_LIMITS.tags}.`;
    throw badRequest(message, { tags: message });
  }
  const linked = (entry.applications ?? []).some((appId) => appId.equals(app._id));
  if (linked && newTags.length === 0) return entry._id;

  const activity: TalentActivityDoc[] = [];
  if (!linked) {
    activity.push(newActivityEntry("application_linked", `Linked application ${move.reference} (${app.jobTitle})`, move.author, move.now));
  }
  if (newTags.length > 0) {
    activity.push(newActivityEntry("tags_changed", `Tags added: ${newTags.join(", ")}`, move.author, move.now));
  }

  const result = await TalentPoolEntryModel.updateOne(
    linked ? { _id: entry._id, archivedAt: null } : { _id: entry._id, archivedAt: null, applications: { $ne: app._id } },
    {
      $addToSet: { applications: app._id, tags: { $each: newTags } },
      $push: {
        activity: { $each: activity },
        ...(!linked && move.note ? { notes: newNoteEntry(move.note, move.author, move.now) } : {}),
      },
    },
    { runValidators: true }
  );
  if (result.matchedCount > 0) return entry._id;

  // Changed between the read and the update: archived, purged, or linked by a concurrent request.
  const again = await TalentPoolEntryModel.findById(entry._id)
    .select({ archivedAt: 1, applications: 1 })
    .lean<Pick<TalentPoolEntryDoc, "_id" | "archivedAt" | "applications">>();
  if (!again) return null;
  if (again.archivedAt) throw talentArchived();
  if ((again.applications ?? []).some((appId) => appId.equals(app._id))) return again._id;
  throw conflict("The talent profile was updated by someone else. Please try again.", "talent_conflict");
}

// Creates a profile from the application. Returns null when a profile with the same email was
// created concurrently (the caller then links to it instead).
async function createTalentFromApplication(move: MoveContext): Promise<Types.ObjectId | null> {
  const { app } = move;
  const entryId = new Types.ObjectId();

  let area = (app.department ?? "").trim();
  if (!area) {
    const job = await JobModel.findById(app.job).select({ department: 1 }).lean<{ department?: string }>();
    area = (job?.department ?? "").trim() || app.jobTitle;
  }
  area = area.slice(0, FIELD_LIMITS.areaOfInterest);

  const documents = (app.documents ?? []).length > 0 ? await copyDocuments(app.documents, `talent-pool/${entryId}`) : [];
  try {
    await TalentPoolEntryModel.create({
      _id: entryId,
      name: app.name,
      email: app.email,
      emailNormalized: app.emailNormalized,
      phone: app.phone,
      areaOfInterest: area,
      candidateNotes: "",
      tags: move.tags,
      notes: move.note ? [newNoteEntry(move.note, move.author, move.now)] : [],
      documents,
      consentGiven: app.consentGiven,
      consentAt: app.consentAt,
      source: "application",
      sourceApplication: app._id,
      applications: [app._id],
      createdBy: move.author.userId,
      activity: [
        newActivityEntry("created", `Added from application ${move.reference} (${app.jobTitle})`, move.author, move.now),
      ],
      legacyIds: [],
    });
    return entryId;
  } catch (err) {
    const saved = await settleFailedInsert(err, documents, () => TalentPoolEntryModel.exists({ _id: entryId }), {
      entityType: "talent",
      entityId: String(entryId),
    });
    if (saved) return entryId;
    if (isDuplicateKeyError(err, "email_unique")) return null;
    throw err;
  }
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
    reference: applicationReference(app._id),
    tags,
    note,
    author: authorFromContext(ctx),
    now: new Date(),
  };

  let created = false;
  let entryId = await linkExistingTalent(move);
  if (!entryId) {
    entryId = await createTalentFromApplication(move);
    if (entryId) created = true;
    else entryId = await linkExistingTalent(move);
  }
  if (!entryId) {
    throw conflict("The talent pool changed while saving. Please try again.", "talent_conflict");
  }

  if (!app.talentPoolEntry || !app.talentPoolEntry.equals(entryId)) {
    await ApplicationModel.updateOne({ _id: app._id }, { $set: { talentPoolEntry: entryId } });
  }

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "application.move_to_talent_pool",
    entityType: "application",
    entityId: String(app._id),
    summary: created
      ? `Moved ${move.reference} to the talent pool (new profile)`
      : `Linked ${move.reference} to an existing talent profile`,
    meta: { talentPoolEntryId: String(entryId), created, tagCount: tags.length },
    ip: ctx.ip,
  });

  return { talentPoolEntryId: String(entryId), created };
}

// ── Erasure ──────────────────────────────────────────────────────────────────

export type PurgeOptions = {
  actor: AuditActor | null;
  ip: string | null;
  // HR erasure requires the record to be archived first; the retention job does not.
  requireArchived: boolean;
  action: "application.purge" | "retention.purge";
};

// Deletes stored documents first (keeping the record if storage fails, so the purge can be
// retried), then unlinks talent profiles, removes queued/sent emails that contain the
// candidate's details, and finally the record itself.
export async function purgeApplicationRecord(id: Types.ObjectId, options: PurgeOptions): Promise<void> {
  await connectToDatabase();
  const app = await ApplicationModel.findById(id)
    .select({ documents: 1, archivedAt: 1, jobSlug: 1, createdAt: 1 })
    .lean<Pick<ApplicationDoc, "_id" | "documents" | "archivedAt" | "jobSlug" | "createdAt">>();
  if (!app) throw applicationNotFound();
  if (options.requireArchived && !app.archivedAt) {
    throw conflict("Archive the application before deleting it permanently.", "not_archived");
  }

  const entityId = String(app._id);
  const reference = applicationReference(app._id);
  const documents = app.documents ?? [];
  const deletable = await documentsSafeToDelete(documents, { type: "application", id: app._id });
  if (deletable.length > 0) {
    const { failedKeys } = await deleteDocuments(deletable);
    if (failedKeys.length > 0) {
      logger.error("application.purge_storage_failed", { applicationId: entityId, failedCount: failedKeys.length });
      throw new AppError(
        502,
        "storage_delete_failed",
        "Some files could not be deleted from storage. The record was kept; please try again later."
      );
    }
  }

  const now = new Date();
  await TalentPoolEntryModel.updateMany(
    { applications: app._id },
    {
      $pull: { applications: app._id },
      $push: { activity: newActivityEntry("application_deleted", `Application ${reference} was permanently deleted`, null, now) },
    }
  );
  await TalentPoolEntryModel.updateMany({ sourceApplication: app._id }, { $set: { sourceApplication: null } });
  await EmailOutboxModel.deleteMany({ "related.entityType": "application", "related.entityId": entityId });
  const { deletedCount } = await ApplicationModel.deleteOne({ _id: app._id });
  // A concurrent purge of the same record got there first; it writes the one audit entry.
  if (deletedCount === 0) throw applicationNotFound();

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
      createdAt: app.createdAt ? new Date(app.createdAt).toISOString() : null,
    },
    ip: options.ip,
  });
}

export async function purgeApplication(id: string, ctx: AdminContext): Promise<void> {
  if (!isObjectIdString(id)) throw applicationNotFound();
  await purgeApplicationRecord(toObjectId(id), {
    actor: toAuditActor(ctx),
    ip: ctx.ip,
    requireArchived: true,
    action: "application.purge",
  });
}

// ── CSV export ───────────────────────────────────────────────────────────────

type ExportRow = Pick<
  ApplicationDoc,
  | "_id"
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
  await connectToDatabase();
  const scope = await resolveJobScope(filters);
  const rows = scope
    ? await ApplicationModel.find(buildApplicationMatch(filters, scope.jobId) as QueryFilter<ApplicationDoc>)
        .select({
          name: 1,
          email: 1,
          phone: 1,
          jobSlug: 1,
          jobTitle: 1,
          department: 1,
          status: 1,
          createdAt: 1,
          statusChangedAt: 1,
          linkedIn: 1,
          portfolio: 1,
          archivedAt: 1,
          talentPoolEntry: 1,
        })
        .sort(SORTS[filters.sort ?? "newest"])
        .limit(EXPORT_MAX_ROWS)
        .maxTimeMS(EXPORT_MAX_TIME_MS)
        .lean<ExportRow[]>()
    : [];

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
    applicationReference(row._id),
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
