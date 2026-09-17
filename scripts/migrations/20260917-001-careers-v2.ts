import { Types, type Model } from "mongoose";
import { FIELD_LIMITS, LEGACY_APPLICATION_STATUS_MAP } from "@/lib/careers/constants";
import { isApplicationStatus, isValidJobSlug, normalizeEmail } from "@/lib/careers/validation";
import { ApplicationModel } from "@/models/application";
import { JobModel } from "@/models/job";
import { TalentPoolEntryModel } from "@/models/talent-pool-entry";
import {
  LEGACY_AUTHOR,
  NOT_SPECIFIED,
  PLACEHOLDER_JOB_DESCRIPTION,
  asDate,
  asString,
  buildValidated,
  isObjectIdValue,
  legacyDocument,
  legacyNotes,
  legacySlugCandidate,
  nonEmptyString,
  truncateText,
  uniqueSlug,
  type PlainDoc,
} from "../lib/legacy";
import { MigrationAbortedError, type Migration, type MigrationContext } from "../lib/migration-types";

// Upgrades documents written by the first MongoDB release of the careers portal (v1) to the v2
// schema: job lifecycle fields, applications with job links, documents, status history and
// structured notes, and talent-pool entries with documents and activity. Also drops v1 indexes
// that contradict the v2 rules (notably the unique {emailNormalized, jobSlug} index).
//
// Idempotent: only missing or v1-shaped fields are written, every update is guarded by the
// document's updatedAt, and documents that are already v2 are left untouched.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = Model<any>;
type RawDoc = PlainDoc & { _id: Types.ObjectId };

type Upgrade = {
  model: AnyModel;
  collection: string;
  raw: RawDoc;
  id: Types.ObjectId;
  guardUpdatedAt: unknown;
  set: PlainDoc;
  unset: string[];
  problems: string[];
};

type JobRef = { _id: Types.ObjectId; slug: string; title: string; department: string; placeholder: boolean };

const OBSOLETE_INDEXES: { model: AnyModel; name: string; key: Record<string, 1 | -1> }[] = [
  { model: JobModel, name: "status_createdAt", key: { status: 1, createdAt: -1 } },
  { model: JobModel, name: "createdAt_desc", key: { createdAt: -1 } },
  { model: ApplicationModel, name: "email_job_unique", key: { emailNormalized: 1, jobSlug: 1 } },
  { model: ApplicationModel, name: "createdAt_desc", key: { createdAt: -1 } },
  { model: ApplicationModel, name: "status_createdAt", key: { status: 1, createdAt: -1 } },
  { model: ApplicationModel, name: "job", key: { job: 1 } },
  { model: ApplicationModel, name: "legacyId_unique", key: { legacyId: 1 } },
  { model: TalentPoolEntryModel, name: "createdAt_desc", key: { createdAt: -1 } },
  { model: TalentPoolEntryModel, name: "legacyId_unique", key: { legacyId: 1 } },
];

const APPLICATION_V1_FIELDS = ["position", "cvFileName", "cvFilePath", "legacyId"];
const TALENT_V1_FIELDS = ["cvFileName", "cvFilePath", "legacyId"];
const ARCHIVE_DEFAULTS: PlainDoc = { archivedAt: null, archivedBy: null, archivedByName: null, archiveReason: "" };
const JOB_TITLE_SNAPSHOT_MAX = FIELD_LIMITS.jobTitle + 50;

function has(raw: PlainDoc, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, field) && raw[field] !== undefined;
}

function sameKeyPattern(actual: unknown, expected: Record<string, number>): boolean {
  if (!actual || typeof actual !== "object") return false;
  const actualEntries = Object.entries(actual as Record<string, unknown>);
  const expectedEntries = Object.entries(expected);
  return (
    actualEntries.length === expectedEntries.length &&
    expectedEntries.every(([field, direction], i) => actualEntries[i][0] === field && Number(actualEntries[i][1]) === direction)
  );
}

function timestamps(raw: RawDoc): { createdAt: Date; updatedAt: Date } {
  const createdAt = asDate(raw.createdAt) ?? raw._id.getTimestamp();
  return { createdAt, updatedAt: asDate(raw.updatedAt) ?? createdAt };
}

function legacyIdsOf(raw: RawDoc): string[] {
  const ids = Array.isArray(raw.legacyIds) ? raw.legacyIds.filter((id): id is string => typeof id === "string") : [];
  if (typeof raw.legacyId === "string" && raw.legacyId && !ids.includes(raw.legacyId)) ids.push(raw.legacyId);
  return ids;
}

