// Imports the legacy PostgreSQL careers data (jobs, applications, talent_pool) into MongoDB (v2 schema).
//
//   npm run db:migrate:postgres -- --dry-run [--backup-dir <dir>] [--check-files]
//   npm run db:migrate:postgres -- --backup-dir <dir> [--confirm=<dbName>] [--prefer-source] [--check-files]
//
// Reads DATABASE_URL (legacy PostgreSQL source) and MONGODB_URI / MONGODB_DB_NAME (target).
// Run `npm run db:setup` against the target first (it applies migrations and creates the indexes).
//
// Safety:
// - PostgreSQL is only read, in one REPEATABLE READ, READ ONLY transaction (a consistent snapshot).
//   Non-local servers are reached over TLS with certificate verification (--insecure-tls disables it).
// - --backup-dir (required unless --dry-run) receives the rows exactly as read, as NDJSON, plus a
//   manifest with row counts and SHA-256 checksums, before anything is written to MongoDB.
// - Every document is validated against the application's schemas before any write. Validation
//   failures and conflicts abort the import before anything is written.
// - Re-runnable: a MongoDB record whose legacyIds contain a source row id is that row's record, and
//   is left untouched unless --prefer-source is given (which overwrites records that differ from
//   PostgreSQL, discarding changes made to them in MongoDB). Jobs are matched by URL id: a job that
//   was not imported from PostgreSQL (seeded or created by HR) with the same id is a conflict,
//   which --prefer-source resolves by overwriting it with the PostgreSQL job.
// - After writing, every source row id must appear in exactly one record's legacyIds, every job
//   must exist and every imported application must reference an existing job; otherwise the
//   script exits with status 1.
// - Output never contains candidate names, emails (masked as a***@domain), phone numbers or file names.
//
// Mapping (scripts/lib/postgres-mapping.ts): applications are grouped by (lower-cased email, job).
// The earliest row becomes the record; later rows that differ only by email case are merged into it
// (their CV as another document, their cover letter, notes and differing details as notes, one
// status history entry per row, status from the most recent row). Talent-pool rows are grouped by
// lower-cased email in the same way. Applications to a job that no longer exists in PostgreSQL get
// an archived placeholder job. CV files are not copied: documents reference the existing storage
// keys (cvs/<file> and talent-pool/<file>).

import "./lib/load-env";
import { Types, type Model } from "mongoose";
import { normalizeEmail } from "@/lib/careers/validation";
import { connectToDatabase, disconnectFromDatabase } from "@/lib/mongodb";
import { headObject } from "@/lib/storage";
import { ApplicationModel } from "@/models/application";
import { JobModel } from "@/models/job";
import type { StoredDocument } from "@/models/shared";
import { TalentPoolEntryModel } from "@/models/talent-pool-entry";
import { COMMON_OPTIONS, describeError, mapWithConcurrency, parseScriptArgs, printTable } from "./lib/cli";
import { ensureCollectionsAndIndexes } from "./lib/indexes";
import {
  asString,
  buildValidated,
  differingFields,
  legacySlugCandidate,
  maskEmail,
  reuseDocumentIds,
  uniqueSlug,
  type PlainDoc,
} from "./lib/legacy";
import { getMigrationStatus } from "./lib/migrations";
import {
  applicationGroupKey,
  assignJobSlugs,
  chronological,
  findOrphanJobs,
  groupRows,
  mapApplicationGroup,
  mapJobRow,
  mapTalentGroup,
  placeholderJob,
  talentGroupKey,
  type JobRef,
} from "./lib/postgres-mapping";
import {
  assertBackupDirUsable,
  describePostgresTarget,
  readLegacySnapshot,
  writeBackup,
  type LegacyApplicationRow,
  type LegacyJobRow,
  type LegacySnapshot,
  type LegacyTalentRow,
} from "./lib/postgres-source";
import { assertWriteConfirmed, describeTarget } from "./lib/target";

