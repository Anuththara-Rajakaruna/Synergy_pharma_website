import type { PipelineStage, QueryFilter, Types } from "mongoose";
import { toAuditActor } from "@/lib/auth/require-admin";
import type { AdminContext } from "@/lib/auth/session";
import {
  FIELD_LIMITS,
  JOB_STATUS_ACTIONS,
  JOB_STATUS_LABELS,
  JOB_STATUS_TRANSITIONS,
  type JobStatus,
  type JobStatusAction,
} from "@/lib/careers/constants";
import { recordAudit } from "@/lib/careers/server/audit";
import { escapeRegExp, hasControlCharacters, isJobOpen, isValidJobSlug, type JobInput } from "@/lib/careers/validation";
import { AppError, badRequest, conflict, notFound } from "@/lib/http/errors";
import { connectToDatabase, isDuplicateKeyError } from "@/lib/mongodb";
import { ApplicationModel } from "@/models/application";
import { JobModel, type JobDoc } from "@/models/job";
import type { AdminJob, Job } from "@/types/careers";

export type AdminJobStatusFilter = JobStatus | "active" | "all";

export type AdminJobFilters = {
  // "active" (default) = everything except archived; "all" includes archived jobs.
  status?: AdminJobStatusFilter;
  q?: string;
  department?: string;
};

// Safety cap for the public listing payload; far above any realistic number of open roles.
const PUBLIC_LIST_LIMIT = 500;
const RELATED_LIST_MAX = 20;
const DELETABLE_STATUSES: readonly JobStatus[] = ["draft", "archived"];

const ACTION_PAST_TENSE: Record<JobStatusAction, string> = {
  publish: "Published",
  unpublish: "Unpublished",
  close: "Closed",
  reopen: "Reopened",
  archive: "Archived",
  restore: "Restored",
};

// Newest first by publishedAt, falling back to createdAt for jobs never published, then _id.
const NEWEST_FIRST: PipelineStage[] = [
  { $addFields: { sortAt: { $ifNull: ["$publishedAt", "$createdAt"] } } },
  { $sort: { sortAt: -1, _id: -1 } },
  { $project: { sortAt: 0 } },
];

// ── Mapping ──────────────────────────────────────────────────────────────────

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Lean documents skip schema defaults, so records written outside Mongoose (migrations,
// restores) may lack optional fields; every field is defaulted defensively.
export function toPublicJob(doc: JobDoc): Job {
  return {
    id: doc.slug,
    title: doc.title,
    department: doc.department ?? "",
    location: doc.location ?? "",
    type: doc.type,
    experience: doc.experience ?? "",
    description: doc.description ?? "",
    responsibilities: [...(doc.responsibilities ?? [])],
    requirements: [...(doc.requirements ?? [])],
    qualifications: [...(doc.qualifications ?? [])],
    benefits: [...(doc.benefits ?? [])],
    applicationDeadline: toIso(doc.applicationDeadline),
    publishedAt: toIso(doc.publishedAt),
    updatedAt: toIso(doc.updatedAt) ?? toIso(doc.createdAt) ?? doc._id.getTimestamp().toISOString(),
  };
}

export function toAdminJob(doc: JobDoc, applicationCount: number, now: Date = new Date()): AdminJob {
  return {
    ...toPublicJob(doc),
    status: doc.status,
    createdAt: toIso(doc.createdAt) ?? doc._id.getTimestamp().toISOString(),
    closedAt: toIso(doc.closedAt),
    archivedAt: toIso(doc.archivedAt),
    isOpen: isJobOpen({ status: doc.status, applicationDeadline: doc.applicationDeadline ?? null }, now),
    applicationCount,
    createdByName: doc.createdByName ?? null,
    updatedByName: doc.updatedByName ?? null,
  };
}

// ── Public queries ───────────────────────────────────────────────────────────

// A job is public ("open") while it is published and its deadline, if any, has not passed.
export function openJobFilter(now: Date = new Date()): QueryFilter<JobDoc> {
  return {
    status: "published",
    $or: [{ applicationDeadline: null }, { applicationDeadline: { $gte: now } }],
  };
}

function validSlug(slug: string): string | null {
  return typeof slug === "string" && isValidJobSlug(slug) ? slug : null;
}

export async function listOpenJobs(): Promise<Job[]> {
  await connectToDatabase();
  const docs = await JobModel.aggregate<JobDoc>([{ $match: openJobFilter() }, ...NEWEST_FIRST, { $limit: PUBLIC_LIST_LIMIT }]);
  return docs.map(toPublicJob);
}

export async function getOpenJobDocument(slug: string): Promise<JobDoc | null> {
  const value = validSlug(slug);
  if (!value) return null;
  await connectToDatabase();
  return JobModel.findOne({ slug: value, ...openJobFilter() }).lean<JobDoc>();
}

export async function getOpenJob(slug: string): Promise<Job | null> {
  const doc = await getOpenJobDocument(slug);
  return doc ? toPublicJob(doc) : null;
}

export async function listRelatedOpenJobs(department: string, excludeSlug: string, limit = 3): Promise<Job[]> {
  if (typeof department !== "string" || !department.trim()) return [];
  const size = Math.min(Math.max(Math.trunc(limit) || 1, 1), RELATED_LIST_MAX);
  await connectToDatabase();
  const docs = await JobModel.aggregate<JobDoc>([
    { $match: { ...openJobFilter(), department, slug: { $ne: String(excludeSlug) } } },
    ...NEWEST_FIRST,
    { $limit: size },
  ]);
  return docs.map(toPublicJob);
}

// ── Admin queries ────────────────────────────────────────────────────────────

function cleanFilterText(value: string | undefined, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return !text || hasControlCharacters(text) ? "" : text.slice(0, max);
}

// Counts every application per job (archived ones included) in a single aggregation.
async function countApplicationsByJob(jobIds: Types.ObjectId[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (jobIds.length === 0) return counts;
  const rows = await ApplicationModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { job: { $in: jobIds } } },
    { $group: { _id: "$job", count: { $sum: 1 } } },
  ]);
  for (const row of rows) counts.set(String(row._id), row.count);
  return counts;
}

