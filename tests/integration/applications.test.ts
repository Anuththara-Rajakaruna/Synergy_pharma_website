import "./support/env";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Types } from "mongoose";
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
import { setTalentArchived, submitTalentProfile } from "@/lib/careers/server/talent-pool";
import { parsePagination, type ApplicationSubmission } from "@/lib/careers/validation";
import { ApplicationModel, applicationReference, type ApplicationDoc } from "@/models/application";
import { EmailOutboxModel } from "@/models/email-outbox";
import { JobModel } from "@/models/job";
import { TalentPoolEntryModel } from "@/models/talent-pool-entry";
import { UploadIntentModel } from "@/models/upload-intent";
import type { AdminJob } from "@/types/careers";
import { integrationConfig } from "./support/env";
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
import { listKeys, objectExists, putObject } from "./support/s3";

const LF = String.fromCharCode(10);
const DAY = 24 * 60 * 60 * 1000;

type Submitted = { id: string; reference: string; input: ApplicationSubmission };

async function loadApplication(id: string): Promise<ApplicationDoc> {
  const doc = await ApplicationModel.findById(id).lean<ApplicationDoc>();
  assert.ok(doc, `application ${id} not found`);
  return doc;
}

describe("applications service", { timeout: 300_000 }, () => {
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

      const doc = await loadApplication(id);
      const jobDoc = await JobModel.findOne({ slug: job.id }).lean();
      assert.ok(jobDoc && doc.job.equals(jobDoc._id));
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
      assert.equal(doc.statusHistory.length, 1);
      assert.deepEqual(
        { ...doc.statusHistory[0], _id: undefined, changedAt: undefined },
        { _id: undefined, changedAt: undefined, from: null, to: "submitted", changedBy: null, changedByName: null, note: "Application submitted via website", candidateNotified: false }
      );

      assert.equal(doc.documents.length, 2);
      assert.deepEqual(
        doc.documents.map((document) => document.kind),
        ["cv", "supporting"]
      );
      for (const document of doc.documents) {
        assert.equal(document.key, `applications/${id}/${document._id.toHexString()}.pdf`);
        assert.ok(await objectExists(document.key));
      }
      for (const uploadId of [input.uploads.cv, ...input.uploads.supporting]) {
        assert.equal(await objectExists(`incoming/${uploadId}.pdf`), false);
      }

      const emails = await EmailOutboxModel.find({ "related.entityType": "application", "related.entityId": id }).sort({ template: 1 }).lean();
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
      assert.equal((await loadApplication(id)).jobTitle, localJob.title);
    });

    it("rejects a duplicate (case-insensitive email) before claiming the new uploads", async () => {
      const first = await submit();
      const cv = await uploadDocument("application", "cv");
      const duplicate = applicationSubmission(job.id, { cv }, { email: first.input.email.toUpperCase() });
      const err = await expectAppError(submitApplication(duplicate, { ip: "198.51.100.23" }), 409, "duplicate_application");
      assert.equal(err.message, "You have already applied for this role. We'll be in touch if your profile is shortlisted.");
      assert.equal((await UploadIntentModel.findById(cv).lean())?.consumedAt, null);
      assert.ok(await objectExists(`incoming/${cv}.pdf`));
      assert.equal(await ApplicationModel.countDocuments({ emailNormalized: first.input.email.toLowerCase() }), 1);

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
      await JobModel.updateOne({ slug: expired.id }, { $set: { applicationDeadline: new Date(Date.now() - 1000) } });

      for (const slug of [closed.id, draft.id, archived.id, expired.id, `missing-${uniqueSuffix()}`]) {
        const cv = await uploadDocument("application", "cv");
        const err = await expectAppError(submitApplication(applicationSubmission(slug, { cv }), { ip: "198.51.100.23" }), 404, "job_not_found");
        assert.equal(err.message, "This role is no longer accepting applications.");
        assert.equal((await UploadIntentModel.findById(cv).lean())?.consumedAt, null, slug);
      }
    });

    it("releases the claimed CV when a supporting document is invalid, so the form can be resubmitted", async () => {
      const cv = await uploadDocument("application", "cv");
      const notPdf = await uploadDocument("application", "supporting", Buffer.from("plain text ".repeat(300)));
      const input = applicationSubmission(job.id, { cv, supporting: [notPdf] });
      personalData.push(input.name, input.email, input.phone);
      await expectAppError(submitApplication(input, { ip: "198.51.100.23" }), 400, "invalid_file");
      assert.equal(await ApplicationModel.exists({ emailNormalized: input.email.toLowerCase() }), null);
      assert.equal((await UploadIntentModel.findById(cv).lean())?.consumedAt, null);

      const retried = await submitApplication({ ...input, uploads: { cv, supporting: [] } }, { ip: "198.51.100.23" });
      assert.equal((await loadApplication(retried.id)).documents.length, 1);
    });

    it("accepts only one of two simultaneous submissions for the same job and email, releasing the loser's files", async () => {
      const raceJob = await publishedJob(hr);
      const [cvA, cvB] = await Promise.all([uploadDocument("application", "cv"), uploadDocument("application", "cv")]);
      const first = applicationSubmission(raceJob.id, { cv: cvA });
      personalData.push(first.name, first.email, first.phone);
      const second = { ...first, email: first.email.toUpperCase(), uploads: { cv: cvB, supporting: [] } };
      const keysBefore = new Set(await listKeys("applications/"));

      const outcomes = await Promise.allSettled([submitApplication(first, { ip: "198.51.100.23" }), submitApplication(second, { ip: "198.51.100.23" })]);
      const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      assert.equal(fulfilled.length, 1, JSON.stringify(outcomes.map((outcome) => outcome.status)));
      assert.equal(rejected.length, 1);
      assert.ok(rejected[0].reason instanceof Error && (rejected[0].reason as { code?: string }).code === "duplicate_application", String(rejected[0].reason));

      const raceJobDoc = await JobModel.findOne({ slug: raceJob.id }).lean();
      const stored = await ApplicationModel.find({ job: raceJobDoc?._id }).lean<ApplicationDoc[]>();
      assert.equal(stored.length, 1);
      for (const document of stored[0].documents) assert.ok(await objectExists(document.key), "the winner keeps its documents");
      const newKeys = (await listKeys("applications/")).filter((key) => !keysBefore.has(key)).sort();
      assert.deepEqual(newKeys, stored[0].documents.map((document) => document.key).sort(), "copies made for the rejected submission were deleted");
    });

    it("removes copied documents when the record cannot be saved", async () => {
      const keysBefore = new Set(await listKeys("applications/"));
      const cv = await uploadDocument("application", "cv");
      // Bypasses the route validator: the schema rejects the over-long name after the upload was claimed.
      const input = applicationSubmission(job.id, { cv }, { name: `Nimal ${"Perera".repeat(30)}` });
      personalData.push(input.email, input.phone);
      await assert.rejects(submitApplication(input, { ip: "198.51.100.23" }), (err: unknown) => err instanceof Error && err.name === "ValidationError");
      const newKeys = (await listKeys("applications/")).filter((key) => !keysBefore.has(key));
      assert.deepEqual(newKeys, []);
      assert.equal(await ApplicationModel.exists({ emailNormalized: input.email.toLowerCase() }), null);
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
      assert.equal(await EmailOutboxModel.countDocuments({ "related.entityId": id, template: "application_status_update" }), 0);

      const message = `Please bring your certificates.${LF}<b>Venue:</b> Head office`;
      const invited = await changeApplicationStatus(
        id,
        { status: "interview", expectedStatus: "under_review", notifyCandidate: true, candidateMessage: message },
        hr
      );
      assert.equal(invited.statusHistory[2].candidateNotified, true);
      assert.ok(Date.parse(invited.statusChangedAt) >= Date.parse(reviewed.statusChangedAt));
      const email = await EmailOutboxModel.findOne({ "related.entityId": id, template: "application_status_update" }).lean();
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
      assert.equal(await EmailOutboxModel.countDocuments({ "related.entityId": id, template: "application_status_update" }), 0);
    });

    it("rejects an unchanged status and a stale expected status", async () => {
      const { id } = await submit();
      await expectAppError(changeApplicationStatus(id, { status: "submitted", expectedStatus: "submitted" }, hr), 400, "status_unchanged");
      await changeApplicationStatus(id, { status: "shortlisted", expectedStatus: "submitted" }, hr);
      const err = await expectAppError(changeApplicationStatus(id, { status: "rejected", expectedStatus: "submitted" }, hr), 409, "status_conflict");
      assert.equal(err.message, "This application was updated by someone else. Refresh to see the latest status.");
      const doc = await loadApplication(id);
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
      assert.equal((await loadApplication(id)).statusHistory.length, 2);
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
      await expectAppError(
        changeApplicationStatus(new Types.ObjectId().toHexString(), { status: "rejected", expectedStatus: "submitted" }, hr),
        404,
        "application_not_found"
      );
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
      assert.deepEqual(
        second.notes.map((note) => note.body),
        ["Strong GMP background; call on Monday.", "Second note"]
      );
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
      assert.equal((await loadApplication(id)).archiveReason, "Duplicate of a phone application");

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
      await ApplicationModel.collection.updateOne({ _id: new Types.ObjectId(a.id) }, { $set: { createdAt: new Date("2025-01-15T10:00:00.000Z") } });

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
      assert.equal(JSON.stringify(firstPage).includes("applications/"), false, "no storage keys in list items");

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
    it("returns the detail DTO without storage keys and audits the view", async () => {
      const { id } = await submit(job.id, {}, 1);
      const detail = await getApplicationDetail(id, hr);
      assert.equal(detail.documents.length, 2);
      for (const document of detail.documents) {
        assert.equal(document.downloadUrl, `/api/admin/documents/${document.id}`);
      }
      const json = JSON.stringify(detail);
      assert.equal(json.includes(`applications/${id}/`), false);
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

      const entry = await TalentPoolEntryModel.findById(result.talentPoolEntryId).lean();
      assert.ok(entry);
      assert.equal(entry.source, "application");
      assert.ok(entry.sourceApplication?.equals(id));
      assert.deepEqual(entry.applications.map(String), [id]);
      assert.equal(entry.emailNormalized, input.email.toLowerCase());
      assert.equal(entry.areaOfInterest, "Quality Assurance");
      assert.deepEqual(entry.tags, ["gmp", "qa"]);
      assert.equal(entry.consentGiven, true);
      assert.equal(entry.candidateNotes, "");
      assert.deepEqual(
        entry.notes.map((note) => [note.body, note.authorName]),
        [["Great fit for future QA roles", "Hiruni Recruiter"]]
      );
      assert.deepEqual(
        entry.activity.map((activity) => activity.action),
        ["created"]
      );
      assert.ok(entry.activity[0].detail.includes(reference));

      const application = await loadApplication(id);
      assert.ok(application.talentPoolEntry?.equals(result.talentPoolEntryId));
      assert.equal(entry.documents.length, application.documents.length);
      for (const [index, document] of entry.documents.entries()) {
        const original = application.documents[index];
        assert.equal(document._id.equals(original._id), false);
        assert.equal(document.key, `talent-pool/${result.talentPoolEntryId}/${document._id.toHexString()}.pdf`);
        assert.ok(await objectExists(document.key));
        assert.ok(await objectExists(original.key));
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

      const entry = await TalentPoolEntryModel.findById(first.talentPoolEntryId).lean();
      assert.ok(entry);
      assert.deepEqual(entry.tags, ["qa", "qc"]);
      assert.equal(entry.notes.length, 1);
      assert.equal(entry.documents.length, 1);
      assert.deepEqual(
        entry.activity.map((activity) => activity.action),
        ["created", "tags_changed"]
      );
      assert.equal(await TalentPoolEntryModel.countDocuments({ emailNormalized: entry.emailNormalized }), 1);
    });

    it("creates a single profile when the move is requested twice at the same time", async () => {
      const { id } = await submit(job.id, {}, 1);
      const keysBefore = new Set(await listKeys("talent-pool/"));
      const results = await Promise.all([
        moveApplicationToTalentPool(id, { tags: ["qa"], note: "" }, hr),
        moveApplicationToTalentPool(id, { tags: ["qa"], note: "" }, hr),
      ]);
      assert.equal(results[0].talentPoolEntryId, results[1].talentPoolEntryId);
      assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
      const application = await loadApplication(id);
      assert.equal(await TalentPoolEntryModel.countDocuments({ emailNormalized: application.emailNormalized }), 1);
      const entry = await TalentPoolEntryModel.findById(results[0].talentPoolEntryId).lean();
      const newKeys = (await listKeys("talent-pool/")).filter((key) => !keysBefore.has(key)).sort();
      assert.deepEqual(newKeys, (entry?.documents ?? []).map((document) => document.key).sort(), "copies made by the losing request were deleted");
    });

    it("links an existing talent profile with the same email instead of creating one", async () => {
      const talentCv = await uploadDocument("talent_pool", "cv");
      const talentInput = talentSubmission({ cv: talentCv });
      personalData.push(talentInput.name, talentInput.email, talentInput.phone);
      const talent = await submitTalentProfile(talentInput, { ip: "198.51.100.23" });
      const { id } = await submit(job.id, { email: talentInput.email.toUpperCase() });

      const result = await moveApplicationToTalentPool(id, { tags: ["referral"], note: "Linked from application" }, hr);
      assert.deepEqual(result, { talentPoolEntryId: talent.id, created: false });
      const entry = await TalentPoolEntryModel.findById(talent.id).lean();
      assert.ok(entry);
      assert.deepEqual(entry.applications.map(String), [id]);
      assert.equal(entry.documents.length, 1, "documents are not copied into an existing profile");
      assert.deepEqual(entry.tags, ["referral"]);
      assert.deepEqual(
        entry.activity.map((activity) => activity.action),
        ["created", "application_linked", "tags_changed"]
      );
      assert.deepEqual(entry.notes.map((note) => note.body), ["Linked from application"]);
      assert.ok((await loadApplication(id)).talentPoolEntry?.equals(talent.id));
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
      assert.ok(await ApplicationModel.exists({ _id: id }));
    });

    it("erases documents, related emails and talent links, then the record", async () => {
      const admin = await adminContext("admin", "Asela Administrator");
      const { id, reference } = await submit(job.id, {}, 1);
      const other = await submit();
      const moved = await moveApplicationToTalentPool(id, { tags: [], note: "" }, hr);
      await changeApplicationStatus(id, { status: "rejected", expectedStatus: "submitted", notifyCandidate: true }, hr);
      const documents = (await loadApplication(id)).documents;
      assert.equal(await EmailOutboxModel.countDocuments({ "related.entityType": "application", "related.entityId": id }), 3);

      await setApplicationArchived(id, true, "Erasure request", hr);
      await purgeApplication(id, admin);

      assert.equal(await ApplicationModel.exists({ _id: id }), null);
      for (const document of documents) assert.equal(await objectExists(document.key), false, document.key);
      assert.equal(await EmailOutboxModel.countDocuments({ "related.entityType": "application", "related.entityId": id }), 0);
      assert.equal(await EmailOutboxModel.countDocuments({ "related.entityType": "application", "related.entityId": other.id }), 2, "other records keep their emails");

      const entry = await TalentPoolEntryModel.findById(moved.talentPoolEntryId).lean();
      assert.ok(entry, "the talent profile itself is kept");
      assert.deepEqual(entry.applications, []);
      assert.equal(entry.sourceApplication, null);
      assert.equal(entry.activity.at(-1)?.action, "application_deleted");
      assert.ok(entry.documents.every((document) => document.key.startsWith(`talent-pool/${moved.talentPoolEntryId}/`)));
      for (const document of entry.documents) assert.ok(await objectExists(document.key), "talent copies are independent");

      const [audit] = await auditEntries({ action: "application.purge", entityId: id });
      assert.ok(audit.actor?.user.equals(admin.userId));
      assert.equal(audit.meta.reference, reference);
      assert.equal(audit.meta.jobSlug, job.id);
    });

    it("keeps a migrated (legacy) file while another record still references its key", async () => {
      const legacyKey = `cvs/1700000000-shared ${uniqueSuffix()}.pdf`;
      await putObject(legacyKey, pdfBytes(1024));
      const legacyDocument = () => ({
        _id: new Types.ObjectId(),
        kind: "cv" as const,
        key: legacyKey,
        originalName: "shared.pdf",
        size: null,
        contentType: "application/pdf",
        uploadedAt: new Date("2024-01-01T00:00:00.000Z"),
        legacy: true,
      });
      const first = await submit();
      const second = await submit();
      // Replace the uploaded CVs with the same migrated file, as merged legacy records can share one.
      await ApplicationModel.updateOne({ _id: first.id }, { $set: { documents: [legacyDocument()] } });
      await ApplicationModel.updateOne({ _id: second.id }, { $set: { documents: [legacyDocument()] } });

      await setApplicationArchived(first.id, true, "", hr);
      await purgeApplication(first.id, hr);
      assert.equal(await ApplicationModel.exists({ _id: first.id }), null);
      assert.ok(await objectExists(legacyKey), "the other record still needs the file");
      const [audit] = await auditEntries({ action: "application.purge", entityId: first.id });
      assert.equal(audit.meta.keptSharedDocuments, 1);

      await setApplicationArchived(second.id, true, "", hr);
      await purgeApplication(second.id, hr);
      assert.equal(await objectExists(legacyKey), false, "the last reference removes the file");
    });

    it("keeps the record and reports 502 when stored documents cannot be deleted", async () => {
      const { id } = await submit();
      const key = `applications/${id}/${new Types.ObjectId().toHexString()}.pdf`;
      await putObject(key, pdfBytes(1024));
      await ApplicationModel.updateOne(
        { _id: id },
        {
          $push: {
            documents: {
              _id: new Types.ObjectId(),
              kind: "supporting",
              key: "/invalid-key-that-storage-rejects.pdf",
              originalName: "broken.pdf",
              size: 10,
              contentType: "application/pdf",
              uploadedAt: new Date(),
              legacy: false,
            },
          },
        }
      );
      await setApplicationArchived(id, true, "", hr);
      await expectAppError(purgeApplication(id, hr), 502, "storage_delete_failed");
      assert.ok(await ApplicationModel.exists({ _id: id }));
      assert.equal(await EmailOutboxModel.countDocuments({ "related.entityId": id }), 2, "emails are kept until the purge succeeds");
      await expectAppError(purgeApplication(new Types.ObjectId().toHexString(), hr), 404, "application_not_found");
    });
  });
});
