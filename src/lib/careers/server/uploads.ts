import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";
import { UPLOAD_LIMITS, type DocumentKind, type UploadPurpose } from "@/lib/careers/constants";
import { newId } from "@/lib/careers/server/ids";
import type { OwnerType, StoredDocument } from "@/lib/careers/server/records";
import { sanitizeOriginalFileName, type UploadFileDescriptor } from "@/lib/careers/validation";
import { getGoogleSettings } from "@/lib/google/auth";
import { deleteFile, ensureFolder, findFileByName, getFile, listFiles, updateFile, uploadFile, type DriveFile } from "@/lib/google/drive";
import { GoogleNotFoundError } from "@/lib/google/errors";
import { AppError, badRequest, payloadTooLarge, unauthorized } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import { SITE_URL } from "@/lib/site";
import type { UploadTicket } from "@/types/careers";

// Candidate document uploads, on Google Drive.
//
// The shape of the flow is unchanged from the presigned-S3 version, because the browser code
// (src/components/careers/upload-client.ts) is unchanged: the form asks for a ticket per file,
// PUTs the bytes to the ticket's URL, then submits the form referencing the upload ids.
//
// What changed is where the ticket points. An S3 presigned URL let the browser write straight
// into the bucket; Google Drive has no equivalent that can be handed to a browser without also
// handing over credentials. The ticket therefore points back at this application
// (PUT /api/uploads/<uploadId>), which validates the bytes and forwards them to Drive. This is
// also the flow the brief describes - the backend receives the file, validates it, and uploads
// it to Drive - and it means a file is never accepted without its PDF structure being checked.
//
// Uploads land in a staging folder named after the upload id. Staging is what makes the ticket
// stateless: any server instance can find a staged file by name, so nothing about an in-flight
// upload has to be written to the spreadsheet, and there is no intent record to expire. The
// maintenance job deletes anything left in staging.

const PDF_CONTENT_TYPE = "application/pdf";
const SNIFF_BYTES = 1024;
const UPLOAD_ID = /^[A-Za-z0-9-]{1,64}$/;

export const STAGING_FOLDER_NAME = "_staging";
export const APPLICATION_FOLDER_NAME = "Applications";
export const TALENT_FOLDER_NAME = "TalentPool";

// ── Ticket signing ───────────────────────────────────────────────────────────

// The ticket URL is a capability: whoever holds it may write one file, of one size, once. It is
// signed with a key derived from the service account's private key rather than a separate
// secret, so there is no extra variable to configure and the key is guaranteed to be present
// and secret wherever the application can talk to Google at all.
let signingKey: Buffer | null = null;

function getSigningKey(): Buffer {
  if (signingKey) return signingKey;
  const { privateKey, clientEmail } = getGoogleSettings();
  signingKey = Buffer.from(hkdfSync("sha256", Buffer.from(privateKey, "utf8"), Buffer.from(clientEmail, "utf8"), Buffer.from("synergy-upload-ticket-v1"), 32));
  return signingKey;
}

type TicketClaims = {
  // upload id
  u: string;
  k: DocumentKind;
  p: UploadPurpose;
  // exact byte length the PUT must carry
  s: number;
  // sanitised original file name
  n: string;
  // expiry, epoch seconds
  e: number;
  // admin user id, for admin_talent uploads
  a?: string;
};

function sign(payload: string): string {
  return createHmac("sha256", getSigningKey()).update(payload).digest("base64url");
}

function createTicketToken(claims: TicketClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

// Returns null for any token that is malformed, unsigned, signed with a different key, or
// expired. Callers turn that into the same "your upload expired" message the browser already
// knows how to show.
export function verifyTicketToken(token: string | null): TicketClaims | null {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expected = Buffer.from(sign(payload), "utf8");
  const received = Buffer.from(signature, "utf8");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  let claims: TicketClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TicketClaims;
  } catch {
    return null;
  }
  if (!claims || typeof claims.u !== "string" || !UPLOAD_ID.test(claims.u)) return null;
  if (typeof claims.e !== "number" || claims.e * 1000 <= Date.now()) return null;
  if (!Number.isInteger(claims.s) || claims.s < 1) return null;
  return claims;
}

// ── Folders ──────────────────────────────────────────────────────────────────

