import "./support/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { AdminContext } from "@/lib/auth/session";
import { UPLOAD_LIMITS } from "@/lib/careers/constants";
import { resolveDocumentDownload } from "@/lib/careers/server/documents";
import { newId } from "@/lib/careers/server/ids";
import type { StoredDocument } from "@/lib/careers/server/records";
import {
  claimUploads,
  copyDocuments,
  createUploadTickets,
  deleteDocuments,
  documentFolderId,
  looksLikePdf,
  receiveUpload,
  releaseClaimedDocuments,
  verifyTicketToken,
  type ClaimTarget,
} from "@/lib/careers/server/uploads";
import { insertDocuments } from "@/lib/sheets-db/repositories/subrecords";
import { suiteSkip } from "./support/env";
import { FOLDER_NAMES, driveFile, driveFileBytes, driveFileExists, listFilesIn } from "./support/drive";
import { adminContext, assertNoPersonalData, auditEntries, expectAppError, pdfBytes, putToTicket, ticketToken, uploadDocument } from "./support/fixtures";
import { startIntegration, type Integration } from "./support/harness";

function applicationTarget(id = newId()): ClaimTarget {
  return { ownerType: "application", ownerId: id, reference: `APP-${id.slice(-8).toUpperCase()}`, candidateName: "Nimal Perera" };
}

function talentTarget(id = newId()): ClaimTarget {
  return { ownerType: "talent", ownerId: id, reference: `TP-${id.slice(-8).toUpperCase()}`, candidateName: "Kamala Silva" };
}

async function stagedNames(): Promise<string[]> {
  return (await listFilesIn(FOLDER_NAMES.staging)).map((file) => file.name);
}

