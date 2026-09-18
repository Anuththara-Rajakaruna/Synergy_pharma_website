import { FIELD_LIMITS, JOB_STATUSES, JOB_TYPES, type JobStatus, type JobType } from "@/lib/careers/constants";
import { idTimestamp } from "@/lib/careers/server/ids";
import { JOB_ORIGINS, type JobOrigin, type JobRecord } from "@/lib/careers/server/records";
import {
  decodeDate,
  decodeDateOr,
  decodeEnum,
  decodeMultiline,
  decodeStringList,
  decodeText,
  decodeTextOrNull,
  encodeDate,
  encodeJson,
  encodeText,
} from "@/lib/sheets-db/codec";
import { allRecords, appendRecord, findRecord, updateRecord, type RecordValues, type TableRecord } from "@/lib/sheets-db/table";

// The Jobs tab. A job is a single row: the list fields (responsibilities, requirements, ...) are
// JSON in one cell each, because they are always read and written together with the job.

export function toJobRecord(values: RecordValues): JobRecord {
  const id = decodeText(values.id);
  const createdFallback = idTimestamp(id) ?? new Date(0);
  const createdAt = decodeDateOr(values.createdAt, createdFallback);
  return {
    id,
    slug: decodeText(values.slug).toLowerCase(),
    title: decodeText(values.title),
    department: decodeText(values.department),
    location: decodeText(values.location),
    type: decodeEnum<JobType>(values.type, JOB_TYPES, "Full-time"),
    experience: decodeText(values.experience),
    description: decodeMultiline(values.description),
    responsibilities: decodeStringList(values.responsibilities),
    requirements: decodeStringList(values.requirements),
    qualifications: decodeStringList(values.qualifications),
    benefits: decodeStringList(values.benefits),
    applicationDeadline: decodeDate(values.applicationDeadline),
    status: decodeEnum<JobStatus>(values.status, JOB_STATUSES, "draft"),
    publishedAt: decodeDate(values.publishedAt),
    closedAt: decodeDate(values.closedAt),
    archivedAt: decodeDate(values.archivedAt),
    createdBy: decodeTextOrNull(values.createdBy),
    createdByName: decodeTextOrNull(values.createdByName),
    updatedBy: decodeTextOrNull(values.updatedBy),
    updatedByName: decodeTextOrNull(values.updatedByName),
    origin: decodeEnum<JobOrigin>(values.origin, JOB_ORIGINS, "admin"),
    createdAt,
    updatedAt: decodeDateOr(values.updatedAt, createdAt),
  };
}

export function jobRow(job: JobRecord): RecordValues {
  return {
    id: job.id,
    slug: job.slug,
    title: encodeText(job.title, FIELD_LIMITS.jobTitle),
    department: encodeText(job.department, FIELD_LIMITS.department),
    location: encodeText(job.location, FIELD_LIMITS.location),
    type: job.type,
    experience: encodeText(job.experience, FIELD_LIMITS.experience),
    description: encodeText(job.description, FIELD_LIMITS.jobDescription),
    responsibilities: encodeJson(job.responsibilities),
    requirements: encodeJson(job.requirements),
    qualifications: encodeJson(job.qualifications),
    benefits: encodeJson(job.benefits),
    applicationDeadline: encodeDate(job.applicationDeadline),
    status: job.status,
    publishedAt: encodeDate(job.publishedAt),
    closedAt: encodeDate(job.closedAt),
    archivedAt: encodeDate(job.archivedAt),
    createdBy: job.createdBy ?? "",
    createdByName: encodeText(job.createdByName, 200),
    updatedBy: job.updatedBy ?? "",
    updatedByName: encodeText(job.updatedByName, 200),
    origin: job.origin,
    createdAt: encodeDate(job.createdAt),
    updatedAt: encodeDate(job.updatedAt),
  };
}

export async function listAllJobs(opts: { maxAgeMs?: number } = {}): Promise<JobRecord[]> {
  const rows = await allRecords("Jobs", opts);
  return rows.map((row) => toJobRecord(row.values)).filter((job) => job.id !== "" && job.slug !== "");
}

export async function findJobById(id: string, opts: { maxAgeMs?: number; refreshOnMiss?: boolean } = {}): Promise<JobRecord | null> {
  const row = await findRecord("Jobs", (values) => decodeText(values.id) === id, opts);
  return row ? toJobRecord(row.values) : null;
}

// Slugs are compared lower-cased: they are the public URL segment and must be unique
// case-insensitively, which MongoDB's lower-cased unique index used to guarantee.
export async function findJobBySlug(slug: string, opts: { maxAgeMs?: number; refreshOnMiss?: boolean } = {}): Promise<JobRecord | null> {
  const wanted = slug.trim().toLowerCase();
  if (!wanted) return null;
  const row = await findRecord("Jobs", (values) => decodeText(values.slug).toLowerCase() === wanted, opts);
  return row ? toJobRecord(row.values) : null;
}

export async function insertJob(job: JobRecord): Promise<TableRecord> {
  return appendRecord("Jobs", jobRow(job));
}

// Encoders for the columns an update is allowed to touch. `slug` is deliberately absent: it is
// the public URL and immutable once the job exists, exactly as the old schema enforced.
const JOB_PATCH_ENCODERS: { [K in keyof JobRecord]?: (value: JobRecord[K]) => string } = {
  title: (value) => encodeText(value, FIELD_LIMITS.jobTitle),
  department: (value) => encodeText(value, FIELD_LIMITS.department),
  location: (value) => encodeText(value, FIELD_LIMITS.location),
  type: (value) => value,
  experience: (value) => encodeText(value, FIELD_LIMITS.experience),
  description: (value) => encodeText(value, FIELD_LIMITS.jobDescription),
  responsibilities: encodeJson,
  requirements: encodeJson,
  qualifications: encodeJson,
  benefits: encodeJson,
  applicationDeadline: encodeDate,
  status: (value) => value,
  publishedAt: encodeDate,
  closedAt: encodeDate,
  archivedAt: encodeDate,
  updatedBy: (value) => value ?? "",
  updatedByName: (value) => encodeText(value, 200),
  updatedAt: encodeDate,
};

// Writes only the given fields. Callers always include updatedAt/updatedBy so the row records
// who changed it (MongoDB's timestamps:true used to do this automatically).
export async function patchJob(id: string, patch: Partial<JobRecord>): Promise<boolean> {
  const values: RecordValues = {};
  for (const [column, value] of Object.entries(patch)) {
    const encode = JOB_PATCH_ENCODERS[column as keyof JobRecord] as ((input: unknown) => string) | undefined;
    if (encode) values[column] = encode(value);
  }
  return updateRecord("Jobs", id, values);
}