type FolderCache = { staging?: string; applications?: string; talent?: string };

declare global {
  var __synergyDriveFolders: FolderCache | undefined;
}

const folders: FolderCache = (globalThis.__synergyDriveFolders ??= {});

async function stagingFolderId(): Promise<string> {
  if (!folders.staging) folders.staging = await ensureFolder(getGoogleSettings().driveFolderId, STAGING_FOLDER_NAME);
  return folders.staging;
}

export async function documentFolderId(ownerType: OwnerType): Promise<string> {
  const root = getGoogleSettings().driveFolderId;
  if (ownerType === "application") {
    if (!folders.applications) folders.applications = await ensureFolder(root, APPLICATION_FOLDER_NAME);
    return folders.applications;
  }
  if (!folders.talent) folders.talent = await ensureFolder(root, TALENT_FOLDER_NAME);
  return folders.talent;
}

function maxBytesFor(kind: DocumentKind): number {
  return kind === "cv" ? UPLOAD_LIMITS.cvMaxBytes : UPLOAD_LIMITS.supportingMaxBytes;
}

export function newDocumentId(): string {
  return newId();
}

// ── Issuing tickets ──────────────────────────────────────────────────────────

export async function createUploadTickets(
  input: { purpose: UploadPurpose; files: UploadFileDescriptor[] },
  ctx: { adminUserId: string | null }
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

  // Fail here rather than after the browser has spent a minute uploading.
  getGoogleSettings();

  const now = Date.now();
  const expiresAt = new Date(now + UPLOAD_LIMITS.presignExpirySeconds * 1000);
  const tickets = input.files.map((file) => {
    const uploadId = randomUUID();
    const token = createTicketToken({
      u: uploadId,
      k: file.kind,
      p: input.purpose,
      s: file.size,
      n: sanitizeOriginalFileName(file.name),
      e: Math.floor(expiresAt.getTime() / 1000),
      ...(ctx.adminUserId ? { a: ctx.adminUserId } : {}),
    });
    return {
      uploadId,
      kind: file.kind,
      method: "PUT" as const,
      // Absolute: the browser helper validates that the ticket URL parses as an http(s) URL.
      url: `${SITE_URL}/api/uploads/${uploadId}?t=${encodeURIComponent(token)}`,
      headers: { "Content-Type": PDF_CONTENT_TYPE },
      expiresAt: expiresAt.toISOString(),
    };
  });

  logger.info("upload.tickets_created", { purpose: input.purpose, count: tickets.length });
  return tickets;
}

// ── Receiving bytes ──────────────────────────────────────────────────────────

function invalidFile(field: string, message: string): AppError {
  return badRequest(message, { [field]: message }, "invalid_file");
}

// A PDF starts with %PDF- and ends with %%EOF. Checking both ends is the same cheap structural
// test the previous implementation performed against the object in S3, done here before the
// bytes reach Drive at all.
export function looksLikePdf(bytes: Buffer): boolean {
  const head = bytes.subarray(0, Math.min(SNIFF_BYTES, bytes.length));
  const tail = bytes.subarray(Math.max(0, bytes.length - SNIFF_BYTES));
  return head.indexOf("%PDF-", 0, "latin1") !== -1 && tail.indexOf("%%EOF", 0, "latin1") !== -1;
}

// Handles PUT /api/uploads/<uploadId>. Validates the ticket and the bytes, then stages the file
// in Drive under the upload id.
export async function receiveUpload(uploadId: string, token: string | null, body: Buffer): Promise<void> {
  const claims = verifyTicketToken(token);
  if (!claims || claims.u !== uploadId) {
    throw badRequest("Your upload link has expired. Please attach the file again.", { cv: "Your upload link has expired." }, "upload_expired");
  }
  if (body.byteLength !== claims.s) {
    throw invalidFile("cv", "The uploaded file doesn't match the file you selected. Please attach it again.");
  }
  if (body.byteLength > maxBytesFor(claims.k)) throw payloadTooLarge("That file is too large.");
  if (!looksLikePdf(body)) throw invalidFile("cv", "Uploaded file is not a valid PDF.");

  const parentId = await stagingFolderId();
  // A repeated PUT of the same ticket replaces the staged file rather than leaving two.
  const existing = await findFileByName(parentId, `${uploadId}.pdf`);
  if (existing) await deleteFile(existing.id);

  await uploadFile({
    name: `${uploadId}.pdf`,
    parentId,
    mimeType: PDF_CONTENT_TYPE,
    body,
    appProperties: {
      uploadId,
      kind: claims.k,
      purpose: claims.p,
      // Drive caps an appProperties value at 124 bytes.
      originalName: claims.n.slice(0, 120),
      size: String(claims.s),
      ...(claims.a ? { adminUserId: claims.a } : {}),
    },
  });
  logger.info("upload.received", { purpose: claims.p, kind: claims.k, bytes: body.byteLength });
}

