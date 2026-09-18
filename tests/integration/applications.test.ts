import "./support/env";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AdminContext } from "@/lib/auth/session";
import {
  addApplicationNote,
  changeApplicationStatus,
  exportApplicationsCsv,
  getApplicationDetail,
  listApplications,
  moveApplicationToTalentPool,
  purgeApplication,
  setApplicationArchived,
  submitApplication,
} from "@/lib/careers/server/applications";
import { changeJobStatus, createJob, updateJob } from "@/lib/careers/server/jobs";
import { applicationReference, newId } from "@/lib/careers/server/ids";
import type { ApplicationRecord } from "@/lib/careers/server/records";
import { setTalentArchived, submitTalentProfile } from "@/lib/careers/server/talent-pool";
import { parsePagination, type ApplicationSubmission } from "@/lib/careers/validation";
import { updateRecord } from "@/lib/sheets-db";
import { encodeDate } from "@/lib/sheets-db/codec";
import { findApplicationById, loadApplication } from "@/lib/sheets-db/repositories/applications";
import { listEmails } from "@/lib/sheets-db/repositories/email";
import { findJobBySlug, patchJob } from "@/lib/sheets-db/repositories/jobs";
import { listAllTalent, loadTalent } from "@/lib/sheets-db/repositories/talent";
import type { AdminJob } from "@/types/careers";
import { integrationConfig, suiteSkip } from "./support/env";
import { FOLDER_NAMES, driveFileExists, listFilesIn } from "./support/drive";
import {
  adminContext,
  applicationSubmission,
  assertAuditHasNoPersonalData,
  assertNoPersonalData,
  auditEntries,
  expectAppError,
  jobInput,
  pdfBytes,
  publishedJob,
  talentSubmission,
  uniqueSuffix,
  uploadDocument,
} from "./support/fixtures";
import { startIntegration, type Integration } from "./support/harness";

const LF = String.fromCharCode(10);
const DAY = 24 * 60 * 60 * 1000;

type Submitted = { id: string; reference: string; input: ApplicationSubmission };

async function record(id: string): Promise<ApplicationRecord> {
  const found = await loadApplication(id, { refreshOnMiss: true });
  assert.ok(found, `application ${id} not found`);
  return found;
}

async function stagedNames(): Promise<string[]> {
  return (await listFilesIn(FOLDER_NAMES.staging)).map((file) => file.name);
}

async function emailsFor(entityType: string, entityId: string) {
  return (await listEmails({ maxAgeMs: 0 })).filter((message) => message.related?.entityType === entityType && message.related?.entityId === entityId);
}

async function liveApplicationsFor(emailNormalized: string): Promise<ApplicationRecord[]> {
  const rows = await listApplications({ archived: "include" }, parsePagination(new URLSearchParams("limit=100")));
  const found: ApplicationRecord[] = [];
  for (const item of rows.items) {
    const full = await loadApplication(item.id);
    if (full && full.emailNormalized === emailNormalized.toLowerCase()) found.push(full);
  }
  return found;
}