const USAGE = `Usage: npm run db:migrate:postgres -- [options]

Options:
  --dry-run            Read, map, validate and compare with MongoDB, but write nothing to MongoDB.
  --backup-dir <dir>   Write the rows read from PostgreSQL (NDJSON) and a SHA-256 manifest to <dir>,
                       which must not already contain a backup. Required unless --dry-run.
  --confirm=<dbName>   Required when MONGODB_URI is not a local server (and not --dry-run).
  --prefer-source      Overwrite MongoDB records that differ from PostgreSQL (including jobs with the
                       same URL id that were not imported from PostgreSQL).
  --check-files        Check that every referenced CV exists in object storage (HeadObject).
  --insecure-tls       Do not verify the PostgreSQL server's TLS certificate (or allow sslmode=disable).
  --no-env-files       Ignore .env.local / .env and use only exported environment variables.
  --help               Show this help.`;

const args = parseScriptArgs(
  {
    ...COMMON_OPTIONS,
    "dry-run": { type: "boolean" },
    "backup-dir": { type: "string" },
    confirm: { type: "string" },
    "prefer-source": { type: "boolean" },
    "check-files": { type: "boolean" },
    "insecure-tls": { type: "boolean" },
  },
  USAGE
);

const DRY_RUN = args["dry-run"] === true;
const BACKUP_DIR = args["backup-dir"]?.trim() || null;
const PREFER_SOURCE = args["prefer-source"] === true;
const BATCH_SIZE = 500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = Model<any>;
type Doc = PlainDoc & { _id: Types.ObjectId };

type CollectionPlan = {
  label: string;
  model: AnyModel;
  sourceRows: number | null;
  groups: number;
  inserts: Doc[];
  replaces: { doc: Doc; previousVersion: number }[];
  present: number;
  differing: string[];
  conflicts: { description: string; resolved: boolean }[];
  issues: string[];
  warnings: string[];
};

type FileReference = { collection: string; key: string; rowIds: string[] };

function newPlan(label: string, model: AnyModel, sourceRows: number | null): CollectionPlan {
  return { label, model, sourceRows, groups: 0, inserts: [], replaces: [], present: 0, differing: [], conflicts: [], issues: [], warnings: [] };
}

// Fields compared to decide whether an already-imported record still matches PostgreSQL, and
// fields that only exist in MongoDB and are kept when a record is overwritten.
const JOB_COMPARED = ["slug", "title", "department", "location", "type", "description", "responsibilities", "requirements", "status", "publishedAt", "closedAt", "archivedAt", "origin", "createdAt"];
const JOB_KEPT = ["experience", "qualifications", "benefits", "applicationDeadline", "createdBy", "createdByName", "updatedBy", "updatedByName"];
const APPLICATION_COMPARED = ["job", "jobSlug", "jobTitle", "department", "name", "email", "emailNormalized", "phone", "coverLetter", "linkedIn", "portfolio", "consentGiven", "consentAt", "documents", "status", "statusChangedAt", "statusHistory", "notes", "source", "legacyIds", "createdAt"];
const APPLICATION_KEPT = ["talentPoolEntry", "archivedAt", "archivedBy", "archivedByName", "archiveReason"];
const TALENT_COMPARED = ["name", "email", "emailNormalized", "phone", "areaOfInterest", "candidateNotes", "notes", "documents", "consentGiven", "consentAt", "source", "activity", "legacyIds", "createdAt"];
const TALENT_KEPT = ["tags", "applications", "sourceApplication", "createdBy", "archivedAt", "archivedBy", "archivedByName", "archiveReason"];

function versionOf(doc: PlainDoc): number {
  return typeof doc.__v === "number" ? doc.__v : 0;
}

function keep(target: PlainDoc, existing: PlainDoc, fields: string[]) {
  for (const field of fields) {
    if (existing[field] !== undefined) target[field] = existing[field];
  }
}

// An existing record matched to a source row/group: identical, overwritten (--prefer-source) or kept.
function recordExisting(plan: CollectionPlan, label: string, mapped: Doc, existing: Doc, compared: string[]) {
  plan.present += 1;
  const fields = differingFields(mapped, existing, compared);
  if (fields.length === 0) return;
  if (PREFER_SOURCE) plan.replaces.push({ doc: mapped, previousVersion: versionOf(existing) });
  else plan.differing.push(`${label}: ${fields.join(", ")}`);
}

