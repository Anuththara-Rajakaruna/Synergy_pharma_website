// Talent pool: public profile submission, HR-managed profiles (create, edit, notes, tags,
// archive), considering a profile for a job, and erasure. Server-only.

import { Types, type QueryFilter } from "mongoose";
import { FIELD_LIMITS, TALENT_SOURCES, type TalentSource } from "@/lib/careers/constants";
import {
  isValidJobSlug,
  normalizeEmail,
  parseDateFilter,
  parseSearchQuery,
  type HrTalentInput,
  type Pagination,
  type TalentSubmission,
} from "@/lib/careers/validation";
import { toAuditActor, type AdminContext } from "@/lib/auth/session";
import { recordAudit } from "@/lib/careers/server/audit";
import { isObjectIdString, toObjectId } from "@/lib/careers/server/ids";
import { getJobDocumentBySlug } from "@/lib/careers/server/jobs";
import {
  LIST_MAX_TIME_MS,
  TALENT_LIST_PROJECTION,
  applicationReference,
  authorFromContext,
  documentsSafeToDelete,
  hrRecipientsFor,
  newActivityEntry,
  newNoteEntry,
  parseTalentUpdatePayload,
  queueEmails,
  searchClauses,
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
import { claimUploads, copyDocuments, deleteDocuments } from "@/lib/careers/server/uploads";
import { hrNewTalentEmail, talentReceivedEmail } from "@/lib/email/templates";
import { AppError, badRequest, conflict, notFound } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import { connectToDatabase, isDuplicateKeyError } from "@/lib/mongodb";
import { ApplicationModel, type ApplicationDoc } from "@/models/application";
import type { AuditActor } from "@/models/audit-log";
import { EmailOutboxModel } from "@/models/email-outbox";
import type { JobDoc } from "@/models/job";
import { TalentPoolEntryModel, type TalentActivityDoc, type TalentPoolEntryDoc } from "@/models/talent-pool-entry";
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

// Built fresh for each query: Mongoose casts filters in place.
function buildTalentMatch(filters: TalentFilters): Record<string, unknown> {
  const match: Record<string, unknown> = {};
  const archived = filters.archived ?? "exclude";
  if (archived === "exclude") match.archivedAt = null;
  else if (archived === "only") match.archivedAt = { $ne: null };
  if (filters.area) match.areaOfInterest = filters.area;
  if (filters.tag) match.tags = filters.tag;
  if (filters.source) match.source = filters.source;
  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = filters.from;
    if (filters.to) range.$lte = filters.to;
    match.createdAt = range;
  }
  if (filters.q) {
    match.$or = searchClauses(filters.q, ["name", "email", "areaOfInterest", "tags"], TALENT_REFERENCE_QUERY);
  }
  return match;
}

async function loadTalent(id: string): Promise<TalentPoolEntryDoc> {
  if (!isObjectIdString(id)) throw talentNotFound();
  await connectToDatabase();
  const doc = await TalentPoolEntryModel.findById(toObjectId(id)).lean<TalentPoolEntryDoc>();
  if (!doc) throw talentNotFound();
  return doc;
}

async function buildTalentDetail(doc: TalentPoolEntryDoc): Promise<TalentDetail> {
  const rows = await ApplicationModel.find({
    $or: [{ _id: { $in: doc.applications ?? [] } }, { talentPoolEntry: doc._id }],
  })
    .select({ jobSlug: 1, jobTitle: 1, status: 1, createdAt: 1, archivedAt: 1 })
    .sort({ createdAt: -1, _id: -1 })
    .limit(LINKED_APPLICATIONS_LIMIT)
    .lean<TalentApplicationRow[]>();
  return toTalentDetail(doc, rows.map(toTalentApplicationLink));
}

// Explains why a conditional update matched nothing.
async function explainMiss(id: Types.ObjectId, archivedMessage: string, otherwise: AppError): Promise<AppError> {
  const current = await TalentPoolEntryModel.findById(id)
    .select({ archivedAt: 1 })
    .lean<Pick<TalentPoolEntryDoc, "_id" | "archivedAt">>();
  if (!current) return talentNotFound();
  if (current.archivedAt) return conflict(archivedMessage, "archived");
  return otherwise;
}

// ── Public submission ────────────────────────────────────────────────────────