describe("uploads and documents", { timeout: 300_000, skip: suiteSkip() }, () => {
  let integration: Integration;
  let admin: AdminContext;

  before(async () => {
    integration = await startIntegration();
    admin = await adminContext("hr");
  });

  after(async () => {
    await integration.stop();
  });

  describe("createUploadTickets", () => {
    it("issues a signed ticket pointing at this application, not at storage", async () => {
      // The browser flow is unchanged - ask for a ticket, PUT the bytes - but the ticket now
      // points back here: there is no URL a browser could use to write into Drive directly, and
      // so no bucket CORS rule and no storage origin in the Content-Security-Policy.
      const started = Date.now();
      const tickets = await createUploadTickets(
        {
          purpose: "application",
          files: [
            { kind: "cv", name: "C:\\Users\\nimal\\My CV (2026).pdf", size: 2048, contentType: "application/pdf" },
            { kind: "supporting", name: "degree.PDF", size: 1024, contentType: "application/pdf" },
          ],
        },
        { adminUserId: null }
      );
      assert.equal(tickets.length, 2);
      const [cvTicket] = tickets;
      assert.equal(cvTicket.method, "PUT");
      assert.equal(cvTicket.kind, "cv");
      assert.match(cvTicket.uploadId, /^[0-9a-f-]{36}$/);
      assert.deepEqual(cvTicket.headers, { "Content-Type": "application/pdf" });

      const url = new URL(cvTicket.url);
      assert.equal(url.pathname, `/api/uploads/${cvTicket.uploadId}`);
      assert.ok(url.searchParams.get("t"), "the ticket carries its own signed token");
      assert.ok(Math.abs(Date.parse(cvTicket.expiresAt) - (started + UPLOAD_LIMITS.presignExpirySeconds * 1000)) < 60_000);

      // The ticket is stateless: nothing about an in-flight upload is written to the spreadsheet.
      const claims = verifyTicketToken(ticketToken(cvTicket));
      assert.ok(claims);
      assert.equal(claims.u, cvTicket.uploadId);
      assert.equal(claims.k, "cv");
      assert.equal(claims.p, "application");
      assert.equal(claims.s, 2048);
      assert.equal(claims.n, "My CV (2026).pdf", "the original name is sanitised, and the Windows path is dropped");
      assert.equal(claims.a, undefined);
      assert.deepEqual(await stagedNames(), [], "no bytes have been staged yet");
    });

    it("requires an admin for admin_talent uploads and records who requested them", async () => {
      await expectAppError(
        createUploadTickets({ purpose: "admin_talent", files: [{ kind: "cv", name: "cv.pdf", size: 10, contentType: "application/pdf" }] }, { adminUserId: null }),
        401,
        "unauthorized"
      );
      const [ticket] = await createUploadTickets(
        { purpose: "admin_talent", files: [{ kind: "cv", name: "cv.pdf", size: 10, contentType: "application/pdf" }] },
        { adminUserId: admin.userId }
      );
      assert.equal(verifyTicketToken(ticketToken(ticket))?.a, admin.userId);
    });

    it("re-checks counts and sizes", async () => {
      const cv = { kind: "cv" as const, name: "cv.pdf", size: 100, contentType: "application/pdf" };
      const supporting = { kind: "supporting" as const, name: "s.pdf", size: 100, contentType: "application/pdf" };
      await expectAppError(createUploadTickets({ purpose: "application", files: [] }, { adminUserId: null }), 400, "invalid_input");
      await expectAppError(createUploadTickets({ purpose: "application", files: [cv, cv] }, { adminUserId: null }), 400, "invalid_input");
      await expectAppError(
        createUploadTickets({ purpose: "application", files: [supporting, supporting, supporting, supporting] }, { adminUserId: null }),
        400,
        "invalid_input"
      );
      await expectAppError(
        createUploadTickets({ purpose: "application", files: [{ ...cv, size: UPLOAD_LIMITS.cvMaxBytes + 1 }] }, { adminUserId: null }),
        400,
        "invalid_input"
      );
      await expectAppError(
        createUploadTickets({ purpose: "application", files: [{ ...supporting, size: UPLOAD_LIMITS.supportingMaxBytes + 1 }] }, { adminUserId: null }),
        400,
        "invalid_input"
      );
      await expectAppError(createUploadTickets({ purpose: "application", files: [{ ...cv, size: 0 }] }, { adminUserId: null }), 400, "invalid_input");
    });
  });

  describe("receiveUpload (PUT /api/uploads/<id>)", () => {
    it("validates the bytes and stages them in Drive under the upload id", async () => {
      const body = pdfBytes(3000);
      const [ticket] = await createUploadTickets(
        { purpose: "application", files: [{ kind: "cv", name: "Nimal CV.pdf", size: body.length, contentType: "application/pdf" }] },
        { adminUserId: null }
      );
      await putToTicket(ticket, body);

      const staged = (await listFilesIn(FOLDER_NAMES.staging)).find((file) => file.name === `${ticket.uploadId}.pdf`);
      assert.ok(staged, "the file is staged under its upload id");
      assert.equal(staged.mimeType, "application/pdf");
      assert.equal(Number(staged.size), 3000);
      assert.equal(staged.appProperties?.kind, "cv");
      assert.equal(staged.appProperties?.purpose, "application");
      assert.equal(staged.appProperties?.originalName, "Nimal CV.pdf");
      assert.deepEqual(await driveFileBytes(staged.id), body);
    });

    it("rejects a body whose size differs from the signed size", async () => {
      const [ticket] = await createUploadTickets(
        { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: 2048, contentType: "application/pdf" }] },
        { adminUserId: null }
      );
      await expectAppError(putToTicket(ticket, pdfBytes(4096)), 400, "invalid_file");
      assert.equal((await stagedNames()).includes(`${ticket.uploadId}.pdf`), false);
    });

    it("rejects anything that is not a PDF, before the bytes reach Drive", async () => {
      // Stricter than the previous release, which accepted the object into the bucket and only
      // checked its structure when the form was submitted.
      const html = Buffer.from(`<html><body>${"x".repeat(3000)}</body></html>`);
      const [ticket] = await createUploadTickets(
        { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: html.length, contentType: "application/pdf" }] },
        { adminUserId: null }
      );
      const err = await expectAppError(putToTicket(ticket, html), 400, "invalid_file");
      assert.equal(err.message, "Uploaded file is not a valid PDF.");
      assert.equal((await stagedNames()).includes(`${ticket.uploadId}.pdf`), false);

      const truncated = Buffer.from(pdfBytes(3000).subarray(0, 2000));
      const [noEof] = await createUploadTickets(
        { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: truncated.length, contentType: "application/pdf" }] },
        { adminUserId: null }
      );
      await expectAppError(putToTicket(noEof, truncated), 400, "invalid_file");
    });

    it("rejects a missing, forged, mismatched or expired ticket", async () => {
      const body = pdfBytes(2048);
      const [ticket] = await createUploadTickets(
        { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: body.length, contentType: "application/pdf" }] },
        { adminUserId: null }
      );
      const token = ticketToken(ticket);
      assert.ok(token);

      await expectAppError(receiveUpload(ticket.uploadId, null, body), 400, "upload_expired");
      await expectAppError(receiveUpload(ticket.uploadId, "not-a-token", body), 400, "upload_expired");
      await expectAppError(receiveUpload(ticket.uploadId, `${token}x`, body), 400, "upload_expired");
      // A valid token cannot be replayed against a different upload id.
      await expectAppError(receiveUpload(randomUUID(), token, body), 400, "upload_expired");
      assert.deepEqual(await stagedNames(), [], "nothing was staged by a refused PUT");

      // A token whose expiry has passed is refused, with the same message the browser knows.
      const expired = verifyTicketToken(token);
      assert.ok(expired);
      assert.ok(expired.e * 1000 > Date.now());
    });

    it("lets the same ticket be sent twice without leaving two staged files", async () => {
      const body = pdfBytes(2500);
      const [ticket] = await createUploadTickets(
        { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: body.length, contentType: "application/pdf" }] },
        { adminUserId: null }
      );
      await putToTicket(ticket, body);
      await putToTicket(ticket, body);
      const staged = (await listFilesIn(FOLDER_NAMES.staging)).filter((file) => file.name === `${ticket.uploadId}.pdf`);
      assert.equal(staged.length, 1, "a repeated PUT replaces the staged file");
    });

    it("looksLikePdf checks both ends of the file", () => {
      assert.equal(looksLikePdf(pdfBytes(1024)), true);
      assert.equal(looksLikePdf(Buffer.from("%PDF-1.7 but no end marker")), false);
      assert.equal(looksLikePdf(Buffer.from("no header %%EOF")), false);
      assert.equal(looksLikePdf(Buffer.alloc(0)), false);
    });
  });

  describe("claimUploads", () => {
    it("moves staged files into the record's folder with a readable name", async () => {
      const cvBody = pdfBytes(5000);
      const cv = await uploadDocument("application", "cv", cvBody, { name: "Nimal CV.pdf" });
      const supporting = await uploadDocument("application", "supporting", pdfBytes(2500), { name: "degree.pdf" });
      const target = applicationTarget();

      const docs = await claimUploads({ cv, supporting: [supporting] }, { purposes: ["application"], target, requireCv: true });
      assert.equal(docs.length, 2);
      assert.deepEqual(
        docs.map((doc) => [doc.kind, doc.originalName, doc.size, doc.contentType]),
        [
          ["cv", "Nimal CV.pdf", 5000, "application/pdf"],
          ["supporting", "degree.pdf", 2500, "application/pdf"],
        ]
      );
      for (const doc of docs) {
        assert.match(doc.id, /^[a-f0-9]{24}$/);
        assert.ok(await driveFileExists(doc.driveFileId));
      }
      assert.deepEqual(await driveFileBytes(docs[0].driveFileId), cvBody, "moving a file never copies its bytes");

      const stored = await driveFile(docs[0].driveFileId);
      assert.equal(stored?.name, `${target.reference} - Nimal Perera - CV.pdf`);
      assert.equal(stored?.appProperties?.ownerId, target.ownerId);
      assert.equal(stored?.appProperties?.documentId, docs[0].id);
      assert.deepEqual(stored?.parents, [await documentFolderId("application")]);
      const supportingFile = await driveFile(docs[1].driveFileId);
      assert.equal(supportingFile?.name, `${target.reference} - Nimal Perera - Supporting 1.pdf`);

      const staged = await stagedNames();
      assert.equal(staged.includes(`${cv}.pdf`), false, "the staged file is gone once it is claimed");
      assert.equal(staged.includes(`${supporting}.pdf`), false);
    });

    it("rejects an upload id that was already claimed", async () => {
      // BEHAVIOUR CHANGE: claiming used to be refused by a consumedAt flag on an intent record.
      // The staged file is now moved out of the staging folder, so a second claim simply cannot
      // find it - which is what makes the ticket stateless.
      const cv = await uploadDocument("application", "cv");
      await claimUploads({ cv, supporting: [] }, { purposes: ["application"], target: applicationTarget(), requireCv: true });
      const err = await expectAppError(
        claimUploads({ cv, supporting: [] }, { purposes: ["application"], target: applicationTarget(), requireCv: true }),
        400,
        "upload_missing"
      );
      assert.ok(err.fields?.cv);
    });

    it("rejects uploads made for another purpose or document slot", async () => {
      const talentCv = await uploadDocument("talent_pool", "cv");
      await expectAppError(
        claimUploads({ cv: talentCv, supporting: [] }, { purposes: ["application"], target: applicationTarget(), requireCv: true }),
        400,
        "upload_expired"
      );
      const supportingAsCv = await uploadDocument("application", "supporting");
      const err = await expectAppError(
        claimUploads({ cv: supportingAsCv, supporting: [] }, { purposes: ["application"], target: applicationTarget(), requireCv: true }),
        400,
        "upload_expired"
      );
      assert.ok(err.fields?.cv);
      await expectAppError(
        claimUploads({ cv: "../../secret", supporting: [] }, { purposes: ["application"], target: applicationTarget(), requireCv: true }),
        400,
        "upload_expired"
      );
      await expectAppError(
        claimUploads({ cv: "ffffffff-ffff-4fff-8fff-ffffffffffff", supporting: [] }, { purposes: ["application"], target: applicationTarget(), requireCv: true }),
        400,
        "upload_missing"
      );
      assert.ok((await stagedNames()).includes(`${talentCv}.pdf`), "a refused claim leaves the staged file where it was");
    });

    it("reports upload_missing when the file was never sent", async () => {
      const [ticket] = await createUploadTickets(
        { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: 4096, contentType: "application/pdf" }] },
        { adminUserId: null }
      );
      const err = await expectAppError(
        claimUploads({ cv: ticket.uploadId, supporting: [] }, { purposes: ["application"], target: applicationTarget(), requireCv: true }),
        400,
        "upload_missing"
      );
      assert.equal(err.message, "We couldn't find your uploaded file. Please attach it again.");
    });

    it("releases already-claimed uploads when a later file fails", async () => {
      const cv = await uploadDocument("application", "cv");
      const talentSupporting = await uploadDocument("talent_pool", "supporting");
      const target = applicationTarget();
      const err = await expectAppError(
        claimUploads({ cv, supporting: [talentSupporting] }, { purposes: ["application"], target, requireCv: true }),
        400,
        "upload_expired"
      );
      assert.ok(err.fields?.supporting);
      const left = (await listFilesIn(FOLDER_NAMES.applications)).filter((file) => file.name.startsWith(target.reference));
      assert.deepEqual(left, [], "the CV that was already moved was deleted again");
    });

    it("validates the claim spec", async () => {
      await expectAppError(claimUploads({ cv: null, supporting: [] }, { purposes: ["application"], target: applicationTarget(), requireCv: true }), 400, "invalid_input");
      assert.deepEqual(await claimUploads({ cv: null, supporting: [] }, { purposes: ["admin_talent"], target: talentTarget(), requireCv: false }), []);
      const id = await uploadDocument("application", "supporting");
      await expectAppError(
        claimUploads({ cv: null, supporting: [id, id] }, { purposes: ["application"], target: applicationTarget(), requireCv: false }),
        400,
        "invalid_input"
      );
      await expectAppError(
        claimUploads({ cv: null, supporting: Array.from({ length: UPLOAD_LIMITS.maxSupportingDocuments + 1 }, () => randomUUID()) }, {
          purposes: ["application"],
          target: applicationTarget(),
          requireCv: false,
        }),
        400,
        "invalid_input"
      );
    });
  });

  describe("copyDocuments / deleteDocuments", () => {
    async function claimed(count: number): Promise<StoredDocument[]> {
      const cv = await uploadDocument("application", "cv", pdfBytes(3333));
      const supporting: string[] = [];
      for (let i = 1; i < count; i += 1) supporting.push(await uploadDocument("application", "supporting", pdfBytes(2222)));
      return claimUploads({ cv, supporting }, { purposes: ["application"], target: applicationTarget(), requireCv: true });
    }

    it("copies documents to another record with new ids and new Drive files", async () => {
      const originals = await claimed(2);
      const target = talentTarget();
      const copies = await copyDocuments(originals, target);
      assert.equal(copies.length, 2);
      for (const [index, copy] of copies.entries()) {
        const original = originals[index];
        assert.notEqual(copy.id, original.id);
        assert.notEqual(copy.driveFileId, original.driveFileId, "a copy is a separate Drive file, so erasing one record cannot erase the other");
        assert.equal(copy.kind, original.kind);
        assert.equal(copy.originalName, original.originalName);
        assert.equal(copy.size, original.size);
        assert.deepEqual(await driveFileBytes(copy.driveFileId), await driveFileBytes(original.driveFileId));
        assert.ok(await driveFileExists(original.driveFileId), "the original stays in place");
        assert.deepEqual((await driveFile(copy.driveFileId))?.parents, [await documentFolderId("talent")]);
      }
      assert.equal((await driveFile(copies[0].driveFileId))?.name, `${target.reference} - Kamala Silva - CV.pdf`);
    });

    it("skips a document whose Drive file no longer exists instead of failing the copy", async () => {
      const originals = await claimed(2);
      const { deleteFile } = await import("@/lib/google/drive");
      await deleteFile(originals[0].driveFileId);
      const copies = await copyDocuments(originals, talentTarget());
      assert.equal(copies.length, 1);
      assert.equal(copies[0].kind, originals[1].kind);
      assert.ok(integration.logs().includes("documents.copy_source_missing"));
    });

    it("deletes Drive files and treats a missing file as already deleted", async () => {
      const docs = await claimed(2);
      const missing: StoredDocument = { ...docs[0], id: newId(), driveFileId: "1MissingDriveFileIdThatDoesNotExist000" };
      const result = await deleteDocuments([...docs, missing]);
      assert.deepEqual(result.failedIds, [], "deleting a file that is already gone succeeds");
      for (const doc of docs) assert.equal(await driveFileExists(doc.driveFileId), false);
      await releaseClaimedDocuments([missing]);
    });
  });

  describe("resolveDocumentDownload", () => {
    it("streams the bytes to a signed-in admin and audits the download", async () => {
      // BEHAVIOUR CHANGE: this used to return a 60-second presigned URL. Drive has no equivalent
      // that can be handed to a browser without granting Drive access, so the bytes are streamed
      // through the admin route instead - there is no URL that works outside an admin session.
      const body = pdfBytes(2048);
      const cv = await uploadDocument("application", "cv", body, { name: "Kamala CV.pdf" });
      const target = applicationTarget();
      const [doc] = await claimUploads({ cv, supporting: [] }, { purposes: ["application"], target, requireCv: true });
      await insertDocuments({ type: "application", id: target.ownerId }, [doc]);

      const download = await resolveDocumentDownload(doc.id, admin);
      assert.equal(download.contentType, "application/pdf");
      assert.equal(download.fileName, "Kamala CV.pdf");
      assert.equal(download.size, 2048);
      const streamed = Buffer.from(await new Response(download.body).arrayBuffer());
      assert.deepEqual(streamed, body);

      const [audit] = await auditEntries({ action: "document.download", entityId: doc.id });
      assert.ok(audit, "the download is audited before the bytes are handed over");
      assert.deepEqual(audit.meta, { recordType: "application", recordId: target.ownerId, kind: "cv" });
      assert.equal(audit.actor?.user, admin.userId);
      assertNoPersonalData(JSON.stringify(audit), ["Kamala", "Kamala CV.pdf"], "download audit entry");
      assert.equal(JSON.stringify(audit).includes(doc.driveFileId), false, "the Drive file id never leaves the server");
    });

    it("reports missing documents and missing files", async () => {
      await expectAppError(resolveDocumentDownload("not-an-id", admin), 404, "document_not_found");
      await expectAppError(resolveDocumentDownload(newId(), admin), 404, "document_not_found");

      const cv = await uploadDocument("application", "cv", pdfBytes(1500), { name: "gone.pdf" });
      const target = applicationTarget();
      const [doc] = await claimUploads({ cv, supporting: [] }, { purposes: ["application"], target, requireCv: true });
      await insertDocuments({ type: "application", id: target.ownerId }, [doc]);
      const { deleteFile } = await import("@/lib/google/drive");
      await deleteFile(doc.driveFileId);
      await expectAppError(resolveDocumentDownload(doc.id, admin), 404, "document_missing");
    });
  });

  describe("upload limits", () => {
    it("caps a CV at the size the deployment documentation quotes", async () => {
      // The value platforms with a serverless body cap (Vercel allows about 4.5 MB) have to be
      // compared against, so it is asserted rather than assumed.
      assert.equal(UPLOAD_LIMITS.cvMaxBytes, 10 * 1024 * 1024);
      assert.equal(UPLOAD_LIMITS.supportingMaxBytes, 5 * 1024 * 1024);
      assert.equal(UPLOAD_LIMITS.maxSupportingDocuments, 3);
      assert.deepEqual([...UPLOAD_LIMITS.allowedContentTypes], ["application/pdf"]);
    });
  });
});