type GroupMatch = { kind: "none" } | { kind: "one"; doc: Doc } | { kind: "conflict"; reason: string };

// The existing record for a group of legacy rows: none, exactly one record holding only this
// group's rows, or a conflict (rows spread over several records, or mixed with another group's).
function matchGroup(rowIds: string[], docsByRowId: Map<string, Doc>): GroupMatch {
  const docs = new Map<string, Doc>();
  for (const id of rowIds) {
    const doc = docsByRowId.get(id);
    if (doc) docs.set(doc._id.toHexString(), doc);
  }
  if (docs.size === 0) return { kind: "none" };
  if (docs.size > 1) {
    return { kind: "conflict", reason: `its rows are spread over ${docs.size} existing records (${[...docs.keys()].join(", ")})` };
  }
  const doc = [...docs.values()][0];
  const own = new Set(rowIds);
  const foreign = (Array.isArray(doc.legacyIds) ? (doc.legacyIds as string[]) : []).filter((id) => !own.has(id));
  if (foreign.length > 0) {
    return { kind: "conflict", reason: `existing record ${doc._id.toHexString()} also contains legacy row(s) ${foreign.join(", ")}` };
  }
  return { kind: "one", doc };
}

async function loadByLegacyIds(model: AnyModel, ids: string[]): Promise<Doc[]> {
  const docs = new Map<string, Doc>();
  for (let i = 0; i < ids.length; i += 1000) {
    const batch = await model.find({ legacyIds: { $in: ids.slice(i, i + 1000) } }).lean<Doc[]>();
    for (const doc of batch) docs.set(doc._id.toHexString(), doc);
  }
  return [...docs.values()];
}

function indexByLegacyId(docs: Doc[]): Map<string, Doc> {
  const map = new Map<string, Doc>();
  for (const doc of docs) {
    for (const id of Array.isArray(doc.legacyIds) ? (doc.legacyIds as string[]) : []) map.set(id, doc);
  }
  return map;
}

// ── Planning ─────────────────────────────────────────────────────────────────

async function planJobs(rows: LegacyJobRow[], existingBySlug: Map<string, Doc>, refs: Map<string, JobRef>) {
  const plan = newPlan("jobs", JobModel, rows.length);
  plan.groups = rows.length;
  const { slugs, used } = assignJobSlugs(rows.map((row) => row.id), plan);

  for (const row of [...rows].sort(chronological)) {
    const slug = slugs.get(row.id) as string;
    const label = `job "${slug}"`;
    const mapped = mapJobRow(row, slug, plan);
    if (!mapped) continue;

    const existing = existingBySlug.get(slug);
    mapped._id = existing?._id ?? new Types.ObjectId();
    if (existing) keep(mapped, existing, JOB_KEPT);
    const built = await buildValidated(JobModel, mapped);
    if (!built.ok) {
      plan.issues.push(`${label}: ${built.problems.join(", ")}`);
      continue;
    }
    const doc = built.doc as Doc;
    // Applications link to the job as it will be in MongoDB after the import.
    const effective = !existing || PREFER_SOURCE ? doc : existing;
    refs.set(row.id, { _id: doc._id, slug, title: asString(effective.title), department: asString(effective.department), placeholder: false });

    if (!existing) {
      plan.inserts.push(doc);
    } else if (existing.origin !== "postgres") {
      const createdIn = existing.origin === "seed" ? "from the sample data" : "in the new system";
      plan.conflicts.push({ description: `${label}: the URL id is already used by a job created ${createdIn}`, resolved: PREFER_SOURCE });
      if (PREFER_SOURCE) plan.replaces.push({ doc, previousVersion: versionOf(existing) });
    } else {
      recordExisting(plan, label, doc, existing, JOB_COMPARED);
    }
  }
  return { plan, usedSlugs: used };
}

