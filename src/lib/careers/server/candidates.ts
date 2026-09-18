// Data subject access: everything held about one candidate (by email address) as a JSON
// document an administrator can hand over. Drive file ids and internal identifiers of other
// people are left out. Server-only.
//
// MongoDB answered this with two indexed equality queries on emailNormalized. A spreadsheet has
// no index, so both tabs are loaded instead (one batchGet, through the store's cache) and
// filtered, sorted and capped in this process. Nothing the administrator receives changed: the
// same JSON shape, the same oldest-first order, the same 500-record cap per collection, the same
// APP-/TP- references, and an audit entry that records those references but never the address.

import { toAuditActor, type AdminContext } from "@/lib/auth/session";
import { APPLICATION_STATUS_LABELS, TALENT_SOURCE_LABELS } from "@/lib/careers/constants";
import { recordAudit } from "@/lib/careers/server/audit";
import { applicationReference, compareByDateAsc, talentReference, toIso } from "@/lib/careers/server/mappers";
import type { ApplicationRecord, StoredDocument, TalentPoolRecord } from "@/lib/careers/server/records";
import { retentionDueAt } from "@/lib/careers/server/retention";
import { isValidEmail, normalizeEmail } from "@/lib/careers/validation";
import { listEmailsFor } from "@/lib/email/outbox";
import { badRequest, notFound } from "@/lib/http/errors";
import { ensureStoreReady, loadTables } from "@/lib/sheets-db";
import { hydrateApplications, listAllApplications } from "@/lib/sheets-db/repositories/applications";
import { hydrateTalent, listAllTalent } from "@/lib/sheets-db/repositories/talent";
import type { EmailDeliveryInfo } from "@/types/careers";

const MAX_RECORDS = 500;

type ExportedDocument = {
  kind: string;
  fileName: string;
  sizeBytes: number | null;
  contentType: string;
  uploadedAt: string | null;
};

type ExportedEmail = { template: string; status: string; createdAt: string; sentAt: string | null };

export type CandidateDataExport = {
  generatedAt: string;
  email: string;
  retentionPolicy: string;
  applications: Record<string, unknown>[];
  talentPoolProfiles: Record<string, unknown>[];
};

// The Drive file id and the document's own id are deliberately absent: the candidate is entitled
// to know which files are held, not to the handles the admin download route is addressed by.
function exportDocuments(documents: StoredDocument[] | undefined): ExportedDocument[] {
  return (documents ?? []).map((doc) => ({
    kind: doc.kind,
    fileName: doc.originalName,
    sizeBytes: doc.size ?? null,
    contentType: doc.contentType,
    uploadedAt: toIso(doc.uploadedAt),
  }));
}

function exportEmails(emails: EmailDeliveryInfo[]): ExportedEmail[] {
  return emails.map((email) => ({
    template: email.template,
    status: email.status,
    createdAt: email.createdAt,
    sentAt: email.sentAt,
  }));
}

function exportApplication(doc: ApplicationRecord, emails: EmailDeliveryInfo[]): Record<string, unknown> {
  return {
    reference: applicationReference(doc.id),
    job: { id: doc.jobSlug, title: doc.jobTitle, department: doc.department ?? "" },
    name: doc.name,
    email: doc.email,
    phone: doc.phone,
    coverLetter: doc.coverLetter ?? "",
    linkedIn: doc.linkedIn ?? null,
    portfolio: doc.portfolio ?? null,
    consentGiven: Boolean(doc.consentGiven),
    consentAt: toIso(doc.consentAt),
    source: doc.source,
    status: APPLICATION_STATUS_LABELS[doc.status] ?? doc.status,
    statusChangedAt: toIso(doc.statusChangedAt),
    statusHistory: (doc.statusHistory ?? []).map((entry) => ({
      from: entry.from ? (APPLICATION_STATUS_LABELS[entry.from] ?? entry.from) : null,
      to: APPLICATION_STATUS_LABELS[entry.to] ?? entry.to,
      changedAt: toIso(entry.changedAt),
      changedBy: entry.changedByName ?? null,
      note: entry.note ?? "",
      candidateNotified: Boolean(entry.candidateNotified),
    })),
    notes: (doc.notes ?? []).map((note) => ({ body: note.body, author: note.authorName, createdAt: toIso(note.createdAt) })),
    documents: exportDocuments(doc.documents),
    emails: exportEmails(emails),
    inTalentPool: Boolean(doc.talentPoolEntry),
    archivedAt: toIso(doc.archivedAt),
    archiveReason: doc.archiveReason ?? "",
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
    retentionDueAt: toIso(retentionDueAt(doc.createdAt)),
  };
}

