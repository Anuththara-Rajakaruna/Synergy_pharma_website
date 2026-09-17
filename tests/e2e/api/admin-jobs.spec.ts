import { expect, test } from "@playwright/test";
import { api, loginAsAdmin, loginAsHr, uniqueSuffix } from "../support/api";
import type { AdminJob, AuditLogEntry, Job, Paginated } from "@/types/careers";
import { expectApiError, expectExactKeys, expectIsoDate, expectNoSensitiveData, expectStatus } from "./lib/assertions";
import { changeJobStatus, createApplication, createJob, jobPayload, retireJob, type JobInput } from "./lib/fixtures";

// Admin job management: editor validation, lifecycle transitions, deletion rules and search.

const ADMIN_JOB_KEYS = [
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
  "status",
  "createdAt",
  "closedAt",
  "archivedAt",
  "isOpen",
  "applicationCount",
  "createdByName",
  "updatedByName",
] as const;

test.describe("admin jobs API", () => {
  let admin = "";
  let hr = "";
  let hrName = "";
  const created: string[] = [];

  test.beforeAll(async () => {
    admin = await loginAsAdmin();
    hr = await loginAsHr();
    const me = await api<{ user: { name: string } }>("GET", "/api/admin/me", { cookie: hr });
    hrName = me.body.user.name;
  });

  test.afterAll(async () => {
    for (const slug of created) await retireJob(admin, slug);
  });

  async function newJob(label: string, overrides: Partial<JobInput> = {}, status: "draft" | "published" = "draft"): Promise<AdminJob> {
    const job = await createJob(hr, jobPayload(label, overrides), status);
    created.push(job.id);
    return job;
  }

  test("HR creates a draft job with normalized fields", async () => {
    const payload = jobPayload("jobs-create", {
      slug: `  E2E-API-Jobs-Create-${uniqueSuffix()}  `,
      title: "  Quality Control Analyst  ",
      responsibilities: "  Test raw materials  \n\n  Maintain   lab records \n",
      requirements: ["BSc in Chemistry", "  ", "Two years   in a lab"],
      qualifications: "",
      benefits: [],
      applicationDeadline: "2099-01-31",
    });
    const result = await api<{ job: AdminJob }>("POST", "/api/admin/jobs", { cookie: hr, json: payload });
    expectStatus(result, 201);
    const { job } = result.body;
    created.push(job.id);
    expectExactKeys(job, ADMIN_JOB_KEYS, "admin job");
    expect(job).toMatchObject({
      id: payload.slug.trim().toLowerCase(),
      title: "Quality Control Analyst",
      status: "draft",
      isOpen: false,
      applicationCount: 0,
      responsibilities: ["Test raw materials", "Maintain lab records"],
      requirements: ["BSc in Chemistry", "Two years in a lab"],
      qualifications: [],
      benefits: [],
      publishedAt: null,
      closedAt: null,
      archivedAt: null,
      createdByName: hrName,
    });
    expectIsoDate(job.applicationDeadline, "applicationDeadline");
    // A calendar deadline lasts until the end of that day in Sri Lanka (UTC+05:30).
    expect(job.applicationDeadline).toBe("2099-01-31T18:29:59.999Z");
    expectNoSensitiveData(result.body, "job create");
    expectApiError(await api("GET", `/api/jobs/${job.id}`), 404, "job_not_found");
  });

  test("rejects invalid editor payloads field by field", async () => {
    const invalid = await api("POST", "/api/admin/jobs", {
      cookie: hr,
      json: {
        slug: "Bad Slug!",
        title: "",
        department: "d".repeat(101),
        location: "",
        type: "Freelance",
        experience: "e".repeat(201),
        description: "",
        responsibilities: [],
        requirements: "",
        qualifications: [{ $gt: "" }],
        benefits: "b".repeat(501),
        applicationDeadline: "2026-02-31",
      },
    });
    expectApiError(invalid, 400, "invalid_input", {
      fields: ["slug", "title", "department", "location", "type", "experience", "description", "responsibilities", "requirements", "qualifications", "benefits", "applicationDeadline"],
    });
    const badStatus = await api("POST", "/api/admin/jobs", { cookie: hr, json: { ...jobPayload("jobs-status"), status: "archived" } });
    expectApiError(badStatus, 400, "invalid_input", { fields: ["status"] });
    const operatorSlug = await api("POST", "/api/admin/jobs", { cookie: hr, json: { ...jobPayload("jobs-op"), slug: { $ne: null } } });
    expectApiError(operatorSlug, 400, "invalid_input", { fields: ["slug"] });
    const tooMany = await api("POST", "/api/admin/jobs", {
      cookie: hr,
      json: jobPayload("jobs-many", { responsibilities: Array.from({ length: 41 }, (_, index) => `Item ${index}`) }),
    });
    expectApiError(tooMany, 400, "invalid_input", { fields: ["responsibilities"] });
    const control = await api("POST", "/api/admin/jobs", { cookie: hr, json: jobPayload("jobs-ctrl", { title: `Analyst${String.fromCharCode(7)}` }) });
    expectApiError(control, 400, "invalid_input", { fields: ["title"] });
  });

  test("publishing requires a future deadline", async () => {
    const past = await api("POST", "/api/admin/jobs", { cookie: hr, json: { ...jobPayload("jobs-past", { applicationDeadline: "2020-01-01" }), status: "published" } });
    expectApiError(past, 400, "publish_requirements", { fields: ["applicationDeadline"] });

    const draft = await newJob("jobs-past-draft", { applicationDeadline: "2020-01-01" });
    expectApiError(await api("POST", `/api/admin/jobs/${draft.id}/status`, { cookie: hr, json: { action: "publish" } }), 400, "publish_requirements", {
      fields: ["applicationDeadline"],
    });
  });

  test("duplicate job ids are rejected, including ids of archived and differently cased jobs", async () => {
    const job = await newJob("jobs-dup");
    const duplicate = await api("POST", "/api/admin/jobs", { cookie: hr, json: jobPayload("jobs-dup-2", { slug: job.id.toUpperCase() }) });
    expectApiError(duplicate, 409, "duplicate_slug", { fields: ["slug"] });
    await changeJobStatus(hr, job.id, "archive");
    expectApiError(await api("POST", "/api/admin/jobs", { cookie: hr, json: jobPayload("jobs-dup-3", { slug: job.id }) }), 409, "duplicate_slug");
  });

  test("walks the whole lifecycle with the right timestamps and public visibility", async () => {
    const job = await newJob("jobs-lifecycle");
    const published = await changeJobStatus(hr, job.id, "publish");
    expect(published).toMatchObject({ status: "published", isOpen: true, closedAt: null });
    expectIsoDate(published.publishedAt, "publishedAt");
    expectStatus(await api<Job>("GET", `/api/jobs/${job.id}`), 200);

    const closed = await changeJobStatus(hr, job.id, "close");
    expect(closed).toMatchObject({ status: "closed", isOpen: false, publishedAt: published.publishedAt });
    expectIsoDate(closed.closedAt, "closedAt");
    expectApiError(await api("GET", `/api/jobs/${job.id}`), 404, "job_not_found");

    const reopened = await changeJobStatus(hr, job.id, "reopen");
    expect(reopened).toMatchObject({ status: "published", isOpen: true, closedAt: null, publishedAt: published.publishedAt });

    const unpublished = await changeJobStatus(hr, job.id, "unpublish");
    expect(unpublished).toMatchObject({ status: "draft", isOpen: false });
    expectApiError(await api("GET", `/api/jobs/${job.id}`), 404, "job_not_found");

    const archived = await changeJobStatus(hr, job.id, "archive");
    expect(archived.status).toBe("archived");
    expectIsoDate(archived.archivedAt, "archivedAt");

    const restored = await changeJobStatus(hr, job.id, "restore");
    expect(restored).toMatchObject({ status: "draft", archivedAt: null });

    const audit = await api<Paginated<AuditLogEntry>>("GET", `/api/admin/audit?entityType=job&entityId=${job.id}&limit=50`, { cookie: admin });
    const actions = audit.body.items.map((entry) => entry.action);
    for (const action of ["job.create", "job.publish", "job.close", "job.reopen", "job.unpublish", "job.archive", "job.restore"]) {
      expect(actions, action).toContain(action);
    }
  });

  test("invalid transitions are 409 and unknown actions are 400", async () => {
    const draft = await newJob("jobs-transitions");
    for (const action of ["close", "reopen", "restore", "unpublish"]) {
      expectApiError(await api("POST", `/api/admin/jobs/${draft.id}/status`, { cookie: hr, json: { action } }), 409, "invalid_transition");
    }
    await changeJobStatus(hr, draft.id, "publish");
    for (const action of ["publish", "reopen", "restore"]) {
      expectApiError(await api("POST", `/api/admin/jobs/${draft.id}/status`, { cookie: hr, json: { action } }), 409, "invalid_transition");
    }
    for (const action of ["delete", "PUBLISH", "", { $in: ["publish"] }, null]) {
      expectApiError(await api("POST", `/api/admin/jobs/${draft.id}/status`, { cookie: hr, json: { action } }), 400, "invalid_input", { fields: ["action"] });
    }
    expectApiError(await api("POST", `/api/admin/jobs/missing-${uniqueSuffix()}/status`, { cookie: hr, json: { action: "publish" } }), 404, "job_not_found");
  });

  test("PATCH updates editable fields but never the id or status", async () => {
    const job = await newJob("jobs-patch", {}, "published");
    const payload = jobPayload("jobs-patch-edit", { slug: "hijacked-slug", title: "Senior QA Analyst", location: "Kandy", applicationDeadline: "2099-06-30" });
    const result = await api<{ job: AdminJob }>("PATCH", `/api/admin/jobs/${job.id}`, { cookie: hr, json: { ...payload, status: "archived" } });
    expectStatus(result, 200);
    expect(result.body.job).toMatchObject({ id: job.id, title: "Senior QA Analyst", location: "Kandy", status: "published", updatedByName: hrName });
    expectApiError(await api("GET", "/api/admin/jobs/hijacked-slug", { cookie: hr }), 404, "job_not_found");

    const invalid = await api("PATCH", `/api/admin/jobs/${job.id}`, { cookie: hr, json: { ...payload, title: { $set: "x" } } });
    expectApiError(invalid, 400, "invalid_input", { fields: ["title"] });
    const unpublishable = await api("PATCH", `/api/admin/jobs/${job.id}`, { cookie: hr, json: { ...payload, applicationDeadline: "2020-01-01" } });
    expectApiError(unpublishable, 400, "publish_requirements", { fields: ["applicationDeadline"] });
    expectApiError(await api("PATCH", `/api/admin/jobs/missing-${uniqueSuffix()}`, { cookie: hr, json: payload }), 404, "job_not_found");
    const fresh = await api<{ job: AdminJob }>("GET", `/api/admin/jobs/${job.id}`, { cookie: hr });
    expect(fresh.body.job.applicationDeadline).toBe("2099-06-30T18:29:59.999Z");
  });

  test("editing a published job so it can no longer be published is rejected and changes nothing", async () => {
    // Requirements are mandatory for every job (drafts included), so removing them fails input
    // validation; a past deadline, which drafts may have, fails with publish_requirements (above).
    const job = await newJob("jobs-unpublishable", {}, "published");
    const edit = jobPayload("jobs-unpublishable-edit", { title: job.title, requirements: [] });
    const result = await api("PATCH", `/api/admin/jobs/${job.id}`, { cookie: hr, json: edit });
    expectApiError(result, 400, "invalid_input", { fields: ["requirements"] });
    const current = await api<{ job: AdminJob }>("GET", `/api/admin/jobs/${job.id}`, { cookie: hr });
    expect(current.body.job.requirements.length).toBeGreaterThan(0);
  });

  test("only draft or archived jobs without applications can be deleted", async () => {
    const draft = await newJob("jobs-delete");
    const deleted = await api("DELETE", `/api/admin/jobs/${draft.id}`, { cookie: hr });
    expectStatus(deleted, 200);
    expect(deleted.body).toEqual({ success: true });
    expectApiError(await api("GET", `/api/admin/jobs/${draft.id}`, { cookie: hr }), 404, "job_not_found");
    expectApiError(await api("DELETE", `/api/admin/jobs/${draft.id}`, { cookie: hr }), 404, "job_not_found");

    const published = await newJob("jobs-delete-published", {}, "published");
    expectApiError(await api("DELETE", `/api/admin/jobs/${published.id}`, { cookie: hr }), 409, "job_not_deletable", {
      message: "Only draft or archived jobs can be deleted.",
    });
    await createApplication(admin, published.id, "jobs-delete-app");
    const unpublished = await changeJobStatus(hr, published.id, "unpublish");
    expect(unpublished.applicationCount).toBe(1);
    expectApiError(await api("DELETE", `/api/admin/jobs/${published.id}`, { cookie: hr }), 409, "job_has_applications");
    await changeJobStatus(hr, published.id, "archive");
    expectApiError(await api("DELETE", `/api/admin/jobs/${published.id}`, { cookie: hr }), 409, "job_has_applications");
  });

  test("lists jobs by status filter and search without regex or operator injection", async () => {
    const marker = uniqueSuffix();
    const draft = await newJob("jobs-list-draft", { title: `Warehouse (Night) Lead ${marker}` });
    const published = await newJob("jobs-list-open", { title: `Warehouse Planner ${marker}`, department: "Warehouse" }, "published");
    const archivedJob = await newJob("jobs-list-archived", { title: `Warehouse Archive ${marker}` });
    await changeJobStatus(hr, archivedJob.id, "archive");

    const list = async (query: string) => {
      const result = await api<{ items: AdminJob[] }>("GET", `/api/admin/jobs?${query}`, { cookie: hr });
      expectStatus(result, 200);
      return result.body.items.map((job) => job.id);
    };
    const active = await list(`q=${marker}`);
    expect(active).toEqual(expect.arrayContaining([draft.id, published.id]));
    expect(active).not.toContain(archivedJob.id);
    expect(await list(`q=${marker}&status=all`)).toEqual(expect.arrayContaining([draft.id, published.id, archivedJob.id]));
    expect(await list(`q=${marker}&status=archived`)).toEqual([archivedJob.id]);
    expect(await list(`q=${marker}&status=published&department=Warehouse`)).toEqual([published.id]);
    expect(await list(`q=${encodeURIComponent(`(Night) Lead ${marker}`)}`)).toEqual([draft.id]);
    expect(await list(`q=${encodeURIComponent(`Warehouse.*${marker}`)}`)).toEqual([]);
    expect(await list(`q=${encodeURIComponent(`[${marker}`)}`)).toEqual([]);
    expect(await list(`q[$ne]=x&status=all`)).toEqual(expect.arrayContaining([draft.id, published.id, archivedJob.id]));

    for (const status of ["deleted", "ALL", "$ne"]) {
      expectApiError(await api("GET", `/api/admin/jobs?status=${status}`, { cookie: hr }), 400, "invalid_input", { fields: ["status"] });
    }
    const detail = await api<{ job: AdminJob }>("GET", `/api/admin/jobs/${published.id}`, { cookie: hr });
    expectStatus(detail, 200);
    expectExactKeys(detail.body, ["job"], "job detail");
    expectExactKeys(detail.body.job, ADMIN_JOB_KEYS, "admin job");
    for (const id of ["UPPER", "a", "%24ne", "..%2F..%2Fusers", "x".repeat(150)]) {
      expectApiError(await api("GET", `/api/admin/jobs/${id}`, { cookie: hr }), 404, "job_not_found");
    }
  });
});
