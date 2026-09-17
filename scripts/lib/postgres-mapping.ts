import { Types } from "mongoose";
import { FIELD_LIMITS, LEGACY_APPLICATION_STATUS_MAP, type ApplicationStatus } from "@/lib/careers/constants";
import { isValidJobSlug, normalizeEmail } from "@/lib/careers/validation";
import type { NoteEntry, StoredDocument } from "@/models/shared";
import {
  LEGACY_AUTHOR,
  NOT_SPECIFIED,
  PLACEHOLDER_JOB_DESCRIPTION,
  legacyDocument,
  legacyNotes,
  legacySlugCandidate,
  nonEmptyString,
  truncateText,
  uniqueSlug,
  type PlainDoc,
} from "./legacy";
import type { LegacyApplicationRow, LegacyJobRow, LegacyTalentRow } from "./postgres-source";

// Pure mapping from legacy PostgreSQL rows to v2 MongoDB documents (no database access).
// Documents are returned without `_id`; the import assigns it after matching existing records.

// Where problems found while mapping are collected. Issues block the import; warnings do not.
export type MappingLog = { issues: string[]; warnings: string[] };

// The MongoDB job an application row belongs to.
export type JobRef = { _id: Types.ObjectId; slug: string; title: string; department: string; placeholder: boolean };

export type OrphanJob = { title: string | null; first: Date; last: Date; rows: number };

const JOB_TITLE_SNAPSHOT_MAX = FIELD_LIMITS.jobTitle + 50;