describe("applications service", { timeout: 600_000, skip: suiteSkip() }, () => {
  let integration: Integration;
  let hr: AdminContext;
  let job: AdminJob;
  const personalData: string[] = [];

  async function submit(jobSlug: string = job.id, overrides: Partial<ApplicationSubmission> = {}, supportingCount = 0): Promise<Submitted> {
    const cv = await uploadDocument("application", "cv");
    const supporting: string[] = [];
    for (let i = 0; i < supportingCount; i += 1) supporting.push(await uploadDocument("application", "supporting", pdfBytes(1500)));
    const input = applicationSubmission(jobSlug, { cv, supporting }, overrides);
    personalData.push(input.name, input.email, input.phone);
    const result = await submitApplication(input, { ip: "198.51.100.23" });
    return { ...result, input };
  }

  before(async () => {
    integration = await startIntegration();
    hr = await adminContext("hr", "Hiruni Recruiter");
    job = await publishedJob(hr, { department: "Quality Assurance" });
  });

  after(async () => {
    try {
      await assertAuditHasNoPersonalData(personalData);
      assertNoPersonalData(integration.logs(), personalData, "application logs");
    } finally {
      await integration.stop();
    }
  });

  describe("submitApplication", () => {
    it("stores the application with job snapshots, documents, history, emails and an audit entry", async () => {
      const { id, reference, input } = await submit(job.id, {}, 1);
      assert.equal(reference, applicationReference(id));
      assert.match(reference, /^APP-[0-9A-F]{8}$/);

      const doc = await record(id);
      const jobRecord = await findJobBySlug(job.id);
      assert.ok(jobRecord);
      assert.equal(doc.job, jobRecord.id, "the row stores the job's record id, not its slug");
      assert.equal(doc.jobSlug, job.id);
      assert.equal(doc.jobTitle, job.title);
      assert.equal(doc.department, "Quality Assurance");
      assert.equal(doc.email, input.email);
      assert.equal(doc.emailNormalized, input.email.toLowerCase());
      assert.equal(doc.consentGiven, true);
      assert.ok(doc.consentAt);
      assert.equal(doc.status, "submitted");
      assert.equal(doc.source, "website");
      assert.equal(doc.talentPoolEntry, null);
      assert.equal(doc.linkedIn, input.linkedIn);
      assert.equal(doc.portfolio, null);
      assert.equal(doc.supersededBy, null);

      assert.equal(doc.statusHistory.length, 1);
      assert.deepEqual(
        { ...doc.statusHistory[0], id: undefined, changedAt: undefined },
        { id: undefined, changedAt: undefined, from: null, to: "submitted", changedBy: null, changedByName: null, note: "Application submitted via website", candidateNotified: false }
      );

      assert.equal(doc.documents.length, 2);
      assert.deepEqual(doc.documents.map((document) => document.kind), ["cv", "supporting"]);
      for (const document of doc.documents) {
        assert.match(document.driveFileId, /^[A-Za-z0-9_-]{10,}$/);
        assert.ok(await driveFileExists(document.driveFileId));
      }
      const staged = await stagedNames();
      for (const uploadId of [input.uploads.cv, ...input.uploads.supporting]) {
        assert.equal(staged.includes(`${uploadId}.pdf`), false, "the staged file was moved, not copied");
      }

      const emails = (await emailsFor("application", id)).sort((a, b) => a.template.localeCompare(b.template));
      assert.deepEqual(
        emails.map((email) => [email.template, email.to, email.replyTo, email.status]),
        [
          ["application_received", input.email, integrationConfig.hrEmail, "pending"],
          ["hr_new_application", integrationConfig.hrEmail, input.email, "pending"],
        ]
      );
      assert.ok(emails[0].subject.includes(reference));
      assert.ok(emails[1].html.includes(`application=${id}`));

      const [audit] = await auditEntries({ action: "application.submit", entityId: id });
      assert.equal(audit.actor, null);
      assert.equal(audit.ip, "198.51.100.23");
      assert.deepEqual(audit.meta, { jobSlug: job.id, documentCount: 2 });
    });

    it("keeps the job title snapshot when the job is edited later", async () => {
      const localJob = await publishedJob(hr);
      const { id } = await submit(localJob.id);
      await updateJob(localJob.id, jobInput({ title: "Renamed Role" }), hr);
      assert.equal((await record(id)).jobTitle, localJob.title);
    });

    it("rejects a duplicate (case-insensitive email) before claiming the new uploads", async () => {
      const first = await submit();
      const cv = await uploadDocument("application", "cv");
      const duplicate = applicationSubmission(job.id, { cv }, { email: first.input.email.toUpperCase() });
      const err = await expectAppError(submitApplication(duplicate, { ip: "198.51.100.23" }), 409, "duplicate_application");
      assert.equal(err.message, "You have already applied for this role. We'll be in touch if your profile is shortlisted.");
      assert.ok((await stagedNames()).includes(`${cv}.pdf`), "the upload is still staged and can be submitted again");
      assert.equal((await liveApplicationsFor(first.input.email)).length, 1);

      await setApplicationArchived(first.id, true, "", hr);
      const cvAgain = await uploadDocument("application", "cv");
      await expectAppError(
        submitApplication(applicationSubmission(job.id, { cv: cvAgain }, { email: first.input.email }), { ip: "198.51.100.23" }),
        409,
        "duplicate_application"
      );

      const otherJob = await publishedJob(hr);
      const second = await submit(otherJob.id, { email: first.input.email });
      assert.ok(second.id);
    });

    it("only accepts applications for open jobs and leaves the uploads untouched", async () => {
      const closed = await publishedJob(hr);
      await changeJobStatus(closed.id, "close", hr);
      const draft = await createJob(jobInput(), "draft", hr);
      const archived = await publishedJob(hr);
      await changeJobStatus(archived.id, "archive", hr);
      const expired = await publishedJob(hr, { applicationDeadline: new Date(Date.now() + DAY) });
      const expiredRecord = await findJobBySlug(expired.id);
      assert.ok(expiredRecord);
      await patchJob(expiredRecord.id, { applicationDeadline: new Date(Date.now() - 1000) });

      for (const slug of [closed.id, draft.id, archived.id, expired.id, `missing-${uniqueSuffix()}`]) {
        const cv = await uploadDocument("application", "cv");
        const err = await expectAppError(submitApplication(applicationSubmission(slug, { cv }), { ip: "198.51.100.23" }), 404, "job_not_found");
        assert.equal(err.message, "This role is no longer accepting applications.");
        assert.ok((await stagedNames()).includes(`${cv}.pdf`), slug);
      }
    });

    it("releases the claimed CV when a supporting document is invalid, so the form can be resubmitted", async () => {
      const cv = await uploadDocument("application", "cv");
      // An upload issued for the talent pool cannot be claimed as an application document.
      const wrongPurpose = await uploadDocument("talent_pool", "supporting", pdfBytes(1500));
      const input = applicationSubmission(job.id, { cv, supporting: [wrongPurpose] });
      personalData.push(input.name, input.email, input.phone);
      await expectAppError(submitApplication(input, { ip: "198.51.100.23" }), 400, "upload_expired");
      assert.equal((await liveApplicationsFor(input.email)).length, 0);
      assert.ok((await stagedNames()).includes(`${cv}.pdf`), "the CV was moved back out of the candidate folder");

      const retried = await submitApplication({ ...input, uploads: { cv, supporting: [] } }, { ip: "198.51.100.23" });
      assert.equal((await record(retried.id)).documents.length, 1);
    });

    it("accepts only one of two simultaneous submissions for the same job and email, releasing the loser's files", async () => {
      const raceJob = await publishedJob(hr);
      const [cvA, cvB] = await Promise.all([uploadDocument("application", "cv"), uploadDocument("application", "cv")]);
      const first = applicationSubmission(raceJob.id, { cv: cvA });
      personalData.push(first.name, first.email, first.phone);
      const second = { ...first, email: first.email.toUpperCase(), uploads: { cv: cvB, supporting: [] } };
      const filesBefore = new Set((await listFilesIn(FOLDER_NAMES.applications)).map((file) => file.id));

      const outcomes = await Promise.allSettled([submitApplication(first, { ip: "198.51.100.23" }), submitApplication(second, { ip: "198.51.100.23" })]);
      const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      assert.equal(fulfilled.length, 1, JSON.stringify(outcomes.map((outcome) => outcome.status)));
      assert.equal(rejected.length, 1);
      assert.ok(rejected[0].reason instanceof Error && (rejected[0].reason as { code?: string }).code === "duplicate_application", String(rejected[0].reason));

      const stored = await liveApplicationsFor(first.email);
      assert.equal(stored.length, 1, "the loser's row is superseded, so it is invisible everywhere");
      for (const document of stored[0].documents) assert.ok(await driveFileExists(document.driveFileId), "the winner keeps its documents");
      const newFiles = (await listFilesIn(FOLDER_NAMES.applications)).filter((file) => !filesBefore.has(file.id)).map((file) => file.id).sort();
      assert.deepEqual(newFiles, stored[0].documents.map((document) => document.driveFileId).sort(), "files moved for the rejected submission were deleted");
    });
  });

  describe("status workflow", () => {
    it("records history, emails the candidate when asked and audits each change", async () => {
      const { id, reference, input } = await submit();
      const reviewed = await changeApplicationStatus(id, { status: "under_review", expectedStatus: "submitted", note: "CV looks relevant" }, hr);
      assert.equal(reviewed.status, "under_review");
      assert.equal(reviewed.statusHistory.length, 2);
      assert.deepEqual(
        { ...reviewed.statusHistory[1], id: undefined, changedAt: undefined },
        { id: undefined, changedAt: undefined, from: "submitted", to: "under_review", changedByName: "Hiruni Recruiter", note: "CV looks relevant", candidateNotified: false }
      );
      assert.equal((await emailsFor("application", id)).filter((email) => email.template === "application_status_update").length, 0);

      const message = `Please bring your certificates.${LF}<b>Venue:</b> Head office`;
      const invited = await changeApplicationStatus(
        id,
        { status: "interview", expectedStatus: "under_review", notifyCandidate: true, candidateMessage: message },
        hr
      );
      assert.equal(invited.statusHistory[2].candidateNotified, true);
      assert.ok(Date.parse(invited.statusChangedAt) >= Date.parse(reviewed.statusChangedAt));
      const email = (await emailsFor("application", id)).find((item) => item.template === "application_status_update");
      assert.ok(email);
      assert.equal(email.to, input.email);
      assert.equal(email.replyTo, integrationConfig.hrEmail);
      assert.equal(email.subject, `Interview invitation: ${job.title} (${reference})`);
      assert.ok(email.html.includes("&lt;b&gt;Venue:&lt;/b&gt; Head office"));
      assert.ok(invited.emails.some((item) => item.template === "application_status_update"));

      const audits = await auditEntries({ action: "application.status_change", entityId: id });
      assert.deepEqual(
        audits.map((entry) => entry.meta),
        [
          { from: "submitted", to: "under_review", candidateNotified: false },
          { from: "under_review", to: "interview", candidateNotified: true },
        ]
      );
      assertNoPersonalData(JSON.stringify(audits), ["Please bring your certificates", "CV looks relevant"], "status audit");
    });

    it("never emails candidates about the submitted status", async () => {
      const { id } = await submit();
      await changeApplicationStatus(id, { status: "rejected", expectedStatus: "submitted" }, hr);
      const back = await changeApplicationStatus(id, { status: "submitted", expectedStatus: "rejected", notifyCandidate: true, candidateMessage: "Reopened" }, hr);
      assert.equal(back.statusHistory[2].candidateNotified, false);
      assert.equal((await emailsFor("application", id)).filter((email) => email.template === "application_status_update").length, 0);
    });

    it("rejects an unchanged status and a stale expected status", async () => {
      const { id } = await submit();
      await expectAppError(changeApplicationStatus(id, { status: "submitted", expectedStatus: "submitted" }, hr), 400, "status_unchanged");
      await changeApplicationStatus(id, { status: "shortlisted", expectedStatus: "submitted" }, hr);
      const err = await expectAppError(changeApplicationStatus(id, { status: "rejected", expectedStatus: "submitted" }, hr), 409, "status_conflict");
      assert.equal(err.message, "This application was updated by someone else. Refresh to see the latest status.");
      const doc = await record(id);
      assert.equal(doc.status, "shortlisted");
      assert.equal(doc.statusHistory.length, 2);
    });

    it("lets only one of two simultaneous status changes from the same status win", async () => {
      const { id } = await submit();
      const outcomes = await Promise.allSettled([
        changeApplicationStatus(id, { status: "shortlisted", expectedStatus: "submitted" }, hr),
        changeApplicationStatus(id, { status: "rejected", expectedStatus: "submitted" }, hr),
      ]);
      assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ["fulfilled", "rejected"]);
      const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      assert.equal((failure?.reason as { code?: string }).code, "status_conflict");
      assert.equal((await record(id)).statusHistory.length, 2, "the losing change appended no history row");
    });

    it("refuses to change archived applications", async () => {
      const { id } = await submit();
      await setApplicationArchived(id, true, "Position filled", hr);
      const err = await expectAppError(changeApplicationStatus(id, { status: "rejected", expectedStatus: "submitted" }, hr), 409, "archived");
      assert.equal(err.message, "Restore the application before changing its status.");
    });

    it("validates the payload and ids", async () => {
      const { id } = await submit();
      const err = await expectAppError(
        changeApplicationStatus(id, { status: "hired" as "selected", expectedStatus: "submitted" }, hr),
        400,
        "invalid_input"
      );
      assert.ok(err.fields?.status);
      await expectAppError(changeApplicationStatus("not-an-id", { status: "rejected", expectedStatus: "submitted" }, hr), 404, "application_not_found");
      await expectAppError(changeApplicationStatus(newId(), { status: "rejected", expectedStatus: "submitted" }, hr), 404, "application_not_found");
    });
  });

  describe("notes", () => {
    it("appends notes with the author and audits without the note body", async () => {
      const { id } = await submit();
      const detail = await addApplicationNote(id, "  Strong GMP background; call on Monday.  ", hr);
      assert.equal(detail.notes.length, 1);
      assert.equal(detail.notes[0].body, "Strong GMP background; call on Monday.");
      assert.equal(detail.notes[0].authorName, "Hiruni Recruiter");
      const second = await addApplicationNote(id, "Second note", hr);
      assert.deepEqual(second.notes.map((note) => note.body), ["Strong GMP background; call on Monday.", "Second note"]);
      const audits = await auditEntries({ action: "application.note_add", entityId: id });
      assert.equal(audits.length, 2);
      assertNoPersonalData(JSON.stringify(audits), ["Strong GMP background", "Second note"], "note audit");
    });

    it("validates note bodies and refuses archived applications", async () => {
      const { id } = await submit();
      await expectAppError(addApplicationNote(id, "   ", hr), 400, "invalid_input");
      await expectAppError(addApplicationNote(id, "x".repeat(5001), hr), 400, "invalid_input");
      await setApplicationArchived(id, true, "", hr);
      await expectAppError(addApplicationNote(id, "Too late", hr), 409, "archived");
    });
  });

  describe("archive and restore", () => {
    it("sets and clears archive fields, auditing only real changes", async () => {
      const { id } = await submit();
      const archived = await setApplicationArchived(id, true, "Duplicate of a phone application", hr);
      assert.ok(archived.archived);
      assert.ok(archived.archivedAt);
      assert.equal(archived.archivedByName, "Hiruni Recruiter");
      assert.equal(archived.archiveReason, "Duplicate of a phone application");
      await setApplicationArchived(id, true, "again", hr);
      assert.equal((await auditEntries({ action: "application.archive", entityId: id })).length, 1);
      assert.equal((await record(id)).archiveReason, "Duplicate of a phone application");

      const restored = await setApplicationArchived(id, false, "", hr);
      assert.equal(restored.archived, false);
      assert.equal(restored.archivedAt, null);
      assert.equal(restored.archiveReason, "");
      assert.equal((await auditEntries({ action: "application.restore", entityId: id })).length, 1);
      await expectAppError(setApplicationArchived(id, true, "x".repeat(501), hr), 400, "invalid_input");
    });
  });

  describe("listing and export", () => {
    it("filters by search text, status, job, archive state and date, with pagination", async () => {
      const listJob = await publishedJob(hr, { title: `=SUM(1+1) Analyst ${uniqueSuffix()}` });
      const a = await submit(listJob.id);
      const b = await submit(listJob.id);
      const c = await submit(listJob.id);
      await changeApplicationStatus(b.id, { status: "shortlisted", expectedStatus: "submitted" }, hr);
      await setApplicationArchived(c.id, true, "", hr);
      assert.ok(await updateRecord("Applications", a.id, { createdAt: encodeDate(new Date("2025-01-15T10:00:00.000Z")) }));

      const page = parsePagination(new URLSearchParams("limit=10"));
      const ids = async (filters: Parameters<typeof listApplications>[0]) => (await listApplications({ jobSlug: listJob.id, ...filters }, page)).items.map((item) => item.id);

      assert.deepEqual(await ids({}), [b.id, a.id], "newest first, archived excluded by default");
      assert.deepEqual(await ids({ archived: "only" }), [c.id]);
      assert.deepEqual((await ids({ archived: "include" })).sort(), [a.id, b.id, c.id].sort());
      assert.deepEqual(await ids({ sort: "oldest" }), [a.id, b.id]);
      assert.deepEqual(await ids({ status: "shortlisted" }), [b.id]);
      assert.deepEqual(await ids({ q: a.input.email.toUpperCase() }), [a.id]);
      assert.deepEqual(await ids({ q: a.input.name.split(" ")[2] }), [a.id]);
      assert.deepEqual(await ids({ q: a.reference }), [a.id]);
      assert.deepEqual(await ids({ q: "(.*)" }), []);
      assert.deepEqual(await ids({ from: new Date("2025-01-15T00:00:00.000Z"), to: new Date("2025-01-16T00:00:00.000Z") }), [a.id]);
      assert.deepEqual(await listApplications({ jobSlug: `missing-${uniqueSuffix()}` }, page), { items: [], total: 0, page: 1, limit: 10, pageCount: 1 });

      const firstPage = await listApplications({ jobSlug: listJob.id, archived: "include" }, parsePagination(new URLSearchParams("limit=2&page=1")));
      assert.equal(firstPage.total, 3);
      assert.equal(firstPage.pageCount, 2);
      assert.equal(firstPage.items.length, 2);
      const item = firstPage.items[0];
      assert.equal("coverLetter" in item, false);
      assert.equal(JSON.stringify(firstPage).includes("driveFileId"), false, "no storage identifiers in list items");

      const { csv, rowCount } = await exportApplicationsCsv({ jobSlug: listJob.id, archived: "include" }, hr);
      assert.equal(rowCount, 3);
      const CRLF = String.fromCharCode(13, 10);
      assert.equal(csv.charCodeAt(0), 0xfeff);
      const lines = csv.slice(1).split(CRLF);
      assert.equal(lines.at(-1), "");
      assert.equal(lines.length, 5);
      assert.equal(
        lines[0],
        ["Reference", "Name", "Email", "Phone", "Job ID", "Job Title", "Department", "Status", "Submitted", "Status Changed", "LinkedIn", "Portfolio", "Archived", "In Talent Pool"]
          .map((cell) => `"${cell}"`)
          .join(",")
      );
      assert.ok(lines[1].includes(`"'${listJob.title}"`), "formula-like job titles are neutralized");
      assert.ok(csv.includes(`"${a.reference}"`));

      const [audit] = await auditEntries({ action: "application.export" });
      assert.equal(audit.meta.rowCount, 3);
      assert.equal((audit.meta.filters as Record<string, unknown>).search, false);
    });
  });

  describe("detail", () => {
    it("returns the detail DTO without Drive identifiers and audits the view", async () => {
      const { id } = await submit(job.id, {}, 1);
      const detail = await getApplicationDetail(id, hr);
      assert.equal(detail.documents.length, 2);
      for (const document of detail.documents) {
        assert.equal(document.downloadUrl, `/api/admin/documents/${document.id}`);
      }
      const json = JSON.stringify(detail);
      const stored = await record(id);
      for (const document of stored.documents) {
        assert.equal(json.includes(document.driveFileId), false, "the Drive file id never reaches the browser");
      }
      assert.equal(json.includes("emailNormalized"), false);
      assert.equal(detail.jobStillExists, true);
      assert.equal((await auditEntries({ action: "application.view", entityId: id })).length, 1);
      await expectAppError(getApplicationDetail("zzz", hr), 404, "application_not_found");
    });
  });

  describe("moveApplicationToTalentPool", () => {
    it("creates a talent profile with copies of the documents", async () => {
      const { id, reference, input } = await submit(job.id, {}, 1);
      const result = await moveApplicationToTalentPool(id, { tags: ["GMP", " qa "], note: "Great fit for future QA roles" }, hr);
      assert.equal(result.created, true);

      const entry = await loadTalent(result.talentPoolEntryId);
      assert.ok(entry);
      assert.equal(entry.source, "application");
      assert.equal(entry.sourceApplication, id);
      assert.deepEqual(entry.applications, [id]);
      assert.equal(entry.emailNormalized, input.email.toLowerCase());
      assert.equal(entry.areaOfInterest, "Quality Assurance");
      assert.deepEqual(entry.tags, ["gmp", "qa"]);
      assert.equal(entry.consentGiven, true);
      assert.equal(entry.candidateNotes, "");
      assert.deepEqual(entry.notes.map((note) => [note.body, note.authorName]), [["Great fit for future QA roles", "Hiruni Recruiter"]]);
      assert.deepEqual(entry.activity.map((activity) => activity.action), ["created"]);
      assert.ok(entry.activity[0].detail.includes(reference));

      const application = await record(id);
      assert.equal(application.talentPoolEntry, result.talentPoolEntryId);
      assert.equal(entry.documents.length, application.documents.length);
      for (const [index, document] of entry.documents.entries()) {
        const original = application.documents[index];
        assert.notEqual(document.id, original.id);
        assert.notEqual(document.driveFileId, original.driveFileId, "the copy is its own Drive file");
        assert.ok(await driveFileExists(document.driveFileId));
        assert.ok(await driveFileExists(original.driveFileId));
      }
      assert.equal((await auditEntries({ action: "application.move_to_talent_pool", entityId: id })).length, 1);
    });

    it("is idempotent and merges new tags", async () => {
      const { id } = await submit();
      const first = await moveApplicationToTalentPool(id, { tags: ["qa"], note: "First" }, hr);
      const second = await moveApplicationToTalentPool(id, { tags: ["qa"], note: "First" }, hr);
      assert.deepEqual(second, { talentPoolEntryId: first.talentPoolEntryId, created: false });
      const third = await moveApplicationToTalentPool(id, { tags: ["qc"], note: "" }, hr);
      assert.equal(third.talentPoolEntryId, first.talentPoolEntryId);

      const entry = await loadTalent(first.talentPoolEntryId);
      assert.ok(entry);
      assert.deepEqual(entry.tags, ["qa", "qc"]);
      assert.equal(entry.notes.length, 1);
      assert.equal(entry.documents.length, 1);
      assert.deepEqual(entry.activity.map((activity) => activity.action), ["created", "tags_changed"]);
      assert.equal((await listAllTalent({ maxAgeMs: 0 })).filter((item) => item.emailNormalized === entry.emailNormalized).length, 1);
    });

    it("creates a single profile when the move is requested twice at the same time", async () => {
      const { id } = await submit(job.id, {}, 1);
      const filesBefore = new Set((await listFilesIn(FOLDER_NAMES.talent)).map((file) => file.id));
      const results = await Promise.all([
        moveApplicationToTalentPool(id, { tags: ["qa"], note: "" }, hr),
        moveApplicationToTalentPool(id, { tags: ["qa"], note: "" }, hr),
      ]);
      assert.equal(results[0].talentPoolEntryId, results[1].talentPoolEntryId);
      assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
      const application = await record(id);
      assert.equal(
        (await listAllTalent({ maxAgeMs: 0 })).filter((item) => item.emailNormalized === application.emailNormalized).length,
        1
      );
      const entry = await loadTalent(results[0].talentPoolEntryId);
      const newFiles = (await listFilesIn(FOLDER_NAMES.talent)).filter((file) => !filesBefore.has(file.id)).map((file) => file.id).sort();
      assert.deepEqual(newFiles, (entry?.documents ?? []).map((document) => document.driveFileId).sort(), "copies made by the losing request were deleted");
    });

    it("links an existing talent profile with the same email instead of creating one", async () => {
      const talentCv = await uploadDocument("talent_pool", "cv");
      const talentInput = talentSubmission({ cv: talentCv });
      personalData.push(talentInput.name, talentInput.email, talentInput.phone);
      const talent = await submitTalentProfile(talentInput, { ip: "198.51.100.23" });
      const { id } = await submit(job.id, { email: talentInput.email.toUpperCase() });

      const result = await moveApplicationToTalentPool(id, { tags: ["referral"], note: "Linked from application" }, hr);
      assert.deepEqual(result, { talentPoolEntryId: talent.id, created: false });
      const entry = await loadTalent(talent.id);
      assert.ok(entry);
      assert.deepEqual(entry.applications, [id]);
      assert.equal(entry.documents.length, 1, "documents are not copied into an existing profile");
      assert.deepEqual(entry.tags, ["referral"]);
      assert.deepEqual(entry.activity.map((activity) => activity.action), ["created", "application_linked", "tags_changed"]);
      assert.deepEqual(entry.notes.map((note) => note.body), ["Linked from application"]);
      assert.equal((await record(id)).talentPoolEntry, talent.id);
    });

    it("refuses archived talent profiles and archived applications", async () => {
      const talentCv = await uploadDocument("talent_pool", "cv");
      const talentInput = talentSubmission({ cv: talentCv });
      personalData.push(talentInput.name, talentInput.email, talentInput.phone);
      const talent = await submitTalentProfile(talentInput, { ip: "198.51.100.23" });
      await setTalentArchived(talent.id, true, "", hr);
      const { id } = await submit(job.id, { email: talentInput.email });
      const err = await expectAppError(moveApplicationToTalentPool(id, { tags: [], note: "" }, hr), 409, "talent_archived");
      assert.equal(err.message, "This candidate's talent profile is archived. Restore it first.");

      const archivedApplication = await submit();
      await setApplicationArchived(archivedApplication.id, true, "", hr);
      await expectAppError(moveApplicationToTalentPool(archivedApplication.id, { tags: [], note: "" }, hr), 409, "archived");
      await expectAppError(moveApplicationToTalentPool(id, { tags: ["<bad>"], note: "" }, hr), 400, "invalid_input");
    });
  });

  describe("purgeApplication", () => {
    it("requires the application to be archived first", async () => {
      const { id } = await submit();
      await expectAppError(purgeApplication(id, hr), 409, "not_archived");
      assert.ok(await findApplicationById(id, { maxAgeMs: 0 }));
    });

    it("erases documents, related emails and talent links, then the rows", async () => {
      const admin = await adminContext("admin", "Asela Administrator");
      const { id, reference } = await submit(job.id, {}, 1);
      const other = await submit();
      const moved = await moveApplicationToTalentPool(id, { tags: [], note: "" }, hr);
      await changeApplicationStatus(id, { status: "rejected", expectedStatus: "submitted", notifyCandidate: true }, hr);
      const documents = (await record(id)).documents;
      assert.equal((await emailsFor("application", id)).length, 3);

      await setApplicationArchived(id, true, "Erasure request", hr);
      await purgeApplication(id, admin);

      assert.equal(await findApplicationById(id, { maxAgeMs: 0 }), null);
      for (const document of documents) assert.equal(await driveFileExists(document.driveFileId), false, document.driveFileId);
      assert.equal((await emailsFor("application", id)).length, 0);
      assert.equal((await emailsFor("application", other.id)).length, 2, "other records keep their emails");

      const entry = await loadTalent(moved.talentPoolEntryId);
      assert.ok(entry, "the talent profile itself is kept");
      assert.deepEqual(entry.applications, []);
      assert.equal(entry.sourceApplication, null);
      assert.equal(entry.activity.at(-1)?.action, "application_deleted");
      for (const document of entry.documents) {
        assert.ok(await driveFileExists(document.driveFileId), "talent copies are independent");
      }

      const [audit] = await auditEntries({ action: "application.purge", entityId: id });
      assert.equal(audit.actor?.user, admin.userId);
      assert.equal(audit.meta.reference, reference);
      assert.equal(audit.meta.jobSlug, job.id);
      assert.equal(audit.meta.keptSharedDocuments, 0);
    });

    it("keeps a Drive file while another record's document row still points at it", async () => {
      // Records merged before the migration can share one file. Erasing one of them must not
      // take the file out from under the other.
      const first = await submit();
      const second = await submit();
      const shared = (await record(first.id)).documents[0];
      const secondDocument = (await record(second.id)).documents[0];
      assert.ok(await updateRecord("Documents", secondDocument.id, { driveFileId: shared.driveFileId }));

      await setApplicationArchived(first.id, true, "", hr);
      await purgeApplication(first.id, hr);
      assert.equal(await findApplicationById(first.id, { maxAgeMs: 0 }), null);
      assert.ok(await driveFileExists(shared.driveFileId), "the other record still needs the file");
      const [audit] = await auditEntries({ action: "application.purge", entityId: first.id });
      assert.equal(audit.meta.keptSharedDocuments, 1);

      await setApplicationArchived(second.id, true, "", hr);
      await purgeApplication(second.id, hr);
      assert.equal(await driveFileExists(shared.driveFileId), false, "the last reference removes the file");
    });

    it("refuses unknown ids", async () => {
      await expectAppError(purgeApplication(newId(), hr), 404, "application_not_found");
      await expectAppError(purgeApplication("not-an-id", hr), 404, "application_not_found");
    });
  });
});