export async function listAdminJobs(filters: AdminJobFilters = {}): Promise<AdminJob[]> {
  const match: QueryFilter<JobDoc> = {};
  const status = filters.status ?? "active";
  if (status === "active") match.status = { $ne: "archived" };
  else if (status !== "all") match.status = status;

  const q = cleanFilterText(filters.q, FIELD_LIMITS.searchQuery);
  if (q) {
    const pattern = new RegExp(escapeRegExp(q), "i");
    match.$or = [{ title: pattern }, { slug: pattern }, { department: pattern }, { location: pattern }];
  }
  const department = cleanFilterText(filters.department, FIELD_LIMITS.department);
  if (department) match.department = department;

  await connectToDatabase();
  const docs = await JobModel.aggregate<JobDoc>([{ $match: match }, ...NEWEST_FIRST]);
  const counts = await countApplicationsByJob(docs.map((doc) => doc._id));
  const now = new Date();
  return docs.map((doc) => toAdminJob(doc, counts.get(String(doc._id)) ?? 0, now));
}

export async function getJobDocumentBySlug(slug: string): Promise<JobDoc | null> {
  const value = validSlug(slug);
  if (!value) return null;
  await connectToDatabase();
  return JobModel.findOne({ slug: value }).lean<JobDoc>();
}

export async function getAdminJob(slug: string): Promise<AdminJob | null> {
  const doc = await getJobDocumentBySlug(slug);
  if (!doc) return null;
  const applicationCount = await ApplicationModel.countDocuments({ job: doc._id });
  return toAdminJob(doc, applicationCount);
}

// ── Admin mutations ──────────────────────────────────────────────────────────

async function requireJobDocument(slug: string): Promise<JobDoc> {
  const doc = await getJobDocumentBySlug(slug);
  if (!doc) throw notFound("Job not found.", "job_not_found");
  return doc;
}

type PublishableJob = Pick<JobDoc, "description" | "responsibilities" | "requirements" | "applicationDeadline">;

function assertPublishable(job: PublishableJob, now: Date, options: { checkDeadline: boolean } = { checkDeadline: true }): void {
  const fields: Record<string, string> = {};
  if (!job.description?.trim()) fields.description = "Add a job description before publishing.";
  if (!job.responsibilities?.length) fields.responsibilities = "Add at least one responsibility before publishing.";
  if (!job.requirements?.length) fields.requirements = "Add at least one requirement before publishing.";
  if (options.checkDeadline && job.applicationDeadline && new Date(job.applicationDeadline).getTime() < now.getTime()) {
    fields.applicationDeadline = "The application deadline has passed. Choose a future date or clear the deadline.";
  }
  const messages = Object.values(fields);
  if (messages.length > 0) {
    throw badRequest(`This job can't be published yet. ${messages.join(" ")}`, fields, "publish_requirements");
  }
}

