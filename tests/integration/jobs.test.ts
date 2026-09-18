import "./support/env";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AdminContext } from "@/lib/auth/session";
import {
  changeJobStatus,
  createJob,
  deleteJob,
  getAdminJob,
  getJobDocumentBySlug,
  getOpenJob,
  getOpenJobDocument,
  listAdminJobs,
  listOpenJobs,
  listRelatedOpenJobs,
  openJobFilter,
  updateJob,
} from "@/lib/careers/server/jobs";
import { newId } from "@/lib/careers/server/ids";
import type { ApplicationRecord, JobRecord } from "@/lib/careers/server/records";
import type { JobStatusAction } from "@/lib/careers/constants";
import { encodeDate } from "@/lib/sheets-db/codec";
import { updateRecord } from "@/lib/sheets-db";
import { insertApplication as insertApplicationRow, listAllApplications } from "@/lib/sheets-db/repositories/applications";
import { findJobById, listAllJobs, patchJob } from "@/lib/sheets-db/repositories/jobs";
import { suiteSkip } from "./support/env";
import { adminContext, auditEntries, expectAppError, jobInput, publishedJob, uniqueSuffix } from "./support/fixtures";
import { startIntegration, type Integration } from "./support/harness";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

async function jobBySlug(slug: string): Promise<JobRecord> {
  const job = await getJobDocumentBySlug(slug);
  assert.ok(job, `job ${slug} not found`);
  return job;
}

// Writes an application row straight to the tab, for the states the service cannot produce on
// demand (an application on an archived job, an already-archived application).
async function insertApplication(slug: string, overrides: { archivedAt?: Date | null } = {}): Promise<string> {
  const job = await jobBySlug(slug);
  const now = new Date();
  const suffix = uniqueSuffix();
  const record: ApplicationRecord = {
    id: newId(now),
    job: job.id,
    jobSlug: job.slug,
    jobTitle: job.title,
    department: job.department,
    name: "Saman Perera",
    email: `saman.${suffix}@example.com`,
    emailNormalized: `saman.${suffix}@example.com`,
    phone: "0771234567",
    coverLetter: "",
    linkedIn: null,
    portfolio: null,
    consentGiven: true,
    consentAt: now,
    documents: [],
    status: "submitted",
    statusChangedAt: now,
    statusHistory: [],
    notes: [],
    source: "website",
    talentPoolEntry: null,
    archivedAt: overrides.archivedAt ?? null,
    archivedBy: null,
    archivedByName: null,
    archiveReason: "",
    supersededBy: null,
    createdAt: now,
    updatedAt: now,
  };
  await insertApplicationRow(record);
  return record.id;
}

// createdAt is not patchable through the repository (a job's creation date is immutable), so
// ageing a row for a sort test writes the cell directly.
async function setJobCreatedAt(slug: string, createdAt: Date): Promise<void> {
  const job = await jobBySlug(slug);
  await updateRecord("Jobs", job.id, { createdAt: encodeDate(createdAt) });
}