async function planPlaceholderJobs(
  applications: LegacyApplicationRow[],
  legacyJobIds: Set<string>,
  usedSlugs: Set<string>,
  existingBySlug: Map<string, Doc>,
  refs: Map<string, JobRef>
): Promise<CollectionPlan> {
  const plan = newPlan("jobs (placeholders)", JobModel, null);
  const orphans = findOrphanJobs(applications, legacyJobIds);
  plan.groups = orphans.size;

  for (const [jobId, orphan] of orphans) {
    // An existing job imported from PostgreSQL with this id is the placeholder (or the job itself)
    // from an earlier run and is reused; a job from the new system with the id is avoided.
    const slug = uniqueSlug(legacySlugCandidate(jobId), (candidate) => {
      const existing = existingBySlug.get(candidate);
      return usedSlugs.has(candidate) || (existing !== undefined && existing.origin !== "postgres");
    });
    usedSlugs.add(slug);
    const label = `placeholder job "${slug}"`;
    const existing = existingBySlug.get(slug);
    if (existing) {
      plan.present += 1;
      refs.set(jobId, { _id: existing._id, slug, title: asString(existing.title), department: "", placeholder: true });
      continue;
    }
    const built = await buildValidated(JobModel, { ...placeholderJob(slug, orphan), _id: new Types.ObjectId() });
    if (!built.ok) {
      plan.issues.push(`${label}: ${built.problems.join(", ")}`);
      continue;
    }
    const doc = built.doc as Doc;
    plan.inserts.push(doc);
    refs.set(jobId, { _id: doc._id, slug, title: asString(doc.title), department: "", placeholder: true });
    plan.warnings.push(`job ${JSON.stringify(jobId)} no longer exists but has ${orphan.rows} application row(s); ${label} (archived) will hold them`);
  }
  return plan;
}

async function planApplications(rows: LegacyApplicationRow[], refs: Map<string, JobRef>, files: FileReference[]): Promise<CollectionPlan> {
  const plan = newPlan("applications", ApplicationModel, rows.length);
  const groups = groupRows(rows, applicationGroupKey);
  plan.groups = groups.length;

  const byRowId = indexByLegacyId(await loadByLegacyIds(ApplicationModel, rows.map((row) => row.id)));
  // Existing applications holding the (job, email) pair, which is unique in MongoDB.
  const pairKey = (job: Types.ObjectId, email: string) => JSON.stringify([job.toHexString(), email]);
  const byJobAndEmail = new Map<string, Doc>();
  const jobIds = [...new Map([...refs.values()].map((ref) => [ref._id.toHexString(), ref._id])).values()];
  const emails = [...new Set(rows.map((row) => normalizeEmail(row.email)))];
  for (let i = 0; i < emails.length; i += 1000) {
    const found = await ApplicationModel.find({ job: { $in: jobIds }, emailNormalized: { $in: emails.slice(i, i + 1000) } })
      .select({ _id: 1, job: 1, emailNormalized: 1 })
      .lean<Doc[]>();
    for (const doc of found) byJobAndEmail.set(pairKey(doc.job as Types.ObjectId, asString(doc.emailNormalized)), doc);
  }

  for (const group of groups) {
    const first = group[0];
    const rowIds = group.map((row) => row.id);
    const label = `application ${first.id}`;
    const who = maskEmail(first.email);
    const job = refs.get(first.job_id);
    if (!job) {
      plan.issues.push(`${label}: its job could not be imported (see the job problems above)`);
      continue;
    }
    if (group.length > 1) {
      plan.warnings.push(`${label} (${who}, job "${job.slug}"): merged ${group.length - 1} duplicate row(s): ${rowIds.slice(1).join(", ")}`);
    }
    const mapped = mapApplicationGroup(group, job, plan);
    if (!mapped) continue;
    for (const doc of mapped.documents as StoredDocument[]) files.push({ collection: "applications", key: doc.key, rowIds });

    const match = matchGroup(rowIds, byRowId);
    if (match.kind === "conflict") {
      plan.conflicts.push({ description: `${label} (${who}): ${match.reason}`, resolved: false });
      continue;
    }
    const existing = match.kind === "one" ? match.doc : null;
    const owner = byJobAndEmail.get(pairKey(job._id, asString(mapped.emailNormalized)));
    if (owner && (!existing || !owner._id.equals(existing._id))) {
      plan.conflicts.push({
        description: `${label} (${who}): record ${owner._id.toHexString()} for job "${job.slug}" was not imported from PostgreSQL`,
        resolved: false,
      });
      continue;
    }

    mapped._id = existing?._id ?? new Types.ObjectId();
    if (existing) {
      keep(mapped, existing, APPLICATION_KEPT);
      mapped.documents = reuseDocumentIds(mapped.documents as StoredDocument[], existing.documents);
    }
    const built = await buildValidated(ApplicationModel, mapped);
    if (!built.ok) {
      plan.issues.push(`${label}: ${built.problems.join(", ")}`);
      continue;
    }
    if (existing) recordExisting(plan, label, built.doc as Doc, existing, APPLICATION_COMPARED);
    else plan.inserts.push(built.doc as Doc);
  }
  return plan;
}

