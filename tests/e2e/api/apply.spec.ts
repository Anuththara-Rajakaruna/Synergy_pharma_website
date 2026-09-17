import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { api, loginAsAdmin, pdfBytes, uniqueSuffix, type UploadFile } from "../support/api";
import type { AdminJob, AuditLogEntry, Paginated } from "@/types/careers";
import { expectApiError, expectIsoDate, expectNoSensitiveData, expectRetryAfter, expectStatus } from "./lib/assertions";
import {
  applicationBody,
  candidate,
  changeJobStatus,
  createJob,
  createOpenJob,
  cvFile,
  findApplication,
  getApplication,
  isolatedClientIp,
  jobPayload,
  ORIGIN_EVIL,
  postApplication,
  retireJob,
  sendStreamedJson,
  submitApplication,
  supportingFile,
  uploadDocuments,
} from "./lib/fixtures";
import { sentTo, waitForEmails } from "./lib/mail";

// POST /api/apply: public job applications referencing files uploaded beforehand.

test.describe("POST /api/apply", () => {
  let admin = "";
  let job: AdminJob;
  let secondJob: AdminJob;
  let draftJob: AdminJob;
  let closedJob: AdminJob;
  const jobs: string[] = [];

  test.beforeAll(async () => {
    admin = await loginAsAdmin();
    const marker = uniqueSuffix();
    job = await createOpenJob(admin, "apply", { title: `QA <b>Lead</b> & "Ops" ${marker}` });
    secondJob = await createOpenJob(admin, "apply-second");
    draftJob = await createJob(admin, jobPayload("apply-draft"));
    closedJob = await changeJobStatus(admin, (await createOpenJob(admin, "apply-closed")).id, "close");
    jobs.push(job.id, secondJob.id, draftJob.id, closedJob.id);
  });

  test.afterAll(async () => {
    for (const slug of jobs) await retireJob(admin, slug);
  });

  test("stores a complete application and notifies the candidate and HR", async () => {
    const person = candidate("apply-ok", {
      email: `E2E.Apply.${uniqueSuffix()}@Example.com`,
      phone: "+94  77 123   4567",
      coverLetter: "  I would like to apply.\r\nSecond line.  ",
      linkedIn: "linkedin.com/in/nadeesha-perera",
      portfolio: "https://portfolio.example.org/work",
    });
    const files: UploadFile[] = [
      { kind: "cv", name: "Nadeesha CV (final).pdf", bytes: pdfBytes(6000, "cv") },
      { kind: "supporting", name: "degree certificate.pdf", bytes: pdfBytes(3000, "degree") },
    ];
    const uploads = await uploadDocuments("application", files);
    const result = await postApplication(applicationBody(job.id, person, uploads));
    expectStatus(result, 201);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(Object.keys(result.body).sort()).toEqual(["message", "reference", "success"]);
    expect(result.body.success).toBe(true);
    expect(result.body.message).toBe("Application submitted successfully.");
    expect(result.body.reference).toMatch(/^APP-[0-9A-F]{8}$/);

    const item = await findApplication(admin, person.email, job.id);
    const detail = await getApplication(admin, item.id);
    expect(detail).toMatchObject({
      reference: result.body.reference,
      name: person.name,
      email: person.email,
      phone: "+94 77 123 4567",
      jobId: job.id,
      jobTitle: job.title,
      department: job.department,
      status: "submitted",
      source: "website",
      coverLetter: "I would like to apply.\nSecond line.",
      linkedIn: "https://linkedin.com/in/nadeesha-perera",
      portfolio: "https://portfolio.example.org/work",
      consentGiven: true,
      archived: false,
      inTalentPool: false,
      documentCount: 2,
      noteCount: 0,
      talentPoolEntryId: null,
      jobStillExists: true,
    });
    expectIsoDate(detail.consentAt, "consentAt");
    expect(detail.statusHistory).toHaveLength(1);
    expect(detail.statusHistory[0]).toMatchObject({
      from: null,
      to: "submitted",
      changedByName: null,
      note: "Application submitted via website",
      candidateNotified: false,
    });
    expect(detail.documents.map((doc) => [doc.kind, doc.size, doc.contentType])).toEqual([
      ["cv", 6000, "application/pdf"],
      ["supporting", 3000, "application/pdf"],
    ]);
    for (const doc of detail.documents) {
      expect(doc.downloadUrl).toBe(`/api/admin/documents/${doc.id}`);
      expect(doc.originalName).toMatch(/\.pdf$/);
      expect(doc.originalName).not.toMatch(/[\\/]/);
    }
    expectNoSensitiveData(detail, "application detail");

    const candidateMail = await waitForEmails((mail) => sentTo(mail, person.email) && mail.subject.includes(result.body.reference));
    expect(candidateMail[0].replyTo).toContain("hr@synergypharma.lk");
    const hrMail = await waitForEmails((mail) => sentTo(mail, "hr@synergypharma.lk") && mail.subject.includes(result.body.reference));
    expect(hrMail[0].replyTo.toLowerCase()).toContain(person.email.toLowerCase());
    expect(hrMail[0].envelopeTo).not.toContain(person.email.toLowerCase());
    for (const mail of [candidateMail[0], hrMail[0]]) {
      expect(mail.html).toContain("QA &lt;b&gt;Lead&lt;/b&gt; &amp;");
      expect(mail.html).not.toContain("<b>Lead</b>");
      expect(mail.text).toContain(job.title);
    }
    expect(hrMail[0].html).toContain(`application=${item.id}`);
    // Candidate-facing mail never echoes candidate-supplied URLs.
    expect(candidateMail[0].html).not.toContain("portfolio.example.org");
    expect(candidateMail[0].text).not.toContain("linkedin.com/in/nadeesha-perera");

    // The public audit trail records the submission without the candidate's contact details.
    const audit = await api<Paginated<AuditLogEntry>>("GET", `/api/admin/audit?entityType=application&entityId=${item.id}`, { cookie: admin });
    expectStatus(audit, 200);
    const submitEntry = audit.body.items.find((entry) => entry.action === "application.submit");
    expect(submitEntry, "application.submit audit entry").toBeDefined();
    expect(JSON.stringify(audit.body).toLowerCase()).not.toContain(person.email.toLowerCase());
  });

  test("reports every invalid field", async () => {
    const result = await postApplication({
      jobId: job.id,
      name: "R2-D2",
      email: "not-an-email",
      phone: "call me",
      coverLetter: "x".repeat(5001),
      linkedIn: "https://evil.example/in/someone",
      portfolio: "javascript:alert(1)",
      consentGiven: false,
      uploads: { cv: "", supporting: [] },
    });
    const error = expectApiError(result, 400, "invalid_input", {
      fields: ["name", "email", "phone", "coverLetter", "linkedIn", "portfolio", "consentGiven", "cv"],
    });
    expect(error.fields?.jobId).toBeUndefined();
    expectApiError(await postApplication({ ...applicationBody("", candidate("apply-nojob"), { cv: randomUUID(), supporting: [] }) }), 400, "invalid_input", {
      fields: ["jobId"],
    });
  });

  test("rejects NoSQL operators and wrong types instead of strings", async () => {
    const person = candidate("apply-operators");
    const base = applicationBody(job.id, person, { cv: randomUUID(), supporting: [] });
    const cases: [Record<string, unknown>, string][] = [
      [{ ...base, jobId: { $ne: null } }, "jobId"],
      [{ ...base, email: { $gt: "" } }, "email"],
      [{ ...base, name: ["Nadeesha", "Perera"] }, "name"],
      [{ ...base, phone: 94771234567 }, "phone"],
      [{ ...base, consentGiven: "true" }, "consentGiven"],
      [{ ...base, uploads: { cv: { $ne: null }, supporting: [] } }, "cv"],
      [{ ...base, uploads: { cv: randomUUID(), supporting: { $exists: true } } }, "supporting"],
      [{ ...base, uploads: { cv: "../../incoming/other.pdf", supporting: [] } }, "cv"],
    ];
    for (const [body, field] of cases) {
      expectApiError(await postApplication(body), 400, "invalid_input", { fields: [field] });
    }
  });

  test("only open jobs accept applications", async () => {
    for (const slug of [draftJob.id, closedJob.id, `missing-${uniqueSuffix()}`]) {
      const body = applicationBody(slug, candidate("apply-closed"), { cv: randomUUID(), supporting: [] });
      expectApiError(await postApplication(body), 404, "job_not_found", {
        message: "This role is no longer accepting applications.",
      });
    }
  });

  test("a second application for the same job and email is a duplicate, whatever the letter case", async () => {
    const person = candidate("apply-dup");
    await submitApplication(job.id, person);

    const retryUploads = await uploadDocuments("application", [cvFile("retry")]);
    const duplicate = await postApplication(applicationBody(job.id, { ...person, email: person.email.toUpperCase() }, retryUploads));
    expectApiError(duplicate, 409, "duplicate_application", {
      message: "You have already applied for this role. We'll be in touch if your profile is shortlisted.",
    });

    // The duplicate was detected before the upload was claimed, so the same file still works elsewhere.
    const other = await postApplication(applicationBody(secondJob.id, person, retryUploads));
    expectStatus(other, 201);
  });

  test("an archived application still blocks a second application for the same job", async () => {
    const person = candidate("apply-archived-dup");
    await submitApplication(job.id, person);
    const item = await findApplication(admin, person.email, job.id);
    const archived = await api("POST", `/api/admin/applications/${item.id}/archive`, { cookie: admin, json: { archived: true, reason: "E2E" } });
    expectStatus(archived, 200);
    const uploads = await uploadDocuments("application", [cvFile("again")]);
    expectApiError(await postApplication(applicationBody(job.id, person, uploads)), 409, "duplicate_application");
  });

  test("stored file names are display-safe and never used as storage paths", async () => {
    const person = candidate("apply-filenames");
    const files: UploadFile[] = [
      { kind: "cv", name: "..\\..\\windows\\<script>alert(1)</script>.pdf", bytes: pdfBytes(2048, "cv") },
      { kind: "supporting", name: "../../etc/passwd;rm -rf.pdf", bytes: pdfBytes(2048, "support") },
    ];
    const uploads = await uploadDocuments("application", files);
    expectStatus(await postApplication(applicationBody(job.id, person, uploads)), 201);
    const detail = await getApplication(admin, (await findApplication(admin, person.email, job.id)).id);
    for (const doc of detail.documents) {
      expect(doc.originalName).toMatch(/^[A-Za-z0-9 ._()-]+\.pdf$/);
      expect(doc.originalName).not.toContain("..");
    }
  });

  test("files whose bytes are not a PDF are rejected as invalid_file", async () => {
    const notPdf: UploadFile = { kind: "cv", name: "cv.pdf", bytes: Buffer.from("<html><body>not a pdf</body></html>".padEnd(2048, " ")) };
    const noTrailer: UploadFile = { kind: "cv", name: "cv.pdf", bytes: Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(4000, 65)]) };
    for (const file of [notPdf, noTrailer]) {
      const uploads = await uploadDocuments("application", [file]);
      const result = await postApplication(applicationBody(job.id, candidate("apply-notpdf"), uploads));
      expectApiError(result, 400, "invalid_file", { fields: ["cv"], message: "Uploaded file is not a valid PDF." });
    }

    // The PDF signature must appear within the first 1024 bytes.
    const lateHeader: UploadFile = {
      kind: "cv",
      name: "cv.pdf",
      bytes: Buffer.concat([Buffer.alloc(1100, 0x20), Buffer.from("%PDF-1.7\n"), Buffer.alloc(500, 0x41), Buffer.from("\n%%EOF\n")]),
    };
    const lateUploads = await uploadDocuments("application", [lateHeader]);
    expectApiError(await postApplication(applicationBody(job.id, candidate("apply-lateheader"), lateUploads)), 400, "invalid_file", { fields: ["cv"] });

    const badSupporting: UploadFile = { kind: "supporting", name: "scan.pdf", bytes: Buffer.alloc(3000, 0x4d) };
    const mixed = await uploadDocuments("application", [cvFile("good"), badSupporting]);
    const person = candidate("apply-badsupporting");
    const result = await postApplication(applicationBody(job.id, person, mixed));
    expectApiError(result, 400, "invalid_file", { fields: ["supporting"] });
    // The valid CV was released again and can be resubmitted with a fresh supporting file.
    const replacement = await uploadDocuments("application", [supportingFile("replacement")]);
    const retry = await postApplication(applicationBody(job.id, person, { cv: mixed.cv, supporting: replacement.supporting }));
    expectStatus(retry, 201);
  });

  test("an upload can be claimed only once", async () => {
    const first = await submitApplication(job.id, candidate("apply-reuse-a"));
    const reuse = await postApplication(applicationBody(secondJob.id, candidate("apply-reuse-b"), first.uploads));
    expectApiError(reuse, 400, "upload_expired", { fields: ["cv"] });
  });

  test("uploads are bound to their purpose and kind", async () => {
    const talentUpload = await uploadDocuments("talent_pool", [cvFile("talent")]);
    expectApiError(await postApplication(applicationBody(job.id, candidate("apply-purpose"), talentUpload)), 400, "upload_expired", {
      fields: ["cv"],
    });

    const supportingOnly = await uploadDocuments("application", [cvFile("cv"), supportingFile("support")]);
    const swapped = { cv: supportingOnly.supporting[0], supporting: [supportingOnly.cv] };
    expectApiError(await postApplication(applicationBody(job.id, candidate("apply-kind"), swapped)), 400, "upload_expired", {
      fields: ["cv"],
    });

    expectApiError(
      await postApplication(applicationBody(job.id, candidate("apply-random"), { cv: randomUUID(), supporting: [] })),
      400,
      "upload_expired",
      { fields: ["cv"] }
    );

    const twice = await postApplication(applicationBody(job.id, candidate("apply-twice"), { cv: supportingOnly.cv, supporting: [supportingOnly.cv] }));
    expectApiError(twice, 400, "invalid_input", { fields: ["supporting"] });

    const tooMany = await postApplication(
      applicationBody(job.id, candidate("apply-many"), { cv: randomUUID(), supporting: [randomUUID(), randomUUID(), randomUUID(), randomUUID()] })
    );
    expectApiError(tooMany, 400, "invalid_input", { fields: ["supporting"] });
  });

  test("a ticket whose file was never uploaded is reported as upload_missing", async () => {
    const presign = await uploadFilesWithoutPut();
    const result = await postApplication(applicationBody(job.id, candidate("apply-missing"), { cv: presign, supporting: [] }));
    expectApiError(result, 400, "upload_missing", { fields: ["cv"] });
  });

  test("an autofilled website field is ignored and the application is still stored", async () => {
    // There is no honeypot: browser autofill filled the hidden field for real candidates, whose
    // applications were then silently discarded. A 2xx must always mean the record was stored.
    const person = candidate("apply-autofill");
    const uploads = await uploadDocuments("application", [cvFile("autofill")]);
    const result = await postApplication({ ...applicationBody(job.id, person, uploads), website: "https://candidate.example" });
    expectStatus(result, 201);
    expect(result.body.reference).toMatch(/^APP-[0-9A-F]{8}$/);

    const list = await api<Paginated<unknown>>("GET", `/api/admin/applications?q=${encodeURIComponent(person.email)}&archived=include`, {
      cookie: admin,
    });
    expect(list.body.total).toBe(1);
  });

  test("cross-site submissions are refused before anything is stored", async () => {
    const person = candidate("apply-cross-site");
    const uploads = await uploadDocuments("application", [cvFile("cross-site")]);
    const body = applicationBody(job.id, person, uploads);
    expectApiError(await api("POST", "/api/apply", { json: body, headers: { origin: ORIGIN_EVIL } }), 403, "cross_site_request");
    expectApiError(
      await api("POST", "/api/apply", { json: body, sameOrigin: false, headers: { "sec-fetch-site": "cross-site" } }),
      403,
      "cross_site_request"
    );
    // The uploads were not claimed: the same-origin submission still succeeds.
    expectStatus(await postApplication(body), 201);
  });

  test("requires a JSON object body within 1 MB", async () => {
    const valid = applicationBody(job.id, candidate("apply-body"), { cv: randomUUID(), supporting: [] });
    expectApiError(await api("POST", "/api/apply", { body: JSON.stringify(valid), headers: { "content-type": "text/plain" } }), 415, "unsupported_media_type");
    expectApiError(await api("POST", "/api/apply", { body: "", headers: {} }), 415, "unsupported_media_type");
    expectApiError(await api("POST", "/api/apply", { body: JSON.stringify(valid), headers: { "content-type": "application/jsonp" } }), 415, "unsupported_media_type");
    // Browsers append a charset; that is still JSON (the job is fine, the fake upload is not).
    const charset = await api("POST", "/api/apply", { body: JSON.stringify(valid), headers: { "content-type": "application/json;charset=UTF-8" } });
    expectApiError(charset, 400, "upload_expired");
    expectApiError(await api("POST", "/api/apply", { json: [valid] }), 400, "invalid_json");
    expectApiError(await api("POST", "/api/apply", { body: "null", headers: { "content-type": "application/json" } }), 400, "invalid_json");
    expectApiError(await api("POST", "/api/apply", { body: '{"jobId":', headers: { "content-type": "application/json" } }), 400, "invalid_json");
    expectApiError(await api("POST", "/api/apply", { json: { ...valid, coverLetter: "x".repeat(1024 * 1024) } }), 413, "payload_too_large");
    const streamed = await sendStreamedJson("POST", "/api/apply", 1100 * 1024);
    expect(streamed.status, streamed.text.slice(0, 200)).toBe(413);
  });

  test("the apply-ip bucket allows 10 attempts per hour per client", async () => {
    const ip = isolatedClientIp();
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const result = await postApplication({}, ip);
      expect(result.status, `attempt ${attempt}`).toBe(400);
    }
    const limited = await postApplication(applicationBody(job.id, candidate("apply-ip"), { cv: randomUUID(), supporting: [] }), ip);
    expectApiError(limited, 429, "rate_limited");
    expectRetryAfter(limited, 60 * 60);
  });

  test("the apply-email bucket allows 5 attempts per hour per email address", async () => {
    const person = candidate("apply-email-limit");
    const missingJob = `missing-${uniqueSuffix()}`;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const email = attempt % 2 === 0 ? person.email.toUpperCase() : person.email;
      const result = await postApplication(applicationBody(missingJob, { ...person, email }, { cv: randomUUID(), supporting: [] }));
      expect(result.status, `attempt ${attempt}`).toBe(404);
    }
    const limited = await postApplication(applicationBody(job.id, person, { cv: randomUUID(), supporting: [] }));
    expectApiError(limited, 429, "rate_limited");
    expectRetryAfter(limited, 60 * 60);
  });
});

// Presigns a CV upload but never PUTs the file.
async function uploadFilesWithoutPut(): Promise<string> {
  const result = await api<{ uploads: { uploadId: string }[] }>("POST", "/api/uploads", {
    json: { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: 4096, contentType: "application/pdf" }] },
  });
  expectStatus(result, 201);
  return result.body.uploads[0].uploadId;
}

