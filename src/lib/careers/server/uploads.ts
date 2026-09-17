import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { UPLOAD_LIMITS, type DocumentKind, type UploadPurpose } from "@/lib/careers/constants";
import { sanitizeOriginalFileName, type UploadFileDescriptor } from "@/lib/careers/validation";
import { AppError, badRequest, unauthorized } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import { connectToDatabase } from "@/lib/mongodb";
import { copyObject, deleteObject, headObject, presignUpload, readObjectBytes, StorageObjectNotFoundError } from "@/lib/storage";
import type { StoredDocument } from "@/models/shared";
import { UploadIntentModel } from "@/models/upload-intent";
import type { UploadTicket } from "@/types/careers";

// Direct-to-storage uploads. The browser asks for tickets (presigned PUT URLs under incoming/),
// uploads the files itself, then submits a form that references the upload ids. The submission
// claims each upload exactly once: the object is verified (size, PDF structure) and copied to
// its permanent key under the record, and the incoming object is removed.

const PDF_CONTENT_TYPE = "application/pdf";
const SNIFF_BYTES = 1024;
const UPLOAD_ID = /^[A-Za-z0-9-]{1,64}$/;
const PREFIX = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

export function newDocumentId(): Types.ObjectId {
  return new Types.ObjectId();
}

function maxBytesFor(kind: DocumentKind): number {
  return kind === "cv" ? UPLOAD_LIMITS.cvMaxBytes : UPLOAD_LIMITS.supportingMaxBytes;
}

export async function createUploadTickets(
  input: { purpose: UploadPurpose; files: UploadFileDescriptor[] },
  ctx: { adminUserId: Types.ObjectId | null }
): Promise<UploadTicket[]> {
  if (input.purpose === "admin_talent" && !ctx.adminUserId) throw unauthorized();
  if (input.files.length === 0) throw badRequest("Select a file to upload.", { files: "Select a file to upload." });
  const supporting = input.files.filter((file) => file.kind === "supporting").length;
  if (input.files.length - supporting > 1 || supporting > UPLOAD_LIMITS.maxSupportingDocuments) {
    throw badRequest("Too many files.", { files: "Too many files." });
  }
  for (const file of input.files) {
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > maxBytesFor(file.kind)) {
      throw badRequest("The file is too large or empty.", { files: "The file is too large or empty." });
    }
  }

  const now = Date.now();
  const intentExpiresAt = new Date(now + UPLOAD_LIMITS.intentTtlSeconds * 1000);
  const urlExpiresAt = new Date(now + UPLOAD_LIMITS.presignExpirySeconds * 1000);

  // Presign first: nothing is written when storage is misconfigured.
  const prepared = await Promise.all(
    input.files.map(async (file) => {
      const id = randomUUID();
      const key = `incoming/${id}.pdf`;
      const presigned = await presignUpload(key, {
        contentType: PDF_CONTENT_TYPE,
        contentLength: file.size,
        expiresInSeconds: UPLOAD_LIMITS.presignExpirySeconds,
      });
      return {
        intent: {
          _id: id,
          key,
          kind: file.kind,
          purpose: input.purpose,
          originalName: sanitizeOriginalFileName(file.name),
          size: file.size,
          contentType: PDF_CONTENT_TYPE,
          createdAt: new Date(now),
          expiresAt: intentExpiresAt,
          consumedAt: null,
          createdByAdmin: input.purpose === "admin_talent" ? ctx.adminUserId : null,
        },
        ticket: {
          uploadId: id,
          kind: file.kind,
          method: "PUT" as const,
          url: presigned.url,
          headers: presigned.headers,
          expiresAt: urlExpiresAt.toISOString(),
        },
      };
    })
  );

  await connectToDatabase();
  await UploadIntentModel.insertMany(
    prepared.map((item) => item.intent),
    { ordered: true }
  );
  logger.info("upload.tickets_created", { purpose: input.purpose, count: prepared.length });
  return prepared.map((item) => item.ticket);
}

export type ClaimSpec = { cv?: string | null; supporting: string[] };