function statusPhrase(status: JobStatus): string {
  const label = JOB_STATUS_LABELS[status].toLowerCase();
  return `${/^[aeiou]/.test(label) ? "An" : "A"} ${label} job`;
}

function assertTransition(job: JobDoc, action: JobStatusAction, now: Date): void {
  const transition = JOB_STATUS_TRANSITIONS[action];
  if (!transition.from.includes(job.status)) {
    throw conflict(`${statusPhrase(job.status)} can't be ${ACTION_PAST_TENSE[action].toLowerCase()}.`, "invalid_transition");
  }
  if (transition.to === "published") assertPublishable(job, now);
}

function editableFields(input: JobInput) {
  return {
    title: input.title,
    department: input.department,
    location: input.location,
    type: input.type,
    experience: input.experience,
    description: input.description,
    responsibilities: input.responsibilities,
    requirements: input.requirements,
    qualifications: input.qualifications,
    benefits: input.benefits,
    applicationDeadline: input.applicationDeadline,
  };
}

function sameInstant(a: Date | string | null | undefined, b: Date | string | null | undefined): boolean {
  return (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return sameInstant(a as Date | null | undefined, b as Date | null | undefined);
  }
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  return (a ?? "") === (b ?? "");
}

function jobLabel(job: Pick<JobDoc, "title" | "slug">): string {
  // Titles are capped at 150 characters, so the summary stays within the audit log limit.
  return `"${job.title}" (${job.slug})`;
}

export async function createJob(input: JobInput, status: "draft" | "published", ctx: AdminContext): Promise<AdminJob> {
  if (!isValidJobSlug(input.slug)) {
    throw badRequest("Job ID is invalid.", {
      slug: `Job ID must be ${FIELD_LIMITS.jobSlugMin}-${FIELD_LIMITS.jobSlugMax} characters using lowercase letters, numbers and single hyphens.`,
    });
  }
  if (status !== "draft" && status !== "published") {
    throw badRequest("New jobs can be saved as a draft or published.", { status: "Choose draft or published." });
  }
  const now = new Date();
  if (status === "published") assertPublishable(input, now);

  await connectToDatabase();
  let created: JobDoc;
  try {
    const doc = await JobModel.create({
      ...editableFields(input),
      slug: input.slug,
      status,
      publishedAt: status === "published" ? now : null,
      closedAt: null,
      archivedAt: null,
      createdBy: ctx.userId,
      createdByName: ctx.user.name,
      updatedBy: ctx.userId,
      updatedByName: ctx.user.name,
      origin: "admin",
    });
    created = doc.toObject<JobDoc>();
  } catch (err) {
    // slug is the only unique key besides _id; archived and deleted slugs are never reusable
    // while the record exists.
    if (isDuplicateKeyError(err)) {
      throw new AppError(409, "duplicate_slug", "A job with this ID already exists. Choose a different job ID.", {
        fields: { slug: "This job ID is already in use." },
      });
    }
    throw err;
  }

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "job.create",
    entityType: "job",
    entityId: created.slug,
    summary: `Created job ${jobLabel(created)} as ${JOB_STATUS_LABELS[status].toLowerCase()}`,
    meta: { jobId: String(created._id), status },
    ip: ctx.ip,
  });
  return toAdminJob(created, 0, now);
}

export async function updateJob(slug: string, input: JobInput, ctx: AdminContext): Promise<AdminJob> {
  const current = await requireJobDocument(slug);
  const now = new Date();
  if (current.status === "published") {
    // A live job must stay publishable. An already-passed deadline only blocks the save when
    // this edit is what sets it, so typo fixes on an expired posting remain possible.
    const deadlineChanged = !sameInstant(current.applicationDeadline, input.applicationDeadline);
    assertPublishable(input, now, { checkDeadline: deadlineChanged });
  }

  const changes = editableFields(input);
  const before = current as unknown as Record<string, unknown>;
  const changedFields = Object.entries(changes)
    .filter(([key, value]) => !sameValue(before[key], value))
    .map(([key]) => key);
  if (changedFields.length === 0) {
    const applicationCount = await ApplicationModel.countDocuments({ job: current._id });
    return toAdminJob(current, applicationCount, now);
  }

  // Matching on the status that was validated above keeps a concurrent publish from making a
  // job live with content that was never checked.
  const updated = await JobModel.findOneAndUpdate(
    { _id: current._id, status: current.status },
    { $set: { ...changes, updatedBy: ctx.userId, updatedByName: ctx.user.name } },
    { returnDocument: "after", runValidators: true }
  ).lean<JobDoc>();
  if (!updated) {
    await requireJobDocument(slug);
    throw conflict("This job was changed by someone else. Reload it and try again.", "job_conflict");
  }

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "job.update",
    entityType: "job",
    entityId: updated.slug,
    summary: `Updated job ${jobLabel(updated)}`,
    meta: { jobId: String(updated._id), changedFields },
    ip: ctx.ip,
  });
  const applicationCount = await ApplicationModel.countDocuments({ job: updated._id });
  return toAdminJob(updated, applicationCount, now);
}