export function chronological(a: { id: string; created_at: Date }, b: { id: string; created_at: Date }): number {
  return a.created_at.getTime() - b.created_at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// Groups rows by key; groups and the rows inside them are in chronological order.
export function groupRows<R extends { id: string; created_at: Date }>(rows: R[], keyOf: (row: R) => string): R[][] {
  const groups = new Map<string, R[]>();
  for (const row of [...rows].sort(chronological)) {
    const key = keyOf(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()];
}

export function applicationGroupKey(row: LegacyApplicationRow): string {
  return JSON.stringify([normalizeEmail(row.email), row.job_id]);
}

export function talentGroupKey(row: LegacyTalentRow): string {
  return normalizeEmail(row.email);
}

function uniqueDocuments(documents: StoredDocument[]): StoredDocument[] {
  const seen = new Set<string>();
  return documents.filter((doc) => {
    if (seen.has(doc.key)) return false;
    seen.add(doc.key);
    return true;
  });
}

function requiredText(value: string, label: string, fallback: string, log: MappingLog): string {
  const trimmed = value.trim();
  if (trimmed) return trimmed;
  log.warnings.push(`${label} is empty; imported as "${fallback}"`);
  return fallback;
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

// URL ids for legacy job ids. Valid ids are kept; invalid ones (upper case, spaces, too short) are
// converted, never taking an id that another legacy job uses as-is. Deterministic for a given
// set of ids, so re-running the import maps every job to the same slug.
export function assignJobSlugs(ids: string[], log: MappingLog): { slugs: Map<string, string>; used: Set<string> } {
  const valid = new Set(ids.map((id) => id.trim()).filter(isValidJobSlug));
  const used = new Set<string>();
  const slugs = new Map<string, string>();
  for (const id of ids) {
    const trimmed = id.trim();
    const slug =
      isValidJobSlug(trimmed) && !used.has(trimmed)
        ? trimmed
        : uniqueSlug(legacySlugCandidate(id), (candidate) => used.has(candidate) || valid.has(candidate));
    used.add(slug);
    slugs.set(id, slug);
    if (slug !== id) log.warnings.push(`job ${JSON.stringify(id)}: not a valid URL id; imported as "${slug}"`);
  }
  return { slugs, used };
}

function toTextList(value: unknown): string[] | null {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return value.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function mapJobRow(row: LegacyJobRow, slug: string, log: MappingLog): PlainDoc | null {
  const label = `job "${slug}"`;
  const responsibilities = toTextList(row.responsibilities);
  const requirements = toTextList(row.requirements);
  if (!responsibilities || !requirements) {
    log.issues.push(`${label}: ${!responsibilities ? "responsibilities" : "requirements"} is not a JSON array of text`);
    return null;
  }
  if (row.status !== "draft" && row.status !== "published" && row.status !== "closed") {
    log.issues.push(`${label}: unknown status ${JSON.stringify(row.status)}`);
    return null;
  }

  // A published job must meet the v2 publishing rules; otherwise it is imported as closed.
  let status: string = row.status;
  if (status === "published" && (responsibilities.length === 0 || requirements.length === 0 || !row.description.trim())) {
    status = "closed";
    log.warnings.push(`${label}: published without responsibilities, requirements or description; imported as closed`);
  }

  return {
    slug,
    title: requiredText(row.title, `${label} title`, `Untitled posting ${slug}`, log),
    department: requiredText(row.department, `${label} department`, NOT_SPECIFIED, log),
    location: requiredText(row.location, `${label} location`, NOT_SPECIFIED, log),
    type: row.type,
    experience: "",
    description: requiredText(row.description, `${label} description`, "No description was recorded in the previous system.", log),
    responsibilities,
    requirements,
    qualifications: [],
    benefits: [],
    applicationDeadline: null,
    status,
    publishedAt: row.status === "published" || row.status === "closed" ? row.created_at : null,
    closedAt: status === "closed" ? row.updated_at : null,
    archivedAt: null,
    createdBy: null,
    createdByName: null,
    updatedBy: null,
    updatedByName: null,
    origin: "postgres",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Legacy job ids referenced by applications but missing from the jobs table, in order of first use.
export function findOrphanJobs(applications: LegacyApplicationRow[], legacyJobIds: Set<string>): Map<string, OrphanJob> {
  const orphans = new Map<string, OrphanJob>();
  for (const row of [...applications].sort(chronological)) {
    if (legacyJobIds.has(row.job_id)) continue;
    const entry = orphans.get(row.job_id);
    if (!entry) {
      orphans.set(row.job_id, { title: nonEmptyString(row.position), first: row.created_at, last: row.created_at, rows: 1 });
    } else {
      entry.last = row.created_at;
      entry.rows += 1;
      entry.title ??= nonEmptyString(row.position);
    }
  }
  return orphans;
}

export function placeholderJob(slug: string, orphan: OrphanJob): PlainDoc {
  return {
    slug,
    title: truncateText(orphan.title ?? `Former posting ${slug}`, FIELD_LIMITS.jobTitle),
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
    archivedAt: orphan.last,
    createdBy: null,
    createdByName: null,
    updatedBy: null,
    updatedByName: null,
    origin: "postgres",
    createdAt: orphan.first,
    updatedAt: orphan.last,
  };
}

// ── Applications ─────────────────────────────────────────────────────────────

// Contact details a merged duplicate submitted that differ from the record, kept as a note.
function detailChanges(
  row: { name: string; email: string; phone: string },
  record: { name: string; email: string; phone: string },
  extra: [string, string | null, string | null][]
): string {
  const lines: string[] = [];
  if (row.name.trim() !== record.name.trim()) lines.push(`Name: ${row.name.trim()}`);
  if (row.email.trim() !== record.email.trim()) lines.push(`Email: ${row.email.trim()}`);
  if (row.phone.trim() !== record.phone.trim()) lines.push(`Phone: ${row.phone.trim()}`);
  for (const [label, value, recorded] of extra) {
    if (value && value !== recorded) lines.push(`${label}: ${value}`);
  }
  return lines.join("\n");
}

// `rows` are one (email, job) group in chronological order; the earliest row is the record.
export function mapApplicationGroup(rows: LegacyApplicationRow[], job: JobRef, log: MappingLog): PlainDoc | null {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const label = `application ${first.id}`;

  const statuses: ApplicationStatus[] = [];
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(LEGACY_APPLICATION_STATUS_MAP, row.status)) {
      log.issues.push(`${label}: legacy row ${row.id} has unknown status ${JSON.stringify(row.status)}`);
      return null;
    }
    statuses.push(LEGACY_APPLICATION_STATUS_MAP[row.status]);
  }

  const linkedIn = rows.map((row) => nonEmptyString(row.linked_in)).find(Boolean) ?? null;
  const portfolio = rows.map((row) => nonEmptyString(row.portfolio)).find(Boolean) ?? null;
  const position = nonEmptyString(first.position);
  const consenting = rows.find((row) => row.consent_given);

  const notes: NoteEntry[] = [...legacyNotes(first.notes, first.created_at)];
  for (const row of rows.slice(1)) {
    const heading = `Merged duplicate submission (${row.id})`;
    const details = detailChanges(row, first, [
      ["Position", nonEmptyString(row.position), position],
      ["LinkedIn", nonEmptyString(row.linked_in), linkedIn],
      ["Portfolio", nonEmptyString(row.portfolio), portfolio],
    ]);
    notes.push(...legacyNotes(details, row.created_at, `${heading}, submitted details:`));
    notes.push(...legacyNotes(row.cover_letter, row.created_at, `${heading}, cover letter:`));
    notes.push(...legacyNotes(row.notes, row.created_at, `${heading}, HR notes:`));
  }

  const documents: StoredDocument[] = [];
  for (const row of rows) {
    const doc = legacyDocument("cvs", row.cv_file_name, row.created_at);
    if (doc) documents.push(doc);
    else log.warnings.push(`${label}: legacy row ${row.id} has no CV file name`);
  }

  return {
    job: job._id,
    jobSlug: job.slug,
    jobTitle: position && position.length <= JOB_TITLE_SNAPSHOT_MAX ? position : job.title,
    department: job.placeholder ? "" : job.department,
    name: requiredText(first.name, `${label} name`, "Unknown applicant", log),
    email: first.email.trim(),
    emailNormalized: normalizeEmail(first.email),
    phone: requiredText(first.phone, `${label} phone`, "Not provided", log),
    coverLetter: first.cover_letter.replace(/\r\n/g, "\n").trim(),
    linkedIn,
    portfolio,
    consentGiven: consenting !== undefined,
    consentAt: consenting?.created_at ?? null,
    documents: uniqueDocuments(documents),
    status: statuses[statuses.length - 1],
    statusChangedAt: last.created_at,
    // One entry per legacy row, so the merge is visible in the timeline.
    statusHistory: rows.map((row, i) => ({
      _id: new Types.ObjectId(),
      from: i === 0 ? null : statuses[i - 1],
      to: statuses[i],
      changedAt: row.created_at,
      changedBy: null,
      changedByName: LEGACY_AUTHOR,
      note: i === 0 ? `Imported from the previous system (${row.id})` : `Merged duplicate submission (${row.id})`,
      candidateNotified: false,
    })),
    notes,
    source: "legacy",
    talentPoolEntry: null,
    legacyIds: rows.map((row) => row.id),
    archivedAt: null,
    archivedBy: null,
    archivedByName: null,
    archiveReason: "",
    createdAt: first.created_at,
    updatedAt: last.created_at,
  };
}

// ── Talent pool ──────────────────────────────────────────────────────────────

// `rows` are one email group in chronological order; the earliest row is the record.
export function mapTalentGroup(rows: LegacyTalentRow[], log: MappingLog): PlainDoc {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const label = `talent entry ${first.id}`;
  const area = requiredText(first.area_of_interest, `${label} area of interest`, NOT_SPECIFIED, log);

  // The candidate's own notes: concatenated (only the candidate's words; the merge itself is recorded
  // in the activity timeline) when they fit the candidate-notes limit, otherwise kept in full as HR
  // notes (never truncated).
  const withNotes = rows.filter((row) => row.notes.trim());
  const joined = [...new Set(withNotes.map((row) => row.notes.replace(/\r\n/g, "\n").trim()))].join("\n\n");
  const notes: NoteEntry[] = [];
  let candidateNotes = "";
  if (joined.length <= FIELD_LIMITS.candidateNotes) {
    candidateNotes = joined;
  } else {
    for (const row of withNotes) {
      const heading = row === first ? "Candidate's notes from the previous system:" : `Merged duplicate submission (${row.id}), candidate's notes:`;
      notes.push(...legacyNotes(row.notes, row.created_at, heading));
    }
  }
  for (const row of rows.slice(1)) {
    const details = detailChanges(row, first, [["Area of interest", nonEmptyString(row.area_of_interest), area]]);
    notes.push(...legacyNotes(details, row.created_at, `Merged duplicate submission (${row.id}), submitted details:`));
  }
  notes.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const documents: StoredDocument[] = [];
  for (const row of rows) {
    const doc = legacyDocument("talent-pool", row.cv_file_name, row.created_at);
    if (doc) documents.push(doc);
    else log.warnings.push(`${label}: legacy row ${row.id} has no CV file name`);
  }
  const consenting = rows.find((row) => row.consent_given);

  return {
    name: requiredText(first.name, `${label} name`, "Unknown candidate", log),
    email: first.email.trim(),
    emailNormalized: normalizeEmail(first.email),
    phone: requiredText(first.phone, `${label} phone`, "Not provided", log),
    areaOfInterest: area,
    candidateNotes,
    tags: [],
    notes,
    documents: uniqueDocuments(documents),
    consentGiven: consenting !== undefined,
    consentAt: consenting?.created_at ?? null,
    source: "legacy",
    sourceApplication: null,
    applications: [],
    createdBy: null,
    activity: rows.map((row, i) => ({
      _id: new Types.ObjectId(),
      action: i === 0 ? "created" : "merged_duplicate",
      at: row.created_at,
      actor: null,
      actorName: LEGACY_AUTHOR,
      detail: i === 0 ? `Imported from the previous system (${row.id})` : `Merged duplicate submission (${row.id})`,
    })),
    legacyIds: rows.map((row) => row.id),
    archivedAt: null,
    archivedBy: null,
    archivedByName: null,
    archiveReason: "",
    createdAt: first.created_at,
    updatedAt: last.created_at,
  };
}