type ClaimSlot = { id: string; kind: DocumentKind; field: "cv" | "supporting" };

function uploadExpired(field: string): AppError {
  const message = "Your uploaded file has expired. Please attach it again.";
  return badRequest(message, { [field]: message }, "upload_expired");
}

function uploadMissing(field: string): AppError {
  const message = "We couldn't find your uploaded file. Please attach it again.";
  return badRequest(message, { [field]: message }, "upload_missing");
}

function invalidFile(field: string, message: string): AppError {
  return badRequest(message, { [field]: message }, "invalid_file");
}

async function discardIncoming(key: string, uploadId: string): Promise<void> {
  try {
    await deleteObject(key);
  } catch (err) {
    // The maintenance job removes leftovers under incoming/.
    logger.warn("upload.incoming_delete_failed", { uploadId, err });
  }
}

// Claims uploaded files for a record, cv first. On any failure, copies already made are
// removed, rejected files are deleted, and the remaining uploads are released so the same
// upload ids can be submitted again.
export async function claimUploads(
  spec: ClaimSpec,
  opts: { purposes: UploadPurpose[]; destinationPrefix: string; requireCv: boolean }
): Promise<StoredDocument[]> {
  if (!PREFIX.test(opts.destinationPrefix)) throw new Error("Invalid destination prefix.");
  const cv = spec.cv?.trim() || null;
  if (opts.requireCv && !cv) {
    throw badRequest("Please upload your CV.", { cv: "Please upload your CV." });
  }
  const slots: ClaimSlot[] = [
    ...(cv ? [{ id: cv, kind: "cv" as const, field: "cv" as const }] : []),
    ...spec.supporting.map((id) => ({ id: id.trim(), kind: "supporting" as const, field: "supporting" as const })),
  ];
  if (slots.length === 0) return [];
  if (spec.supporting.length > UPLOAD_LIMITS.maxSupportingDocuments) {
    const message = `Upload at most ${UPLOAD_LIMITS.maxSupportingDocuments} supporting documents.`;
    throw badRequest(message, { supporting: message });
  }
  if (new Set(slots.map((slot) => slot.id)).size !== slots.length) {
    throw badRequest("The same file was attached twice.", { supporting: "The same file was attached twice." });
  }
  for (const slot of slots) {
    if (!UPLOAD_ID.test(slot.id)) throw uploadExpired(slot.field);
  }

  await connectToDatabase();
  const now = new Date();
  const claimed: { uploadId: string; key: string }[] = [];
  // Uploads whose incoming object was deleted or never existed; these cannot be released.
  const burned = new Set<string>();
  const documents: StoredDocument[] = [];

  try {
    for (const slot of slots) {
      const intent = await UploadIntentModel.findOneAndUpdate(
        {
          _id: slot.id,
          consumedAt: null,
          expiresAt: { $gt: now },
          purpose: { $in: opts.purposes },
          kind: slot.kind,
        },
        { $set: { consumedAt: now } },
        { returnDocument: "after" }
      ).lean();
      if (!intent) throw uploadExpired(slot.field);
      claimed.push({ uploadId: intent._id, key: intent.key });

      const head = await headObject(intent.key);
      if (!head) {
        burned.add(intent._id);
        throw uploadMissing(slot.field);
      }
      if (head.size !== intent.size || head.size > maxBytesFor(slot.kind) || (head.contentType && head.contentType !== PDF_CONTENT_TYPE)) {
        burned.add(intent._id);
        await discardIncoming(intent.key, intent._id);
        throw invalidFile(slot.field, "The uploaded file doesn't match the file you selected. Please attach it again.");
      }

      let first: Buffer;
      let last: Buffer;
      try {
        first = await readObjectBytes(intent.key, { start: 0, end: Math.min(SNIFF_BYTES, head.size) - 1 });
        last = await readObjectBytes(intent.key, { suffix: Math.min(SNIFF_BYTES, head.size) });
      } catch (err) {
        if (err instanceof StorageObjectNotFoundError) {
          burned.add(intent._id);
          throw uploadMissing(slot.field);
        }
        throw err;
      }
      if (first.indexOf("%PDF-", 0, "latin1") === -1 || last.indexOf("%%EOF", 0, "latin1") === -1) {
        burned.add(intent._id);
        await discardIncoming(intent.key, intent._id);
        throw invalidFile(slot.field, "Uploaded file is not a valid PDF.");
      }

      const documentId = newDocumentId();
      const key = `${opts.destinationPrefix}/${documentId.toHexString()}.pdf`;
      try {
        await copyObject(intent.key, key, { contentType: PDF_CONTENT_TYPE });
      } catch (err) {
        if (err instanceof StorageObjectNotFoundError) {
          burned.add(intent._id);
          throw uploadMissing(slot.field);
        }
        throw err;
      }
      documents.push({
        _id: documentId,
        kind: slot.kind,
        key,
        originalName: intent.originalName,
        size: head.size,
        contentType: PDF_CONTENT_TYPE,
        uploadedAt: now,
        legacy: false,
      });
    }
  } catch (err) {
    await releaseClaimedDocuments(documents);
    const releasable = claimed.filter((item) => !burned.has(item.uploadId)).map((item) => item.uploadId);
    if (releasable.length > 0) {
      try {
        await UploadIntentModel.updateMany({ _id: { $in: releasable }, consumedAt: now }, { $set: { consumedAt: null } });
      } catch (releaseErr) {
        logger.warn("upload.release_failed", { count: releasable.length, err: releaseErr });
      }
    }
    throw err;
  }

  await Promise.all(claimed.map((item) => discardIncoming(item.key, item.uploadId)));
  logger.info("upload.claimed", { count: documents.length, purposes: opts.purposes });
  return documents;
}

