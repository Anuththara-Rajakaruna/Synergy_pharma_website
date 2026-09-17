import "./support/env";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Types } from "mongoose";
import type { AdminContext } from "@/lib/auth/session";
import { moveApplicationToTalentPool, submitApplication } from "@/lib/careers/server/applications";
import { changeJobStatus, createJob } from "@/lib/careers/server/jobs";
import {
  addTalentNote,
  applyTalentToJob,
  createTalentEntry,
  getTalentDetail,
  listTalent,
  listTalentTags,
  purgeTalentEntry,
  setTalentArchived,
  submitTalentProfile,
  updateTalentEntry,
} from "@/lib/careers/server/talent-pool";
import { parsePagination, type HrTalentInput, type TalentSubmission } from "@/lib/careers/validation";
import { ApplicationModel } from "@/models/application";
import { EmailOutboxModel } from "@/models/email-outbox";
import { TalentPoolEntryModel, type TalentPoolEntryDoc } from "@/models/talent-pool-entry";
import type { AdminJob } from "@/types/careers";
import { integrationConfig } from "./support/env";
import {
  adminContext,
  applicationSubmission,
  assertAuditHasNoPersonalData,
  assertNoPersonalData,
  auditEntries,
  candidate,
  expectAppError,
  jobInput,
  pdfBytes,
  publishedJob,
  talentSubmission,
  uniqueSuffix,
  uploadDocument,
} from "./support/fixtures";
import { startIntegration, type Integration } from "./support/harness";
import { objectExists } from "./support/s3";

async function loadEntry(id: string): Promise<TalentPoolEntryDoc> {
  const doc = await TalentPoolEntryModel.findById(id).lean<TalentPoolEntryDoc>();
  assert.ok(doc, `talent entry ${id} not found`);
  return doc;
}

