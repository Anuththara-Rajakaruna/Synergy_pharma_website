import { FIELD_LIMITS, TALENT_SOURCES, type TalentSource } from "@/lib/careers/constants";
import { idTimestamp } from "@/lib/careers/server/ids";
import type { TalentPoolRecord } from "@/lib/careers/server/records";
import {
  decodeBoolean,
  decodeDate,
  decodeDateOr,
  decodeEnum,
  decodeMultiline,
  decodeStringList,
  decodeText,
  decodeTextOrNull,
  encodeBoolean,
  encodeDate,
  encodeJson,
  encodeText,
} from "@/lib/sheets-db/codec";
import { loadActivityByTalent, loadDocumentsByOwner, loadNotesByOwner } from "@/lib/sheets-db/repositories/subrecords";
import { allRecords, appendRecord, findRecord, updateRecord, type RecordValues, type TableRecord } from "@/lib/sheets-db/table";

// The TalentPool tab. Same split as applications: a shallow row for lists, hydrated with
// documents, notes and activity for the detail view.

export type ShallowTalent = Omit<TalentPoolRecord, "documents" | "notes" | "activity">;

export function toShallowTalent(values: RecordValues): ShallowTalent {
  const id = decodeText(values.id);
  const createdAt = decodeDateOr(values.createdAt, idTimestamp(id) ?? new Date(0));
  return {
    id,
    name: decodeText(values.name),
    email: decodeText(values.email),
    emailNormalized: decodeText(values.emailNormalized).toLowerCase() || decodeText(values.email).toLowerCase(),
    phone: decodeText(values.phone),
    areaOfInterest: decodeText(values.areaOfInterest),
    candidateNotes: decodeMultiline(values.candidateNotes),
    tags: decodeStringList(values.tags).map((tag) => tag.toLowerCase()),
    consentGiven: decodeBoolean(values.consentGiven),
    consentAt: decodeDate(values.consentAt),
    source: decodeEnum<TalentSource>(values.source, TALENT_SOURCES, "self_submitted"),
    sourceApplication: decodeTextOrNull(values.sourceApplicationId),
    applications: decodeStringList(values.applicationIds),
    createdBy: decodeTextOrNull(values.createdBy),
    archivedAt: decodeDate(values.archivedAt),
    archivedBy: decodeTextOrNull(values.archivedBy),
    archivedByName: decodeTextOrNull(values.archivedByName),
    archiveReason: decodeMultiline(values.archiveReason),
    supersededBy: decodeTextOrNull(values.supersededBy),
    createdAt,
    updatedAt: decodeDateOr(values.updatedAt, createdAt),
  };
}

export function talentRow(entry: TalentPoolRecord | ShallowTalent): RecordValues {
  return {
    id: entry.id,
    name: encodeText(entry.name, FIELD_LIMITS.name),
    email: encodeText(entry.email, FIELD_LIMITS.email),
    emailNormalized: encodeText(entry.emailNormalized, FIELD_LIMITS.email),
    phone: encodeText(entry.phone, 40),
    areaOfInterest: encodeText(entry.areaOfInterest, FIELD_LIMITS.areaOfInterest),
    candidateNotes: encodeText(entry.candidateNotes, FIELD_LIMITS.candidateNotes),
    tags: encodeJson(entry.tags),
    consentGiven: encodeBoolean(entry.consentGiven),
    consentAt: encodeDate(entry.consentAt),
    source: entry.source,
    sourceApplicationId: entry.sourceApplication ?? "",
    applicationIds: encodeJson(entry.applications),
    createdBy: entry.createdBy ?? "",
    archivedAt: encodeDate(entry.archivedAt),
    archivedBy: entry.archivedBy ?? "",
    archivedByName: encodeText(entry.archivedByName, 200),
    archiveReason: encodeText(entry.archiveReason, FIELD_LIMITS.archiveReason),
    supersededBy: entry.supersededBy ?? "",
    createdAt: encodeDate(entry.createdAt),
    updatedAt: encodeDate(entry.updatedAt),
  };
}

function isLive(values: RecordValues): boolean {
  return decodeText(values.id) !== "" && !decodeText(values.supersededBy);
}

export async function listAllTalent(opts: { maxAgeMs?: number } = {}): Promise<ShallowTalent[]> {
  const rows = await allRecords("TalentPool", opts);
  return rows.filter((row) => isLive(row.values)).map((row) => toShallowTalent(row.values));
}

export async function findTalentById(id: string, opts: { maxAgeMs?: number; refreshOnMiss?: boolean } = {}): Promise<ShallowTalent | null> {
  const row = await findRecord("TalentPool", (values) => decodeText(values.id) === id && isLive(values), opts);
  return row ? toShallowTalent(row.values) : null;
}