// Copies documents to another record (new document ids and keys). A legacy document whose
// object no longer exists cannot be copied and is left out (logged); any other failure removes
// the copies made so far and rethrows.
export async function copyDocuments(docs: StoredDocument[], destinationPrefix: string): Promise<StoredDocument[]> {
  if (!PREFIX.test(destinationPrefix)) throw new Error("Invalid destination prefix.");
  const copies: StoredDocument[] = [];
  try {
    for (const doc of docs) {
      const documentId = newDocumentId();
      const key = `${destinationPrefix}/${documentId.toHexString()}.pdf`;
      try {
        await copyObject(doc.key, key, { contentType: PDF_CONTENT_TYPE });
      } catch (err) {
        if (err instanceof StorageObjectNotFoundError) {
          logger.warn("documents.copy_source_missing", { documentId: String(doc._id) });
          continue;
        }
        throw err;
      }
      let size = doc.size;
      if (size === null) size = (await headObject(key))?.size ?? null;
      copies.push({
        _id: documentId,
        kind: doc.kind,
        key,
        originalName: doc.originalName,
        size,
        contentType: PDF_CONTENT_TYPE,
        uploadedAt: doc.uploadedAt,
        legacy: false,
      });
    }
  } catch (err) {
    await releaseClaimedDocuments(copies);
    throw err;
  }
  return copies;
}

export async function deleteDocuments(docs: StoredDocument[]): Promise<{ failedKeys: string[] }> {
  const results = await Promise.allSettled(docs.map((doc) => deleteObject(doc.key)));
  const failedKeys: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      failedKeys.push(docs[index].key);
      logger.error("documents.delete_failed", { documentId: String(docs[index]._id), err: result.reason });
    }
  });
  return { failedKeys };
}

// Best-effort cleanup of copied objects after a failed insert. Never throws.
export async function releaseClaimedDocuments(docs: StoredDocument[]): Promise<void> {
  if (docs.length === 0) return;
  try {
    const { failedKeys } = await deleteDocuments(docs);
    if (failedKeys.length > 0) logger.warn("documents.release_incomplete", { failed: failedKeys.length, total: docs.length });
  } catch (err) {
    logger.error("documents.release_failed", { err, total: docs.length });
  }
}