async function planTalent(rows: LegacyTalentRow[], files: FileReference[]): Promise<CollectionPlan> {
  const plan = newPlan("talent_pool", TalentPoolEntryModel, rows.length);
  const groups = groupRows(rows, talentGroupKey);
  plan.groups = groups.length;

  const byRowId = indexByLegacyId(await loadByLegacyIds(TalentPoolEntryModel, rows.map((row) => row.id)));
  const byEmail = new Map<string, Doc>();
  const emails = [...new Set(rows.map((row) => normalizeEmail(row.email)))];
  for (let i = 0; i < emails.length; i += 1000) {
    const found = await TalentPoolEntryModel.find({ emailNormalized: { $in: emails.slice(i, i + 1000) } })
      .select({ _id: 1, emailNormalized: 1 })
      .lean<Doc[]>();
    for (const doc of found) byEmail.set(asString(doc.emailNormalized), doc);
  }

  for (const group of groups) {
    const first = group[0];
    const rowIds = group.map((row) => row.id);
    const label = `talent entry ${first.id}`;
    const who = maskEmail(first.email);
    if (group.length > 1) {
      plan.warnings.push(`${label} (${who}): merged ${group.length - 1} duplicate row(s): ${rowIds.slice(1).join(", ")}`);
    }
    const mapped = mapTalentGroup(group, plan);
    for (const doc of mapped.documents as StoredDocument[]) files.push({ collection: "talent_pool", key: doc.key, rowIds });

    const match = matchGroup(rowIds, byRowId);
    if (match.kind === "conflict") {
      plan.conflicts.push({ description: `${label} (${who}): ${match.reason}`, resolved: false });
      continue;
    }
    const existing = match.kind === "one" ? match.doc : null;
    const owner = byEmail.get(asString(mapped.emailNormalized));
    if (owner && (!existing || !owner._id.equals(existing._id))) {
      plan.conflicts.push({
        description: `${label} (${who}): talent profile ${owner._id.toHexString()} with this email was not imported from PostgreSQL`,
        resolved: false,
      });
      continue;
    }

    mapped._id = existing?._id ?? new Types.ObjectId();
    if (existing) {
      keep(mapped, existing, TALENT_KEPT);
      mapped.documents = reuseDocumentIds(mapped.documents as StoredDocument[], existing.documents);
    }
    const built = await buildValidated(TalentPoolEntryModel, mapped);
    if (!built.ok) {
      plan.issues.push(`${label}: ${built.problems.join(", ")}`);
      continue;
    }
    if (existing) recordExisting(plan, label, built.doc as Doc, existing, TALENT_COMPARED);
    else plan.inserts.push(built.doc as Doc);
  }
  return plan;
}

// ── Reporting ────────────────────────────────────────────────────────────────

function printList(title: string, lines: string[], marker: string, limit = 200) {
  if (lines.length === 0) return;
  console.log(`\n${title} (${lines.length}):`);
  for (const line of lines.slice(0, limit)) console.log(`  ${marker} ${line}`);
  if (lines.length > limit) console.log(`  … and ${lines.length - limit} more`);
}

