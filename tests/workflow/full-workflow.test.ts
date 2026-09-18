// The complete careers-portal workflow, end to end, against an in-memory stand-in for the
// Google Sheets and Google Drive APIs (tests/support/google-stub.ts).
//
// This is the test that answers "does the thing actually work": a job is created and published,
// a candidate uploads a CV and applies, HR finds the application in the admin portal, downloads
// the CV, moves the candidate through the pipeline, and the retention job eventually erases
// everything - with every assertion made against what really ended up in the spreadsheet and in
// Drive, not against a mock's call log.
//
// It needs no Google Cloud project and no credentials, so it runs in CI on every commit. What it
// cannot prove is that Google itself behaves as the stub does; DEPLOYMENT.md's smoke-test
// checklist covers that against a real project once.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { installGoogleStub, type GoogleStub } from "../support/google-stub";

// The stub has to be installed before any application module is imported, because the Google
// client caches its access token and settings on first use.
const installed = installGoogleStub();
const stub: GoogleStub = installed.stub;

process.env.NEXT_PUBLIC_SITE_URL ??= "http://localhost:3000";
process.env.HR_NOTIFICATION_EMAIL ??= "hr@example.com";
process.env.DATA_RETENTION_MONTHS ??= "12";

// A minimal, structurally valid PDF: the upload path checks for %PDF- at the start and %%EOF at
// the end, which is exactly what a real CV would carry.
const PDF = Buffer.from(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  "latin1"
);
const NOT_A_PDF = Buffer.from("just some text pretending to be a CV, at length".padEnd(200, "."), "utf8");

type Modules = Awaited<ReturnType<typeof loadModules>>;

async function loadModules() {
  const [sheetsDb, uploads, documents, jobs, applications, talent, users, session, outbox, audit, maintenance, retention, stats, ids] =
    await Promise.all([
      import("@/lib/sheets-db"),
      import("@/lib/careers/server/uploads"),
      import("@/lib/careers/server/documents"),
      import("@/lib/careers/server/jobs"),
      import("@/lib/careers/server/applications"),
      import("@/lib/careers/server/talent-pool"),
      import("@/lib/careers/server/users"),
      import("@/lib/auth/session"),
      import("@/lib/email/outbox"),
      import("@/lib/careers/server/audit"),
      import("@/lib/careers/server/maintenance"),
      import("@/lib/careers/server/retention"),
      import("@/lib/careers/server/stats"),
      import("@/lib/careers/server/ids"),
    ]);
  return { sheetsDb, uploads, documents, jobs, applications, talent, users, session, outbox, audit, maintenance, retention, stats, ids };
}

let m: Modules;
let adminCtx: import("@/lib/auth/session").AdminContext;

// Walks the real ticket flow: ask for a ticket, then PUT the bytes at the URL the ticket names.
async function uploadCv(bytes: Buffer = PDF, purpose: "application" | "talent_pool" = "application"): Promise<string> {
  const [ticket] = await m.uploads.createUploadTickets(
    { purpose, files: [{ kind: "cv", name: "my-cv.pdf", size: bytes.byteLength, contentType: "application/pdf" }] },
    { adminUserId: null }
  );
  const token = new URL(ticket.url).searchParams.get("t");
  await m.uploads.receiveUpload(ticket.uploadId, token, bytes);
  return ticket.uploadId;
}

async function publishedJob(slug: string, title = "Quality Control Analyst") {
  const created = await m.jobs.createJob(
    {
      slug,
      title,
      department: "Quality Control",
      location: "Colombo",
      type: "Full-time",
      experience: "2+ years",
      description: "Run release testing for finished products.",
      responsibilities: ["Test batches"],
      requirements: ["BSc in Chemistry"],
      qualifications: [],
      benefits: [],
      applicationDeadline: null,
    },
    "draft",
    adminCtx
  );
  // Jobs are addressed by slug throughout the admin API, not by their internal id.
  await m.jobs.changeJobStatus(created.id, "publish", adminCtx);
  return created;
}

before(async () => {
  m = await loadModules();
  await m.sheetsDb.ensureSchema();
});

after(() => installed.restore());

beforeEach(async () => {
  // A clean spreadsheet and Drive for every test, so ordering never matters.
  stub.reset();
  stub.failures = [];
  m.sheetsDb.invalidateTable();
  await m.sheetsDb.ensureSchema();

  const email = "hr.manager@synergypharma.lk";
  await m.users.createAdminUserWithPassword({ email, name: "HR Manager", role: "admin" }, "correct-horse-battery-1", null);
  const auth = await m.users.authenticateAdmin(email, "correct-horse-battery-1", { ip: "203.0.113.5", userAgent: "test" });
  const resolved = await m.session.resolveSession(auth.token);
  assert.ok(resolved, "the session just created resolves");
  adminCtx = { ...resolved, ip: "203.0.113.5", userAgent: "test" };
});