// ── Claiming ─────────────────────────────────────────────────────────────────

export type ClaimSpec = { cv?: string | null; supporting: string[] };

export type ClaimTarget = {
  ownerType: OwnerType;
  ownerId: string;
  // APP-7F3A9C21 / TP-7F3A9C21, used to name the file so the Drive folder is browsable.
  reference: string;
  candidateName: string;
};

type ClaimSlot = { id: string; kind: DocumentKind; field: "cv" | "supporting" };

function uploadExpired(field: string): AppError {
  const message = "Your uploaded file has expired. Please attach it again.";
  return badRequest(message, { [field]: message }, "upload_expired");
}

function uploadMissing(field: string): AppError {
  const message = "We couldn't find your uploaded file. Please attach it again.";
  return badRequest(message, { [field]: message }, "upload_missing");
}

// Keeps the Drive folder readable for whoever opens it: "APP-7F3A9C21 - Jane Doe - CV.pdf".
function documentFileName(target: ClaimTarget, kind: DocumentKind, index: number): string {
  const name = target.candidateName.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Candidate";
  const label = kind === "cv" ? "CV" : `Supporting ${index}`;
  return `${target.reference} - ${name} - ${label}.pdf`;
}

// Moves each staged upload to its permanent folder and returns the documents to record. On any
// failure the files already moved are deleted, so a failed submission never leaves a document
// attached to a record that was not created.
export async function claimUploads(
  spec: ClaimSpec,
  opts: { purposes: UploadPurpose[]; target: ClaimTarget; requireCv: boolean }
): Promise<StoredDocument[]> {
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

  const staging = await stagingFolderId();
  const destination = await documentFolderId(opts.target.ownerType);
  const now = new Date();
  const documents: StoredDocument[] = [];
  let supportingIndex = 0;

  try {
    for (const slot of slots) {
      const staged = await findFileByName(staging, `${slot.id}.pdf`);
      if (!staged) throw uploadMissing(slot.field);

      const properties = staged.appProperties ?? {};
      if (properties.kind !== slot.kind || !opts.purposes.includes(properties.purpose as UploadPurpose)) {
        throw uploadExpired(slot.field);
      }
      const size = Number.parseInt(staged.size ?? properties.size ?? "", 10);
      if (!Number.isFinite(size) || size < 1 || size > maxBytesFor(slot.kind)) {
        throw invalidFile(slot.field, "The uploaded file doesn't match the file you selected. Please attach it again.");
      }

      const documentId = newDocumentId();
      if (slot.kind === "supporting") supportingIndex += 1;

      // Moving is a metadata change: the bytes are never copied, and the staged file cannot be
      // claimed twice because it is no longer in the staging folder afterwards.
      const moved = await updateFile(staged.id, {
        name: documentFileName(opts.target, slot.kind, supportingIndex),
        addParents: [destination],
        removeParents: [staging],
        appProperties: {
          documentId,
          ownerType: opts.target.ownerType,
          ownerId: opts.target.ownerId,
          reference: opts.target.reference,
          kind: slot.kind,
          originalName: (properties.originalName ?? "document.pdf").slice(0, 120),
        },
        description: `${slot.kind === "cv" ? "CV" : "Supporting document"} for ${opts.target.reference}`,
      });

      documents.push({
        id: documentId,
        kind: slot.kind,
        driveFileId: moved.id,
        originalName: properties.originalName || "document.pdf",
        size,
        contentType: PDF_CONTENT_TYPE,
        uploadedAt: now,
      });
    }
  } catch (err) {
    await releaseClaimedDocuments(documents);
    throw err;
  }

  logger.info("upload.claimed", { count: documents.length, purposes: opts.purposes });
  return documents;
}

