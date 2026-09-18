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
import { idTimestamp, newId } from "@/lib/careers/server/ids";
import { compareByDateDesc, makeSearchMatcher } from "@/lib/careers/server/mappers";
import type { JobRecord } from "@/lib/careers/server/records";
import { hasControlCharacters, isJobOpen, isValidJobSlug, type JobInput } from "@/lib/careers/validation";
import { AppError, badRequest, conflict, notFound } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import { deleteRows, ensureStoreReady, findById, reconcileDuplicate, withLock } from "@/lib/sheets-db";
import { countApplicationsByJob } from "@/lib/sheets-db/repositories/applications";
import { findJobById, findJobBySlug, insertJob, listAllJobs, patchJob, toJobRecord } from "@/lib/sheets-db/repositories/jobs";
import type { AdminJob, Job } from "@/types/careers";

// Job lifecycle service, on the Google Sheets store.
//
// What changed relative to the MongoDB version, and nothing else did:
//
//   * Filtering, sorting and the per-job application count happen in this process over a cached
//     copy of the Jobs and Applications tabs instead of in an aggregation pipeline.
//   * The slug's unique index is replaced by withLock("job-slug:<slug>") around a read-check-
//     append, plus reconcileDuplicate for the cross-instance case. The 409 duplicate_slug an
//     admin sees is identical.
//   * Every conditional findOneAndUpdate became withLock("job:<id>") around a fresh read, the
//     same rule check, and a patch. The lifecycle rules are therefore still evaluated against
//     the job's real current state, and the same 409/400 codes come out.

export type AdminJobStatusFilter = JobStatus | "active" | "all";

export type AdminJobFilters = {
  // "active" (default) = everything except archived; "all" includes archived jobs.
  status?: AdminJobStatusFilter;
  q?: string;
  department?: string;
};

// The two fields the public visibility rule is made of.
export type JobVisibility = Pick<JobRecord, "status" | "applicationDeadline">;

// Safety cap for the public listing payload; far above any realistic number of open roles.
const PUBLIC_LIST_LIMIT = 500;
const RELATED_LIST_MAX = 20;
const DELETABLE_STATUSES: readonly JobStatus[] = ["draft", "archived"];

// The public pages read the Jobs tab on every visit, so they tolerate a longer cache window than
// the store's 10-second default. Admin reads and every mutation use fresher data.
const PUBLIC_CACHE_MS = 30_000;

const ACTION_PAST_TENSE: Record<JobStatusAction, string> = {
  publish: "Published",
  unpublish: "Unpublished",
  close: "Closed",
  reopen: "Reopened",
  archive: "Archived",
  restore: "Restored",
};

// Newest first by publishedAt, falling back to createdAt for jobs never published, then id.
// This is the $addFields/$ifNull sort key the aggregation used, with the same _id tie-break.
const NEWEST_FIRST = compareByDateDesc<JobRecord>((job) => job.publishedAt ?? job.createdAt, (job) => job.id);

// Applications and talent profiles are searchable by their candidate-facing reference; jobs have
// no such reference (they are addressed by slug), so this pattern never matches and the search
// stays a plain substring match over the four indexed text fields.
const NO_JOB_REFERENCE = /(?!)/;

// ── Mapping ──────────────────────────────────────────────────────────────────

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Last-resort timestamp, from the creation time encoded in the id. Replaces
// ObjectId.getTimestamp() for rows whose date cells were emptied by a hand edit.
function idIso(id: string): string {
  return (idTimestamp(id) ?? new Date(0)).toISOString();
}

export function toPublicJob(job: JobRecord): Job {
  return {
    id: job.slug,
    title: job.title,
    department: job.department ?? "",
    location: job.location ?? "",
    type: job.type,
    experience: job.experience ?? "",
    description: job.description ?? "",
    responsibilities: [...(job.responsibilities ?? [])],
    requirements: [...(job.requirements ?? [])],
    qualifications: [...(job.qualifications ?? [])],
    benefits: [...(job.benefits ?? [])],
    applicationDeadline: toIso(job.applicationDeadline),
    publishedAt: toIso(job.publishedAt),
    updatedAt: toIso(job.updatedAt) ?? toIso(job.createdAt) ?? idIso(job.id),
  };
}

export function toAdminJob(job: JobRecord, applicationCount: number, now: Date = new Date()): AdminJob {
  return {
    ...toPublicJob(job),
    status: job.status,
    createdAt: toIso(job.createdAt) ?? idIso(job.id),
    closedAt: toIso(job.closedAt),
    archivedAt: toIso(job.archivedAt),
    isOpen: isJobOpen({ status: job.status, applicationDeadline: job.applicationDeadline ?? null }, now),
    applicationCount,
    createdByName: job.createdByName ?? null,
    updatedByName: job.updatedByName ?? null,
  };
}

