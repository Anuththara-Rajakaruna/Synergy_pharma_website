import {
  APPLICATION_SOURCES,
  APPLICATION_STATUSES,
  FIELD_LIMITS,
  type ApplicationSource,
  type ApplicationStatus,
} from "@/lib/careers/constants";
import { idTimestamp } from "@/lib/careers/server/ids";
import type { ApplicationRecord } from "@/lib/careers/server/records";
import {
  decodeBoolean,
  decodeDate,
  decodeDateOr,
  decodeEnum,
  decodeMultiline,
  decodeText,
  decodeTextOrNull,
  encodeBoolean,
  encodeDate,
  encodeText,
} from "@/lib/sheets-db/codec";
import {
  loadDocumentsByOwner,
  loadNotesByOwner,
  loadStatusHistoryByApplication,
} from "@/lib/sheets-db/repositories/subrecords";
import { allRecords, appendRecord, findRecord, updateRecord, type RecordValues, type TableRecord } from "@/lib/sheets-db/table";

// The Applications tab, plus the three sub-record tabs that complete an application.
//
// A "shallow" application is the row on its own: enough for the list view, one read. A "full"
// application additionally carries its documents, notes and status history, which the detail
// view needs. Keeping the two apart is what stops the list endpoint from loading every note in
// the system on every page view.

export type ShallowApplication = Omit<ApplicationRecord, "documents" | "notes" | "statusHistory">;

export function toShallowApplication(values: RecordValues): ShallowApplication {
  const id = decodeText(values.id);
  const createdAt = decodeDateOr(values.createdAt, idTimestamp(id) ?? new Date(0));
  return {
    id,
    job: decodeText(values.jobId),
    jobSlug: decodeText(values.jobSlug),
    jobTitle: decodeText(values.jobTitle),
    department: decodeText(values.department),
    name: decodeText(values.name),
    email: decodeText(values.email),
    emailNormalized: decodeText(values.emailNormalized).toLowerCase() || decodeText(values.email).toLowerCase(),
    phone: decodeText(values.phone),
    coverLetter: decodeMultiline(values.coverLetter),
    linkedIn: decodeTextOrNull(values.linkedIn),
    portfolio: decodeTextOrNull(values.portfolio),
    consentGiven: decodeBoolean(values.consentGiven),
    consentAt: decodeDate(values.consentAt),
    status: decodeEnum<ApplicationStatus>(values.status, APPLICATION_STATUSES, "submitted"),
    statusChangedAt: decodeDateOr(values.statusChangedAt, createdAt),
    source: decodeEnum<ApplicationSource>(values.source, APPLICATION_SOURCES, "website"),
    talentPoolEntry: decodeTextOrNull(values.talentPoolEntryId),
    archivedAt: decodeDate(values.archivedAt),
    archivedBy: decodeTextOrNull(values.archivedBy),
    archivedByName: decodeTextOrNull(values.archivedByName),
    archiveReason: decodeMultiline(values.archiveReason),
    supersededBy: decodeTextOrNull(values.supersededBy),
    createdAt,
    updatedAt: decodeDateOr(values.updatedAt, createdAt),
  };
}

export function applicationRow(application: ApplicationRecord | ShallowApplication): RecordValues {
  return {
    id: application.id,
    // Denormalised so the spreadsheet is readable on its own; the application derives it from
    // the id everywhere else.
    reference: `APP-${application.id.slice(-8).toUpperCase()}`,
    jobId: application.job,
    jobSlug: encodeText(application.jobSlug, FIELD_LIMITS.jobSlugMax),
    jobTitle: encodeText(application.jobTitle, FIELD_LIMITS.jobTitle + 50),
    department: encodeText(application.department, FIELD_LIMITS.department),
    name: encodeText(application.name, FIELD_LIMITS.name),
    email: encodeText(application.email, FIELD_LIMITS.email),
    emailNormalized: encodeText(application.emailNormalized, FIELD_LIMITS.email),
    phone: encodeText(application.phone, 40),
    coverLetter: encodeText(application.coverLetter, FIELD_LIMITS.coverLetter),
    linkedIn: encodeText(application.linkedIn, FIELD_LIMITS.url),
    portfolio: encodeText(application.portfolio, FIELD_LIMITS.url),
    consentGiven: encodeBoolean(application.consentGiven),
    consentAt: encodeDate(application.consentAt),
    status: application.status,
    statusChangedAt: encodeDate(application.statusChangedAt),
    source: application.source,
    talentPoolEntryId: application.talentPoolEntry ?? "",
    archivedAt: encodeDate(application.archivedAt),
    archivedBy: application.archivedBy ?? "",
    archivedByName: encodeText(application.archivedByName, 200),
    archiveReason: encodeText(application.archiveReason, FIELD_LIMITS.archiveReason),
    supersededBy: application.supersededBy ?? "",
    createdAt: encodeDate(application.createdAt),
    updatedAt: encodeDate(application.updatedAt),
  };
}

// Rows that lost a duplicate race are hidden from every listing, count and export, the same way
// the unique index used to stop them existing at all.
function isLive(values: RecordValues): boolean {
  return decodeText(values.id) !== "" && !decodeText(values.supersededBy);
}