export async function submitTalentProfile(input: TalentSubmission, meta: { ip: string }): Promise<{ id: string; reference: string }> {
  await connectToDatabase();
  const emailNormalized = normalizeEmail(input.email);
  const duplicate = () =>
    conflict(
      "This email address is already in our talent pool. We'll contact you when a matching role opens.",
      "duplicate_talent_profile"
    );
  // Archived profiles count too: a public submission never silently revives someone's profile.
  if (await TalentPoolEntryModel.exists({ emailNormalized })) throw duplicate();

  const id = new Types.ObjectId();
  const entityId = String(id);
  const reference = talentReference(id);
  const documents = await claimUploads(
    { cv: input.uploads.cv, supporting: input.uploads.supporting },
    { purposes: ["talent_pool"], destinationPrefix: `talent-pool/${entityId}`, requireCv: true }
  );

  const now = new Date();
  try {
    await TalentPoolEntryModel.create({
      _id: id,
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
      activity: [newActivityEntry("created", "Profile submitted via the careers website", null, now)],
      legacyIds: [],
    });
  } catch (err) {
    const saved = await settleFailedInsert(err, documents, () => TalentPoolEntryModel.exists({ _id: id }), {
      entityType: "talent",
      entityId,
    });
    if (!saved) {
      if (isDuplicateKeyError(err, "email_unique")) throw duplicate();
      throw err;
    }
  }

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
    summary: `Talent profile ${reference} submitted (${input.areaOfInterest})`,
    meta: { documentCount: documents.length },
    ip: meta.ip,
  });

  return { id: entityId, reference };
}

// ── Admin: create, list, detail ──────────────────────────────────────────────

export async function createTalentEntry(input: HrTalentInput, ctx: AdminContext): Promise<TalentDetail> {
  await connectToDatabase();
  const emailNormalized = normalizeEmail(input.email);
  const duplicate = () => {
    const message = "This email address is already in the talent pool.";
    return new AppError(409, "duplicate_talent_profile", message, { fields: { email: message } });
  };
  if (await TalentPoolEntryModel.exists({ emailNormalized })) throw duplicate();

  const id = new Types.ObjectId();
  const entityId = String(id);
  const reference = talentReference(id);
  const hasUploads = Boolean(input.uploads && (input.uploads.cv || input.uploads.supporting.length > 0));
  const documents =
    input.uploads && hasUploads
      ? await claimUploads(
          { cv: input.uploads.cv || null, supporting: input.uploads.supporting },
          { purposes: ["admin_talent"], destinationPrefix: `talent-pool/${entityId}`, requireCv: false }
        )
      : [];

  const now = new Date();
  const author = authorFromContext(ctx);
  const note = validateOptionalHrNote(input.note);
  try {
    await TalentPoolEntryModel.create({
      _id: id,
      name: input.name,
      email: input.email,
      emailNormalized,
      phone: input.phone,
      areaOfInterest: input.areaOfInterest,
      candidateNotes: "",
      tags: input.tags,
      notes: note ? [newNoteEntry(note, author, now)] : [],
      documents,
      // HR confirmed the candidate agreed to be kept on file (validated by the route).
      consentGiven: true,
      consentAt: now,
      source: "hr_added",
      sourceApplication: null,
      applications: [],
      createdBy: ctx.userId,
      activity: [newActivityEntry("created", "Added by HR", author, now)],
      legacyIds: [],
    });
  } catch (err) {
    const saved = await settleFailedInsert(err, documents, () => TalentPoolEntryModel.exists({ _id: id }), {
      entityType: "talent",
      entityId,
    });
    if (!saved) {
      if (isDuplicateKeyError(err, "email_unique")) throw duplicate();
      throw err;
    }
  }

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "talent.create",
    entityType: "talent",
    entityId,
    summary: `Added talent profile ${reference} (${input.areaOfInterest})`,
    meta: { documentCount: documents.length, tagCount: input.tags.length, hasNote: note.length > 0 },
    ip: ctx.ip,
  });

  return buildTalentDetail(await loadTalent(entityId));
}