// ── Public queries ───────────────────────────────────────────────────────────

// A job is public ("open") while it is published and its deadline, if any, has not passed.
// The single source of truth for public visibility: the query filter became a predicate, so
// callers filter a loaded tab with it instead of handing it to the database.
export function openJobFilter(now: Date = new Date()): (job: JobVisibility) => boolean {
  return (job) => isJobOpen(job, now);
}

function validSlug(slug: string): string | null {
  return typeof slug === "string" && isValidJobSlug(slug) ? slug : null;
}

export async function listOpenJobs(): Promise<Job[]> {
  ensureStoreReady();
  const isOpen = openJobFilter();
  const jobs = (await listAllJobs({ maxAgeMs: PUBLIC_CACHE_MS })).filter(isOpen);
  jobs.sort(NEWEST_FIRST);
  return jobs.slice(0, PUBLIC_LIST_LIMIT).map(toPublicJob);
}

export async function getOpenJobDocument(slug: string): Promise<JobRecord | null> {
  const value = validSlug(slug);
  if (!value) return null;
  ensureStoreReady();
  const job = await findJobBySlug(value);
  if (!job) return null;
  return openJobFilter()(job) ? job : null;
}

export async function getOpenJob(slug: string): Promise<Job | null> {
  const job = await getOpenJobDocument(slug);
  return job ? toPublicJob(job) : null;
}

export async function listRelatedOpenJobs(department: string, excludeSlug: string, limit = 3): Promise<Job[]> {
  if (typeof department !== "string" || !department.trim()) return [];
  const size = Math.min(Math.max(Math.trunc(limit) || 1, 1), RELATED_LIST_MAX);
  ensureStoreReady();
  const isOpen = openJobFilter();
  const exclude = String(excludeSlug);
  const jobs = (await listAllJobs({ maxAgeMs: PUBLIC_CACHE_MS })).filter(
    // department is an exact, case-sensitive match, as the indexed query was.
    (job) => isOpen(job) && job.department === department && job.slug !== exclude
  );
  jobs.sort(NEWEST_FIRST);
  return jobs.slice(0, size).map(toPublicJob);
}

// How many jobs are on the public site right now. Replaces countDocuments(openJobFilter()).
export async function countOpenJobs(): Promise<number> {
  ensureStoreReady();
  const isOpen = openJobFilter();
  return (await listAllJobs({ maxAgeMs: PUBLIC_CACHE_MS })).filter(isOpen).length;
}

// ── Admin queries ────────────────────────────────────────────────────────────

function cleanFilterText(value: string | undefined, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return !text || hasControlCharacters(text) ? "" : text.slice(0, max);
}

function matchesStatus(job: JobRecord, filter: AdminJobStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return job.status !== "archived";
  return job.status === filter;
}

// Every application counts, archived ones included; only rows that lost a duplicate race are
// excluded, which is what the unique index used to prevent existing at all.
async function applicationCountFor(jobId: string, opts: { maxAgeMs?: number } = {}): Promise<number> {
  const counts = await countApplicationsByJob(opts);
  return counts.get(jobId) ?? 0;
}

export async function listAdminJobs(filters: AdminJobFilters = {}): Promise<AdminJob[]> {
  ensureStoreReady();
  const status = filters.status ?? "active";
  const q = cleanFilterText(filters.q, FIELD_LIMITS.searchQuery);
  const department = cleanFilterText(filters.department, FIELD_LIMITS.department);
  const matchesSearch = makeSearchMatcher<JobRecord>(
    q,
    (job) => [job.title, job.slug, job.department, job.location],
    (job) => job.id,
    NO_JOB_REFERENCE
  );

  const jobs = (await listAllJobs()).filter(
    (job) => matchesStatus(job, status) && (!department || job.department === department) && matchesSearch(job)
  );
  jobs.sort(NEWEST_FIRST);

  // One pass over the Applications tab for the whole page, and one `now` so every row's isOpen
  // is measured against the same instant.
  const counts = await countApplicationsByJob();
  const now = new Date();
  return jobs.map((job) => toAdminJob(job, counts.get(job.id) ?? 0, now));
}

export async function getJobDocumentBySlug(slug: string): Promise<JobRecord | null> {
  const value = validSlug(slug);
  if (!value) return null;
  ensureStoreReady();
  // A job created seconds ago on another instance must not read as a 404 here, so a miss is
  // confirmed against Google before it is believed.
  return findJobBySlug(value, { refreshOnMiss: true });
}

export async function getAdminJob(slug: string): Promise<AdminJob | null> {
  const job = await getJobDocumentBySlug(slug);
  if (!job) return null;
  return toAdminJob(job, await applicationCountFor(job.id));
}