function withoutFields(raw: RawDoc, fields: string[]): PlainDoc {
  const copy: PlainDoc = { ...raw };
  for (const field of fields) delete copy[field];
  return copy;
}

// Validates the document as it will be after the update.
async function problemsFor(upgrade: Upgrade): Promise<string[]> {
  const result = await buildValidated(upgrade.model, { ...withoutFields(upgrade.raw, upgrade.unset), ...upgrade.set });
  return result.ok ? [] : result.problems;
}

async function listIndexesIfExists(model: AnyModel): Promise<{ name: string; key: unknown }[]> {
  try {
    return (await model.collection.listIndexes().toArray()) as { name: string; key: unknown }[];
  } catch (err) {
    const e = err as { code?: unknown; codeName?: unknown };
    if (e.code === 26 || e.codeName === "NamespaceNotFound") return [];
    throw err;
  }
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

function planJobUpgrade(raw: RawDoc, newSlug: string | null): Upgrade | null {
  const { createdAt, updatedAt } = timestamps(raw);
  const status = asString(raw.status);
  const set: PlainDoc = {};
  if (newSlug) set.slug = newSlug;
  if (!has(raw, "origin")) set.origin = "admin"; // provenance of v1 jobs is unknown; treat as HR-managed
  if (!has(raw, "experience")) set.experience = "";
  for (const list of ["responsibilities", "requirements", "qualifications", "benefits"]) {
    if (!Array.isArray(raw[list])) set[list] = [];
  }
  if (!has(raw, "applicationDeadline")) set.applicationDeadline = null;
  if (!has(raw, "publishedAt")) set.publishedAt = status === "published" || status === "closed" ? createdAt : null;
  if (!has(raw, "closedAt")) set.closedAt = status === "closed" ? updatedAt : null;
  if (!has(raw, "archivedAt")) set.archivedAt = status === "archived" ? updatedAt : null;
  for (const field of ["createdBy", "createdByName", "updatedBy", "updatedByName"]) {
    if (!has(raw, field)) set[field] = null;
  }
  if (Object.keys(set).length === 0) return null;
  return {
    model: JobModel,
    collection: "jobs",
    raw,
    id: raw._id,
    guardUpdatedAt: raw.updatedAt ?? null,
    set,
    unset: [],
    problems: [],
  };
}

// ── Applications ─────────────────────────────────────────────────────────────

function resolveJob(raw: RawDoc, jobsById: Map<string, JobRef>, jobsBySlug: Map<string, JobRef>, renames: Map<string, string>): JobRef | null {
  if (isObjectIdValue(raw.job)) {
    const byId = jobsById.get(raw.job.toHexString());
    if (byId) return byId;
  }
  const slug = asString(raw.jobSlug);
  return jobsBySlug.get(renames.get(slug) ?? slug) ?? null;
}

function planApplicationUpgrade(raw: RawDoc, job: JobRef): Upgrade | null {
  const { createdAt, updatedAt } = timestamps(raw);
  const legacyIds = legacyIdsOf(raw);
  const set: PlainDoc = {};

  if (!isObjectIdValue(raw.job) || !raw.job.equals(job._id)) set.job = job._id;
  if (raw.jobSlug !== job.slug) set.jobSlug = job.slug;
  if (!nonEmptyString(raw.jobTitle)) {
    const position = nonEmptyString(raw.position);
    set.jobTitle = position && position.length <= JOB_TITLE_SNAPSHOT_MAX ? position : job.title;
  }
  if (typeof raw.department !== "string") set.department = job.placeholder ? "" : job.department;
  const emailNormalized = normalizeEmail(asString(raw.email));
  if (raw.emailNormalized !== emailNormalized) set.emailNormalized = emailNormalized;
  if (typeof raw.coverLetter !== "string") set.coverLetter = "";
  for (const field of ["linkedIn", "portfolio"]) {
    if (!has(raw, field) || (typeof raw[field] === "string" && !nonEmptyString(raw[field]))) set[field] = null;
  }
  const consentGiven = raw.consentGiven === true;
  if (typeof raw.consentGiven !== "boolean") set.consentGiven = consentGiven;
  if (!has(raw, "consentAt")) set.consentAt = consentGiven ? createdAt : null;
  if (!Array.isArray(raw.documents)) {
    const cv = legacyDocument("cvs", raw.cvFileName, createdAt);
    set.documents = cv ? [cv] : [];
  }

  const rawStatus = asString(raw.status);
  let status = rawStatus;
  if (!isApplicationStatus(rawStatus) && Object.prototype.hasOwnProperty.call(LEGACY_APPLICATION_STATUS_MAP, rawStatus)) {
    status = LEGACY_APPLICATION_STATUS_MAP[rawStatus];
    set.status = status;
  }
  if (!has(raw, "statusChangedAt")) set.statusChangedAt = updatedAt;
  if (!Array.isArray(raw.statusHistory)) {
    set.statusHistory = [
      {
        _id: new Types.ObjectId(),
        from: null,
        to: status,
        changedAt: createdAt,
        changedBy: null,
        changedByName: legacyIds.length > 0 ? LEGACY_AUTHOR : null,
        note: legacyIds.length > 0 ? "Imported from the previous system" : "Application submitted via website",
        candidateNotified: false,
      },
    ];
  }
  // v1 kept one overwritable notes string; its last edit is the best available timestamp.
  if (!Array.isArray(raw.notes)) set.notes = legacyNotes(asString(raw.notes), updatedAt);
  if (!has(raw, "source")) set.source = legacyIds.length > 0 ? "legacy" : "website";
  if (!has(raw, "talentPoolEntry")) set.talentPoolEntry = null;
  if (!Array.isArray(raw.legacyIds) || legacyIds.length !== raw.legacyIds.length) set.legacyIds = legacyIds;
  for (const [field, value] of Object.entries(ARCHIVE_DEFAULTS)) {
    if (!has(raw, field)) set[field] = value;
  }

  const unset = APPLICATION_V1_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(raw, field));
  if (Object.keys(set).length === 0 && unset.length === 0) return null;
  return {
    model: ApplicationModel,
    collection: "applications",
    raw,
    id: raw._id,
    guardUpdatedAt: raw.updatedAt ?? null,
    set,
    unset,
    problems: [],
  };
}