describe("the happy path, start to finish", () => {
  it("creates a job, publishes it, and shows it on the public careers page", async () => {
    const created = await m.jobs.createJob(
      {
        slug: "qc-analyst",
        title: "Quality Control Analyst",
        department: "Quality Control",
        location: "Colombo",
        type: "Full-time",
        experience: "2+ years",
        description: "Run release testing for finished products.",
        responsibilities: ["Test batches", "Write reports"],
        requirements: ["BSc in Chemistry"],
        qualifications: [],
        benefits: [],
        applicationDeadline: null,
      },
      "draft",
      adminCtx
    );
    assert.equal(created.status, "draft");

    // A draft is invisible publicly.
    assert.deepEqual(await m.jobs.listOpenJobs(), []);
    assert.equal(await m.jobs.getOpenJob("qc-analyst"), null);

    await m.jobs.changeJobStatus(created.id, "publish", adminCtx);

    const open = await m.jobs.listOpenJobs();
    assert.equal(open.length, 1);
    assert.equal(open[0].id, "qc-analyst", "the public id is the slug");
    assert.equal(open[0].title, "Quality Control Analyst");
    assert.deepEqual(open[0].responsibilities, ["Test batches", "Write reports"]);

    // And it really is a row in the spreadsheet.
    const rows = stub.rowsOf("Jobs");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].slug, "qc-analyst");
    assert.equal(rows[0].status, "published");
    assert.deepEqual(JSON.parse(String(rows[0].responsibilities)), ["Test batches", "Write reports"]);
  });

  it("accepts an application, stores the CV in Drive and the record in Sheets, and emails both sides", async () => {
    await publishedJob("qc-analyst");
    const uploadId = await uploadCv();

    // The CV is staged in Drive but not yet attached to anything.
    const staging = stub.folderNamed("_staging")!;
    assert.equal(stub.filesIn(staging.id).length, 1, "staged before submission");

    const result = await m.applications.submitApplication(
      {
        jobSlug: "qc-analyst",
        name: "Nimali Perera",
        email: "Nimali.Perera@example.com",
        phone: "0771234567",
        coverLetter: "I have five years of QC experience.",
        linkedIn: "",
        portfolio: "",
        uploads: { cv: uploadId, supporting: [] },
      },
      { ip: "198.51.100.9" }
    );

    assert.match(result.reference, /^APP-[0-9A-F]{8}$/);

    // ── In Google Sheets ──────────────────────────────────────────────────
    const rows = stub.rowsOf("Applications");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Nimali Perera");
    assert.equal(rows[0].email, "Nimali.Perera@example.com");
    assert.equal(rows[0].emailNormalized, "nimali.perera@example.com", "lower-cased for the duplicate rule");
    assert.equal(rows[0].jobSlug, "qc-analyst");
    assert.equal(rows[0].status, "submitted");
    assert.equal(rows[0].reference, result.reference);
    assert.ok(String(rows[0].createdAt).endsWith("Z"), "timestamps are stored as ISO 8601 UTC");

    // The initial status-history entry exists and is truthful.
    const history = stub.rowsOf("StatusHistory");
    assert.equal(history.length, 1);
    assert.equal(history[0].from, "");
    assert.equal(history[0].to, "submitted");
    assert.equal(history[0].applicationId, result.id);

    // ── In Google Drive ───────────────────────────────────────────────────
    const documents = stub.rowsOf("Documents");
    assert.equal(documents.length, 1);
    assert.equal(documents[0].kind, "cv");
    assert.equal(documents[0].originalName, "my-cv.pdf");
    assert.equal(documents[0].ownerId, result.id);

    const driveFileId = String(documents[0].driveFileId);
    const driveFile = stub.driveFiles().find((file) => file.id === driveFileId);
    assert.ok(driveFile, "the CV is a real file in Drive");
    assert.ok(driveFile.content?.equals(PDF), "the stored bytes are the bytes that were uploaded");
    assert.match(driveFile.name, /^APP-[0-9A-F]{8} - Nimali Perera - CV\.pdf$/, "named so the Drive folder is browsable");

    const applicationsFolder = stub.folderNamed("Applications")!;
    assert.ok(driveFile.parents.includes(applicationsFolder.id), "moved out of staging into Applications");
    assert.equal(stub.filesIn(staging.id).length, 0, "staging is empty again");

    // ── Emails ────────────────────────────────────────────────────────────
    const emails = stub.rowsOf("EmailOutbox");
    const templates = emails.map((row) => String(row.template)).sort();
    assert.deepEqual(templates, ["application_received", "hr_new_application"]);

    const candidateMail = emails.find((row) => row.template === "application_received")!;
    assert.equal(candidateMail.to, "Nimali.Perera@example.com");
    assert.ok(String(candidateMail.subject).length > 0);
    assert.ok(String(candidateMail.html).includes(result.reference), "the candidate is told their reference");

    const hrMail = emails.find((row) => row.template === "hr_new_application")!;
    assert.equal(hrMail.to, "hr@example.com");
    assert.equal(hrMail.relatedId, result.id);
  });

  it("shows the application in the admin portal, serves the CV, and records a status change", async () => {
    await publishedJob("qc-analyst");
    const uploadId = await uploadCv();
    const submitted = await m.applications.submitApplication(
      {
        jobSlug: "qc-analyst",
        name: "Nimali Perera",
        email: "nimali@example.com",
        phone: "0771234567",
        coverLetter: "Cover letter.",
        linkedIn: "",
        portfolio: "",
        uploads: { cv: uploadId, supporting: [] },
      },
      { ip: "198.51.100.9" }
    );

    // ── List, search and filter ───────────────────────────────────────────
    const all = await m.applications.listApplications(
      m.applications.parseApplicationFilters(new URLSearchParams()),
      { page: 1, limit: 25, skip: 0 }
    );
    assert.equal(all.total, 1);
    assert.equal(all.items[0].reference, submitted.reference);
    assert.equal(all.items[0].documentCount, 1);

    const byName = await m.applications.listApplications(
      m.applications.parseApplicationFilters(new URLSearchParams({ q: "nimali" })),
      { page: 1, limit: 25, skip: 0 }
    );
    assert.equal(byName.total, 1, "search matches the candidate name case-insensitively");

    const byReference = await m.applications.listApplications(
      m.applications.parseApplicationFilters(new URLSearchParams({ q: submitted.reference })),
      { page: 1, limit: 25, skip: 0 }
    );
    assert.equal(byReference.total, 1, "search matches the reference");

    const noMatch = await m.applications.listApplications(
      m.applications.parseApplicationFilters(new URLSearchParams({ q: "(.*)" })),
      { page: 1, limit: 25, skip: 0 }
    );
    assert.equal(noMatch.total, 0, "a regex-looking query is treated as literal text");

    const wrongStatus = await m.applications.listApplications(
      m.applications.parseApplicationFilters(new URLSearchParams({ status: "selected" })),
      { page: 1, limit: 25, skip: 0 }
    );
    assert.equal(wrongStatus.total, 0);

    // ── Detail and CV download ────────────────────────────────────────────
    const detail = await m.applications.getApplicationDetail(submitted.id, adminCtx);
    assert.equal(detail.coverLetter, "Cover letter.");
    assert.equal(detail.documents.length, 1);
    assert.equal(detail.documents[0].downloadUrl, `/api/admin/documents/${detail.documents[0].id}`);
    assert.ok(!JSON.stringify(detail).includes("driveFileId"), "the Drive file id never reaches the client");

    const download = await m.documents.resolveDocumentDownload(detail.documents[0].id, adminCtx);
    const received = Buffer.from(await new Response(download.body).arrayBuffer());
    assert.ok(received.equals(PDF), "the admin portal serves the original bytes");
    assert.equal(download.fileName, "my-cv.pdf");

    // ── Status change ─────────────────────────────────────────────────────
    const updated = await m.applications.changeApplicationStatus(
      submitted.id,
      { status: "shortlisted", expectedStatus: "submitted", note: "Strong QC background.", notifyCandidate: true, candidateMessage: "We would like to meet you." },
      adminCtx
    );
    assert.equal(updated.status, "shortlisted");
    assert.equal(updated.statusHistory.length, 2);
    assert.equal(updated.statusHistory[1].from, "submitted");
    assert.equal(updated.statusHistory[1].to, "shortlisted");
    assert.equal(updated.statusHistory[1].candidateNotified, true);

    assert.equal(stub.rowsOf("Applications")[0].status, "shortlisted", "persisted to the sheet");
    assert.ok(
      stub.rowsOf("EmailOutbox").some((row) => row.template === "application_status_update"),
      "the candidate is emailed about the change"
    );

    // Re-reading gives the same answer (no stale cache).
    const refetched = await m.applications.getApplicationDetail(submitted.id, adminCtx);
    assert.equal(refetched.status, "shortlisted");
  });
});