// ── Admin mutations ──────────────────────────────────────────────────────────

async function requireJobDocument(slug: string): Promise<JobRecord> {
  const job = await getJobDocumentBySlug(slug);
  if (!job) throw notFound("Job not found.", "job_not_found");
  return job;
}

// The authoritative state of a job inside its lock: straight from Google, never the cache.
async function currentJob(id: string): Promise<JobRecord> {
  const job = await findJobById(id, { maxAgeMs: 0 });
  if (!job) throw notFound("Job not found.", "job_not_found");
  return job;
}

type PublishableJob = Pick<JobRecord, "description" | "responsibilities" | "requirements" | "applicationDeadline">;

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

function assertTransition(job: JobRecord, action: JobStatusAction, now: Date): void {
  const transition = JOB_STATUS_TRANSITIONS[action];
  if (!transition.from.includes(job.status)) {
    throw conflict(`${statusPhrase(job.status)} can't be ${ACTION_PAST_TENSE[action].toLowerCase()}.`, "invalid_transition");
  }
  if (transition.to === "published") assertPublishable(job, now);
}

// The fields the editor may change. `slug` and `status` are deliberately absent: the slug is the
// public URL and immutable, and status changes go through changeJobStatus.
type EditableJobFields = Pick<
  JobRecord,
  | "title"
  | "department"
  | "location"
  | "type"
  | "experience"
  | "description"
  | "responsibilities"
  | "requirements"
  | "qualifications"
  | "benefits"
  | "applicationDeadline"
>;

function editableFields(input: JobInput): EditableJobFields {
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
    // Already the last millisecond of the chosen day in Sri Lanka time (parseDeadlineDate);
    // it is carried through unchanged and stored as an ISO instant.
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

function changedFieldsOf(current: JobRecord, changes: EditableJobFields): string[] {
  const before = current as unknown as Record<string, unknown>;
  return Object.entries(changes)
    .filter(([key, value]) => !sameValue(before[key], value))
    .map(([key]) => key);
}

function jobLabel(job: Pick<JobRecord, "title" | "slug">): string {
  // Titles are capped at 150 characters, so the summary stays within the audit log limit.
  return `"${job.title}" (${job.slug})`;
}

function duplicateSlugError(): AppError {
  return new AppError(409, "duplicate_slug", "A job with this ID already exists. Choose a different job ID.", {
    fields: { slug: "This job ID is already in use." },
  });
}

// Removes the row this request appended after losing a slug race to an earlier row. Failing to
// clean up is not worth failing the request over: the admin still gets the duplicate_slug error,
// and the surviving row is the one every lookup already resolves to.
async function discardLosingRow(rowNumber: number, slug: string): Promise<void> {
  try {
    await deleteRows("Jobs", [rowNumber]);
  } catch (err) {
    logger.error("jobs.duplicate_row_cleanup_failed", { slug, err });
  }
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
  ensureStoreReady();

  const slug = input.slug;
  // The slug is the only unique key besides the id, and archived or deleted slugs are never
  // reusable while the record exists. The lock orders same-instance attempts; reconcileDuplicate
  // settles the rest, where the earliest row always wins.
  const created = await withLock<JobRecord>(`job-slug:${slug}`, async () => {
    const existing = await findJobBySlug(slug, { refreshOnMiss: true });
    if (existing) throw duplicateSlugError();

    const record: JobRecord = {
      id: newId(now),
      slug,
      ...editableFields(input),
      status,
      publishedAt: status === "published" ? now : null,
      closedAt: null,
      archivedAt: null,
      createdBy: ctx.userId,
      createdByName: ctx.user.name,
      updatedBy: ctx.userId,
      updatedByName: ctx.user.name,
      origin: "admin",
      createdAt: now,
      updatedAt: now,
    };

    const row = await insertJob(record);
    const { isDuplicate } = await reconcileDuplicate("Jobs", row, (values) => String(values.slug ?? "").trim().toLowerCase() || null);
    if (isDuplicate) {
      await discardLosingRow(row.rowNumber, slug);
      throw duplicateSlugError();
    }
    return record;
  });

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "job.create",
    entityType: "job",
    entityId: created.slug,
    summary: `Created job ${jobLabel(created)} as ${JOB_STATUS_LABELS[status].toLowerCase()}`,
    meta: { jobId: created.id, status },
    ip: ctx.ip,
  });
  return toAdminJob(created, 0, now);
}