function statusChanges(action: JobStatusAction, current: JobDoc, now: Date): Partial<JobDoc> {
  switch (action) {
    case "publish":
      return { status: "published", publishedAt: now, closedAt: null, archivedAt: null };
    case "reopen":
      // Keeps the original publication date; legacy records without one get it now.
      return { status: "published", publishedAt: current.publishedAt ?? now, closedAt: null, archivedAt: null };
    case "close":
      return { status: "closed", closedAt: now };
    case "unpublish":
      return { status: "draft", closedAt: null, archivedAt: null };
    case "archive":
      return { status: "archived", archivedAt: now };
    case "restore":
      return { status: "draft", closedAt: null, archivedAt: null };
  }
}

export async function changeJobStatus(slug: string, action: JobStatusAction, ctx: AdminContext): Promise<AdminJob> {
  if (!(JOB_STATUS_ACTIONS as readonly string[]).includes(action)) {
    throw badRequest("Unknown status action.", { action: "Choose a valid action." });
  }
  const transition = JOB_STATUS_TRANSITIONS[action];
  const current = await requireJobDocument(slug);
  const now = new Date();
  assertTransition(current, action, now);

  // The transition is applied only if the job is still in an allowed status (and, when going
  // live, still publishable), so concurrent actions cannot skip the lifecycle rules.
  const filter: QueryFilter<JobDoc> = { _id: current._id, status: { $in: [...transition.from] } };
  if (transition.to === "published") {
    filter.responsibilities = { $ne: [] };
    filter.requirements = { $ne: [] };
    filter.$or = [{ applicationDeadline: null }, { applicationDeadline: { $gte: now } }];
  }
  const updated = await JobModel.findOneAndUpdate(
    filter,
    { $set: { ...statusChanges(action, current, now), updatedBy: ctx.userId, updatedByName: ctx.user.name } },
    { returnDocument: "after", runValidators: true }
  ).lean<JobDoc>();
  if (!updated) {
    const latest = await requireJobDocument(slug);
    assertTransition(latest, action, now);
    throw conflict("This job was updated by someone else. Refresh to see its latest status.", "job_conflict");
  }

  await recordAudit({
    actor: toAuditActor(ctx),
    action: `job.${action}`,
    entityType: "job",
    entityId: updated.slug,
    summary: `${ACTION_PAST_TENSE[action]} job ${jobLabel(updated)}`,
    meta: { jobId: String(updated._id), from: current.status, to: updated.status },
    ip: ctx.ip,
  });
  const applicationCount = await ApplicationModel.countDocuments({ job: updated._id });
  return toAdminJob(updated, applicationCount, now);
}

function assertDeletable(job: JobDoc): void {
  if (!DELETABLE_STATUSES.includes(job.status)) {
    throw conflict("Only draft or archived jobs can be deleted.", "job_not_deletable");
  }
}

export async function deleteJob(slug: string, ctx: AdminContext): Promise<void> {
  const current = await requireJobDocument(slug);
  assertDeletable(current);
  // Every application counts, archived ones included: they keep a reference to this job.
  if (await ApplicationModel.exists({ job: current._id })) {
    throw conflict(
      current.status === "archived"
        ? "This job has applications, so it can't be deleted. It stays archived to keep them linked."
        : "This job has applications. Archive it instead.",
      "job_has_applications"
    );
  }

  const deleted = await JobModel.findOneAndDelete({ _id: current._id, status: { $in: [...DELETABLE_STATUSES] } }).lean<JobDoc>();
  if (!deleted) {
    const latest = await requireJobDocument(slug);
    assertDeletable(latest);
    throw conflict("This job was updated by someone else. Refresh and try again.", "job_conflict");
  }

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "job.delete",
    entityType: "job",
    entityId: deleted.slug,
    summary: `Deleted job ${jobLabel(deleted)}`,
    meta: { jobId: String(deleted._id), status: deleted.status },
    ip: ctx.ip,
  });
}