describe("validation and abuse", () => {
  it("refuses a duplicate application for the same job and email", async () => {
    await publishedJob("qc-analyst");
    const first = await uploadCv();
    await m.applications.submitApplication(
      { jobSlug: "qc-analyst", name: "A", email: "dup@example.com", phone: "0771234567", coverLetter: "", linkedIn: "", portfolio: "", uploads: { cv: first, supporting: [] } },
      { ip: "198.51.100.9" }
    );

    const second = await uploadCv();
    await assert.rejects(
      () =>
        m.applications.submitApplication(
          // Different capitalisation: the rule is case-insensitive.
          { jobSlug: "qc-analyst", name: "A", email: "DUP@example.com", phone: "0771234567", coverLetter: "", linkedIn: "", portfolio: "", uploads: { cv: second, supporting: [] } },
          { ip: "198.51.100.9" }
        ),
      (err: Error & { code?: string }) => err.code === "duplicate_application"
    );

    assert.equal(stub.rowsOf("Applications").length, 1, "no second row was written");
    // The rejected submission's CV is not left lying around attached to nothing.
    assert.equal(stub.rowsOf("Documents").length, 1);
  });

  it("refuses an application for a job that is not open", async () => {
    const draft = await m.jobs.createJob(
      { slug: "draft-role", title: "Draft Role", department: "IT", location: "Colombo", type: "Full-time", experience: "", description: "Not published yet.", responsibilities: [], requirements: [], qualifications: [], benefits: [], applicationDeadline: null },
      "draft",
      adminCtx
    );
    assert.equal(draft.status, "draft");

    const uploadId = await uploadCv();
    await assert.rejects(
      () =>
        m.applications.submitApplication(
          { jobSlug: "draft-role", name: "A", email: "a@example.com", phone: "0771234567", coverLetter: "", linkedIn: "", portfolio: "", uploads: { cv: uploadId, supporting: [] } },
          { ip: "198.51.100.9" }
        ),
      (err: Error & { code?: string }) => err.code === "job_not_found"
    );
    assert.equal(stub.rowsOf("Applications").length, 0);
  });

  it("rejects an upload whose bytes are not a PDF, and one whose size does not match the ticket", async () => {
    const [ticket] = await m.uploads.createUploadTickets(
      { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: NOT_A_PDF.byteLength, contentType: "application/pdf" }] },
      { adminUserId: null }
    );
    const token = new URL(ticket.url).searchParams.get("t");

    await assert.rejects(
      () => m.uploads.receiveUpload(ticket.uploadId, token, NOT_A_PDF),
      (err: Error & { code?: string }) => err.code === "invalid_file"
    );

    const [second] = await m.uploads.createUploadTickets(
      { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: PDF.byteLength, contentType: "application/pdf" }] },
      { adminUserId: null }
    );
    const secondToken = new URL(second.url).searchParams.get("t");
    await assert.rejects(
      () => m.uploads.receiveUpload(second.uploadId, secondToken, Buffer.concat([PDF, Buffer.from("extra")])),
      (err: Error & { code?: string }) => err.code === "invalid_file"
    );

    assert.equal(stub.driveFiles().filter((file) => file.content).length, 0, "nothing reached Drive");
  });

  it("rejects a forged or expired upload ticket", async () => {
    const [ticket] = await m.uploads.createUploadTickets(
      { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: PDF.byteLength, contentType: "application/pdf" }] },
      { adminUserId: null }
    );

    await assert.rejects(() => m.uploads.receiveUpload(ticket.uploadId, "not-a-token", PDF), (err: Error & { code?: string }) => err.code === "upload_expired");
    await assert.rejects(() => m.uploads.receiveUpload(ticket.uploadId, null, PDF), (err: Error & { code?: string }) => err.code === "upload_expired");

    // A valid token for a different upload id must not work for this one.
    const token = new URL(ticket.url).searchParams.get("t");
    await assert.rejects(
      () => m.uploads.receiveUpload("some-other-upload-id", token, PDF),
      (err: Error & { code?: string }) => err.code === "upload_expired"
    );
  });

  it("refuses a CV larger than the limit", async () => {
    const { UPLOAD_LIMITS } = await import("@/lib/careers/constants");
    const oversize = UPLOAD_LIMITS.cvMaxBytes + 1;

    // The ticket request itself refuses the size, so the bytes are never sent.
    await assert.rejects(
      () =>
        m.uploads.createUploadTickets(
          { purpose: "application", files: [{ kind: "cv", name: "huge.pdf", size: oversize, contentType: "application/pdf" }] },
          { adminUserId: null }
        ),
      (err: Error & { code?: string }) => err.code === "invalid_input"
    );

    // And a ticket issued for a legal size cannot be used to smuggle a larger body through.
    const [ticket] = await m.uploads.createUploadTickets(
      { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: PDF.byteLength, contentType: "application/pdf" }] },
      { adminUserId: null }
    );
    const token = new URL(ticket.url).searchParams.get("t");
    const padded = Buffer.concat([PDF, Buffer.alloc(UPLOAD_LIMITS.cvMaxBytes, 0x20)]);
    await assert.rejects(
      () => m.uploads.receiveUpload(ticket.uploadId, token, padded),
      (err: Error & { code?: string }) => err.code === "invalid_file" || err.code === "payload_too_large"
    );

    const staging = stub.folderNamed("_staging");
    assert.equal(staging ? stub.filesIn(staging.id).length : 0, 0, "nothing oversized reached Drive");
  });

  it("refuses an application whose fields are missing or malformed", async () => {
    const { validateApplicationSubmission } = await import("@/lib/careers/validation");

    const empty = validateApplicationSubmission({});
    assert.equal(empty.ok, false, "an empty body is rejected");

    const badEmail = validateApplicationSubmission({
      jobId: "qc-analyst",
      name: "Nimali Perera",
      email: "not-an-email",
      phone: "0771234567",
      coverLetter: "",
      linkedIn: "",
      portfolio: "",
      consentGiven: true,
      uploads: { cv: "x", supporting: [] },
    });
    assert.equal(badEmail.ok, false);
    if (!badEmail.ok) assert.ok(badEmail.errors.email, "the error names the offending field");

    const noConsent = validateApplicationSubmission({
      jobId: "qc-analyst",
      name: "Nimali Perera",
      email: "nimali@example.com",
      phone: "0771234567",
      coverLetter: "",
      linkedIn: "",
      portfolio: "",
      consentGiven: false,
      uploads: { cv: "x", supporting: [] },
    });
    assert.equal(noConsent.ok, false, "consent is required");

    assert.equal(stub.rowsOf("Applications").length, 0, "nothing was written for any invalid body");
  });

  it("refuses an admin action from a request with no valid session", async () => {
    // resolveSession is the single gate every admin route goes through (requireAdmin calls it).
    assert.equal(await m.session.resolveSession(undefined), null, "no cookie, no session");
    assert.equal(await m.session.resolveSession("not-a-real-token"), null, "a malformed token is refused");
    assert.equal(
      await m.session.resolveSession("A".repeat(43)),
      null,
      "a well-formed but unknown token is refused"
    );

    // A deactivated account's existing session stops working immediately.
    const email = "temp.hr@synergypharma.lk";
    const created = await m.users.createAdminUserWithPassword({ email, name: "Temp HR", role: "hr" }, "temporary-password-42", null);
    const auth = await m.users.authenticateAdmin(email, "temporary-password-42", { ip: "203.0.113.7", userAgent: "test" });
    assert.ok(await m.session.resolveSession(auth.token), "the session works while the account is active");

    await m.users.updateAdminUser(created.id, { active: false }, adminCtx);
    assert.equal(await m.session.resolveSession(auth.token), null, "deactivating the account kills its sessions");
  });

  it("refuses to submit an application that references an upload nobody made", async () => {
    await publishedJob("qc-analyst");
    await assert.rejects(
      () =>
        m.applications.submitApplication(
          { jobSlug: "qc-analyst", name: "A", email: "a@example.com", phone: "0771234567", coverLetter: "", linkedIn: "", portfolio: "", uploads: { cv: "11111111-2222-3333-4444-555555555555", supporting: [] } },
          { ip: "198.51.100.9" }
        ),
      (err: Error & { code?: string }) => err.code === "upload_missing" || err.code === "upload_expired"
    );
    assert.equal(stub.rowsOf("Applications").length, 0);
  });

  it("locks an admin account after repeated wrong passwords", async () => {
    const email = "locked.user@synergypharma.lk";
    await m.users.createAdminUserWithPassword({ email, name: "Locked User", role: "hr" }, "another-good-password-9", null);

    // The first four wrong guesses are ordinary failures...
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await assert.rejects(
        () => m.users.authenticateAdmin(email, "wrong-password-entirely", { ip: "203.0.113.9", userAgent: "test" }),
        (err: Error & { code?: string }) => err.code === "invalid_credentials"
      );
    }

    // ...and the fifth both trips the lock and reports it, as it did on MongoDB.
    await assert.rejects(
      () => m.users.authenticateAdmin(email, "wrong-password-entirely", { ip: "203.0.113.9", userAgent: "test" }),
      (err: Error & { code?: string }) => err.code === "account_locked"
    );

    // The account is now refused even with the correct password.
    await assert.rejects(
      () => m.users.authenticateAdmin(email, "another-good-password-9", { ip: "203.0.113.9", userAgent: "test" }),
      (err: Error & { code?: string }) => err.code === "account_locked"
    );

    const row = stub.rowsOf("AdminUsers").find((r) => r.email === email)!;
    assert.ok(String(row.lockedUntil).length > 0, "the lock is durable, not just in memory");
  });

  it("treats an unknown account and a wrong password identically", async () => {
    const unknown = await m.users
      .authenticateAdmin("nobody@synergypharma.lk", "some-password-here", { ip: "203.0.113.9", userAgent: "test" })
      .catch((err: Error & { code?: string }) => err);
    const wrong = await m.users
      .authenticateAdmin("hr.manager@synergypharma.lk", "some-password-here", { ip: "203.0.113.9", userAgent: "test" })
      .catch((err: Error & { code?: string }) => err);

    assert.equal((unknown as { code?: string }).code, "invalid_credentials");
    assert.equal((wrong as { code?: string }).code, "invalid_credentials");
    assert.equal((unknown as Error).message, (wrong as Error).message);
  });

  it("never stores a session token or a password in recoverable form", async () => {
    const auth = await m.users.authenticateAdmin("hr.manager@synergypharma.lk", "correct-horse-battery-1", { ip: "203.0.113.5", userAgent: "test" });

    const sessionRows = stub.rowsOf("AdminSessions");
    assert.ok(sessionRows.length >= 1);
    for (const row of sessionRows) {
      assert.notEqual(row.tokenHash, auth.token, "the cookie value itself is never stored");
      assert.match(String(row.tokenHash), /^[a-f0-9]{64}$/, "only a SHA-256 is stored");
    }

    const userRow = stub.rowsOf("AdminUsers").find((r) => r.email === "hr.manager@synergypharma.lk")!;
    assert.ok(!String(userRow.passwordHash).includes("correct-horse-battery-1"));
    assert.match(String(userRow.passwordHash), /^scrypt\$/, "passwords are scrypt hashes");
  });

  it("rejects a revoked session", async () => {
    const auth = await m.users.authenticateAdmin("hr.manager@synergypharma.lk", "correct-horse-battery-1", { ip: "203.0.113.5", userAgent: "test" });
    assert.ok(await m.session.resolveSession(auth.token));
    await m.session.destroySession(auth.token);
    assert.equal(await m.session.resolveSession(auth.token), null, "a signed-out session stops working immediately");
  });
});