export async function listTalent(filters: TalentFilters, page: Pagination): Promise<Paginated<TalentListItem>> {
  await connectToDatabase();
  const [rows, total] = await Promise.all([
    TalentPoolEntryModel.aggregate<TalentListRow>([
      { $match: buildTalentMatch(filters) },
      { $sort: { createdAt: -1, _id: -1 } },
      { $skip: page.skip },
      { $limit: page.limit },
      { $project: TALENT_LIST_PROJECTION },
    ]).option({ maxTimeMS: LIST_MAX_TIME_MS }),
    TalentPoolEntryModel.countDocuments(buildTalentMatch(filters) as QueryFilter<TalentPoolEntryDoc>).maxTimeMS(LIST_MAX_TIME_MS),
  ]);
  return toPaginated(rows.map(toTalentListItem), total, page);
}

export async function listTalentTags(): Promise<string[]> {
  await connectToDatabase();
  const tags = (await TalentPoolEntryModel.distinct("tags", { archivedAt: null }).maxTimeMS(LIST_MAX_TIME_MS)) as unknown[];
  return tags
    .filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
    .sort((a, b) => a.localeCompare(b, "en"));
}

export async function getTalentDetail(id: string, ctx: AdminContext): Promise<TalentDetail> {
  const doc = await loadTalent(id);
  const detail = await buildTalentDetail(doc);
  await recordAudit({
    actor: toAuditActor(ctx),
    action: "talent.view",
    entityType: "talent",
    entityId: String(doc._id),
    summary: `Viewed talent profile ${talentReference(doc._id)}`,
    meta: {},
    ip: ctx.ip,
  });
  return detail;
}

// ── Admin: edits ─────────────────────────────────────────────────────────────

export async function updateTalentEntry(id: string, patch: TalentUpdatePayload, ctx: AdminContext): Promise<TalentDetail> {
  if (!isObjectIdString(id)) throw talentNotFound();
  // Idempotent normalization; the route has usually parsed the raw body already.
  const input = parseTalentUpdatePayload(patch);
  const current = await loadTalent(id);
  if (current.archivedAt) throw conflict("Restore the talent profile before editing it.", "archived");

  const set: Record<string, unknown> = {};
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
  if (tagsChanged) set.tags = input.tags;

  // Nothing actually changed (e.g. a retried request): return the profile as it is.
  if (Object.keys(set).length === 0) return buildTalentDetail(current);

  const now = new Date();
  const author = authorFromContext(ctx);
  const activity: TalentActivityDoc[] = [];
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

  const objectId = toObjectId(id);
  // Tags are replaced as a whole, so require the tags the editor started from to avoid losing a
  // concurrent tag change.
  const filter: Record<string, unknown> = { _id: objectId, archivedAt: null };
  if (tagsChanged) {
    if (currentTags.length > 0) filter.tags = currentTags;
    else filter.$or = [{ tags: { $exists: false } }, { tags: { $size: 0 } }];
  }

  const updated = await TalentPoolEntryModel.findOneAndUpdate(
    filter as QueryFilter<TalentPoolEntryDoc>,
    { $set: set, $push: { activity: { $each: activity } } },
    { returnDocument: "after", runValidators: true }
  ).lean<TalentPoolEntryDoc>();
  if (!updated) {
    throw await explainMiss(
      objectId,
      "Restore the talent profile before editing it.",
      conflict("This profile was updated by someone else. Refresh and try again.", "talent_conflict")
    );
  }

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "talent.update",
    entityType: "talent",
    entityId: String(updated._id),
    summary: `Updated talent profile ${talentReference(updated._id)}`,
    meta: {
      fields: tagsChanged ? [...changedFields, "tags"] : changedFields,
      tagsAdded: added.length,
      tagsRemoved: removed.length,
    },
    ip: ctx.ip,
  });
  return buildTalentDetail(updated);
}

export async function addTalentNote(id: string, body: string, ctx: AdminContext): Promise<TalentDetail> {
  if (!isObjectIdString(id)) throw talentNotFound();
  const text = validateNoteBody(body);
  await connectToDatabase();
  const objectId = toObjectId(id);
  const now = new Date();
  const author = authorFromContext(ctx);
  const note = newNoteEntry(text, author, now);

  const updated = await TalentPoolEntryModel.findOneAndUpdate(
    { _id: objectId, archivedAt: null },
    { $push: { notes: note, activity: newActivityEntry("note_added", "Added an HR note", author, now) } },
    { returnDocument: "after", runValidators: true }
  ).lean<TalentPoolEntryDoc>();
  if (!updated) {
    throw await explainMiss(
      objectId,
      "Restore the talent profile before adding notes.",
      conflict("The talent profile changed while saving. Please try again.")
    );
  }

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "talent.note_add",
    entityType: "talent",
    entityId: String(updated._id),
    summary: `Added a note to talent profile ${talentReference(updated._id)}`,
    meta: { noteId: String(note._id) },
    ip: ctx.ip,
  });
  return buildTalentDetail(updated);
}

