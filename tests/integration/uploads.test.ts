import "./support/env";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Types } from "mongoose";
import type { AdminContext } from "@/lib/auth/session";
import { UPLOAD_LIMITS } from "@/lib/careers/constants";
import { claimUploads, copyDocuments, createUploadTickets, deleteDocuments, releaseClaimedDocuments } from "@/lib/careers/server/uploads";
import { resolveDocumentDownload } from "@/lib/careers/server/documents";
import { presignDownload, readObjectBytes, copyObject, deleteObject, headObject as appHeadObject, StorageObjectNotFoundError } from "@/lib/storage";
import type { StoredDocument } from "@/models/shared";
import { UploadIntentModel } from "@/models/upload-intent";
import { ApplicationModel } from "@/models/application";
import { adminContext, assertNoPersonalData, auditEntries, expectAppError, pdfBytes, putToTicket, uniqueSuffix, uploadDocument } from "./support/fixtures";
import { startIntegration, type Integration } from "./support/harness";
import { getObjectBytes, headObject, listKeys, objectExists, putObject } from "./support/s3";

function prefix(): string {
  return `applications/${new Types.ObjectId().toHexString()}`;
}

async function intent(id: string) {
  const doc = await UploadIntentModel.findById(id).lean();
  assert.ok(doc, `upload intent ${id} not found`);
  return doc;
}