describe("the talent pool", () => {
  it("accepts a self-submitted profile and keeps one profile per email", async () => {
    const uploadId = await uploadCv(PDF, "talent_pool");
    const first = await m.talent.submitTalentProfile(
      { name: "Kasun Silva", email: "kasun@example.com", phone: "0777654321", areaOfInterest: "Analytical Development", candidateNotes: "Open to QC roles.", uploads: { cv: uploadId, supporting: [] } },
      { ip: "198.51.100.10" }
    );
    assert.match(first.reference, /^TP-[0-9A-F]{8}$/);

    const rows = stub.rowsOf("TalentPool");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].emailNormalized, "kasun@example.com");

    const second = await uploadCv(PDF, "talent_pool");
    await m.talent
      .submitTalentProfile(
        { name: "Kasun Silva", email: "KASUN@example.com", phone: "0777654321", areaOfInterest: "Quality Control", candidateNotes: "", uploads: { cv: second, supporting: [] } },
        { ip: "198.51.100.10" }
      )
      .catch(() => undefined);

    const live = stub.rowsOf("TalentPool").filter((row) => !String(row.supersededBy));
    assert.equal(live.length, 1, "still exactly one live profile for that address");
  });

  it("moves an application into the talent pool, copying its CV", async () => {
    await publishedJob("qc-analyst");
    const uploadId = await uploadCv();
    const submitted = await m.applications.submitApplication(
      { jobSlug: "qc-analyst", name: "Nimali Perera", email: "nimali@example.com", phone: "0771234567", coverLetter: "", linkedIn: "", portfolio: "", uploads: { cv: uploadId, supporting: [] } },
      { ip: "198.51.100.9" }
    );

    const moved = await m.applications.moveApplicationToTalentPool(submitted.id, { tags: ["qc", "colombo"], note: "Good fallback candidate." }, adminCtx);
    assert.ok(moved.talentPoolEntryId);
    assert.equal(moved.created, true);

    const talentRows = stub.rowsOf("TalentPool");
    assert.equal(talentRows.length, 1);
    assert.deepEqual(JSON.parse(String(talentRows[0].tags)).sort(), ["colombo", "qc"]);

    // The CV was copied, not moved: the application keeps its own.
    const documents = stub.rowsOf("Documents").filter((row) => !String(row.deletedAt));
    assert.equal(documents.length, 2);
    assert.equal(documents.filter((row) => row.ownerType === "application").length, 1);
    assert.equal(documents.filter((row) => row.ownerType === "talent").length, 1);

    // Moving again converges on the same profile rather than creating a second one.
    const again = await m.applications.moveApplicationToTalentPool(submitted.id, { tags: ["qc"], note: "" }, adminCtx);
    assert.equal(again.talentPoolEntryId, moved.talentPoolEntryId);
    assert.equal(stub.rowsOf("TalentPool").length, 1);
  });
});