// One profile per person, matched case-insensitively. Used both to enforce the rule and to
// converge on the existing profile when an application is moved to the talent pool.
export async function findTalentByEmail(
  emailNormalized: string,
  opts: { maxAgeMs?: number; refreshOnMiss?: boolean } = {}
): Promise<ShallowTalent | null> {
  const email = emailNormalized.trim().toLowerCase();
  if (!email) return null;
  const row = await findRecord("TalentPool", (values) => decodeText(values.emailNormalized).toLowerCase() === email && isLive(values), opts);
  return row ? toShallowTalent(row.values) : null;
}

export async function insertTalent(entry: TalentPoolRecord): Promise<TableRecord> {
  return appendRecord("TalentPool", talentRow(entry));
}

type PatchEncoder = { column: string; encode: (value: unknown) => string };

const TALENT_PATCH: Partial<Record<keyof TalentPoolRecord, PatchEncoder>> = {
  name: { column: "name", encode: (value) => encodeText(value as string, FIELD_LIMITS.name) },
  phone: { column: "phone", encode: (value) => encodeText(value as string, 40) },
  areaOfInterest: { column: "areaOfInterest", encode: (value) => encodeText(value as string, FIELD_LIMITS.areaOfInterest) },
  tags: { column: "tags", encode: (value) => encodeJson(value) },
  applications: { column: "applicationIds", encode: (value) => encodeJson(value) },
  sourceApplication: { column: "sourceApplicationId", encode: (value) => (value as string | null) ?? "" },
  archivedAt: { column: "archivedAt", encode: (value) => encodeDate(value as Date | null) },
  archivedBy: { column: "archivedBy", encode: (value) => (value as string | null) ?? "" },
  archivedByName: { column: "archivedByName", encode: (value) => encodeText(value as string | null, 200) },
  archiveReason: { column: "archiveReason", encode: (value) => encodeText(value as string, FIELD_LIMITS.archiveReason) },
  supersededBy: { column: "supersededBy", encode: (value) => (value as string | null) ?? "" },
  updatedAt: { column: "updatedAt", encode: (value) => encodeDate(value as Date | null) },
};

export async function patchTalent(id: string, patch: Partial<TalentPoolRecord>): Promise<boolean> {
  const values: RecordValues = {};
  for (const [field, value] of Object.entries(patch)) {
    const encoder = TALENT_PATCH[field as keyof TalentPoolRecord];
    if (encoder) values[encoder.column] = encoder.encode(value);
  }
  return updateRecord("TalentPool", id, values);
}

export async function supersedeTalent(id: string, winnerId: string): Promise<void> {
  await updateRecord("TalentPool", id, { supersededBy: winnerId, updatedAt: encodeDate(new Date()) });
}

// ── Full records ─────────────────────────────────────────────────────────────

export async function hydrateTalent(shallow: ShallowTalent[], opts: { maxAgeMs?: number } = {}): Promise<TalentPoolRecord[]> {
  if (shallow.length === 0) return [];
  const [documents, notes, activity] = await Promise.all([
    loadDocumentsByOwner("talent", opts),
    loadNotesByOwner("talent", opts),
    loadActivityByTalent(opts),
  ]);

  return shallow.map((entry) => ({
    ...entry,
    documents: documents.get(entry.id) ?? [],
    notes: notes.get(entry.id) ?? [],
    activity: (activity.get(entry.id) ?? []).slice().sort((a, b) => a.at.getTime() - b.at.getTime()),
  }));
}

export async function loadTalent(id: string, opts: { refreshOnMiss?: boolean } = {}): Promise<TalentPoolRecord | null> {
  const shallow = await findTalentById(id, opts);
  if (!shallow) return null;
  const [full] = await hydrateTalent([shallow]);
  return full ?? null;
}

// Every distinct tag in use, for the admin filter drop-down.
export async function listTalentTags(opts: { maxAgeMs?: number } = {}): Promise<string[]> {
  const rows = await allRecords("TalentPool", opts);
  const tags = new Set<string>();
  for (const row of rows) {
    if (!isLive(row.values)) continue;
    for (const tag of decodeStringList(row.values.tags)) tags.add(tag.toLowerCase());
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

// Profiles that reference an application, for unlinking during a purge.
export async function findTalentReferencing(applicationId: string): Promise<ShallowTalent[]> {
  const rows = await allRecords("TalentPool", { maxAgeMs: 0 });
  return rows
    .filter((row) => {
      if (!isLive(row.values)) return false;
      return (
        decodeText(row.values.sourceApplicationId) === applicationId ||
        decodeStringList(row.values.applicationIds).includes(applicationId)
      );
    })
    .map((row) => toShallowTalent(row.values));
}

export async function talentRowNumbers(ids: Set<string>): Promise<number[]> {
  const rows = await allRecords("TalentPool", { maxAgeMs: 0 });
  return rows.filter((row) => ids.has(decodeText(row.values.id))).map((row) => row.rowNumber);
}
