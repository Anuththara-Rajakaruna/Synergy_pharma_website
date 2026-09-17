import { expect, test } from "@playwright/test";
import { api, loginAsAdmin } from "../support/api";
import type { AdminJob, Job } from "@/types/careers";
import { expectApiError, expectExactKeys, expectIsoDate, expectNoSensitiveData, expectStatus } from "./lib/assertions";
import { databaseConfigured, withDatabase } from "./lib/database";
import { changeJobStatus, createJob, jobPayload, randomObjectId, retireJob } from "./lib/fixtures";

// Public job endpoints: only open jobs (published, deadline not passed) are ever visible.

const PUBLIC_JOB_KEYS = [
  "id",
  "title",
  "department",
  "location",
  "type",
  "experience",
  "description",
  "responsibilities",
  "requirements",
  "qualifications",
  "benefits",
  "applicationDeadline",
  "publishedAt",
  "updatedAt",
] as const;

test.describe("public jobs API", () => {
  let admin = "";
  let openJob: AdminJob;
  let deadlineJob: AdminJob;
  let draftJob: AdminJob;
  let closedJob: AdminJob;
  let archivedJob: AdminJob;
  let unpublishedJob: AdminJob;
  const created: string[] = [];

  test.beforeAll(async () => {
    admin = await loginAsAdmin();
    openJob = await createJob(admin, jobPayload("public-open"), "published");
    deadlineJob = await createJob(admin, jobPayload("public-deadline", { applicationDeadline: "2099-12-31" }), "published");
    draftJob = await createJob(admin, jobPayload("public-draft"));
    closedJob = await createJob(admin, jobPayload("public-closed"), "published");
    closedJob = await changeJobStatus(admin, closedJob.id, "close");
    archivedJob = await createJob(admin, jobPayload("public-archived"), "published");
    archivedJob = await changeJobStatus(admin, archivedJob.id, "archive");
    unpublishedJob = await createJob(admin, jobPayload("public-unpublished"), "published");
    unpublishedJob = await changeJobStatus(admin, unpublishedJob.id, "unpublish");
    created.push(openJob.id, deadlineJob.id, draftJob.id, closedJob.id, archivedJob.id, unpublishedJob.id);
  });

  test.afterAll(async () => {
    for (const slug of created) await retireJob(admin, slug);
  });

  test("GET /api/jobs lists open jobs newest first with the public shape only", async () => {
    const result = await api<Job[]>("GET", "/api/jobs");
    expectStatus(result, 200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(Array.isArray(result.body)).toBe(true);

    const slugs = result.body.map((job) => job.id);
    expect(slugs).toContain(openJob.id);
    expect(slugs).toContain(deadlineJob.id);
    for (const hidden of [draftJob, closedJob, archivedJob, unpublishedJob]) expect(slugs).not.toContain(hidden.id);

    for (const job of result.body) {
      expectExactKeys(job, PUBLIC_JOB_KEYS, `public job ${job.id}`);
      expect(job.publishedAt, `publishedAt of ${job.id}`).not.toBeNull();
      if (job.applicationDeadline) expect(new Date(job.applicationDeadline).getTime()).toBeGreaterThanOrEqual(Date.now() - 60_000);
    }
    const published = result.body.map((job) => new Date(job.publishedAt ?? 0).getTime());
    for (let index = 1; index < published.length; index += 1) {
      expect(published[index - 1], "jobs are sorted newest first").toBeGreaterThanOrEqual(published[index]);
    }
    expectNoSensitiveData(result.body, "GET /api/jobs");
  });

  test("GET /api/jobs/[id] returns one open job", async () => {
    const result = await api<Job>("GET", `/api/jobs/${deadlineJob.id}`);
    expectStatus(result, 200);
    expectExactKeys(result.body, PUBLIC_JOB_KEYS, "public job");
    expect(result.body).toMatchObject({
      id: deadlineJob.id,
      title: deadlineJob.title,
      department: "Quality Assurance",
      type: "Full-time",
      responsibilities: ["Review batch manufacturing records", "Support internal audits"],
      requirements: ["BSc in Chemistry or Pharmacy"],
    });
    expectIsoDate(result.body.applicationDeadline, "applicationDeadline");
    expectIsoDate(result.body.publishedAt, "publishedAt");
    expect(result.headers.get("cache-control")).toContain("no-store");
  });

  test("draft, closed, archived, unpublished, unknown and malformed ids all answer 404 job_not_found", async () => {
    const hiddenIds = [
      draftJob.id,
      closedJob.id,
      archivedJob.id,
      unpublishedJob.id,
      `${openJob.id}-missing`,
      randomObjectId(),
      "UPPER-Case-Slug",
      "%24ne",
      "..%2F..%2Fadmin%2Fusers",
      encodeURIComponent('{"$ne":null}'),
      "a".repeat(300),
    ];
    for (const id of hiddenIds) {
      const result = await api("GET", `/api/jobs/${id}`);
      expectApiError(result, 404, "job_not_found");
    }
  });

  test("query parameters cannot reveal unpublished jobs", async () => {
    for (const query of ["?all=1", "?status=draft", "?status[$ne]=published", "?includeDrafts=true"]) {
      const result = await api<Job[]>("GET", `/api/jobs${query}`);
      expectStatus(result, 200);
      const slugs = result.body.map((job) => job.id);
      for (const hidden of [draftJob, closedJob, archivedJob, unpublishedJob]) expect(slugs, query).not.toContain(hidden.id);
    }
  });

  test("closing a job removes it from the public API immediately", async () => {
    const job = await createJob(admin, jobPayload("public-toggle"), "published");
    created.push(job.id);
    expectStatus(await api("GET", `/api/jobs/${job.id}`), 200);
    await changeJobStatus(admin, job.id, "close");
    expectApiError(await api("GET", `/api/jobs/${job.id}`), 404, "job_not_found");
    const list = await api<Job[]>("GET", "/api/jobs");
    expect(list.body.map((item) => item.id)).not.toContain(job.id);
    await changeJobStatus(admin, job.id, "reopen");
    expectStatus(await api("GET", `/api/jobs/${job.id}`), 200);
  });

  test("a published job whose deadline has passed is hidden", async () => {
    test.skip(!databaseConfigured(), "Set E2E_MONGODB_URI and E2E_MONGODB_DB_NAME to create an expired job.");
    const job = await createJob(admin, jobPayload("public-expired"), "published");
    created.push(job.id);
    expectStatus(await api("GET", `/api/jobs/${job.id}`), 200);
    await withDatabase(async (connection) => {
      const update = await connection
        .collection("jobs")
        .updateOne({ slug: job.id }, { $set: { applicationDeadline: new Date(Date.now() - 60 * 60 * 1000) } });
      expect(update.matchedCount).toBe(1);
    });
    expectApiError(await api("GET", `/api/jobs/${job.id}`), 404, "job_not_found");
    const list = await api<Job[]>("GET", "/api/jobs");
    expect(list.body.map((item) => item.id)).not.toContain(job.id);
    const adminView = await api<{ job: AdminJob }>("GET", `/api/admin/jobs/${job.id}`, { cookie: admin });
    expect(adminView.body.job).toMatchObject({ status: "published", isOpen: false });
  });

  test("job pages and the sitemap only include open jobs", async () => {
    const page = await api("GET", `/careers/${openJob.id}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain(openJob.title);
    for (const hidden of [draftJob, closedJob, archivedJob, unpublishedJob]) {
      const result = await api("GET", `/careers/${hidden.id}`);
      expect(result.status, `/careers/${hidden.id}`).toBe(404);
      expect(result.text).not.toContain(hidden.title);
    }
    const sitemap = await api("GET", "/sitemap.xml");
    expect(sitemap.status).toBe(200);
    expect(sitemap.text).toContain(`/careers/${openJob.id}</loc>`);
    for (const hidden of [draftJob, closedJob, archivedJob, unpublishedJob]) {
      expect(sitemap.text).not.toContain(`/careers/${hidden.id}<`);
    }
    expect(sitemap.text).not.toContain("/careers/admin");
  });

  test("job text is escaped in the page and its JSON-LD", async () => {
    const payload = '</script><img src=x onerror="alert(1)">';
    const job = await createJob(
      admin,
      jobPayload("public-xss", {
        title: `Analyst ${payload}`,
        description: `Line ${payload}\n\nSecond ${String.fromCharCode(0x2028)} paragraph`,
        responsibilities: [`Duty ${payload}`],
      }),
      "published"
    );
    created.push(job.id);
    const page = await api("GET", `/careers/${job.id}`);
    expect(page.status).toBe(200);
    expect(page.text).not.toContain("<img src=x");
    expect(page.text).not.toContain('</script><img');
    const jsonLd = [...page.text.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    const posting = jsonLd.find((block) => block.includes("JobPosting"));
    expect(posting, "JobPosting JSON-LD").toBeDefined();
    const data = JSON.parse(posting ?? "{}") as { title?: string; description?: string };
    expect(data.title).toBe(job.title);
    expect(posting).not.toContain("<");
    expect(posting).not.toContain(String.fromCharCode(0x2028));
  });

  test("the public jobs API is read-only", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const collection = await api(method, "/api/jobs", { json: jobPayload("public-write") });
      expect(collection.status, `${method} /api/jobs`).toBe(405);
      const item = await api(method, `/api/jobs/${openJob.id}`, { json: { title: "Hijacked" } });
      expect(item.status, `${method} /api/jobs/[id]`).toBe(405);
    }
    const unchanged = await api<Job>("GET", `/api/jobs/${openJob.id}`);
    expect(unchanged.body.title).toBe(openJob.title);
  });

  test("routes removed in v2 no longer exist", async () => {
    for (const path of ["/api/applicants", `/api/applicants/${randomObjectId()}`, "/api/files/cvs/example.pdf", "/api/files/talent-pool/example.pdf"]) {
      const result = await api("GET", path);
      expect(result.status, path).toBe(404);
    }
  });
});
