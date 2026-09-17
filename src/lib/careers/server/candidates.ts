// Data subject access: everything held about one candidate (by email address) as a JSON
// document an administrator can hand over. Storage keys and internal identifiers of other
// people are left out. Server-only.

import { APPLICATION_STATUS_LABELS, TALENT_SOURCE_LABELS } from "@/lib/careers/constants";
import { isValidEmail, normalizeEmail } from "@/lib/careers/validation";
import { toAuditActor, type AdminContext } from "@/lib/auth/session";
import { recordAudit } from "@/lib/careers/server/audit";
import { applicationReference, talentReference, toIso } from "@/lib/careers/server/mappers";
import { retentionDueAt } from "@/lib/careers/server/retention";
import { listEmailsFor } from "@/lib/email/outbox";
import { badRequest, notFound } from "@/lib/http/errors";
import { connectToDatabase } from "@/lib/mongodb";
import { ApplicationModel, type ApplicationDoc } from "@/models/application";
import type { StoredDocument } from "@/models/shared";
import { TalentPoolEntryModel, type TalentPoolEntryDoc } from "@/models/talent-pool-entry";
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

function exportApplication(doc: ApplicationDoc, emails: EmailDeliveryInfo[]): Record<string, unknown> {
  return {
    reference: applicationReference(doc._id),
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

function exportTalent(doc: TalentPoolEntryDoc, emails: EmailDeliveryInfo[]): Record<string, unknown> {
  return {
    reference: talentReference(doc._id),
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

export async function exportCandidateData(email: string, ctx: AdminContext): Promise<CandidateDataExport> {
  const trimmed = (email ?? "").trim();
  if (!trimmed || !isValidEmail(trimmed)) {
    throw badRequest("Enter a valid email address.", { email: "Enter a valid email address." });
  }
  const emailNormalized = normalizeEmail(trimmed);

  await connectToDatabase();
  const [applications, talent] = await Promise.all([
    ApplicationModel.find({ emailNormalized }).sort({ createdAt: 1, _id: 1 }).limit(MAX_RECORDS).lean<ApplicationDoc[]>(),
    TalentPoolEntryModel.find({ emailNormalized }).sort({ createdAt: 1, _id: 1 }).limit(MAX_RECORDS).lean<TalentPoolEntryDoc[]>(),
  ]);
  if (applications.length === 0 && talent.length === 0) {
    throw notFound("No applications or talent pool profiles were found for this email address.", "no_records");
  }

  const [applicationEmails, talentEmails] = await Promise.all([
    Promise.all(applications.map((doc) => listEmailsFor("application", String(doc._id)))),
    Promise.all(talent.map((doc) => listEmailsFor("talent", String(doc._id)))),
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
    entityId: applications[0] ? String(applications[0]._id) : String(talent[0]._id),
    summary: `Exported candidate data (${applications.length} application${applications.length === 1 ? "" : "s"}, ${talent.length} talent profile${talent.length === 1 ? "" : "s"})`,
    meta: {
      applications: applications.map((doc) => applicationReference(doc._id)),
      talentProfiles: talent.map((doc) => talentReference(doc._id)),
    },
    ip: ctx.ip,
  });

  return result;
}