describe("uploads and documents", { timeout: 180_000 }, () => {
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
    it("creates presigned PUT tickets and intents under incoming/", async () => {
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
      assert.equal(url.pathname.endsWith(`/incoming/${cvTicket.uploadId}.pdf`), true, url.pathname);
      assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-length;content-type;host");
      assert.equal(url.searchParams.get("X-Amz-Expires"), String(UPLOAD_LIMITS.presignExpirySeconds));
      assert.ok(Math.abs(Date.parse(cvTicket.expiresAt) - (started + UPLOAD_LIMITS.presignExpirySeconds * 1000)) < 60_000);

      const stored = await intent(cvTicket.uploadId);
      assert.equal(stored.key, `incoming/${cvTicket.uploadId}.pdf`);
      assert.equal(stored.originalName, "My CV (2026).pdf");
      assert.equal(stored.size, 2048);
      assert.equal(stored.purpose, "application");
      assert.equal(stored.consumedAt, null);
      assert.equal(stored.createdByAdmin, null);
      assert.ok(Math.abs(stored.expiresAt.getTime() - (started + UPLOAD_LIMITS.intentTtlSeconds * 1000)) < 60_000);
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
      assert.ok((await intent(ticket.uploadId)).createdByAdmin?.equals(admin.userId));
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

  describe("presigned PUT", () => {
    it("stores the uploaded bytes under the incoming key", async () => {
      const body = pdfBytes(3000);
      const [ticket] = await createUploadTickets(
        { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: body.length, contentType: "application/pdf" }] },
        { adminUserId: null }
      );
      assert.equal(await putToTicket(ticket, body), 200);
      const head = await headObject(`incoming/${ticket.uploadId}.pdf`);
      assert.deepEqual(head, { size: 3000, contentType: "application/pdf" });
    });

    it("is rejected by storage when the body size differs from the signed size", async () => {
      const [ticket] = await createUploadTickets(
        { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: 2048, contentType: "application/pdf" }] },
        { adminUserId: null }
      );
      const status = await putToTicket(ticket, pdfBytes(4096));
      assert.equal(status, 403);
      assert.equal(await objectExists(`incoming/${ticket.uploadId}.pdf`), false);
    });

    it("is rejected by storage when the content type differs from the signed type", async () => {
      const body = pdfBytes(2048);
      const [ticket] = await createUploadTickets(
        { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: body.length, contentType: "application/pdf" }] },
        { adminUserId: null }
      );
      const status = await putToTicket(ticket, body, { "Content-Type": "text/html" });
      assert.equal(status, 403);
      assert.equal(await objectExists(`incoming/${ticket.uploadId}.pdf`), false);
    });
  });

  describe("claimUploads", () => {
    it("verifies, copies and consumes valid uploads, removing the incoming objects", async () => {
      const cvBody = pdfBytes(5000);
      const cv = await uploadDocument("application", "cv", cvBody, { name: "Nimal CV.pdf" });
      const supporting = await uploadDocument("application", "supporting", pdfBytes(2500), { name: "degree.pdf" });
      const destination = prefix();

      const docs = await claimUploads({ cv, supporting: [supporting] }, { purposes: ["application"], destinationPrefix: destination, requireCv: true });
      assert.equal(docs.length, 2);
      assert.deepEqual(
        docs.map((doc) => [doc.kind, doc.originalName, doc.size, doc.contentType, doc.legacy]),
        [
          ["cv", "Nimal CV.pdf", 5000, "application/pdf", false],
          ["supporting", "degree.pdf", 2500, "application/pdf", false],
        ]
      );
      for (const doc of docs) {
        assert.equal(doc.key, `${destination}/${doc._id.toHexString()}.pdf`);
        assert.ok(await objectExists(doc.key), doc.key);
      }
      assert.deepEqual(await getObjectBytes(docs[0].key), cvBody);
      assert.equal(await objectExists(`incoming/${cv}.pdf`), false);
      assert.equal(await objectExists(`incoming/${supporting}.pdf`), false);
      assert.ok((await intent(cv)).consumedAt);
      assert.ok((await intent(supporting)).consumedAt);
    });

    it("rejects an upload id that was already claimed", async () => {
      const cv = await uploadDocument("application", "cv");
      await claimUploads({ cv, supporting: [] }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: true });
      const err = await expectAppError(
        claimUploads({ cv, supporting: [] }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: true }),
        400,
        "upload_expired"
      );
      assert.ok(err.fields?.cv);
    });

    it("rejects expired intents without touching the object", async () => {
      const cv = await uploadDocument("application", "cv");
      await UploadIntentModel.updateOne({ _id: cv }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      await expectAppError(claimUploads({ cv, supporting: [] }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: true }), 400, "upload_expired");
      assert.equal((await intent(cv)).consumedAt, null);
    });

    it("rejects uploads made for another purpose or document slot", async () => {
      const talentCv = await uploadDocument("talent_pool", "cv");
      await expectAppError(
        claimUploads({ cv: talentCv, supporting: [] }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: true }),
        400,
        "upload_expired"
      );
      const supportingAsCv = await uploadDocument("application", "supporting");
      const err = await expectAppError(
        claimUploads({ cv: supportingAsCv, supporting: [] }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: true }),
        400,
        "upload_expired"
      );
      assert.ok(err.fields?.cv);
      await expectAppError(
        claimUploads({ cv: "../../secret", supporting: [] }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: true }),
        400,
        "upload_expired"
      );
      await expectAppError(
        claimUploads({ cv: "ffffffff-ffff-4fff-8fff-ffffffffffff", supporting: [] }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: true }),
        400,
        "upload_expired"
      );
    });

    it("reports upload_missing when the file was never uploaded", async () => {
      const [ticket] = await createUploadTickets(
        { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: 4096, contentType: "application/pdf" }] },
        { adminUserId: null }
      );
      const err = await expectAppError(
        claimUploads({ cv: ticket.uploadId, supporting: [] }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: true }),
        400,
        "upload_missing"
      );
      assert.equal(err.message, "We couldn't find your uploaded file. Please attach it again.");
    });

    it("rejects an object whose size differs from the declared size and deletes it", async () => {
      const [ticket] = await createUploadTickets(
        { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: 4096, contentType: "application/pdf" }] },
        { adminUserId: null }
      );
      const key = `incoming/${ticket.uploadId}.pdf`;
      await putObject(key, pdfBytes(2048));
      const err = await expectAppError(
        claimUploads({ cv: ticket.uploadId, supporting: [] }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: true }),
        400,
        "invalid_file"
      );
      assert.ok(err.fields?.cv);
      assert.equal(await objectExists(key), false);
      assert.ok((await intent(ticket.uploadId)).consumedAt, "a rejected file cannot be claimed again");
    });

    it("rejects files that are not PDFs and deletes them", async () => {
      const html = Buffer.from(`<html><body>${"x".repeat(3000)}</body></html>`);
      const notPdf = await uploadDocument("application", "cv", html);
      const err = await expectAppError(
        claimUploads({ cv: notPdf, supporting: [] }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: true }),
        400,
        "invalid_file"
      );
      assert.equal(err.message, "Uploaded file is not a valid PDF.");
      assert.equal(await objectExists(`incoming/${notPdf}.pdf`), false);

      const truncated = pdfBytes(3000).subarray(0, 2000);
      const noEof = await uploadDocument("application", "cv", Buffer.from(truncated));
      await expectAppError(
        claimUploads({ cv: noEof, supporting: [] }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: true }),
        400,
        "invalid_file"
      );

      const [ticket] = await createUploadTickets(
        { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: 3000, contentType: "application/pdf" }] },
        { adminUserId: null }
      );
      await putObject(`incoming/${ticket.uploadId}.pdf`, pdfBytes(3000), "text/html");
      await expectAppError(
        claimUploads({ cv: ticket.uploadId, supporting: [] }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: true }),
        400,
        "invalid_file"
      );
    });

    it("releases already-claimed uploads and removes copies when a later file fails", async () => {
      const cv = await uploadDocument("application", "cv");
      const bad = await uploadDocument("application", "supporting", Buffer.from("definitely not a pdf, just some text padding".repeat(20)));
      const destination = prefix();
      const err = await expectAppError(
        claimUploads({ cv, supporting: [bad] }, { purposes: ["application"], destinationPrefix: destination, requireCv: true }),
        400,
        "invalid_file"
      );
      assert.ok(err.fields?.supporting);
      assert.deepEqual(await listKeys(`${destination}/`), [], "the CV copy was removed");
      assert.equal((await intent(cv)).consumedAt, null, "the CV upload can be submitted again");
      assert.ok(await objectExists(`incoming/${cv}.pdf`));

      const docs = await claimUploads({ cv, supporting: [] }, { purposes: ["application"], destinationPrefix: destination, requireCv: true });
      assert.equal(docs.length, 1);
    });

    it("validates the claim spec", async () => {
      await expectAppError(claimUploads({ cv: null, supporting: [] }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: true }), 400, "invalid_input");
      assert.deepEqual(await claimUploads({ cv: null, supporting: [] }, { purposes: ["admin_talent"], destinationPrefix: prefix(), requireCv: false }), []);
      const id = await uploadDocument("application", "supporting");
      await expectAppError(
        claimUploads({ cv: null, supporting: [id, id] }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: false }),
        400,
        "invalid_input"
      );
      await assert.rejects(
        claimUploads({ cv: id, supporting: [] }, { purposes: ["application"], destinationPrefix: "../escape", requireCv: false }),
        /Invalid destination prefix/
      );
    });
  });

  describe("copyDocuments / deleteDocuments", () => {
    async function claimed(count: number): Promise<StoredDocument[]> {
      const cv = await uploadDocument("application", "cv", pdfBytes(3333));
      const supporting: string[] = [];
      for (let i = 1; i < count; i += 1) supporting.push(await uploadDocument("application", "supporting", pdfBytes(2222)));
      return claimUploads({ cv, supporting }, { purposes: ["application"], destinationPrefix: prefix(), requireCv: true });
    }

    it("copies documents to a new prefix with new ids and keys", async () => {
      const originals = await claimed(2);
      const destination = `talent-pool/${new Types.ObjectId().toHexString()}`;
      const copies = await copyDocuments(originals, destination);
      assert.equal(copies.length, 2);
      for (const [index, copy] of copies.entries()) {
        const original = originals[index];
        assert.equal(copy._id.equals(original._id), false);
        assert.equal(copy.key, `${destination}/${copy._id.toHexString()}.pdf`);
        assert.equal(copy.kind, original.kind);
        assert.equal(copy.originalName, original.originalName);
        assert.equal(copy.size, original.size);
        assert.equal(copy.legacy, false);
        assert.deepEqual(await getObjectBytes(copy.key), await getObjectBytes(original.key));
        assert.ok(await objectExists(original.key), "the original stays in place");
      }
    });

    it("skips legacy documents whose object no longer exists and fills unknown sizes", async () => {
      const legacyKey = `cvs/legacy ${uniqueSuffix()} cv.pdf`;
      await putObject(legacyKey, pdfBytes(1234));
      const legacy: StoredDocument = {
        _id: new Types.ObjectId(),
        kind: "cv",
        key: legacyKey,
        originalName: "legacy cv.pdf",
        size: null,
        contentType: "application/pdf",
        uploadedAt: new Date("2023-01-01T00:00:00Z"),
        legacy: true,
      };
      const missing: StoredDocument = { ...legacy, _id: new Types.ObjectId(), key: `cvs/missing-${uniqueSuffix()}.pdf` };
      const copies = await copyDocuments([missing, legacy], `applications/${new Types.ObjectId().toHexString()}`);
      assert.equal(copies.length, 1);
      assert.equal(copies[0].size, 1234);
      assert.equal(copies[0].legacy, false);
      assert.deepEqual(copies[0].uploadedAt, legacy.uploadedAt);
    });

    it("deletes objects, treats missing objects as deleted and reports failures", async () => {
      const docs = await claimed(2);
      const missing: StoredDocument = { ...docs[0], _id: new Types.ObjectId(), key: `applications/${new Types.ObjectId().toHexString()}/gone.pdf` };
      const invalid: StoredDocument = { ...docs[0], _id: new Types.ObjectId(), key: "/not-a-valid-key.pdf" };
      const result = await deleteDocuments([...docs, missing, invalid]);
      assert.deepEqual(result.failedKeys, ["/not-a-valid-key.pdf"]);
      for (const doc of docs) assert.equal(await objectExists(doc.key), false);
      await releaseClaimedDocuments([invalid]);
    });
  });

  describe("storage primitives", () => {
    it("reads byte ranges, copies with metadata and reports missing objects", async () => {
      const key = `incoming/${uniqueSuffix()}.pdf`;
      const body = pdfBytes(4096);
      await putObject(key, body);
      assert.deepEqual(await readObjectBytes(key, { start: 0, end: 4 }), body.subarray(0, 5));
      assert.deepEqual(await readObjectBytes(key, { suffix: 6 }), body.subarray(body.length - 6));
      const copyKey = `applications/${uniqueSuffix()}/copy.pdf`;
      await copyObject(key, copyKey, { contentType: "application/pdf" });
      assert.deepEqual(await appHeadObject(copyKey).then((head) => head && { size: head.size, contentType: head.contentType }), { size: 4096, contentType: "application/pdf" });
      await assert.rejects(readObjectBytes(`incoming/${uniqueSuffix()}.pdf`, { start: 0, end: 10 }), StorageObjectNotFoundError);
      await assert.rejects(copyObject(`incoming/${uniqueSuffix()}.pdf`, `applications/${uniqueSuffix()}.pdf`), StorageObjectNotFoundError);
      assert.equal(await appHeadObject(`incoming/${uniqueSuffix()}.pdf`), null);
      await deleteObject(`incoming/${uniqueSuffix()}.pdf`);
      await deleteObject(key);
      assert.equal(await objectExists(key), false);
    });

    it("presigns downloads that force an attachment with a safe file name", async () => {
      const key = `applications/${uniqueSuffix()}/doc.pdf`;
      await putObject(key, pdfBytes(2048));
      const url = await presignDownload(key, { fileName: "සුනිල් \"CV\".pdf" });
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("X-Amz-Expires"), "60");
      const disposition = parsed.searchParams.get("response-content-disposition") ?? "";
      assert.ok(disposition.startsWith("attachment; filename=\""), disposition);
      assert.ok(disposition.includes("filename*=UTF-8''"), disposition);
      assert.equal(disposition.slice(0, disposition.indexOf(";", 12)).includes("\\"), false);
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/pdf");
      assert.ok((response.headers.get("content-disposition") ?? "").startsWith("attachment"));
      assert.equal((await response.arrayBuffer()).byteLength, 2048);
    });
  });

  describe("resolveDocumentDownload", () => {
    it("returns a presigned URL, audits the download and reports missing documents and files", async () => {
      const cv = await uploadDocument("application", "cv", pdfBytes(2048), { name: "Kamala CV.pdf" });
      const applicationId = new Types.ObjectId();
      const [doc] = await claimUploads({ cv, supporting: [] }, { purposes: ["application"], destinationPrefix: `applications/${applicationId}`, requireCv: true });
      const now = new Date();
      await ApplicationModel.create({
        _id: applicationId,
        job: new Types.ObjectId(),
        jobSlug: "download-test",
        jobTitle: "Download Test",
        name: "Kamala Silva",
        email: `kamala.${uniqueSuffix()}@example.com`,
        phone: "0771234567",
        consentGiven: true,
        documents: [doc],
        statusChangedAt: now,
      });

      const url = await resolveDocumentDownload(doc._id.toHexString(), admin);
      assert.equal((await fetch(url)).status, 200);
      const [audit] = await auditEntries({ action: "document.download", entityId: doc._id.toHexString() });
      assert.ok(audit);
      assert.deepEqual(audit.meta, { recordType: "application", recordId: applicationId.toHexString(), kind: "cv" });
      assert.ok(audit.actor?.user.equals(admin.userId));
      assertNoPersonalData(JSON.stringify(audit), ["Kamala", "Kamala CV.pdf"], "download audit entry");

      await expectAppError(resolveDocumentDownload("not-an-id", admin), 404, "document_not_found");
      await expectAppError(resolveDocumentDownload(new Types.ObjectId().toHexString(), admin), 404, "document_not_found");
      await deleteObject(doc.key);
      await expectAppError(resolveDocumentDownload(doc._id.toHexString(), admin), 404, "document_missing");
    });
  });
});