describe("jobs service", { timeout: 300_000, skip: suiteSkip() }, () => {
  let integration: Integration;
  let ctx: AdminContext;

  before(async () => {
    integration = await startIntegration();
    ctx = await adminContext("hr", "Hiruni Recruiter");
  });

  after(async () => {
    await integration.stop();
  });

  describe("createJob", () => {
    it("creates a draft that is not publicly visible", async () => {
      const input = jobInput();
      const job = await createJob(input, "draft", ctx);
      assert.equal(job.id, input.slug);
      assert.equal(job.status, "draft");
      assert.equal(job.publishedAt, null);
      assert.equal(job.isOpen, false);
      assert.equal(job.applicationCount, 0);
      assert.equal(job.createdByName, "Hiruni Recruiter");
      assert.equal(await getOpenJob(input.slug), null);

      const [audit] = await auditEntries({ action: "job.create", entityId: input.slug });
      assert.ok(audit);
      assert.equal(audit.actor?.name, "Hiruni Recruiter");
      assert.equal(audit.ip, "203.0.113.10");
    });

    it("stores the job as one row whose id is separate from its slug", async () => {
      const input = jobInput();
      await createJob(input, "draft", ctx);
      const record = await jobBySlug(input.slug);
      assert.match(record.id, /^[a-f0-9]{24}$/, "rows are addressed by id, the slug stays the public identifier");
      assert.equal(record.slug, input.slug);
      assert.deepEqual(record.responsibilities, input.responsibilities, "list fields round-trip through one cell each");
      assert.equal(record.origin, "admin");
      assert.equal((await listAllJobs({ maxAgeMs: 0 })).filter((job) => job.slug === input.slug).length, 1);
    });

    it("publishes immediately when requested and the job meets the requirements", async () => {
      const before = Date.now();
      const job = await publishedJob(ctx);
      assert.equal(job.status, "published");
      assert.equal(job.isOpen, true);
      assert.ok(job.publishedAt && Date.parse(job.publishedAt) >= before - 1000);
      const open = await getOpenJob(job.id);
      assert.equal(open?.id, job.id);
      assert.equal((open as Record<string, unknown> | null)?.status, undefined, "public DTO has no admin fields");
    });

    it("rejects publishing without responsibilities, requirements or with a past deadline", async () => {
      const err = await expectAppError(
        createJob(jobInput({ responsibilities: [], requirements: [], applicationDeadline: new Date(Date.now() - DAY) }), "published", ctx),
        400,
        "publish_requirements"
      );
      assert.deepEqual(Object.keys(err.fields ?? {}).sort(), ["applicationDeadline", "requirements", "responsibilities"]);
    });

    it("rejects duplicate slugs with 409 duplicate_slug", async () => {
      const input = jobInput();
      await createJob(input, "draft", ctx);
      const err = await expectAppError(createJob({ ...input, title: "Another title" }, "draft", ctx), 409, "duplicate_slug");
      assert.ok(err.fields?.slug);
      assert.equal((await listAllJobs({ maxAgeMs: 0 })).filter((job) => job.slug === input.slug).length, 1, "no second row was appended");
    });

    it("rejects invalid slugs before touching the store", async () => {
      await expectAppError(createJob(jobInput({ slug: "Not A Slug" }), "draft", ctx), 400, "invalid_input");
    });
  });

  describe("status lifecycle", () => {
    it("walks through publish, close, reopen, unpublish, archive and restore", async () => {
      const draft = await createJob(jobInput(), "draft", ctx);
      const slug = draft.id;

      const published = await changeJobStatus(slug, "publish", ctx);
      assert.equal(published.status, "published");
      assert.ok(published.publishedAt);
      assert.equal(published.isOpen, true);

      const closed = await changeJobStatus(slug, "close", ctx);
      assert.equal(closed.status, "closed");
      assert.ok(closed.closedAt);
      assert.equal(closed.isOpen, false);
      assert.equal(await getOpenJob(slug), null);

      const reopened = await changeJobStatus(slug, "reopen", ctx);
      assert.equal(reopened.status, "published");
      assert.equal(reopened.publishedAt, published.publishedAt, "reopen keeps the original publication date");
      assert.equal(reopened.closedAt, null);
      assert.equal((await getOpenJob(slug))?.id, slug);

      const unpublished = await changeJobStatus(slug, "unpublish", ctx);
      assert.equal(unpublished.status, "draft");
      assert.equal(await getOpenJob(slug), null);

      const archived = await changeJobStatus(slug, "archive", ctx);
      assert.equal(archived.status, "archived");
      assert.ok(archived.archivedAt);

      const restored = await changeJobStatus(slug, "restore", ctx);
      assert.equal(restored.status, "draft");
      assert.equal(restored.archivedAt, null);

      const republished = await changeJobStatus(slug, "publish", ctx);
      assert.ok(republished.publishedAt && republished.publishedAt >= published.publishedAt!, "publishing from draft sets a new publication date");

      const actions = (await auditEntries({ entityId: slug })).map((entry) => entry.action);
      assert.deepEqual(actions, ["job.create", "job.publish", "job.close", "job.reopen", "job.unpublish", "job.archive", "job.restore", "job.publish"]);
      const archiveAudit = (await auditEntries({ action: "job.archive", entityId: slug }))[0];
      assert.deepEqual({ from: archiveAudit.meta.from, to: archiveAudit.meta.to }, { from: "draft", to: "archived" });
    });

    it("rejects transitions that are not allowed from the current status with 409 invalid_transition", async () => {
      const job = await publishedJob(ctx);
      const draft = await createJob(jobInput(), "draft", ctx);
      const invalid: [string, JobStatusAction][] = [
        [job.id, "publish"],
        [job.id, "reopen"],
        [job.id, "restore"],
        [draft.id, "close"],
        [draft.id, "reopen"],
        [draft.id, "unpublish"],
        [draft.id, "restore"],
      ];
      for (const [slug, action] of invalid) {
        await expectAppError(changeJobStatus(slug, action, ctx), 409, "invalid_transition");
      }
      await changeJobStatus(draft.id, "archive", ctx);
      for (const action of ["publish", "unpublish", "close", "reopen", "archive"] as const) {
        await expectAppError(changeJobStatus(draft.id, action, ctx), 409, "invalid_transition");
      }
      assert.equal((await getAdminJob(job.id))?.status, "published");
    });

    it("rejects unknown actions and unknown jobs", async () => {
      const job = await publishedJob(ctx);
      await expectAppError(changeJobStatus(job.id, "delete" as JobStatusAction, ctx), 400, "invalid_input");
      await expectAppError(changeJobStatus(`missing-${uniqueSuffix()}`, "close", ctx), 404, "job_not_found");
    });

    it("enforces publish requirements when publishing a draft", async () => {
      const draft = await createJob(jobInput({ responsibilities: [], requirements: [] }), "draft", ctx);
      const err = await expectAppError(changeJobStatus(draft.id, "publish", ctx), 400, "publish_requirements");
      assert.ok(err.fields?.responsibilities && err.fields?.requirements);
      assert.equal((await getAdminJob(draft.id))?.status, "draft");

      const expired = await createJob(jobInput({ applicationDeadline: new Date(Date.now() - MINUTE) }), "draft", ctx);
      const deadlineErr = await expectAppError(changeJobStatus(expired.id, "publish", ctx), 400, "publish_requirements");
      assert.deepEqual(Object.keys(deadlineErr.fields ?? {}), ["applicationDeadline"]);
    });

    it("enforces publish requirements when reopening a closed job whose deadline has passed", async () => {
      const job = await publishedJob(ctx, { applicationDeadline: new Date(Date.now() + DAY) });
      await changeJobStatus(job.id, "close", ctx);
      await patchJob((await jobBySlug(job.id)).id, { applicationDeadline: new Date(Date.now() - DAY) });
      await expectAppError(changeJobStatus(job.id, "reopen", ctx), 400, "publish_requirements");
      assert.equal((await getAdminJob(job.id))?.status, "closed");
    });
  });

  describe("updateJob", () => {
    it("updates editable fields, never the status, and audits the changed fields", async () => {
      const job = await publishedJob(ctx);
      const input = jobInput({ slug: "ignored-on-update", title: "Senior QA Executive", location: "Kandy", requirements: ["BSc", "3 years GMP"] });
      const updated = await updateJob(job.id, input, ctx);
      assert.equal(updated.id, job.id, "slug is immutable");
      assert.equal(updated.status, "published");
      assert.equal(updated.title, "Senior QA Executive");
      assert.deepEqual(updated.requirements, ["BSc", "3 years GMP"]);
      const [audit] = await auditEntries({ action: "job.update", entityId: job.id });
      assert.ok(Array.isArray(audit.meta.changedFields));
      assert.ok((audit.meta.changedFields as string[]).includes("title"));
      assert.ok((audit.meta.changedFields as string[]).includes("location"));
      assert.equal((await jobBySlug(job.id)).slug, job.id, "the slug cell is never rewritten");
    });

    it("does not write or audit when nothing changed", async () => {
      const input = jobInput();
      const job = await createJob(input, "draft", ctx);
      const before = await jobBySlug(job.id);
      await updateJob(job.id, input, ctx);
      assert.equal((await auditEntries({ action: "job.update", entityId: job.id })).length, 0);
      assert.deepEqual((await jobBySlug(job.id)).updatedAt, before.updatedAt, "the row was not touched at all");
    });

    it("keeps published jobs publishable", async () => {
      const job = await publishedJob(ctx);
      await expectAppError(updateJob(job.id, jobInput({ requirements: [] }), ctx), 400, "publish_requirements");
      await expectAppError(updateJob(job.id, jobInput({ applicationDeadline: new Date(Date.now() - DAY) }), ctx), 400, "publish_requirements");
      assert.equal((await getAdminJob(job.id))?.requirements.length, 1);
    });

    it("allows drafts to be saved without lists", async () => {
      const job = await createJob(jobInput(), "draft", ctx);
      const updated = await updateJob(job.id, jobInput({ responsibilities: [], requirements: [] }), ctx);
      assert.deepEqual(updated.responsibilities, []);
      assert.deepEqual((await jobBySlug(job.id)).responsibilities, [], "an empty list is an empty cell");
    });

    it("returns 404 for unknown jobs", async () => {
      await expectAppError(updateJob(`missing-${uniqueSuffix()}`, jobInput(), ctx), 404, "job_not_found");
    });
  });

  describe("public visibility", () => {
    it("openJobFilter includes deadlines at or after now and excludes past deadlines", async () => {
      const now = new Date(Date.now() + 10 * DAY);
      const exact = await publishedJob(ctx, { applicationDeadline: now });
      const later = await publishedJob(ctx, { applicationDeadline: new Date(now.getTime() + 1) });
      const earlier = await publishedJob(ctx, { applicationDeadline: new Date(now.getTime() + DAY) });
      await patchJob((await jobBySlug(earlier.id)).id, { applicationDeadline: new Date(now.getTime() - 1) });
      const noDeadline = await publishedJob(ctx);
      const draft = await createJob(jobInput(), "draft", ctx);

      const slugs = new Set([exact.id, later.id, earlier.id, noDeadline.id, draft.id]);
      const isOpen = openJobFilter(now);
      const matched = (await listAllJobs({ maxAgeMs: 0 })).filter((job) => slugs.has(job.slug) && isOpen(job)).map((job) => job.slug);
      assert.deepEqual([...matched].sort(), [exact.id, later.id, noDeadline.id].sort());
    });

    it("hides expired, closed, draft and archived jobs from every public query", async () => {
      const department = `Dept ${uniqueSuffix()}`;
      const open = await publishedJob(ctx, { department, applicationDeadline: new Date(Date.now() + DAY) });
      const expired = await publishedJob(ctx, { department, applicationDeadline: new Date(Date.now() + DAY) });
      await patchJob((await jobBySlug(expired.id)).id, { applicationDeadline: new Date(Date.now() - MINUTE) });
      const closed = await publishedJob(ctx, { department });
      await changeJobStatus(closed.id, "close", ctx);
      const archived = await publishedJob(ctx, { department });
      await changeJobStatus(archived.id, "archive", ctx);
      const draft = await createJob(jobInput({ department }), "draft", ctx);

      const publicSlugs = (await listOpenJobs()).map((job) => job.id);
      assert.ok(publicSlugs.includes(open.id));
      for (const hidden of [expired, closed, archived, draft]) {
        assert.equal(publicSlugs.includes(hidden.id), false, hidden.id);
        assert.equal(await getOpenJob(hidden.id), null, hidden.id);
        assert.equal(await getOpenJobDocument(hidden.id), null, hidden.id);
      }
      assert.equal((await getAdminJob(expired.id))?.isOpen, false, "admin view reports the expired job as not open");

      const related = await listRelatedOpenJobs(department, "some-other-job");
      assert.deepEqual(related.map((job) => job.id), [open.id]);
      assert.deepEqual(await listRelatedOpenJobs(department, open.id), []);
    });

    it("returns null for malformed slugs", async () => {
      assert.equal(await getOpenJob("../../etc/passwd"), null);
      assert.equal(await getOpenJob("UPPER-CASE"), null);
      assert.equal(await getJobDocumentBySlug("x"), null);
    });

    it("sorts newest first by publication date, falling back to creation date", async () => {
      const department = `Sort ${uniqueSuffix()}`;
      const a = await publishedJob(ctx, { department });
      const b = await publishedJob(ctx, { department });
      const c = await createJob(jobInput({ department }), "draft", ctx);
      await patchJob((await jobBySlug(a.id)).id, { publishedAt: new Date(Date.now() - 1 * DAY) });
      await patchJob((await jobBySlug(b.id)).id, { publishedAt: new Date(Date.now() - 3 * DAY) });
      await setJobCreatedAt(c.id, new Date(Date.now() - 2 * DAY));

      const adminOrder = (await listAdminJobs({ department, status: "all" })).map((job) => job.id);
      assert.deepEqual(adminOrder, [a.id, c.id, b.id]);
      const publicOrder = (await listOpenJobs()).map((job) => job.id).filter((slug) => slug === a.id || slug === b.id);
      assert.deepEqual(publicOrder, [a.id, b.id]);
    });
  });

  describe("listAdminJobs", () => {
    it("filters by status, search text and department and counts every application", async () => {
      const department = `List ${uniqueSuffix()}`;
      const draft = await createJob(jobInput({ department, title: "Microbiology Analyst" }), "draft", ctx);
      const published = await publishedJob(ctx, { department, title: "Production Pharmacist" });
      const archived = await publishedJob(ctx, { department, title: "Warehouse Officer" });
      await insertApplication(archived.id);
      await insertApplication(archived.id, { archivedAt: new Date() });
      await changeJobStatus(archived.id, "archive", ctx);

      const ids = async (filters: Parameters<typeof listAdminJobs>[0]) => (await listAdminJobs({ department, ...filters })).map((job) => job.id).sort();
      assert.deepEqual(await ids({}), [draft.id, published.id].sort(), "default is active (not archived)");
      assert.deepEqual(await ids({ status: "active" }), [draft.id, published.id].sort());
      assert.deepEqual(await ids({ status: "all" }), [draft.id, published.id, archived.id].sort());
      assert.deepEqual(await ids({ status: "archived" }), [archived.id]);
      assert.deepEqual(await ids({ status: "draft" }), [draft.id]);
      assert.deepEqual(await ids({ status: "all", q: "pharmac" }), [published.id]);
      assert.deepEqual(await ids({ status: "all", q: "(.*" }), [], "search text is not a regular expression");
      assert.deepEqual(await listAdminJobs({ department: `${department}x` }), []);

      const archivedJob = (await listAdminJobs({ department, status: "archived" }))[0];
      assert.equal(archivedJob.applicationCount, 2, "archived applications are counted");
      assert.equal((await getAdminJob(archived.id))?.applicationCount, 2);
    });
  });

  describe("deleteJob", () => {
    it("removes the row of a draft without applications and audits it", async () => {
      const draft = await createJob(jobInput(), "draft", ctx);
      await deleteJob(draft.id, ctx);
      assert.equal(await getJobDocumentBySlug(draft.id), null);
      assert.equal((await listAllJobs({ maxAgeMs: 0 })).some((job) => job.slug === draft.id), false, "the row is gone, not hidden");
      const [audit] = await auditEntries({ action: "job.delete", entityId: draft.id });
      assert.ok(audit);
    });

    it("removes the row of an archived job without applications", async () => {
      const job = await publishedJob(ctx);
      await changeJobStatus(job.id, "archive", ctx);
      await deleteJob(job.id, ctx);
      assert.equal(await getJobDocumentBySlug(job.id), null);
    });

    it("keeps every other job addressable after a row is deleted", async () => {
      // Deleting a row renumbers everything below it, so the read cache is dropped. A job read
      // afterwards must still resolve, and a write to it must land on its own row.
      const keep = await createJob(jobInput({ title: "Kept Role" }), "draft", ctx);
      const remove = await createJob(jobInput(), "draft", ctx);
      const after = await createJob(jobInput({ title: "Later Role" }), "draft", ctx);
      await deleteJob(remove.id, ctx);

      assert.equal((await getAdminJob(keep.id))?.title, "Kept Role");
      assert.equal((await getAdminJob(after.id))?.title, "Later Role");
      const renamed = await updateJob(after.id, jobInput({ title: "Renamed Later Role" }), ctx);
      assert.equal(renamed.title, "Renamed Later Role");
      assert.equal((await jobBySlug(keep.id)).title, "Kept Role", "the write landed on the right row");
    });

    it("refuses to delete published or closed jobs", async () => {
      const job = await publishedJob(ctx);
      await expectAppError(deleteJob(job.id, ctx), 409, "job_not_deletable");
      await changeJobStatus(job.id, "close", ctx);
      await expectAppError(deleteJob(job.id, ctx), 409, "job_not_deletable");
      assert.ok(await getJobDocumentBySlug(job.id));
    });

    it("refuses to delete jobs with any application, including archived ones", async () => {
      const draft = await createJob(jobInput(), "draft", ctx);
      await insertApplication(draft.id, { archivedAt: new Date() });
      await expectAppError(deleteJob(draft.id, ctx), 409, "job_has_applications");

      const archived = await publishedJob(ctx);
      const applicationId = await insertApplication(archived.id);
      await changeJobStatus(archived.id, "archive", ctx);
      await expectAppError(deleteJob(archived.id, ctx), 409, "job_has_applications");
      assert.ok(await getJobDocumentBySlug(archived.id));
      assert.equal((await auditEntries({ action: "job.delete", entityId: archived.id })).length, 0);
      assert.ok((await listAllApplications({ maxAgeMs: 0 })).some((application) => application.id === applicationId));
    });

    it("returns 404 for unknown jobs", async () => {
      await expectAppError(deleteJob(`missing-${uniqueSuffix()}`, ctx), 404, "job_not_found");
      assert.equal(await findJobById(newId(), { maxAgeMs: 0 }), null);
    });
  });
});
