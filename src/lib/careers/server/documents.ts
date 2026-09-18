import { toAuditActor, type AdminContext } from "@/lib/auth/session";
import { recordAudit } from "@/lib/careers/server/audit";
import { applicationReference, isRecordId, talentReference } from "@/lib/careers/server/ids";
import type { StoredDocument } from "@/lib/careers/server/records";
import { downloadFileStream } from "@/lib/google/drive";
import { notFound } from "@/lib/http/errors";
import { findDocument } from "@/lib/sheets-db/repositories/subrecords";
import type { DocumentInfo } from "@/types/careers";

// Admin access to candidate documents.
//
// The download used to be a redirect to a 60-second presigned S3 URL. Google Drive has no
// equivalent that can be given to a browser without also granting Drive access to whoever holds
// the link, so the bytes are streamed through this application instead. The result is stricter
// rather than looser: there is no URL that works outside an authenticated admin session, no
// window during which a leaked link is usable, and the Drive file id is never exposed at all.
//
// `downloadUrl` in the DTO is unchanged (/api/admin/documents/<id>), so the admin UI needs no
// change - the browser simply receives the PDF from that URL rather than a 302 to storage.

export function toDocumentInfo(document: StoredDocument): DocumentInfo {
  return {
    id: document.id,
    kind: document.kind,
    originalName: document.originalName,
    size: document.size ?? null,
    contentType: document.contentType || "application/pdf",
    uploadedAt: new Date(document.uploadedAt).toISOString(),
    downloadUrl: `/api/admin/documents/${document.id}`,
  };
}

// RFC 6266: an ASCII-safe fallback plus a UTF-8 form for names with non-ASCII characters.
export function contentDisposition(fileName: string): string {
  const cleaned = fileName.replace(/[\x00-\x1F\x7F]/g, "").trim() || "document.pdf";
  const ascii = cleaned.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(cleaned).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export type DocumentDownload = {
  body: ReadableStream<Uint8Array>;
  fileName: string;
  contentType: string;
  size: number | null;
};

// Streams a document to a signed-in admin and records the access. The audit entry is written
// before the bytes are handed over, matching the previous behaviour.
export async function resolveDocumentDownload(documentId: string, ctx: AdminContext): Promise<DocumentDownload> {
  if (!isRecordId(documentId)) throw notFound("Document not found.", "document_not_found");

  const located = await findDocument(documentId);
  if (!located) throw notFound("Document not found.", "document_not_found");

  const { document, ownerType, ownerId } = located;
  const reference = ownerType === "application" ? applicationReference(ownerId) : talentReference(ownerId);
  const kindLabel = document.kind === "cv" ? "CV" : "supporting document";
  const recordLabel = ownerType === "application" ? "application" : "talent profile";

  await recordAudit({
    actor: toAuditActor(ctx),
    action: "document.download",
    entityType: "document",
    entityId: documentId,
    summary: `Downloaded ${kindLabel} from ${recordLabel} ${reference}`,
    meta: { recordType: ownerType, recordId: ownerId, kind: document.kind },
    ip: ctx.ip,
  });

  const file = await downloadFileStream(document.driveFileId);
  if (!file) {
    throw notFound("The file for this document could not be found in storage.", "document_missing");
  }

  return {
    body: file.body,
    fileName: document.originalName || "document.pdf",
    contentType: document.contentType || "application/pdf",
    size: document.size ?? file.size,
  };
}