// ── Copying, deleting ────────────────────────────────────────────────────────

// Copies documents to another record (new document ids and new Drive files), used when an
// application is moved into the talent pool. A document whose Drive file no longer exists is
// left out and logged; any other failure removes the copies made so far and rethrows.
export async function copyDocuments(documents: StoredDocument[], target: ClaimTarget): Promise<StoredDocument[]> {
  if (documents.length === 0) return [];
  const destination = await documentFolderId(target.ownerType);
  const { sharedDriveId } = getGoogleSettings();
  const copies: StoredDocument[] = [];
  let supportingIndex = 0;

  try {
    for (const document of documents) {
      const documentId = newDocumentId();
      if (document.kind === "supporting") supportingIndex += 1;
      const name = documentFileName(target, document.kind, supportingIndex);

      const { googleJson } = await import("@/lib/google/request");
      const copied = await googleJson<DriveFile>({
        method: "POST",
        url:
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(document.driveFileId)}/copy?` +
          new URLSearchParams({ supportsAllDrives: "true", fields: "id,name,size,mimeType" }).toString(),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          parents: [destination],
          appProperties: {
            documentId,
            ownerType: target.ownerType,
            ownerId: target.ownerId,
            reference: target.reference,
            kind: document.kind,
            originalName: document.originalName.slice(0, 120),
          },
          ...(sharedDriveId ? { driveId: sharedDriveId } : {}),
        }),
        operation: "drive.files.copy",
        allowNotFound: true,
      });

      if (!copied) {
        logger.warn("documents.copy_source_missing", { documentId: document.id });
        continue;
      }
      copies.push({
        id: documentId,
        kind: document.kind,
        driveFileId: copied.id,
        originalName: document.originalName,
        size: document.size ?? (copied.size ? Number.parseInt(copied.size, 10) : null),
        contentType: PDF_CONTENT_TYPE,
        uploadedAt: document.uploadedAt,
      });
    }
  } catch (err) {
    await releaseClaimedDocuments(copies);
    throw err;
  }
  return copies;
}

export async function deleteDocuments(documents: StoredDocument[]): Promise<{ failedIds: string[] }> {
  const results = await Promise.allSettled(documents.map((document) => deleteFile(document.driveFileId)));
  const failedIds: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      failedIds.push(documents[index].id);
      logger.error("documents.delete_failed", { documentId: documents[index].id, err: result.reason });
    }
  });
  return { failedIds };
}

// Best-effort cleanup of Drive files after a failed write. Never throws.
export async function releaseClaimedDocuments(documents: StoredDocument[]): Promise<void> {
  if (documents.length === 0) return;
  try {
    const { failedIds } = await deleteDocuments(documents);
    if (failedIds.length > 0) logger.warn("documents.release_incomplete", { failed: failedIds.length, total: documents.length });
  } catch (err) {
    logger.error("documents.release_failed", { err, total: documents.length });
  }
}

// True when the Drive file behind a document still exists.
export async function documentFileExists(driveFileId: string): Promise<boolean> {
  try {
    const file = await getFile(driveFileId);
    return Boolean(file && !file.trashed);
  } catch (err) {
    if (err instanceof GoogleNotFoundError) return false;
    throw err;
  }
}

// ── Maintenance ──────────────────────────────────────────────────────────────

// Uploads that were never submitted. Anything in staging older than the cutoff is abandoned:
// the ticket that produced it expired long ago and can no longer be claimed.
export async function sweepStagedUploads(olderThan: Date, limit: number): Promise<{ deleted: number; failed: number }> {
  const staging = await stagingFolderId();
  const files = await listFiles(staging, { pageSize: 100, maxPages: Math.max(1, Math.ceil(limit / 100)), orderBy: "createdTime" });
  const stale = files.filter((file) => {
    const created = file.createdTime ? Date.parse(file.createdTime) : Number.NaN;
    return Number.isFinite(created) && created < olderThan.getTime();
  });

  let deleted = 0;
  let failed = 0;
  for (const file of stale.slice(0, limit)) {
    try {
      await deleteFile(file.id);
      deleted += 1;
    } catch (err) {
      failed += 1;
      logger.warn("maintenance.staged_upload_delete_failed", { err });
    }
  }
  return { deleted, failed };
}