describe("talent pool service", { timeout: 300_000 }, () => {
  let integration: Integration;
  let hr: AdminContext;
  const personalData: string[] = [];

  async function submitProfile(overrides: Partial<TalentSubmission> = {}, supportingCount = 0): Promise<{ id: string; reference: string; input: TalentSubmission }> {
    const cv = await uploadDocument("talent_pool", "cv");
    const supporting: string[] = [];
    for (let i = 0; i < supportingCount; i += 1) supporting.push(await uploadDocument("talent_pool", "supporting", pdfBytes(1800)));
    const input = talentSubmission({ cv, supporting }, overrides);
    personalData.push(input.name, input.email, input.phone, input.candidateNotes);
    const result = await submitTalentProfile(input, { ip: "198.51.100.44" });
    return { ...result, input };
  }

  function hrInput(overrides: Partial<HrTalentInput> = {}): HrTalentInput {
    const person = candidate();
    personalData.push(person.name, person.email, person.phone);
    return {
      name: person.name,
      email: person.email,
      phone: person.phone,
      areaOfInterest: "Referred by the production manager",
      tags: ["referral", "production"],
      note: "Met at the Colombo career fair.",
      consentConfirmed: true,
      uploads: null,
      ...overrides,
    };
  }

  before(async () => {
    integration = await startIntegration();
    hr = await adminContext("hr", "Hiruni Recruiter");
  });

  after(async () => {
    try {
      await assertAuditHasNoPersonalData(personalData);
      assertNoPersonalData(integration.logs(), personalData, "talent pool logs");
    } finally {
      await integration.stop();
    }
  });

  describe("submitTalentProfile", () => {
    it("stores a self-submitted profile with documents, activity, emails and an audit entry", async () => {
      const { id, reference, input } = await submitProfile({}, 1);
      assert.match(reference, /^TP-[0-9A-F]{8}$/);
      assert.equal(reference, `TP-${id.slice(-8).toUpperCase()}`);
      const entry = await loadEntry(id);
      assert.equal(entry.source, "self_submitted");
      assert.equal(entry.emailNormalized, input.email.toLowerCase());
      assert.equal(entry.candidateNotes, input.candidateNotes);
      assert.equal(entry.consentGiven, true);
      assert.ok(entry.consentAt);
      assert.deepEqual(entry.tags, []);
      assert.deepEqual(entry.notes, []);
      assert.equal(entry.createdBy, null);
      assert.deepEqual(entry.activity.map((activity) => activity.action), ["created"]);
      assert.equal(entry.documents.length, 2);
      for (const document of entry.documents) {
        assert.equal(document.key, `talent-pool/${id}/${document._id.toHexString()}.pdf`);
        assert.ok(await objectExists(document.key));
      }

      const emails = await EmailOutboxModel.find({ "related.entityType": "talent", "related.entityId": id }).sort({ template: 1 }).lean();
      assert.deepEqual(
        emails.map((email) => [email.template, email.to, email.replyTo]),
        [
          ["hr_new_talent", integrationConfig.hrEmail, input.email],
          ["talent_received", input.email, integrationConfig.hrEmail],
        ]
      );
      const [audit] = await auditEntries({ action: "talent.submit", entityId: id });
      assert.equal(audit.actor, null);
      assert.equal(audit.ip, "198.51.100.44");
    });

    it("rejects duplicates by case-insensitive email, including archived profiles", async () => {
      const first = await submitProfile();
      const cv = await uploadDocument("talent_pool", "cv");
      const err = await expectAppError(
        submitTalentProfile(talentSubmission({ cv }, { email: ` ${first.input.email.toUpperCase()} `.trim() }), { ip: "198.51.100.44" }),
        409,
        "duplicate_talent_profile"
      );
      assert.equal(err.message, "This email address is already in our talent pool. We'll contact you when a matching role opens.");
      assert.ok(await objectExists(`incoming/${cv}.pdf`), "uploads are not claimed for duplicates");

      await setTalentArchived(first.id, true, "Candidate asked us to pause contact", hr);
      await expectAppError(
        submitTalentProfile(talentSubmission({ cv }, { email: first.input.email }), { ip: "198.51.100.44" }),
        409,
        "duplicate_talent_profile"
      );
      assert.ok((await loadEntry(first.id)).archivedAt, "a public submission never restores an archived profile");
    });
  });

  describe("createTalentEntry", () => {
    it("creates an HR-added profile without documents", async () => {
      const input = hrInput();
      const detail = await createTalentEntry(input, hr);
      assert.equal(detail.source, "hr_added");
      assert.equal(detail.areaOfInterest, "Referred by the production manager");
      assert.deepEqual(detail.tags, ["referral", "production"]);
      assert.deepEqual(detail.documents, []);
      assert.deepEqual(
        detail.notes.map((note) => [note.body, note.authorName]),
        [["Met at the Colombo career fair.", "Hiruni Recruiter"]]
      );
      assert.equal(detail.consentGiven, true);
      const entry = await loadEntry(detail.id);
      assert.ok(entry.createdBy?.equals(hr.userId));
      const [audit] = await auditEntries({ action: "talent.create", entityId: detail.id });
      assert.deepEqual(audit.meta, { documentCount: 0, tagCount: 2, hasNote: true });
      assertNoPersonalData(JSON.stringify(audit), ["Met at the Colombo career fair."], "talent.create audit");
    });

    it("claims admin uploads for the profile", async () => {
      const cv = await uploadDocument("admin_talent", "cv", pdfBytes(3000), { adminUserId: hr.userId });
      const supporting = await uploadDocument("admin_talent", "supporting", pdfBytes(2000), { adminUserId: hr.userId });
      const detail = await createTalentEntry(hrInput({ uploads: { cv, supporting: [supporting] } }), hr);
      assert.deepEqual(
        detail.documents.map((document) => [document.kind, document.size]),
        [
          ["cv", 3000],
          ["supporting", 2000],
        ]
      );
      const entry = await loadEntry(detail.id);
      for (const document of entry.documents) assert.ok(document.key.startsWith(`talent-pool/${detail.id}/`));

      const publicUpload = await uploadDocument("talent_pool", "cv");
      await expectAppError(createTalentEntry(hrInput({ uploads: { cv: publicUpload, supporting: [] } }), hr), 400, "upload_expired");
    });

    it("rejects duplicate emails with a field error", async () => {
      const existing = await submitProfile();
      const err = await expectAppError(createTalentEntry(hrInput({ email: existing.input.email.toUpperCase() }), hr), 409, "duplicate_talent_profile");
      assert.deepEqual(Object.keys(err.fields ?? {}), ["email"]);
    });
  });

  describe("editing", () => {
    it("updates name, phone, area and tags with activity entries and an audit", async () => {
      const detail = await createTalentEntry(hrInput({ tags: ["qa"] }), hr);
      const updated = await updateTalentEntry(detail.id, { name: "Kamala Wickramasinghe", phone: "0112223334", tags: ["QA", "Regulatory"] }, hr);
      assert.equal(updated.name, "Kamala Wickramasinghe");
      assert.equal(updated.phone, "0112223334");
      assert.deepEqual(updated.tags, ["qa", "regulatory"]);
      assert.deepEqual(
        updated.activity.map((activity) => [activity.action, activity.detail]),
        [
          ["created", "Added by HR"],
          ["profile_updated", "Updated name, phone"],
          ["tags_changed", "Tags added regulatory"],
        ]
      );
      const [audit] = await auditEntries({ action: "talent.update", entityId: detail.id });
      assert.deepEqual(audit.meta, { fields: ["name", "phone", "tags"], tagsAdded: 1, tagsRemoved: 0 });
      assertNoPersonalData(JSON.stringify(audit), ["Kamala Wickramasinghe", "0112223334"], "talent.update audit");

      const same = await updateTalentEntry(detail.id, { name: "Kamala Wickramasinghe" }, hr);
      assert.equal(same.activity.length, 3, "no-op updates add nothing");
      await expectAppError(updateTalentEntry(detail.id, {}, hr), 400, "nothing_to_update");
      await expectAppError(updateTalentEntry(detail.id, { email: "new@example.com" } as unknown as { name?: string }, hr), 400, "nothing_to_update");
      await expectAppError(updateTalentEntry(detail.id, { name: "=cmd|calc" }, hr), 400, "invalid_input");
      assert.equal((await loadEntry(detail.id)).email, detail.email, "email is not editable");
    });

    it("adds notes and refuses edits to archived profiles", async () => {
      const detail = await createTalentEntry(hrInput({ note: "" }), hr);
      const noted = await addTalentNote(detail.id, "Called; interested in QC roles.", hr);
      assert.deepEqual(noted.notes.map((note) => note.body), ["Called; interested in QC roles."]);
      assert.equal(noted.activity.at(-1)?.action, "note_added");
      await expectAppError(addTalentNote(detail.id, "", hr), 400, "invalid_input");

      const archived = await setTalentArchived(detail.id, true, "No longer interested", hr);
      assert.ok(archived.archivedAt);
      assert.equal(archived.archiveReason, "No longer interested");
      assert.equal(archived.activity.at(-1)?.action, "archived");
      await expectAppError(updateTalentEntry(detail.id, { phone: "0779998887" }, hr), 409, "archived");
      await expectAppError(addTalentNote(detail.id, "Another note", hr), 409, "archived");

      const restored = await setTalentArchived(detail.id, false, "", hr);
      assert.equal(restored.archivedAt, null);
      assert.equal(restored.activity.at(-1)?.action, "restored");
      assert.deepEqual(
        (await auditEntries({ entityId: detail.id })).map((entry) => entry.action),
        ["talent.create", "talent.note_add", "talent.archive", "talent.restore"]
      );
      await expectAppError(updateTalentEntry(new Types.ObjectId().toHexString(), { phone: "0779998887" }, hr), 404, "talent_not_found");
    });
  });

  describe("listing", () => {
    it("filters by search, area, tag, source and archive state and lists active tags", async () => {
      const marker = `m${uniqueSuffix()}`;
      const a = await createTalentEntry(hrInput({ areaOfInterest: `Area ${marker}`, tags: [`tag-${marker}`, "shared"] }), hr);
      const b = await submitProfile({ areaOfInterest: "Microbiology", candidateNotes: `Personal note ${marker}` });
      const c = await createTalentEntry(hrInput({ areaOfInterest: `Area ${marker}`, tags: [`archived-${marker}`] }), hr);
      await setTalentArchived(c.id, true, "", hr);
      const page = parsePagination(new URLSearchParams("limit=50"));
      const ids = async (filters: Parameters<typeof listTalent>[0]) => (await listTalent(filters, page)).items.map((item) => item.id).sort();

      assert.deepEqual(await ids({ area: `Area ${marker}` }), [a.id]);
      assert.deepEqual(await ids({ area: `Area ${marker}`, archived: "include" }), [a.id, c.id].sort());
      assert.deepEqual(await ids({ area: `Area ${marker}`, archived: "only" }), [c.id]);
      assert.deepEqual(await ids({ tag: `tag-${marker}` }), [a.id]);
      assert.deepEqual(await ids({ q: marker }), [a.id], "search covers area and tags, not candidate notes");
      assert.deepEqual(await ids({ q: b.input.email.toUpperCase() }), [b.id]);
      assert.deepEqual(await ids({ q: b.reference }), [b.id]);
      assert.ok((await ids({ source: "hr_added" })).includes(a.id));
      assert.equal((await ids({ source: "self_submitted" })).includes(a.id), false);

      const tags = await listTalentTags();
      assert.ok(tags.includes(`tag-${marker}`));
      assert.equal(tags.includes(`archived-${marker}`), false);
      assert.deepEqual([...tags].sort((x, y) => x.localeCompare(y, "en")), tags);

      const detail = await getTalentDetail(a.id, hr);
      assert.equal(JSON.stringify(detail).includes("emailNormalized"), false);
      assert.equal((await auditEntries({ action: "talent.view", entityId: a.id })).length, 1);
    });
  });

  describe("applyTalentToJob", () => {
    let job: AdminJob;

    before(async () => {
      job = await publishedJob(hr);
    });

    it("creates an application from the profile with copied documents", async () => {
      const profile = await submitProfile({}, 1);
      const result = await applyTalentToJob(profile.id, { jobSlug: job.id.toUpperCase(), note: "Strong match for this role" }, hr);
      const application = await ApplicationModel.findById(result.applicationId).lean();
      assert.ok(application);
      assert.equal(application.source, "talent_pool");
      assert.equal(application.jobSlug, job.id);
      assert.equal(application.emailNormalized, profile.input.email.toLowerCase());
      assert.equal(application.coverLetter, "");
      assert.equal(application.linkedIn, null);
      assert.equal(application.status, "submitted");
      assert.ok(application.talentPoolEntry?.equals(profile.id));
      assert.equal(application.statusHistory[0].note, "Created from talent pool by Hiruni Recruiter");
      assert.ok(application.statusHistory[0].changedBy?.equals(hr.userId));
      assert.deepEqual(application.notes.map((note) => note.body), ["Strong match for this role"]);

      const entry = await loadEntry(profile.id);
      assert.deepEqual(entry.applications.map(String), [result.applicationId]);
      assert.equal(entry.activity.at(-1)?.action, "applied_to_job");
      assert.equal(application.documents.length, entry.documents.length);
      for (const [index, document] of application.documents.entries()) {
        assert.equal(document._id.equals(entry.documents[index]._id), false);
        assert.equal(document.key, `applications/${result.applicationId}/${document._id.toHexString()}.pdf`);
        assert.ok(await objectExists(document.key));
      }
      assert.equal((await auditEntries({ action: "talent.apply_to_job", entityId: profile.id })).length, 1);
      assert.equal(await EmailOutboxModel.countDocuments({ "related.entityId": result.applicationId }), 0, "HR-created applications do not email the candidate");

      const retry = await applyTalentToJob(profile.id, { jobSlug: job.id, note: "Strong match for this role" }, hr);
      assert.equal(retry.applicationId, result.applicationId, "retries converge on the same application");
      assert.equal((await auditEntries({ action: "talent.apply_to_job", entityId: profile.id })).length, 1);
    });

    it("allows draft and closed jobs but refuses archived and unknown jobs", async () => {
      const profile = await createTalentEntry(hrInput(), hr);
      const draft = await createJob(jobInput(), "draft", hr);
      const closed = await publishedJob(hr);
      await changeJobStatus(closed.id, "close", hr);
      assert.ok((await applyTalentToJob(profile.id, { jobSlug: draft.id, note: "" }, hr)).applicationId);
      assert.ok((await applyTalentToJob(profile.id, { jobSlug: closed.id, note: "" }, hr)).applicationId);

      const archived = await publishedJob(hr);
      await changeJobStatus(archived.id, "archive", hr);
      await expectAppError(applyTalentToJob(profile.id, { jobSlug: archived.id, note: "" }, hr), 409, "job_archived");
      await expectAppError(applyTalentToJob(profile.id, { jobSlug: `missing-${uniqueSuffix()}`, note: "" }, hr), 404, "job_not_found");
      await expectAppError(applyTalentToJob(profile.id, { jobSlug: "", note: "" }, hr), 400, "invalid_input");
      await expectAppError(applyTalentToJob(new Types.ObjectId().toHexString(), { jobSlug: job.id, note: "" }, hr), 404, "talent_not_found");
      assert.equal((await loadEntry(profile.id)).applications.length, 2);
    });

    it("refuses duplicates of an existing application and archived profiles", async () => {
      const profile = await submitProfile();
      const cv = await uploadDocument("application", "cv");
      await submitApplication(applicationSubmission(job.id, { cv }, { email: profile.input.email, name: profile.input.name, phone: profile.input.phone }), {
        ip: "198.51.100.44",
      });
      const err = await expectAppError(applyTalentToJob(profile.id, { jobSlug: job.id, note: "" }, hr), 409, "duplicate_application");
      assert.equal(err.message, "This candidate has already applied for this role.");

      const archivedProfile = await createTalentEntry(hrInput(), hr);
      await setTalentArchived(archivedProfile.id, true, "", hr);
      await expectAppError(applyTalentToJob(archivedProfile.id, { jobSlug: job.id, note: "" }, hr), 409, "archived");
    });
  });

  describe("purgeTalentEntry", () => {
    it("requires archiving, then deletes documents, emails and links", async () => {
      const admin = await adminContext("admin", "Asela Administrator");
      const job = await publishedJob(hr);
      const profile = await submitProfile({}, 1);
      const other = await submitProfile();
      const applied = await applyTalentToJob(profile.id, { jobSlug: job.id, note: "" }, hr);

      const cv = await uploadDocument("application", "cv");
      const input = applicationSubmission(job.id, { cv });
      personalData.push(input.name, input.email, input.phone);
      const website = await submitApplication(input, { ip: "198.51.100.44" });
      const linked = await moveApplicationToTalentPool(website.id, { tags: [], note: "" }, hr);
      assert.equal(linked.created, true);

      const entry = await loadEntry(profile.id);
      await expectAppError(purgeTalentEntry(profile.id, admin), 409, "not_archived");
      await setTalentArchived(profile.id, true, "Erasure request", hr);
      await purgeTalentEntry(profile.id, admin);

      assert.equal(await TalentPoolEntryModel.exists({ _id: profile.id }), null);
      for (const document of entry.documents) assert.equal(await objectExists(document.key), false, document.key);
      assert.equal(await EmailOutboxModel.countDocuments({ "related.entityType": "talent", "related.entityId": profile.id }), 0);
      assert.equal(await EmailOutboxModel.countDocuments({ "related.entityType": "talent", "related.entityId": other.id }), 2);

      const application = await ApplicationModel.findById(applied.applicationId).lean();
      assert.ok(application, "applications created from the profile are kept");
      assert.equal(application.talentPoolEntry, null);
      for (const document of application.documents) assert.ok(await objectExists(document.key), "application copies are independent");
      assert.ok((await ApplicationModel.findById(website.id).lean())?.talentPoolEntry?.equals(linked.talentPoolEntryId), "other links are untouched");

      const [audit] = await auditEntries({ action: "talent.purge", entityId: profile.id });
      assert.ok(audit.actor?.user.equals(admin.userId));
      assert.equal(audit.meta.reference, profile.reference);
      await expectAppError(purgeTalentEntry(profile.id, admin), 404, "talent_not_found");
    });
  });
});