export async function updateJob(slug: string, input: JobInput, ctx: AdminContext): Promise<AdminJob> {
  const existing = await requireJobDocument(slug);
  const now = new Date();

  // Everything is decided inside the lock against a fresh read, so a concurrent publish cannot
  // make a job live with content that was never checked.
  const { job, changedFields } = await withLock<{ job: JobRecord; changedFields: string[] }>(`job:${existing.id}`, async () => {
    const current = await currentJob(existing.id);
    if (current.status === "published") {
      // A live job must stay publishable. An already-passed deadline only blocks the save when
      // this edit is what sets it, so typo fixes on an expired posting remain possible.
      const deadlineChanged = !sameInstant(current.applicationDeadline, input.applicationDeadline);
      assertPublishable(input, now, { checkDeadline: deadlineChanged });
    }

    const changes = editableFields(input);
    const fields = changedFieldsOf(current, changes);
    if (fields.length === 0) return { job: current, changedFields: fields };

    const patch = { ...changes, updatedBy: ctx.userId, updatedByName: ctx.user.name, updatedAt: now };
    if (!(await patchJob(current.id, patch))) {
      // The row is gone: 404 if the slug is gone with it, otherwise another row now holds it.
      await requireJobDocument(slug);
      throw conflict("This job was changed by someone else. Reload it and try again.", "job_conflict");
    }
    return { job: { ...current, ...patch }, changedFields: fields };
  });

  // No editable field actually changed: no write, no audit entry, and the current job is
  // returned unchanged, so a repeated save is a no-op.
  if (changedFields.length > 0) {
    await recordAudit({
      actor: toAuditActor(ctx),
      action: "job.update",
      entityType: "job",
      entityId: job.slug,
      summary: `Updated job ${jobLabel(job)}`,
      meta: { jobId: job.id, changedFields },
      ip: ctx.ip,
    });
  }
  return toAdminJob(job, await applicationCountFor(job.id), now);
}

type StatusPatch = Pick<JobRecord, "status"> & Partial<Pick<JobRecord, "publishedAt" | "closedAt" | "archivedAt">>;

function statusChanges(action: JobStatusAction, current: JobRecord, now: Date): StatusPatch {
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
  const existing = await requireJobDocument(slug);
  const now = new Date();

  const { job, from } = await withLock<{ job: JobRecord; from: JobStatus }>(`job:${existing.id}`, async () => {
    // The transition is checked against the job's real current status (and, when going live,
    // its real current content), so concurrent actions cannot skip the lifecycle rules.
    const current = await currentJob(existing.id);
    assertTransition(current, action, now);

    const patch = { ...statusChanges(action, current, now), updatedBy: ctx.userId, updatedByName: ctx.user.name, updatedAt: now };
    if (!(await patchJob(current.id, patch))) {
      const latest = await requireJobDocument(slug);
      assertTransition(latest, action, now);
      throw conflict("This job was updated by someone else. Refresh to see its latest status.", "job_conflict");
    }
    return { job: { ...current, ...patch }, from: current.status };
  });

  await recordAudit({
    actor: toAuditActor(ctx),
    action: `job.${action}`,
    entityType: "job",
    entityId: job.slug,
    summary: `${ACTION_PAST_TENSE[action]} job ${jobLabel(job)}`,
    meta: { jobId: job.id, from, to: job.status },
    ip: ctx.ip,
  });
  return toAdminJob(job, await applicationCountFor(job.id), now);
}

function assertDeletable(job: JobRecord): void {
  if (!DELETABLE_STATUSES.includes(job.status)) {
    throw conflict("Only draft or archived jobs can be deleted.", "job_not_deletable");
  }
}

export async function deleteJob(slug: string, ctx: AdminContext): Promise<void> {
  const existing = await requireJobDocument(slug);

  const deleted = await withLock<JobRecord>(`job:${existing.id}`, async () => {
    // Deleting is the one operation that needs the row number as well as the record, because it
    // removes the row outright: the slug only becomes reusable when the job is really gone.
    const row = await findById("Jobs", existing.id, { maxAgeMs: 0 });
    if (!row) {
      const latest = await requireJobDocument(slug);
      assertDeletable(latest);
      throw conflict("This job was updated by someone else. Refresh and try again.", "job_conflict");
    }
    const current = toJobRecord(row.values);
    assertDeletable(current);

    // Every application counts, archived ones included: they keep a reference to this job.
    if ((await applicationCountFor(current.id, { maxAgeMs: 0 })) > 0) {
      throw conflict(
        current.status === "archived"
          ? "This job has applications, so it can't be deleted. It stays archived to keep them linked."
          : "This job has applications. Archive it instead.",
        "job_has_applications"
      );
    }

    await deleteRows("Jobs", [row.rowNumber]);
    return current;
  });

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "job.delete",
    entityType: "job",
    entityId: deleted.slug,
    summary: `Deleted job ${jobLabel(deleted)}`,
    meta: { jobId: deleted.id, status: deleted.status },
    ip: ctx.ip,
  });
}
