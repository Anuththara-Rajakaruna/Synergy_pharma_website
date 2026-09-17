import { toAuditActor, type AdminContext } from "@/lib/auth/session";
import { recordAudit } from "@/lib/careers/server/audit";
import { isObjectIdString, toObjectId } from "@/lib/careers/server/ids";
import { notFound } from "@/lib/http/errors";
import { connectToDatabase } from "@/lib/mongodb";
import { headObject, presignDownload } from "@/lib/storage";
import { ApplicationModel, applicationReference } from "@/models/application";
import type { StoredDocument } from "@/models/shared";
import { TalentPoolEntryModel } from "@/models/talent-pool-entry";
import type { DocumentInfo } from "@/types/careers";

const DOWNLOAD_URL_TTL_SECONDS = 60;

export function toDocumentInfo(doc: StoredDocument): DocumentInfo {
  const id = String(doc._id);
  return {
    id,
    kind: doc.kind,
    originalName: doc.originalName,
    size: doc.size ?? null,
    contentType: doc.contentType || "application/pdf",
    uploadedAt: new Date(doc.uploadedAt).toISOString(),
    downloadUrl: `/api/admin/documents/${id}`,
  };
}

type Located = { recordType: "application" | "talent"; recordId: string; reference: string; document: StoredDocument };

async function locateDocument(documentId: string): Promise<Located | null> {
  const _id = toObjectId(documentId);
  await connectToDatabase();

  const application = await ApplicationModel.findOne({ "documents._id": _id }, { "documents.$": 1 }).lean();
  const applicationDocument = application?.documents?.[0];
  if (application && applicationDocument) {
    return {
      recordType: "application",
      recordId: String(application._id),
      reference: applicationReference(application._id),
      document: applicationDocument,
    };
  }

  const entry = await TalentPoolEntryModel.findOne({ "documents._id": _id }, { "documents.$": 1 }).lean();
  const entryDocument = entry?.documents?.[0];
  if (entry && entryDocument) {
    return {
      recordType: "talent",
      recordId: String(entry._id),
      reference: `TP-${String(entry._id).slice(-8).toUpperCase()}`,
      document: entryDocument,
    };
  }
  return null;
}

// Resolves an admin download to a short-lived presigned URL and records the access.
export async function resolveDocumentDownload(documentId: string, ctx: AdminContext): Promise<string> {
  if (!isObjectIdString(documentId)) throw notFound("Document not found.", "document_not_found");
  const located = await locateDocument(documentId);
  if (!located) throw notFound("Document not found.", "document_not_found");

  const { document } = located;
  if (!(await headObject(document.key))) {
    throw notFound("The file for this document could not be found in storage.", "document_missing");
  }

  const kindLabel = document.kind === "cv" ? "CV" : "supporting document";
  const recordLabel = located.recordType === "application" ? "application" : "talent profile";
  await recordAudit({
    actor: toAuditActor(ctx),
    action: "document.download",
    entityType: "document",
    entityId: documentId,
    summary: `Downloaded ${kindLabel} from ${recordLabel} ${located.reference}`,
    meta: { recordType: located.recordType, recordId: located.recordId, kind: document.kind },
    ip: ctx.ip,
  });

  return presignDownload(document.key, { fileName: document.originalName, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS });
}
