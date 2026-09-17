import { expect, test } from "@playwright/test";
import { api, clientIp, loginAsAdmin, loginAsHr, pdfBytes, uniqueSuffix } from "../support/api";
import { e2eEnv } from "../support/env";
import type {
  AdminJob,
  ApplicationDetail,
  ApplicationListItem,
  AuditLogEntry,
  MoveToTalentPoolResponse,
  Paginated,
  TalentDetail,
} from "@/types/careers";
import { expectApiError, expectExactKeys, expectIsoDate, expectNoSensitiveData, expectStatus } from "./lib/assertions";
import { parseCsv } from "./lib/csv";
import {
  applicationBody,
  candidate,
  changeJobStatus,
  createApplication,
  createOpenJob,
  getApplication,
  getTalent,
  postApplication,
  randomObjectId,
  retireJob,
  setApplicationArchived,
  setTalentArchived,
  uploadDocuments,
} from "./lib/fixtures";
import { sentTo, waitForEmails } from "./lib/mail";

// HR review workflow for applications: listing and filters, detail, status changes with candidate
// emails, notes, archive/restore, moving to the talent pool, erasure, CSV export and documents.

const LIST_ITEM_KEYS = [
  "id",
  "reference",
  "name",
  "email",
  "phone",
  "jobId",
  "jobTitle",
  "department",
  "status",
  "source",
  "createdAt",
  "statusChangedAt",
  "archived",
  "inTalentPool",
  "documentCount",
  "noteCount",
] as const;

const DETAIL_KEYS = [
  ...LIST_ITEM_KEYS,
  "coverLetter",
  "linkedIn",
  "portfolio",
  "consentGiven",
  "consentAt",
  "documents",
  "notes",
  "statusHistory",
  "talentPoolEntryId",
  "jobStillExists",
  "archivedAt",
  "archivedByName",
  "archiveReason",
  "emails",
  "updatedAt",
] as const;

const CSV_HEADER = [
  "Reference",
  "Name",
  "Email",
  "Phone",
  "Job ID",
  "Job Title",
  "Department",
  "Status",
  "Submitted",
  "Status Changed",
  "LinkedIn",
  "Portfolio",
  "Archived",
  "In Talent Pool",
];

type ListResult = Paginated<ApplicationListItem>;