function printSummaryTable(plans: CollectionPlan[], inserted: (plan: CollectionPlan) => number, heading: string) {
  console.log(`\n${heading}`);
  printTable(
    ["collection", "source rows", "merged groups", "inserted", "already present", "conflicts"],
    plans.map((plan) => [plan.label, plan.sourceRows ?? "-", plan.groups, inserted(plan), plan.present, plan.conflicts.length])
  );
  const overwritten = plans.filter((plan) => plan.replaces.length > 0);
  if (overwritten.length > 0) {
    console.log(`  Overwritten with --prefer-source: ${overwritten.map((plan) => `${plan.label} ${plan.replaces.length}`).join(", ")}`);
  }
}

async function checkFiles(files: FileReference[]): Promise<{ missing: string[]; failed: string | null }> {
  const unique = [...new Map(files.map((file) => [JSON.stringify([file.collection, file.key]), file])).values()];
  console.log(`\nChecking ${unique.length} CV object(s) in storage ...`);
  try {
    const results = await mapWithConcurrency(unique, 8, async (file) => ({ file, found: (await headObject(file.key)) !== null }));
    return {
      missing: results
        .filter((result) => !result.found)
        .map((result) => `${result.file.collection}: CV for legacy row(s) ${result.file.rowIds.join(", ")} is missing from storage`),
      failed: null,
    };
  } catch (err) {
    return { missing: [], failed: describeError(err) };
  }
}

// ── Writing and reconciliation ───────────────────────────────────────────────

function describeDoc(doc: PlainDoc): string {
  if (Array.isArray(doc.legacyIds) && doc.legacyIds.length > 0) return `legacy row(s) ${(doc.legacyIds as string[]).join(", ")}`;
  return typeof doc.slug === "string" ? `"${doc.slug}"` : String(doc._id);
}

// Raw collection writes of the already cast documents, so createdAt/updatedAt from PostgreSQL are kept.
async function applyPlan(plan: CollectionPlan): Promise<{ inserted: number; replaced: number; errors: string[] }> {
  let inserted = 0;
  let replaced = 0;
  const errors: string[] = [];

  for (let i = 0; i < plan.inserts.length; i += BATCH_SIZE) {
    const batch = plan.inserts.slice(i, i + BATCH_SIZE);
    try {
      const result = await plan.model.collection.insertMany(
        batch.map((doc) => ({ ...doc, __v: 0 })),
        { ordered: false }
      );
      inserted += result.insertedCount;
    } catch (err) {
      if (!(err instanceof Error) || err.name !== "MongoBulkWriteError") throw err;
      type WriteError = { index: number; code?: number };
      const bulk = err as Error & { insertedCount?: number; writeErrors?: WriteError | WriteError[] };
      inserted += bulk.insertedCount ?? 0;
      const writeErrors = Array.isArray(bulk.writeErrors) ? bulk.writeErrors : bulk.writeErrors ? [bulk.writeErrors] : [];
      for (const writeError of writeErrors) {
        errors.push(`${plan.label} ${describeDoc(batch[writeError.index])}: insert failed (code ${writeError.code ?? "unknown"})`);
      }
      if (writeErrors.length === 0) errors.push(`${plan.label}: insert batch failed (${describeError(err)})`);
    }
  }

  for (const { doc, previousVersion } of plan.replaces) {
    const { _id, ...replacement } = doc;
    try {
      const result = await plan.model.collection.replaceOne({ _id }, { ...replacement, __v: previousVersion + 1 });
      if (result.matchedCount === 1) replaced += 1;
      else errors.push(`${plan.label} ${describeDoc(doc)}: record ${_id.toHexString()} no longer exists`);
    } catch (err) {
      errors.push(`${plan.label} ${describeDoc(doc)}: overwrite failed (${describeError(err)})`);
    }
  }
  return { inserted, replaced, errors };
}