export async function listAllApplications(opts: { maxAgeMs?: number } = {}): Promise<ShallowApplication[]> {
  const rows = await allRecords("Applications", opts);
  return rows.filter((row) => isLive(row.values)).map((row) => toShallowApplication(row.values));
}

export async function findApplicationById(
  id: string,
  opts: { maxAgeMs?: number; refreshOnMiss?: boolean } = {}
): Promise<ShallowApplication | null> {
  const row = await findRecord("Applications", (values) => decodeText(values.id) === id && isLive(values), opts);
  return row ? toShallowApplication(row.values) : null;
}

// The one-application-per-job rule. `refreshOnMiss` matters here: concluding "no application
// yet" from a stale cache is what would let a duplicate through.
export async function findApplicationByJobAndEmail(
  jobId: string,
  emailNormalized: string,
  opts: { maxAgeMs?: number; refreshOnMiss?: boolean } = {}
): Promise<ShallowApplication | null> {
  const email = emailNormalized.trim().toLowerCase();
  if (!jobId || !email) return null;
  const row = await findRecord(
    "Applications",
    (values) => decodeText(values.jobId) === jobId && decodeText(values.emailNormalized).toLowerCase() === email && isLive(values),
    opts
  );
  return row ? toShallowApplication(row.values) : null;
}

export async function insertApplication(application: ApplicationRecord): Promise<TableRecord> {
  return appendRecord("Applications", applicationRow(application));
}

// The columns an update may touch, each with the column name it maps to and how to encode it.
// Immutable fields (the candidate's own details, the job snapshot, createdAt) are absent on
// purpose: a patch can never rewrite the submission itself.
type PatchEncoder = { column: string; encode: (value: unknown) => string };

const APPLICATION_PATCH: Partial<Record<keyof ApplicationRecord, PatchEncoder>> = {
  status: { column: "status", encode: (value) => String(value) },
  statusChangedAt: { column: "statusChangedAt", encode: (value) => encodeDate(value as Date | null) },
  talentPoolEntry: { column: "talentPoolEntryId", encode: (value) => (value as string | null) ?? "" },
  archivedAt: { column: "archivedAt", encode: (value) => encodeDate(value as Date | null) },
  archivedBy: { column: "archivedBy", encode: (value) => (value as string | null) ?? "" },
  archivedByName: { column: "archivedByName", encode: (value) => encodeText(value as string | null, 200) },
  archiveReason: { column: "archiveReason", encode: (value) => encodeText(value as string, FIELD_LIMITS.archiveReason) },
  supersededBy: { column: "supersededBy", encode: (value) => (value as string | null) ?? "" },
  updatedAt: { column: "updatedAt", encode: (value) => encodeDate(value as Date | null) },
};

export async function patchApplication(id: string, patch: Partial<ApplicationRecord>): Promise<boolean> {
  const values: RecordValues = {};
  for (const [field, value] of Object.entries(patch)) {
    const encoder = APPLICATION_PATCH[field as keyof ApplicationRecord];
    if (encoder) values[encoder.column] = encoder.encode(value);
  }
  return updateRecord("Applications", id, values);
}

// Marks a row that lost a duplicate race. It stays in the sheet - deleting would renumber every
// row below it - but is invisible to the application from this point on.
export async function supersedeApplication(id: string, winnerId: string): Promise<void> {
  await updateRecord("Applications", id, { supersededBy: winnerId, updatedAt: encodeDate(new Date()) });
}

// ── Full records ─────────────────────────────────────────────────────────────

// Attaches documents, notes and status history to shallow rows. One read per sub-record tab,
// regardless of how many applications are being hydrated.
export async function hydrateApplications(
  shallow: ShallowApplication[],
  opts: { maxAgeMs?: number } = {}
): Promise<ApplicationRecord[]> {
  if (shallow.length === 0) return [];
  const [documents, notes, history] = await Promise.all([
    loadDocumentsByOwner("application", opts),
    loadNotesByOwner("application", opts),
    loadStatusHistoryByApplication(opts),
  ]);

  return shallow.map((application) => ({
    ...application,
    documents: documents.get(application.id) ?? [],
    notes: notes.get(application.id) ?? [],
    statusHistory: (history.get(application.id) ?? []).slice().sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime()),
  }));
}

export async function loadApplication(id: string, opts: { refreshOnMiss?: boolean } = {}): Promise<ApplicationRecord | null> {
  const shallow = await findApplicationById(id, opts);
  if (!shallow) return null;
  const [full] = await hydrateApplications([shallow]);
  return full ?? null;
}

// Counts per job id, for the admin jobs list. Archived applications are included, matching the
// count the previous implementation produced.
export async function countApplicationsByJob(opts: { maxAgeMs?: number } = {}): Promise<Map<string, number>> {
  const rows = await allRecords("Applications", opts);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!isLive(row.values)) continue;
    const jobId = decodeText(row.values.jobId);
    if (!jobId) continue;
    counts.set(jobId, (counts.get(jobId) ?? 0) + 1);
  }
  return counts;
}

// Row numbers for the retention purge, which is the only code allowed to delete rows.
export async function applicationRowNumbers(ids: Set<string>): Promise<number[]> {
  const rows = await allRecords("Applications", { maxAgeMs: 0 });
  return rows.filter((row) => ids.has(decodeText(row.values.id))).map((row) => row.rowNumber);
}