export async function setTalentArchived(id: string, archived: boolean, reason: string, ctx: AdminContext): Promise<TalentDetail> {
  if (!isObjectIdString(id)) throw talentNotFound();
  const archiveReason = archived ? validateArchiveReason(reason) : "";
  await connectToDatabase();
  const objectId = toObjectId(id);
  const now = new Date();
  const author = authorFromContext(ctx);

  const updated = archived
    ? await TalentPoolEntryModel.findOneAndUpdate(
        { _id: objectId, archivedAt: null },
        {
          $set: { archivedAt: now, archivedBy: ctx.userId, archivedByName: ctx.user.name, archiveReason },
          $push: { activity: newActivityEntry("archived", archiveReason ? `Archived: ${archiveReason}` : "Archived", author, now) },
        },
        { returnDocument: "after", runValidators: true }
      ).lean<TalentPoolEntryDoc>()
    : await TalentPoolEntryModel.findOneAndUpdate(
        { _id: objectId, archivedAt: { $ne: null } },
        {
          $set: { archivedAt: null, archivedBy: null, archivedByName: null, archiveReason: "" },
          $push: { activity: newActivityEntry("restored", "Restored from archive", author, now) },
        },
        { returnDocument: "after" }
      ).lean<TalentPoolEntryDoc>();

  // Already in the requested state (e.g. a retried request): nothing changes, nothing is audited.
  if (!updated) return buildTalentDetail(await loadTalent(id));

  await recordAudit({
    actor: toAuditActor(ctx),
    action: archived ? "talent.archive" : "talent.restore",
    entityType: "talent",
    entityId: String(updated._id),
    summary: `${archived ? "Archived" : "Restored"} talent profile ${talentReference(updated._id)}`,
    meta: archived ? { hasReason: archiveReason.length > 0 } : {},
    ip: ctx.ip,
  });
  return buildTalentDetail(updated);
}

// ── Admin: consider for a job ────────────────────────────────────────────────

type OwnershipRow = Pick<ApplicationDoc, "_id" | "source" | "talentPoolEntry">;

// An application created earlier from this same profile (e.g. by a request whose response was
// lost). Treating it as the result makes retries converge instead of failing as duplicates.
function isCreatedFromEntry(row: OwnershipRow, entryId: Types.ObjectId): boolean {
  return row.source === "talent_pool" && Boolean(row.talentPoolEntry?.equals(entryId));
}

async function findApplicationFor(job: JobDoc, entry: TalentPoolEntryDoc): Promise<OwnershipRow | null> {
  return ApplicationModel.findOne({ job: job._id, emailNormalized: entry.emailNormalized })
    .select({ source: 1, talentPoolEntry: 1 })
    .lean<OwnershipRow>();
}