async function reconcile(snapshot: LegacySnapshot, refs: Map<string, JobRef>): Promise<string[]> {
  const problems: string[] = [];

  for (const row of snapshot.jobs) {
    if (!refs.has(row.id)) problems.push(`jobs: legacy job ${JSON.stringify(row.id)} was not imported`);
  }
  // Every legacy job, and every job id an application refers to, resolves to an imported job.
  const expectedSlugs = [...new Set([...refs.values()].map((ref) => ref.slug))];
  const jobs = await JobModel.find({ slug: { $in: expectedSlugs } }).select({ slug: 1, origin: 1 }).lean<Doc[]>();
  const jobsBySlug = new Map(jobs.map((job) => [asString(job.slug), job]));
  for (const slug of expectedSlugs) {
    const job = jobsBySlug.get(slug);
    if (!job) problems.push(`jobs: "${slug}" is missing`);
    else if (job.origin !== "postgres") problems.push(`jobs: "${slug}" is not marked as imported from PostgreSQL`);
  }

  const checkLegacyIds = async (label: string, model: AnyModel, ids: string[]) => {
    const docs = await loadByLegacyIds(model, ids);
    const counts = new Map<string, number>();
    for (const doc of docs) {
      for (const id of doc.legacyIds as string[]) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const id of ids) {
      const count = counts.get(id) ?? 0;
      if (count !== 1) problems.push(`${label}: legacy row ${id} is in ${count} records (expected exactly 1)`);
    }
    return docs;
  };

  const applications = await checkLegacyIds("applications", ApplicationModel, snapshot.applications.map((row) => row.id));
  await checkLegacyIds("talent_pool", TalentPoolEntryModel, snapshot.talentPool.map((row) => row.id));

  const referenced = [...new Map(applications.map((doc) => [String(doc.job), doc.job as Types.ObjectId])).values()];
  const found = new Set(
    (await JobModel.find({ _id: { $in: referenced } }).select({ _id: 1 }).lean<Doc[]>()).map((job) => job._id.toHexString())
  );
  for (const doc of applications) {
    if (!found.has(String(doc.job))) problems.push(`applications: record ${doc._id.toHexString()} references a job that does not exist`);
  }
  return problems;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL (the legacy PostgreSQL connection string) is not set.");
  if (!DRY_RUN && !BACKUP_DIR) {
    console.error(`--backup-dir is required unless --dry-run is given.\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const source = describePostgresTarget(databaseUrl);
  console.log(`Source: PostgreSQL ${source}${args["insecure-tls"] ? " (TLS certificate NOT verified)" : ""}`);
  console.log(`Target: MongoDB ${describeTarget()}`);
  console.log(`Mode:   ${DRY_RUN ? "DRY RUN (nothing is written to MongoDB)" : "IMPORT"}${PREFER_SOURCE ? ", prefer source" : ""}`);
  if (!DRY_RUN) assertWriteConfirmed(process.argv.slice(2));
  if (BACKUP_DIR) await assertBackupDirUsable(BACKUP_DIR);

  console.log("\nReading PostgreSQL (REPEATABLE READ, READ ONLY) ...");
  const snapshot = await readLegacySnapshot(databaseUrl, { insecureTls: args["insecure-tls"] === true });
  for (const table of snapshot.missingTables) console.log(`  ! table ${table} does not exist; treated as empty`);
  console.log(`  jobs: ${snapshot.jobs.length}, applications: ${snapshot.applications.length}, talent_pool: ${snapshot.talentPool.length}`);

  if (BACKUP_DIR) {
    const manifest = await writeBackup(BACKUP_DIR, snapshot, source);
    console.log(`\nBackup written to ${BACKUP_DIR} (contains personal data; store it securely)`);
    for (const [name, file] of Object.entries(manifest.files)) {
      console.log(`  ${name}: ${file.rows} row(s), ${file.bytes} bytes, sha256 ${file.sha256}`);
    }
  }

  await connectToDatabase({ autoSchemaSetup: false });
  const migrations = await getMigrationStatus();
  if (migrations.pending.length > 0) {
    const message = `MongoDB has pending data migrations (${migrations.pending.map((m) => m.id).join(", ")}). Run \`npm run db:setup\` first.`;
    if (!DRY_RUN) throw new Error(message);
    console.log(`\n! ${message} The plan below may be inaccurate for data from the first MongoDB release.`);
  }

  console.log("\nPlanning ...");
  const existingJobs = await JobModel.find({}).lean<Doc[]>();
  const existingBySlug = new Map(existingJobs.map((job) => [asString(job.slug), job]));
  const refs = new Map<string, JobRef>();
  const files: FileReference[] = [];

  const { plan: jobsPlan, usedSlugs } = await planJobs(snapshot.jobs, existingBySlug, refs);
  const legacyJobIds = new Set(snapshot.jobs.map((row) => row.id));
  const placeholderPlan = await planPlaceholderJobs(snapshot.applications, legacyJobIds, usedSlugs, existingBySlug, refs);
  const applicationsPlan = await planApplications(snapshot.applications, refs, files);
  const talentPlan = await planTalent(snapshot.talentPool, files);
  const plans = [jobsPlan, placeholderPlan, applicationsPlan, talentPlan];

  printList("Warnings", plans.flatMap((plan) => plan.warnings), "!");
  printList(
    PREFER_SOURCE
      ? "Already imported records that differ from PostgreSQL (will be overwritten)"
      : "Already imported records that differ from PostgreSQL (kept; --prefer-source overwrites them)",
    plans.flatMap((plan) => plan.differing),
    "~"
  );
  printList(
    "Conflicts",
    plans.flatMap((plan) => plan.conflicts.map((c) => `${c.description}${c.resolved ? " (will be overwritten: --prefer-source)" : ""}`)),
    "✗"
  );
  printList("Invalid records", plans.flatMap((plan) => plan.issues), "✗");

  let storageProblem = false;
  if (args["check-files"] === true) {
    const result = await checkFiles(files);
    if (result.failed) {
      storageProblem = true;
      console.log(`  ✗ Storage check failed: ${result.failed}`);
    } else if (result.missing.length === 0) {
      console.log("  ✓ All referenced CV objects exist.");
    } else {
      printList("Missing CV objects (the records are still imported)", result.missing, "!");
    }
  }

  const blocking =
    plans.reduce((sum, plan) => sum + plan.issues.length + plan.conflicts.filter((c) => !c.resolved).length, 0) + (storageProblem ? 1 : 0);

  if (DRY_RUN || blocking > 0) {
    printSummaryTable(plans, (plan) => plan.inserts.length, 'Plan (not written; "inserted" = would insert)');
    if (blocking > 0) {
      console.log(`\n✗ ${blocking} blocking problem(s) listed above; ${DRY_RUN ? "the import would abort" : "aborted"} before writing to MongoDB.`);
      process.exitCode = 1;
    } else {
      console.log("\n✓ Dry run complete: the import can proceed.");
    }
    return;
  }

  console.log("\nEnsuring collections and indexes ...");
  const indexes = await ensureCollectionsAndIndexes((line) => console.log(line), { dropStale: false });
  if (indexes.failures.length > 0) {
    console.log("\n✗ Aborted before importing: required indexes could not be created (see above).");
    process.exitCode = 1;
    return;
  }

  console.log("\nImporting ...");
  const inserted = new Map<CollectionPlan, number>();
  const writeErrors: string[] = [];
  for (const plan of plans) {
    const result = await applyPlan(plan);
    inserted.set(plan, result.inserted);
    writeErrors.push(...result.errors);
    console.log(`  ${plan.label}: inserted ${result.inserted}, overwritten ${result.replaced}`);
  }
  printList("Write errors", writeErrors, "✗");

  console.log("\nReconciling ...");
  const mismatches = await reconcile(snapshot, refs);
  printSummaryTable(plans, (plan) => inserted.get(plan) ?? 0, "Result");
  printList("Reconciliation mismatches", mismatches, "✗");

  if (mismatches.length > 0 || writeErrors.length > 0) {
    console.log("\n✗ Import finished with problems. PostgreSQL was not modified; fix the problems and re-run (the import is idempotent).");
    process.exitCode = 1;
  } else {
    console.log("\n✓ Import complete: every PostgreSQL row is in exactly one MongoDB record. PostgreSQL was not modified.");
  }
}

main()
  .catch((err: unknown) => {
    console.error(`\n✗ Import failed: ${describeError(err)}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectFromDatabase());