// ── Talent pool ──────────────────────────────────────────────────────────────

function planTalentUpgrade(raw: RawDoc): Upgrade | null {
  const { createdAt, updatedAt } = timestamps(raw);
  const legacyIds = legacyIdsOf(raw);
  const set: PlainDoc = {};

  const emailNormalized = normalizeEmail(asString(raw.email));
  if (raw.emailNormalized !== emailNormalized) set.emailNormalized = emailNormalized;
  if (!nonEmptyString(raw.areaOfInterest)) set.areaOfInterest = NOT_SPECIFIED;

  // v1 stored the candidate's own message in `notes`; v2 keeps it in candidateNotes and uses
  // `notes` for internal HR notes. Text beyond the candidateNotes limit is kept as HR notes.
  if (typeof raw.notes === "string") {
    const text = raw.notes.trim();
    if (typeof raw.candidateNotes === "string") {
      set.notes = legacyNotes(text, updatedAt, "Candidate's notes from the previous system:");
    } else if (text.length <= FIELD_LIMITS.candidateNotes) {
      set.candidateNotes = text;
      set.notes = [];
    } else {
      set.candidateNotes = "";
      set.notes = legacyNotes(text, updatedAt, "Candidate's notes from the previous system:");
    }
  } else if (!Array.isArray(raw.notes)) {
    set.notes = [];
  }
  if (typeof raw.candidateNotes !== "string" && !("candidateNotes" in set)) set.candidateNotes = "";

  if (!Array.isArray(raw.tags)) set.tags = [];
  if (!Array.isArray(raw.documents)) {
    const cv = legacyDocument("talent-pool", raw.cvFileName, createdAt);
    set.documents = cv ? [cv] : [];
  }
  const consentGiven = raw.consentGiven === true;
  if (typeof raw.consentGiven !== "boolean") set.consentGiven = consentGiven;
  if (!has(raw, "consentAt")) set.consentAt = consentGiven ? createdAt : null;
  if (!has(raw, "source")) set.source = legacyIds.length > 0 ? "legacy" : "self_submitted";
  if (!has(raw, "sourceApplication")) set.sourceApplication = null;
  if (!Array.isArray(raw.applications)) set.applications = [];
  if (!has(raw, "createdBy")) set.createdBy = null;
  if (!Array.isArray(raw.activity)) {
    set.activity = [
      {
        _id: new Types.ObjectId(),
        action: "created",
        at: createdAt,
        actor: null,
        actorName: legacyIds.length > 0 ? LEGACY_AUTHOR : null,
        detail: legacyIds.length > 0 ? "Imported from the previous system" : "Submitted via the website",
      },
    ];
  }
  if (!Array.isArray(raw.legacyIds) || legacyIds.length !== raw.legacyIds.length) set.legacyIds = legacyIds;
  for (const [field, value] of Object.entries(ARCHIVE_DEFAULTS)) {
    if (!has(raw, field)) set[field] = value;
  }

  const unset = TALENT_V1_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(raw, field));
  if (Object.keys(set).length === 0 && unset.length === 0) return null;
  return {
    model: TalentPoolEntryModel,
    collection: "talent_pool",
    raw,
    id: raw._id,
    guardUpdatedAt: raw.updatedAt ?? null,
    set,
    unset,
    problems: [],
  };
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function up(ctx: MigrationContext): Promise<string> {
  const verb = ctx.dryRun ? "would" : "will";

  // Jobs: every slug in use, v1 slugs that are not valid v2 URL ids, and missing fields.
  const jobs = (await JobModel.collection.find({}).toArray()) as RawDoc[];
  const allSlugs = new Set(jobs.map((job) => asString(job.slug)));
  const renames = new Map<string, string>();
  let renamedJobs = 0;
  const jobsById = new Map<string, JobRef>();
  const jobsBySlug = new Map<string, JobRef>();
  const jobUpgrades: Upgrade[] = [];

  for (const job of jobs) {
    const slug = asString(job.slug);
    let newSlug: string | null = null;
    if (!isValidJobSlug(slug)) {
      newSlug = uniqueSlug(legacySlugCandidate(slug), (candidate) => allSlugs.has(candidate));
      allSlugs.add(newSlug);
      renames.set(slug, newSlug);
      renamedJobs += 1;
      ctx.log(`job ${job._id.toHexString()}: URL id ${JSON.stringify(slug)} is not valid in v2; ${verb} become "${newSlug}"`);
    }
    const ref: JobRef = {
      _id: job._id,
      slug: newSlug ?? slug,
      title: asString(job.title),
      department: asString(job.department),
      placeholder: false,
    };
    jobsById.set(job._id.toHexString(), ref);
    jobsBySlug.set(ref.slug, ref);
    const upgrade = planJobUpgrade(job, newSlug);
    if (upgrade) jobUpgrades.push(upgrade);
  }

  // Applications whose job no longer exists get an archived placeholder job, so every
  // application keeps a valid job reference.
  const applications = (await ApplicationModel.collection.find({}).toArray()) as RawDoc[];
  const orphans = new Map<string, { title: string | null; first: Date; last: Date }>();
  for (const application of applications) {
    if (resolveJob(application, jobsById, jobsBySlug, renames)) continue;
    const slug = asString(application.jobSlug);
    const { createdAt } = timestamps(application);
    const position = nonEmptyString(application.position) ?? nonEmptyString(application.jobTitle);
    const entry = orphans.get(slug);
    if (!entry) orphans.set(slug, { title: position, first: createdAt, last: createdAt });
    else {
      if (createdAt < entry.first) entry.first = createdAt;
      if (createdAt > entry.last) entry.last = createdAt;
      entry.title ??= position;
    }
  }

  // Placeholders created by an earlier, interrupted run of this migration.
  const existingPlaceholders = new Set(
    jobs
      .filter((job) => job.origin === "postgres" && job.status === "archived" && job.description === PLACEHOLDER_JOB_DESCRIPTION)
      .map((job) => asString(job.slug))
  );

  const placeholders: PlainDoc[] = [];
  const problems: string[] = [];
  for (const [legacySlug, info] of orphans) {
    const candidateSlug = legacySlugCandidate(legacySlug);
    if (existingPlaceholders.has(candidateSlug)) {
      renames.set(legacySlug, candidateSlug);
      continue;
    }
    const slug = uniqueSlug(candidateSlug, (candidate) => allSlugs.has(candidate));
    allSlugs.add(slug);
    const doc: PlainDoc = {
      _id: new Types.ObjectId(),
      slug,
      title: truncateText(info.title ?? `Former posting ${slug}`, FIELD_LIMITS.jobTitle),
      department: NOT_SPECIFIED,
      location: NOT_SPECIFIED,
      type: "Full-time",
      experience: "",
      description: PLACEHOLDER_JOB_DESCRIPTION,
      responsibilities: [],
      requirements: [],
      qualifications: [],
      benefits: [],
      applicationDeadline: null,
      status: "archived",
      publishedAt: null,
      closedAt: null,
      archivedAt: info.last,
      createdBy: null,
      createdByName: null,
      updatedBy: null,
      updatedByName: null,
      origin: "postgres",
      createdAt: info.first,
      updatedAt: info.last,
    };
    const built = await buildValidated(JobModel, doc);
    if (!built.ok) {
      problems.push(`placeholder job "${slug}": ${built.problems.join(", ")}`);
      continue;
    }
    placeholders.push(built.doc);
    const ref: JobRef = { _id: doc._id as Types.ObjectId, slug, title: asString(built.doc.title), department: "", placeholder: true };
    jobsBySlug.set(slug, ref);
    // Later lookups of the original (possibly invalid) slug resolve to the placeholder.
    renames.set(legacySlug, slug);
    ctx.log(`placeholder job "${slug}" ${verb} be created (archived) for applications to a job that no longer exists`);
  }

  const applicationUpgrades: Upgrade[] = [];
  for (const application of applications) {
    const job = resolveJob(application, jobsById, jobsBySlug, renames);
    if (!job) {
      problems.push(`applications ${application._id.toHexString()}: job could not be resolved`);
      continue;
    }
    const upgrade = planApplicationUpgrade(application, job);
    if (upgrade) applicationUpgrades.push(upgrade);
  }

  const talent = (await TalentPoolEntryModel.collection.find({}).toArray()) as RawDoc[];
  const talentUpgrades = talent.map(planTalentUpgrade).filter((upgrade): upgrade is Upgrade => upgrade !== null);

  const upgrades = [...jobUpgrades, ...applicationUpgrades, ...talentUpgrades];
  for (const upgrade of upgrades) {
    upgrade.problems = await problemsFor(upgrade);
    if (upgrade.problems.length > 0) problems.push(`${upgrade.collection} ${upgrade.id.toHexString()}: ${upgrade.problems.join(", ")}`);
  }
  for (const problem of problems) ctx.log(`✗ ${problem}`);

  const obsolete: { model: AnyModel; name: string; label: string }[] = [];
  for (const index of OBSOLETE_INDEXES) {
    const existing = (await listIndexesIfExists(index.model)).find((candidate) => candidate.name === index.name);
    if (existing && sameKeyPattern(existing.key, index.key)) {
      obsolete.push({ model: index.model, name: index.name, label: `${index.model.collection.collectionName}.${index.name}` });
    }
  }

  const summary =
    `jobs upgraded: ${jobUpgrades.length} (URL ids changed: ${renamedJobs}), ` +
    `placeholder jobs: ${placeholders.length}, applications upgraded: ${applicationUpgrades.length}, ` +
    `talent entries upgraded: ${talentUpgrades.length}, obsolete indexes dropped: ${obsolete.length}` +
    (problems.length > 0 ? `, invalid documents: ${problems.length}` : "");

  for (const index of obsolete) ctx.log(`${ctx.dryRun ? "would drop" : "dropping"} obsolete v1 index ${index.label}`);

  if (problems.length > 0 && !ctx.allowInvalid) {
    throw new MigrationAbortedError(
      `${problems.length} document(s) would not match the v2 schema (listed above). Nothing was changed. ` +
        "Fix them, or re-run with --allow-invalid to upgrade the documents anyway and fix those records afterwards."
    );
  }
  if (ctx.dryRun) return summary;

  for (const index of obsolete) await index.model.collection.dropIndex(index.name);
  if (placeholders.length > 0) {
    await JobModel.collection.insertMany(placeholders.map((doc) => ({ ...doc, __v: 0 })));
  }

  const changedMeanwhile: string[] = [];
  for (const upgrade of upgrades) {
    const update: PlainDoc = { $set: upgrade.set };
    if (upgrade.unset.length > 0) update.$unset = Object.fromEntries(upgrade.unset.map((field) => [field, ""]));
    // Skip if the application changed the document since it was read; a re-run picks it up.
    const result = await upgrade.model.collection.updateOne({ _id: upgrade.id, updatedAt: upgrade.guardUpdatedAt }, update);
    if (result.matchedCount === 0) changedMeanwhile.push(`${upgrade.collection} ${upgrade.id.toHexString()}`);
  }
  if (changedMeanwhile.length > 0) {
    for (const entry of changedMeanwhile) ctx.log(`! ${entry} changed while the migration was running`);
    throw new MigrationAbortedError(
      `${changedMeanwhile.length} document(s) changed during the migration and were not upgraded. Run the migration again.`
    );
  }

  return summary;
}

export const careersV2Migration: Migration = {
  id: "20260917-001-careers-v2",
  description: "Upgrade careers data from the first MongoDB release to the v2 schema",
  up,
};