test.describe("admin applications API", () => {
  let admin = "";
  let hr = "";
  let hrName = "";
  let job: AdminJob;
  let otherJob: AdminJob;
  const jobs: string[] = [];

  test.beforeAll(async () => {
    admin = await loginAsAdmin();
    hr = await loginAsHr();
    hrName = (await api<{ user: { name: string } }>("GET", "/api/admin/me", { cookie: hr })).body.user.name;
    job = await createOpenJob(admin, "apps", { title: `=HYPERLINK("http://evil.example","Open") Analyst ${uniqueSuffix()}` });
    otherJob = await createOpenJob(admin, "apps-other");
    jobs.push(job.id, otherJob.id);
  });

  test.afterAll(async () => {
    for (const slug of jobs) await retireJob(admin, slug);
  });

  function list(query: Record<string, string>, cookie = hr) {
    return api<ListResult>("GET", `/api/admin/applications?${new URLSearchParams(query)}`, { cookie });
  }

  async function downloadExport(query: string): Promise<{ status: number; headers: Headers; bytes: Buffer }> {
    const response = await fetch(`${e2eEnv.baseUrl}/api/admin/applications/export?${query}`, {
      headers: { cookie: hr, [e2eEnv.clientIpHeader]: clientIp() },
      redirect: "manual",
    });
    return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
  }

  function changeStatus(id: string, json: Record<string, unknown>, cookie = hr) {
    return api<{ application: ApplicationDetail }>("POST", `/api/admin/applications/${id}/status`, { cookie, json });
  }

  test("lists applications with filters, sorting and clamped pagination", async () => {
    const localJob = await createOpenJob(admin, "apps-list");
    jobs.push(localJob.id);
    const first = await createApplication(hr, localJob.id, "apps-list-a");
    const second = await createApplication(hr, localJob.id, "apps-list-b");
    const third = await createApplication(hr, localJob.id, "apps-list-c");
    expectStatus(await changeStatus(second.item.id, { status: "shortlisted", expectedStatus: "submitted" }), 200);
    await setApplicationArchived(hr, third.item.id, true);

    const all = await list({ job: localJob.id });
    expectStatus(all, 200);
    expectExactKeys(all.body, ["items", "total", "page", "limit", "pageCount"], "page");
    expect(all.body).toMatchObject({ total: 2, page: 1, limit: 25, pageCount: 1 });
    expect(all.body.items.map((item) => item.id)).toEqual([second.item.id, first.item.id]);
    for (const item of all.body.items) {
      expectExactKeys(item, LIST_ITEM_KEYS, "list item");
      expectIsoDate(item.createdAt, "createdAt");
    }
    expectNoSensitiveData(all.body, "application list");

    expect((await list({ job: localJob.id, sort: "oldest" })).body.items.map((item) => item.id)).toEqual([first.item.id, second.item.id]);
    expect((await list({ job: localJob.id, sort: "status_changed" })).body.items[0].id).toBe(second.item.id);
    expect((await list({ job: localJob.id, status: "shortlisted" })).body.items.map((item) => item.id)).toEqual([second.item.id]);
    expect((await list({ job: localJob.id, archived: "only" })).body.items.map((item) => item.id)).toEqual([third.item.id]);
    expect((await list({ job: localJob.id, archived: "include" })).body.total).toBe(3);
    expect((await list({ q: first.person.email.toUpperCase() })).body.items.map((item) => item.id)).toEqual([first.item.id]);
    expect((await list({ q: first.reference, job: localJob.id })).body.items.map((item) => item.id)).toEqual([first.item.id]);

    const paged = await list({ job: localJob.id, limit: "1", page: "2" });
    expect(paged.body).toMatchObject({ total: 2, page: 2, limit: 1, pageCount: 2 });
    expect(paged.body.items.map((item) => item.id)).toEqual([first.item.id]);
    const clamped = await list({ job: localJob.id, limit: "5000", page: "0" });
    expect(clamped.body).toMatchObject({ page: 1, limit: 100 });
    const garbage = await list({ job: localJob.id, limit: "abc", page: "-3", sort: "$natural", status: "hired", archived: "yes" });
    expect(garbage.body).toMatchObject({ page: 1, limit: 25, total: 2 });

    expect((await list({ job: localJob.id, from: "2099-01-01" })).body.total).toBe(0);
    expect((await list({ job: localJob.id, to: "2000-01-01" })).body.total).toBe(0);
    expect((await list({ job: localJob.id, from: "2000-01-01", to: "2099-12-31" })).body.total).toBe(2);
    expect((await list({ job: `missing-${uniqueSuffix()}` })).body.total).toBe(0);
  });

  test("search treats regex metacharacters and operator syntax literally", async () => {
    const created = await createApplication(hr, job.id, "apps-search");
    const marker = created.person.email.split("@")[0];
    expect((await list({ q: marker })).body.total).toBe(1);
    for (const q of [`${marker}.*`, `.*`, `${marker}|.*`, `(${marker}`, `[a-z]+${marker}`, "\\", "$where"]) {
      const result = await list({ q, job: job.id });
      expectStatus(result, 200);
      expect(result.body.items.map((item) => item.id), q).not.toContain(created.item.id);
    }
    const bracket = await api<ListResult>("GET", `/api/admin/applications?job=${job.id}&q[$ne]=nobody&status[$ne]=submitted&archived[$ne]=x`, { cookie: hr });
    expectStatus(bracket, 200);
    expect(bracket.body.items.map((item) => item.id)).toContain(created.item.id);
    const jobOperator = await list({ job: '{"$ne":null}' });
    expectStatus(jobOperator, 200);
    expect(jobOperator.body.total).toBe(0);
  });

  test("returns the full detail and records the view in the audit log", async () => {
    const created = await createApplication(hr, job.id, "apps-detail");
    const result = await api<{ application: ApplicationDetail }>("GET", `/api/admin/applications/${created.item.id}`, { cookie: hr });
    expectStatus(result, 200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expectExactKeys(result.body, ["application"], "detail body");
    const detail = result.body.application;
    expectExactKeys(detail, DETAIL_KEYS, "application detail");
    expect(detail).toMatchObject({ id: created.item.id, reference: created.reference, jobStillExists: true, archiveReason: "", archivedByName: null });
    expectIsoDate(detail.updatedAt, "updatedAt");
    for (const doc of detail.documents) expectExactKeys(doc, ["id", "kind", "originalName", "size", "contentType", "uploadedAt", "downloadUrl"], "document");
    expectNoSensitiveData(result.body, "application detail");

    const audit = await api<Paginated<AuditLogEntry>>("GET", `/api/admin/audit?action=application.view&entityId=${created.item.id}`, { cookie: admin });
    expect(audit.body.items.length).toBeGreaterThan(0);
    expect(audit.body.items[0].actorName).toBe(hrName);
  });

  test("unknown, malformed and foreign ids are 404 on every application route", async () => {
    const talent = await api<{ talent: TalentDetail }>("POST", "/api/admin/talent-pool", {
      cookie: hr,
      json: { name: "Foreign Record", email: `e2e.foreign.${uniqueSuffix()}@example.com`, phone: "+94 71 000 0000", areaOfInterest: "IT", tags: [], note: "", consentConfirmed: true, uploads: null },
    });
    expectStatus(talent, 201);
    const me = await api<{ user: { id: string } }>("GET", "/api/admin/me", { cookie: hr });
    const created = await createApplication(hr, job.id, "apps-foreign");
    const detail = await getApplication(hr, created.item.id);
    const ids = [randomObjectId(), "123", "not-an-id", "%24ne", talent.body.talent.id, me.body.user.id, detail.documents[0].id, `${created.item.id}0`];
    for (const id of ids) {
      expectApiError(await api("GET", `/api/admin/applications/${id}`, { cookie: hr }), 404, "application_not_found");
      expectApiError(await changeStatus(id, { status: "under_review", expectedStatus: "submitted" }), 404, "application_not_found");
      expectApiError(await api("POST", `/api/admin/applications/${id}/notes`, { cookie: hr, json: { body: "Note" } }), 404, "application_not_found");
      expectApiError(await api("POST", `/api/admin/applications/${id}/archive`, { cookie: hr, json: { archived: true } }), 404, "application_not_found");
      expectApiError(await api("POST", `/api/admin/applications/${id}/talent-pool`, { cookie: hr, json: {} }), 404, "application_not_found");
      expectApiError(await api("DELETE", `/api/admin/applications/${id}`, { cookie: admin }), 404, "application_not_found");
    }
  });

  test("status changes are recorded, conflict-checked and can email the candidate", async () => {
    const created = await createApplication(hr, job.id, "apps-status");
    const id = created.item.id;

    const quiet = await changeStatus(id, { status: "under_review", expectedStatus: "submitted", note: "Screening started" });
    expectStatus(quiet, 200);
    expect(quiet.body.application).toMatchObject({ status: "under_review" });
    expect(quiet.body.application.statusHistory.at(-1)).toMatchObject({
      from: "submitted",
      to: "under_review",
      changedByName: hrName,
      note: "Screening started",
      candidateNotified: false,
    });

    const message = `Please bring your <b>certificates</b> & ID ${uniqueSuffix()}`;
    const notified = await changeStatus(id, {
      status: "interview",
      expectedStatus: "under_review",
      notifyCandidate: true,
      candidateMessage: `${message}\nSee you soon.`,
    });
    expectStatus(notified, 200);
    expect(notified.body.application.statusHistory.at(-1)).toMatchObject({ from: "under_review", to: "interview", candidateNotified: true });
    const [mail] = await waitForEmails((item) => sentTo(item, created.person.email) && item.text.includes(message));
    expect(mail.subject).toContain(created.reference);
    expect(mail.replyTo).toContain("hr@synergypharma.lk");
    expect(mail.html).toContain("&lt;b&gt;certificates&lt;/b&gt; &amp; ID");
    expect(mail.html).not.toContain("<b>certificates</b>");

    expectApiError(await changeStatus(id, { status: "selected", expectedStatus: "under_review" }), 409, "status_conflict");
    expectApiError(await changeStatus(id, { status: "interview", expectedStatus: "interview" }), 400, "status_unchanged", { fields: ["status"] });
    expectApiError(await changeStatus(id, { status: "hired", expectedStatus: "interview" }), 400, "invalid_input", { fields: ["status"] });
    expectApiError(await changeStatus(id, { status: { $ne: "x" }, expectedStatus: { $exists: true } }), 400, "invalid_input", { fields: ["status", "expectedStatus"] });
    expectApiError(await changeStatus(id, { status: "selected", expectedStatus: "interview", note: "n".repeat(1001) }), 400, "invalid_input", { fields: ["note"] });
    expectApiError(
      await changeStatus(id, { status: "selected", expectedStatus: "interview", notifyCandidate: true, candidateMessage: "m".repeat(2001) }),
      400,
      "invalid_input",
      { fields: ["candidateMessage"] }
    );
    expectApiError(await changeStatus(id, { status: "selected", expectedStatus: "interview", notifyCandidate: "yes" }), 400, "invalid_input", {
      fields: ["notifyCandidate"],
    });

    // Candidates are never emailed about moving back to "submitted".
    const backToSubmitted = await changeStatus(id, { status: "submitted", expectedStatus: "interview", notifyCandidate: true, candidateMessage: "Ignored" });
    expectStatus(backToSubmitted, 200);
    expect(backToSubmitted.body.application.statusHistory.at(-1)).toMatchObject({ to: "submitted", candidateNotified: false });
    expectStatus(await changeStatus(id, { status: "interview", expectedStatus: "submitted" }), 200);

    // Terminal states are not locked; history keeps the trail.
    expectStatus(await changeStatus(id, { status: "rejected", expectedStatus: "interview" }), 200);
    const reopened = await changeStatus(id, { status: "under_review", expectedStatus: "rejected" });
    expectStatus(reopened, 200);
    expect(reopened.body.application.statusHistory.map((entry) => entry.to)).toEqual([
      "submitted",
      "under_review",
      "interview",
      "submitted",
      "interview",
      "rejected",
      "under_review",
    ]);

    const detail = await getApplication(hr, id);
    expect(detail.emails.map((email) => email.template)).toContain("application_status_update");
    for (const email of detail.emails) {
      expect(Object.keys(email).sort()).toEqual(["attempts", "createdAt", "id", "sentAt", "status", "template"]);
    }

    // The audit trail records the change, never the private note or the message to the candidate.
    const audit = await api<Paginated<AuditLogEntry>>("GET", `/api/admin/audit?action=application.status_change&entityId=${id}&limit=50`, { cookie: admin });
    expect(audit.body.items.length).toBeGreaterThanOrEqual(5);
    expect(audit.text).not.toContain("Screening started");
    expect(audit.text).not.toContain("certificates");
  });

  test("notes are appended with the author and validated", async () => {
    const created = await createApplication(hr, job.id, "apps-notes");
    const result = await api<{ application: ApplicationDetail }>("POST", `/api/admin/applications/${created.item.id}/notes`, {
      cookie: hr,
      json: { body: "  Strong lab background.\r\nCall back on Monday.  " },
    });
    expectStatus(result, 201);
    expect(result.body.application.noteCount).toBe(1);
    expect(result.body.application.notes[0]).toMatchObject({ body: "Strong lab background.\nCall back on Monday.", authorName: hrName });
    expectExactKeys(result.body.application.notes[0], ["id", "body", "authorName", "createdAt"], "note");

    const post = (json: unknown) => api("POST", `/api/admin/applications/${created.item.id}/notes`, { cookie: hr, json });
    expectApiError(await post({ body: "   " }), 400, "invalid_input", { fields: ["body"] });
    expectApiError(await post({ body: "n".repeat(5001) }), 400, "invalid_input", { fields: ["body"] });
    expectApiError(await post({ body: { $gt: "" } }), 400, "invalid_input", { fields: ["body"] });
    expectApiError(await post({ body: `bell${String.fromCharCode(7)}` }), 400, "invalid_input", { fields: ["body"] });
    // Author fields in the body are ignored.
    const spoof = await api<{ application: ApplicationDetail }>("POST", `/api/admin/applications/${created.item.id}/notes`, {
      cookie: hr,
      json: { body: "Second note", authorName: "Someone Else", author: randomObjectId() },
    });
    expect(spoof.body.application.notes[1].authorName).toBe(hrName);
    const audit = await api<Paginated<AuditLogEntry>>("GET", `/api/admin/audit?action=application.note_add&entityId=${created.item.id}`, { cookie: admin });
    expect(audit.body.items).toHaveLength(2);
    expect(audit.text).not.toContain("Strong lab background");
  });

  test("archived applications are read-only until restored", async () => {
    const created = await createApplication(hr, job.id, "apps-archive");
    const id = created.item.id;
    const archived = await api<{ application: ApplicationDetail }>("POST", `/api/admin/applications/${id}/archive`, {
      cookie: hr,
      json: { archived: true, reason: "Position filled" },
    });
    expectStatus(archived, 200);
    expect(archived.body.application).toMatchObject({ archived: true, archiveReason: "Position filled", archivedByName: hrName });
    expectIsoDate(archived.body.application.archivedAt, "archivedAt");

    expectApiError(await changeStatus(id, { status: "under_review", expectedStatus: "submitted" }), 409, "archived");
    expectApiError(await api("POST", `/api/admin/applications/${id}/notes`, { cookie: hr, json: { body: "Late note" } }), 409, "archived");
    expectApiError(await api("POST", `/api/admin/applications/${id}/talent-pool`, { cookie: hr, json: {} }), 409, "archived");
    expectApiError(await api("POST", `/api/admin/applications/${id}/archive`, { cookie: hr, json: { archived: "false" } }), 400, "invalid_input", {
      fields: ["archived"],
    });
    expectApiError(await api("POST", `/api/admin/applications/${id}/archive`, { cookie: hr, json: { archived: true, reason: "r".repeat(501) } }), 400, "invalid_input");

    const restored = await setApplicationArchived(hr, id, false);
    expect(restored).toMatchObject({ archived: false, archivedAt: null, archiveReason: "" });
    expectStatus(await changeStatus(id, { status: "under_review", expectedStatus: "submitted" }), 200);
  });

  test("moving to the talent pool creates one profile and is safe to repeat", async () => {
    const created = await createApplication(hr, job.id, "apps-move");
    const id = created.item.id;
    const move = await api<MoveToTalentPoolResponse>("POST", `/api/admin/applications/${id}/talent-pool`, {
      cookie: hr,
      json: { tags: ["QC", " Lab  Work ", "qc"], note: "Great fit for future QC roles" },
    });
    expectStatus(move, 200);
    expectExactKeys(move.body, ["talentPoolEntryId", "created"], "move response");
    expect(move.body.created).toBe(true);

    const again = await api<MoveToTalentPoolResponse>("POST", `/api/admin/applications/${id}/talent-pool`, { cookie: hr, json: { tags: ["qc", "microbiology"] } });
    expectStatus(again, 200);
    expect(again.body).toEqual({ talentPoolEntryId: move.body.talentPoolEntryId, created: false });

    const application = await getApplication(hr, id);
    expect(application).toMatchObject({ inTalentPool: true, talentPoolEntryId: move.body.talentPoolEntryId });
    const talent = await getTalent(hr, move.body.talentPoolEntryId);
    expect(talent).toMatchObject({
      source: "application",
      sourceApplicationId: id,
      email: created.person.email,
      areaOfInterest: job.department,
      consentGiven: true,
      consentAt: application.consentAt,
      candidateNotes: "",
    });
    expect([...talent.tags].sort()).toEqual(["lab work", "microbiology", "qc"]);
    expect(talent.notes.map((note) => note.body)).toEqual(["Great fit for future QC roles"]);
    expect(talent.applications.map((link) => link.id)).toEqual([id]);
    expect(talent.documents).toHaveLength(application.documents.length);
    const applicationDocumentIds = application.documents.map((doc) => doc.id);
    expect(talent.documents.some((doc) => applicationDocumentIds.includes(doc.id)), "talent documents are copies with new ids").toBe(false);

    expectApiError(await api("POST", `/api/admin/applications/${id}/talent-pool`, { cookie: hr, json: { tags: [{ $ne: 1 }] } }), 400, "invalid_input", { fields: ["tags"] });
    expectApiError(await api("POST", `/api/admin/applications/${id}/talent-pool`, { cookie: hr, json: { tags: ["<script>"] } }), 400, "invalid_input", { fields: ["tags"] });

    // A second application from the same person links to the same profile; an archived profile blocks it.
    const secondUploads = await uploadDocuments("application", [{ kind: "cv", name: "cv.pdf", bytes: pdfBytes(3000) }]);
    expectStatus(await postApplication(applicationBody(otherJob.id, created.person, secondUploads)), 201);
    const secondItems = await api<ListResult>("GET", `/api/admin/applications?q=${encodeURIComponent(created.person.email)}&job=${otherJob.id}`, { cookie: hr });
    const secondId = secondItems.body.items[0].id;
    await setTalentArchived(hr, move.body.talentPoolEntryId, true);
    expectApiError(await api("POST", `/api/admin/applications/${secondId}/talent-pool`, { cookie: hr, json: {} }), 409, "talent_archived");
    await setTalentArchived(hr, move.body.talentPoolEntryId, false);
    const linked = await api<MoveToTalentPoolResponse>("POST", `/api/admin/applications/${secondId}/talent-pool`, { cookie: hr, json: {} });
    expect(linked.body).toEqual({ talentPoolEntryId: move.body.talentPoolEntryId, created: false });
  });

  test("permanent deletion is admin-only, requires archiving first and removes documents", async () => {
    const created = await createApplication(hr, job.id, "apps-purge");
    const id = created.item.id;
    const detail = await getApplication(hr, id);
    const documentId = detail.documents[0].id;
    const presigned = (await api("GET", detail.documents[0].downloadUrl, { cookie: hr })).headers.get("location") ?? "";
    expect(presigned).toMatch(/^https?:\/\//);

    expectApiError(await api("DELETE", `/api/admin/applications/${id}`, { cookie: hr }), 403, "forbidden");
    expectApiError(await api("DELETE", `/api/admin/applications/${id}`, { cookie: admin }), 409, "not_archived");
    await setApplicationArchived(hr, id, true);
    expectApiError(await api("DELETE", `/api/admin/applications/${id}`, { cookie: hr }), 403, "forbidden");

    const purged = await api("DELETE", `/api/admin/applications/${id}`, { cookie: admin });
    expectStatus(purged, 200);
    expect(purged.body).toEqual({ success: true });
    expectApiError(await api("GET", `/api/admin/applications/${id}`, { cookie: admin }), 404, "application_not_found");
    expectApiError(await api("GET", `/api/admin/documents/${documentId}`, { cookie: admin }), 404, "document_not_found");
    expectApiError(await api("DELETE", `/api/admin/applications/${id}`, { cookie: admin }), 404, "application_not_found");
    // The stored file itself is gone, not just the record pointing at it.
    expect((await fetch(presigned)).status, "stored CV after erasure").toBe(404);

    const audit = await api<Paginated<AuditLogEntry>>("GET", `/api/admin/audit?action=application.purge&entityId=${id}`, { cookie: admin });
    expect(audit.body.items).toHaveLength(1);
    expect(JSON.stringify(audit.body).toLowerCase()).not.toContain(created.person.email.toLowerCase());

    // The candidate may apply again once their data has been erased.
    const uploads = await uploadDocuments("application", [{ kind: "cv", name: "cv.pdf", bytes: pdfBytes(2048) }]);
    expectStatus(await postApplication(applicationBody(job.id, created.person, uploads)), 201);
  });

  test("erasing an application unlinks it from the talent profile", async () => {
    const created = await createApplication(hr, job.id, "apps-purge-linked");
    const move = await api<MoveToTalentPoolResponse>("POST", `/api/admin/applications/${created.item.id}/talent-pool`, { cookie: hr, json: {} });
    expectStatus(move, 200);
    await setApplicationArchived(hr, created.item.id, true);
    expectStatus(await api("DELETE", `/api/admin/applications/${created.item.id}`, { cookie: admin }), 200);

    const talent = await getTalent(hr, move.body.talentPoolEntryId);
    expect(talent.applications).toEqual([]);
    expect(talent.applicationCount).toBe(0);
    expect(talent.sourceApplicationId).toBeNull();
    expect(talent.activity.map((entry) => entry.action)).toContain("application_deleted");
    // The profile keeps its own copy of the documents.
    expect(talent.documentCount).toBe(1);
    expect((await api("GET", talent.documents[0].downloadUrl, { cookie: hr })).status).toBe(302);
  });

  test("CSV export is UTF-8 with BOM and CRLF, neutralizes formulas and mirrors the filters", async () => {
    const exportJob = await createOpenJob(admin, "apps-export", { title: `=SUM(A1:A9) "Quoted", Lead ${uniqueSuffix()}`, department: "@Finance" });
    jobs.push(exportJob.id);
    const plain = await createApplication(hr, exportJob.id, "apps-csv-a", { name: "නදීශා Perera", phone: "+94 77 765 4321", portfolio: "https://example.org/-cmd" });
    const archivedOne = await createApplication(hr, exportJob.id, "apps-csv-b", {
      name: "Mary O'Brien-Smith",
      email: `=e2e.csv.${uniqueSuffix()}@example.com`,
    });
    await setApplicationArchived(hr, archivedOne.item.id, true);

    const result = await downloadExport(`job=${exportJob.id}&archived=include&sort=oldest`);
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.headers.get("content-disposition")).toMatch(/^attachment; filename="applications-\d{4}-\d{2}-\d{2}\.csv"$/);
    // Response.text() would silently drop the byte-order mark, so check the raw bytes.
    expect([...result.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = result.bytes.subarray(3).toString("utf8");
    expect(body.endsWith("\r\n")).toBe(true);
    expect(body.replace(/\r\n/g, "")).not.toContain("\n");

    const rows = parseCsv(body);
    expect(rows[0]).toEqual(CSV_HEADER);
    expect(rows).toHaveLength(3);
    for (const line of body.split("\r\n").filter(Boolean)) {
      expect(line.startsWith('"'), "every cell is quoted").toBe(true);
    }
    const [first, second] = rows.slice(1);
    expect(first[0]).toBe(plain.reference);
    expect(first[1]).toBe("නදීශා Perera");
    expect(first[2]).toBe(plain.person.email);
    expect(first[3]).toBe("'+94 77 765 4321");
    expect(first[4]).toBe(exportJob.id);
    expect(first[5]).toBe(`'${exportJob.title}`);
    expect(first[6]).toBe("'@Finance");
    expect(first[7]).toBe("Submitted");
    expectIsoDate(first[8], "Submitted");
    expect(first[11]).toBe("https://example.org/-cmd");
    expect(first.slice(12)).toEqual(["No", "No"]);
    expect(second[1]).toBe("Mary O'Brien-Smith");
    expect(second[2]).toBe(`'${archivedOne.person.email}`);
    expect(second[12]).toBe("Yes");
    expect(body).toContain('""Quoted""');

    const excluded = await downloadExport(`job=${exportJob.id}`);
    expect(parseCsv(excluded.bytes.subarray(3).toString("utf8"))).toHaveLength(2);
    const none = await downloadExport(`job=missing-${uniqueSuffix()}`);
    expect(parseCsv(none.bytes.subarray(3).toString("utf8"))).toEqual([CSV_HEADER]);

    const audit = await api<Paginated<AuditLogEntry>>("GET", "/api/admin/audit?action=application.export&limit=10", { cookie: admin });
    expect(audit.body.items.some((entry) => entry.actorName === hrName)).toBe(true);
    expectApiError(await api("GET", "/api/admin/applications/export"), 401, "unauthorized");
  });

  test("document downloads redirect to a short-lived private URL and are audited", async () => {
    const created = await createApplication(hr, job.id, "apps-docs");
    const detail = await getApplication(hr, created.item.id);
    const doc = detail.documents[0];

    const result = await api("GET", doc.downloadUrl, { cookie: hr });
    expect(result.status).toBe(302);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    const location = new URL(result.headers.get("location") ?? "");
    expect(location.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(location.pathname).toContain(`applications/${created.item.id}/`);
    expect(decodeURIComponent(location.searchParams.get("response-content-disposition") ?? "")).toMatch(/^attachment;/);

    const download = await fetch(location);
    expect(download.status).toBe(200);
    // Always a download of a PDF, never rendered inline by the storage origin.
    expect(download.headers.get("content-disposition") ?? "").toMatch(/^attachment;\s*filename="[^"\\/]+\.pdf"/);
    expect(download.headers.get("content-type")).toBe("application/pdf");
    const bytes = Buffer.from(await download.arrayBuffer());
    expect(bytes.equals(created.files[0].bytes)).toBe(true);

    expectApiError(await api("GET", doc.downloadUrl), 401, "unauthorized");
    for (const id of [randomObjectId(), created.item.id, "not-an-id", "..%2F..%2Fapplications"]) {
      expectApiError(await api("GET", `/api/admin/documents/${id}`, { cookie: hr }), 404, "document_not_found");
    }
    const audit = await api<Paginated<AuditLogEntry>>("GET", `/api/admin/audit?action=document.download&entityId=${doc.id}`, { cookie: admin });
    expect(audit.body.items).toHaveLength(1);
    expect(audit.body.items[0].actorName).toBe(hrName);
  });

  test("closing the job keeps its applications manageable", async () => {
    const closingJob = await createOpenJob(admin, "apps-closing");
    jobs.push(closingJob.id);
    const created = await createApplication(hr, closingJob.id, "apps-closing");
    await changeJobStatus(admin, closingJob.id, "close");
    const detail = await getApplication(hr, created.item.id);
    expect(detail.jobStillExists).toBe(false);
    expectStatus(await changeStatus(created.item.id, { status: "selected", expectedStatus: "submitted" }), 200);
    const fresh = candidate("apps-closed-apply");
    const uploads = await uploadDocuments("application", [{ kind: "cv", name: "cv.pdf", bytes: pdfBytes(2048) }]);
    expectApiError(await postApplication(applicationBody(closingJob.id, fresh, uploads)), 404, "job_not_found");
  });
});