describe("email delivery", () => {
  it("keeps a message that cannot be sent, and retries it later", async () => {
    await publishedJob("qc-analyst");
    const uploadId = await uploadCv();
    await m.applications.submitApplication(
      { jobSlug: "qc-analyst", name: "Nimali Perera", email: "nimali@example.com", phone: "0771234567", coverLetter: "", linkedIn: "", portfolio: "", uploads: { cv: uploadId, supporting: [] } },
      { ip: "198.51.100.9" }
    );

    // No SMTP is configured in this suite, so nothing can actually be delivered.
    const rows = stub.rowsOf("EmailOutbox");
    assert.ok(rows.length >= 2, "the messages exist regardless of whether SMTP works");
    for (const row of rows) {
      assert.ok(["pending", "skipped"].includes(String(row.status)), `unexpected status ${row.status}`);
      assert.ok(String(row.html).length > 0, "the rendered body is kept so delivery needs no re-render");
    }

    // The application itself is unaffected by the mail problem.
    assert.equal(stub.rowsOf("Applications").length, 1);
  });

  it("delivers each message at most once when two runs overlap", async () => {
    await publishedJob("qc-analyst");
    const uploadId = await uploadCv();
    await m.applications.submitApplication(
      { jobSlug: "qc-analyst", name: "Nimali Perera", email: "nimali@example.com", phone: "0771234567", coverLetter: "", linkedIn: "", portfolio: "", uploads: { cv: uploadId, supporting: [] } },
      { ip: "198.51.100.9" }
    );

    const [a, b] = await Promise.all([m.outbox.deliverEmails(), m.outbox.deliverEmails()]);
    const handled = a.sent + a.failed + a.skipped + a.retried + (b.sent + b.failed + b.skipped + b.retried);
    assert.ok(handled <= stub.rowsOf("EmailOutbox").length, "no message was processed twice");
  });
});