function exportTalent(doc: TalentPoolRecord, emails: EmailDeliveryInfo[]): Record<string, unknown> {
  return {
    reference: talentReference(doc.id),
    name: doc.name,
    email: doc.email,
    phone: doc.phone,
    areaOfInterest: doc.areaOfInterest,
    candidateNotes: doc.candidateNotes ?? "",
    tags: doc.tags ?? [],
    consentGiven: Boolean(doc.consentGiven),
    consentAt: toIso(doc.consentAt),
    source: TALENT_SOURCE_LABELS[doc.source] ?? doc.source,
    linkedApplications: (doc.applications ?? []).map((id) => applicationReference(id)),
    notes: (doc.notes ?? []).map((note) => ({ body: note.body, author: note.authorName, createdAt: toIso(note.createdAt) })),
    activity: (doc.activity ?? []).map((entry) => ({
      action: entry.action,
      at: toIso(entry.at),
      by: entry.actorName ?? null,
      detail: entry.detail ?? "",
    })),
    documents: exportDocuments(doc.documents),
    emails: exportEmails(emails),
    archivedAt: toIso(doc.archivedAt),
    archiveReason: doc.archiveReason ?? "",
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
    retentionDueAt: toIso(retentionDueAt(doc.createdAt)),
  };
}

// Oldest first with the id as the tie-breaker - the sort({createdAt:1, _id:1}) the emailNormalized
// index used to provide, so two records written in the same second keep a stable order between
// exports (and the 500-record cap always cuts the same place).
function oldestFirst<T extends { id: string; createdAt: Date }>(rows: T[]): T[] {
  return rows.slice().sort(
    compareByDateAsc<T>(
      (row) => row.createdAt,
      (row) => row.id
    )
  );
}

export async function exportCandidateData(email: string, ctx: AdminContext): Promise<CandidateDataExport> {
  const trimmed = (email ?? "").trim();
  if (!trimmed || !isValidEmail(trimmed)) {
    throw badRequest("Enter a valid email address.", { email: "Enter a valid email address." });
  }
  const emailNormalized = normalizeEmail(trimmed);

  ensureStoreReady();
  // One batchGet for both tabs; the repository calls below read the cached copies.
  await loadTables(["Applications", "TalentPool"]);
  const [everyApplication, everyTalentProfile] = await Promise.all([listAllApplications(), listAllTalent()]);

  const matchedApplications = oldestFirst(everyApplication.filter((row) => row.emailNormalized === emailNormalized)).slice(0, MAX_RECORDS);
  const matchedTalent = oldestFirst(everyTalentProfile.filter((row) => row.emailNormalized === emailNormalized)).slice(0, MAX_RECORDS);

  if (matchedApplications.length === 0 && matchedTalent.length === 0) {
    throw notFound("No applications or talent pool profiles were found for this email address.", "no_records");
  }

  // Documents, notes, status history and activity live in their own tabs; hydrating the capped
  // sets costs one read per sub-record tab regardless of how many records matched.
  const [applications, talent] = await Promise.all([hydrateApplications(matchedApplications), hydrateTalent(matchedTalent)]);

  const [applicationEmails, talentEmails] = await Promise.all([
    Promise.all(applications.map((doc) => listEmailsFor("application", doc.id))),
    Promise.all(talent.map((doc) => listEmailsFor("talent", doc.id))),
  ]);

  const result: CandidateDataExport = {
    generatedAt: new Date().toISOString(),
    email: emailNormalized,
    retentionPolicy: "Records are deleted when their retention period ends (see retentionDueAt on each record).",
    applications: applications.map((doc, index) => exportApplication(doc, applicationEmails[index])),
    talentPoolProfiles: talent.map((doc, index) => exportTalent(doc, talentEmails[index])),
  };

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "candidate.export",
    entityType: "candidate",
    entityId: applications[0] ? applications[0].id : talent[0].id,
    summary: `Exported candidate data (${applications.length} application${applications.length === 1 ? "" : "s"}, ${talent.length} talent profile${talent.length === 1 ? "" : "s"})`,
    meta: {
      applications: applications.map((doc) => applicationReference(doc.id)),
      talentProfiles: talent.map((doc) => talentReference(doc.id)),
    },
    ip: ctx.ip,
  });

  return result;
}