// Returns the new application id, or null when an application for this job and email was
// created concurrently.
async function createApplicationFromTalent(
  entry: TalentPoolEntryDoc,
  job: JobDoc,
  note: string,
  author: { userId: Types.ObjectId; name: string },
  now: Date
): Promise<Types.ObjectId | null> {
  const applicationId = new Types.ObjectId();
  const documents =
    (entry.documents ?? []).length > 0 ? await copyDocuments(entry.documents, `applications/${applicationId}`) : [];
  try {
    await ApplicationModel.create({
      _id: applicationId,
      job: job._id,
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
      statusHistory: [
        {
          _id: new Types.ObjectId(),
          from: null,
          to: "submitted",
          changedAt: now,
          changedBy: author.userId,
          changedByName: author.name,
          note: `Created from talent pool by ${author.name}`.slice(0, FIELD_LIMITS.hrNote),
          candidateNotified: false,
        },
      ],
      notes: note ? [newNoteEntry(note, author, now)] : [],
      source: "talent_pool",
      talentPoolEntry: entry._id,
      legacyIds: [],
    });
    return applicationId;
  } catch (err) {
    const saved = await settleFailedInsert(err, documents, () => ApplicationModel.exists({ _id: applicationId }), {
      entityType: "application",
      entityId: String(applicationId),
    });
    if (saved) return applicationId;
    if (isDuplicateKeyError(err, "job_email_unique")) return null;
    throw err;
  }
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
  const now = new Date();
  const author = authorFromContext(ctx);

  let applicationId: Types.ObjectId;
  const existing = await findApplicationFor(job, entry);
  if (existing) {
    if (!isCreatedFromEntry(existing, entry._id)) throw duplicate();
    applicationId = existing._id;
  } else {
    const createdId = await createApplicationFromTalent(entry, job, note, author, now);
    if (createdId) {
      applicationId = createdId;
    } else {
      const winner = await findApplicationFor(job, entry);
      if (!winner || !isCreatedFromEntry(winner, entry._id)) throw duplicate();
      applicationId = winner._id;
    }
  }

  const reference = applicationReference(applicationId);
  const link = await TalentPoolEntryModel.updateOne(
    { _id: entry._id, applications: { $ne: applicationId } },
    {
      $addToSet: { applications: applicationId },
      $push: { activity: newActivityEntry("applied_to_job", `Considered for ${job.title} (${reference})`, author, now) },
    }
  );

  // Audited once, when the profile is linked (a converged retry that finds it linked is not).
  if (link.modifiedCount > 0) {
    await recordAudit({
      actor: toAuditActor(ctx),
      action: "talent.apply_to_job",
      entityType: "talent",
      entityId: String(entry._id),
      summary: `Talent profile ${talentReference(entry._id)} added as application ${reference} for ${job.title}`,
      meta: { applicationId: String(applicationId), jobSlug: job.slug },
      ip: ctx.ip,
    });
  }

  return { applicationId: String(applicationId) };
}

// ── Erasure ──────────────────────────────────────────────────────────────────

export type TalentPurgeOptions = {
  actor: AuditActor | null;
  ip: string | null;
  // HR erasure requires the profile to be archived first; the retention job does not.
  requireArchived: boolean;
  action: "talent.purge" | "retention.purge";
};

// Deletes stored documents first (keeping the profile if storage fails, so the purge can be
// retried), then unlinks applications, removes emails containing the candidate's details, and
// finally the profile itself.
export async function purgeTalentRecord(id: Types.ObjectId, options: TalentPurgeOptions): Promise<void> {
  await connectToDatabase();
  const entry = await TalentPoolEntryModel.findById(id)
    .select({ documents: 1, archivedAt: 1, createdAt: 1, source: 1 })
    .lean<Pick<TalentPoolEntryDoc, "_id" | "documents" | "archivedAt" | "createdAt" | "source">>();
  if (!entry) throw talentNotFound();
  if (options.requireArchived && !entry.archivedAt) {
    throw conflict("Archive the talent profile before deleting it permanently.", "not_archived");
  }

  const entityId = String(entry._id);
  const reference = talentReference(entry._id);
  const documents = entry.documents ?? [];
  const deletable = await documentsSafeToDelete(documents, { type: "talent", id: entry._id });
  if (deletable.length > 0) {
    const { failedKeys } = await deleteDocuments(deletable);
    if (failedKeys.length > 0) {
      logger.error("talent.purge_storage_failed", { talentId: entityId, failedCount: failedKeys.length });
      throw new AppError(
        502,
        "storage_delete_failed",
        "Some files could not be deleted from storage. The profile was kept; please try again later."
      );
    }
  }

  await ApplicationModel.updateMany({ talentPoolEntry: entry._id }, { $set: { talentPoolEntry: null } });
  await EmailOutboxModel.deleteMany({ "related.entityType": "talent", "related.entityId": entityId });
  const { deletedCount } = await TalentPoolEntryModel.deleteOne({ _id: entry._id });
  // A concurrent purge of the same profile got there first; it writes the one audit entry.
  if (deletedCount === 0) throw talentNotFound();

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
  await purgeTalentRecord(toObjectId(id), {
    actor: toAuditActor(ctx),
    ip: ctx.ip,
    requireArchived: true,
    action: "talent.purge",
  });
}