describe("when Google fails", () => {
  it("surfaces a quota rejection as a retryable failure rather than losing the submission", async () => {
    await publishedJob("qc-analyst");
    const uploadId = await uploadCv();

    // Every Sheets append fails, permanently.
    stub.failures = [{ match: /:append/, status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED" } } }];

    await assert.rejects(() =>
      m.applications.submitApplication(
        { jobSlug: "qc-analyst", name: "Nimali Perera", email: "nimali@example.com", phone: "0771234567", coverLetter: "", linkedIn: "", portfolio: "", uploads: { cv: uploadId, supporting: [] } },
        { ip: "198.51.100.9" }
      )
    );
    stub.failures = [];

    // Nothing half-written: no application row, and the CV that was copied for it is gone again.
    assert.equal(stub.rowsOf("Applications").length, 0);
    const applicationsFolder = stub.folderNamed("Applications")!;
    assert.ok(applicationsFolder, "the Applications folder exists, so the next assertion is not vacuous");
    assert.equal(stub.filesIn(applicationsFolder.id).length, 0, "the orphaned CV was cleaned up");
  });

  it("fails the upload cleanly when Google Drive refuses the bytes", async () => {
    const [ticket] = await m.uploads.createUploadTickets(
      { purpose: "application", files: [{ kind: "cv", name: "cv.pdf", size: PDF.byteLength, contentType: "application/pdf" }] },
      { adminUserId: null }
    );
    const token = new URL(ticket.url).searchParams.get("t");

    // The service account has no Drive quota of its own - the single most common production
    // failure for this integration, and one that must never look like a transient blip.
    stub.failures = [
      { match: /stub\.upload/, status: 403, body: { error: { code: 403, status: "PERMISSION_DENIED", errors: [{ reason: "storageQuotaExceeded" }] } } },
    ];
    await assert.rejects(
      () => m.uploads.receiveUpload(ticket.uploadId, token, PDF),
      (err: Error) => err.name === "GoogleConfigError" && /Shared Drive|storage quota/i.test(err.message)
    );
    stub.failures = [];

    assert.equal(stub.driveFiles().filter((file) => file.content).length, 0, "no partial file was left behind");
  });

  it("keeps the record consistent when Drive fails midway through a submission", async () => {
    await publishedJob("qc-analyst");
    const uploadId = await uploadCv();

    // The CV is staged; now the move into its permanent folder fails.
    stub.failures = [{ match: /drive\/v3\/files\/[^/?]+\?/, status: 500, body: { error: { code: 500, status: "INTERNAL" } } }];
    await assert.rejects(() =>
      m.applications.submitApplication(
        { jobSlug: "qc-analyst", name: "Nimali Perera", email: "nimali@example.com", phone: "0771234567", coverLetter: "", linkedIn: "", portfolio: "", uploads: { cv: uploadId, supporting: [] } },
        { ip: "198.51.100.9" }
      )
    );
    stub.failures = [];

    assert.equal(stub.rowsOf("Applications").length, 0, "no application row was written");
    assert.equal(stub.rowsOf("Documents").length, 0, "no document row was written");
    assert.equal(stub.rowsOf("EmailOutbox").length, 0, "no email was queued for a submission that failed");
  });

  it("recovers from a transient read failure", async () => {
    await publishedJob("qc-analyst");
    stub.failures = [{ match: /values:batchGet/, status: 503, times: 1 }];
    m.sheetsDb.invalidateTable();
    const open = await m.jobs.listOpenJobs();
    assert.equal(open.length, 1, "one 503 is retried, not surfaced");
    stub.failures = [];
  });

  it("reports a permission problem as a configuration error", async () => {
    stub.failures = [{ match: /values:batchGet/, status: 403, body: { error: { code: 403, status: "PERMISSION_DENIED" } } }];
    m.sheetsDb.invalidateTable();
    await assert.rejects(() => m.jobs.listOpenJobs(), (err: Error) => err.name === "GoogleConfigError");
    stub.failures = [];
  });
});

describe("maintenance and erasure", () => {
  it("clears abandoned uploads without touching submitted ones", async () => {
    await publishedJob("qc-analyst");
    const submittedUpload = await uploadCv();
    await m.applications.submitApplication(
      { jobSlug: "qc-analyst", name: "Nimali Perera", email: "nimali@example.com", phone: "0771234567", coverLetter: "", linkedIn: "", portfolio: "", uploads: { cv: submittedUpload, supporting: [] } },
      { ip: "198.51.100.9" }
    );
    // An upload nobody ever submitted.
    await uploadCv();

    const staging = stub.folderNamed("_staging")!;
    assert.equal(stub.filesIn(staging.id).length, 1);

    // Everything staged is "old" when the cutoff is in the future.
    const swept = await m.uploads.sweepStagedUploads(new Date(Date.now() + 60_000), 100);
    assert.equal(swept.deleted, 1);
    assert.equal(stub.filesIn(staging.id).length, 0);

    // The submitted CV is untouched.
    const applicationsFolder = stub.folderNamed("Applications")!;
    assert.equal(stub.filesIn(applicationsFolder.id).length, 1);
  });

  it("erases an archived application completely, including its CV", async () => {
    await publishedJob("qc-analyst");
    const uploadId = await uploadCv();
    const submitted = await m.applications.submitApplication(
      { jobSlug: "qc-analyst", name: "Nimali Perera", email: "nimali@example.com", phone: "0771234567", coverLetter: "", linkedIn: "", portfolio: "", uploads: { cv: uploadId, supporting: [] } },
      { ip: "198.51.100.9" }
    );

    // Erasure requires the record to be archived first.
    await assert.rejects(() => m.applications.purgeApplication(submitted.id, adminCtx), (err: Error & { code?: string }) => err.code === "not_archived");

    await m.applications.setApplicationArchived(submitted.id, true, "Candidate withdrew.", adminCtx);
    await m.applications.purgeApplication(submitted.id, adminCtx);

    assert.equal(stub.rowsOf("Applications").length, 0, "the row is gone, not just flagged");
    assert.equal(stub.rowsOf("StatusHistory").length, 0, "its sub-records went with it");
    const applicationsFolder = stub.folderNamed("Applications")!;
    assert.ok(applicationsFolder, "the Applications folder exists, so the next assertion is not vacuous");
    assert.equal(stub.filesIn(applicationsFolder.id).length, 0, "the CV is permanently deleted from Drive");
    assert.equal(stub.rowsOf("EmailOutbox").length, 0, "queued mail about the candidate is dropped too");
  });

  it("runs the whole maintenance job without error on an empty portal", async () => {
    const result = await m.maintenance.runMaintenance();
    assert.ok(result, "maintenance returns a summary");
  });
});

describe("the dashboard", () => {
  it("counts jobs, applications and the talent pool", async () => {
    await publishedJob("qc-analyst", "QC Analyst");
    await publishedJob("qa-officer", "QA Officer");
    const uploadId = await uploadCv();
    await m.applications.submitApplication(
      { jobSlug: "qc-analyst", name: "Nimali Perera", email: "nimali@example.com", phone: "0771234567", coverLetter: "", linkedIn: "", portfolio: "", uploads: { cv: uploadId, supporting: [] } },
      { ip: "198.51.100.9" }
    );

    const stats = await m.stats.getAdminStats();
    assert.equal(stats.jobs.published, 2);
    assert.equal(stats.jobs.open, 2);
    assert.equal(stats.jobs.draft, 0);
    assert.equal(stats.applications.total, 1);
    assert.equal(stats.applications.byStatus.submitted, 1);
    assert.equal(stats.applications.byStatus.rejected, 0, "every status key is present");
    assert.equal(stats.applications.last7Days, 1);
    assert.equal(stats.talentPool.total, 0);
  });

  it("writes an audit trail that names the actor but not the candidate's contact details", async () => {
    await publishedJob("qc-analyst");
    const uploadId = await uploadCv();
    const submitted = await m.applications.submitApplication(
      { jobSlug: "qc-analyst", name: "Nimali Perera", email: "nimali@example.com", phone: "0771234567", coverLetter: "", linkedIn: "", portfolio: "", uploads: { cv: uploadId, supporting: [] } },
      { ip: "198.51.100.9" }
    );
    await m.applications.getApplicationDetail(submitted.id, adminCtx);
    await m.audit.flushAuditLog();

    const entries = stub.rowsOf("AuditLog");
    const actions = entries.map((row) => String(row.action));
    assert.ok(actions.includes("application.submit"));
    assert.ok(actions.includes("job.create"));

    for (const entry of entries) {
      assert.ok(!String(entry.summary).includes("nimali@example.com"), "no candidate email in a summary");
      assert.ok(!String(entry.summary).includes("0771234567"), "no phone number in a summary");
    }
  });
});
