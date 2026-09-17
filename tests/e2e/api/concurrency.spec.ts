import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { api, loginAsAdmin, loginAsHr, type ApiResult } from "../support/api";
import type { AdminJob, AuditLogEntry, MoveToTalentPoolResponse, Paginated } from "@/types/careers";
import { expectApiError, expectStatus } from "./lib/assertions";
import {
  applicationBody,
  candidate,
  createActiveUser,
  createApplication,
  createJob,
  createOpenJob,
  cvFile,
  deactivateUser,
  findApplication,
  isolatedClientIp,
  jobPayload,
  postApplication,
  retireJob,
  setApplicationArchived,
  uploadDocuments,
} from "./lib/fixtures";

// Races that the services must resolve atomically: exactly one winner, a clear 4xx for the
// losers, and never a 500 or a duplicated record.

function statuses(results: ApiResult<unknown>[]): number[] {
  return results.map((result) => result.status).sort((a, b) => a - b);
}

test.describe("concurrent requests", () => {
  let admin = "";
  let hr = "";
  let job: AdminJob;
  const jobs: string[] = [];

  test.beforeAll(async () => {
    admin = await loginAsAdmin();
    hr = await loginAsHr();
    job = await createOpenJob(admin, "race");
    jobs.push(job.id);
  });

  test.afterAll(async () => {
    for (const slug of jobs) await retireJob(admin, slug);
  });

  test("two simultaneous status changes from the same state: one wins, one gets status_conflict", async () => {
    const created = await createApplication(hr, job.id, "race-status");
    const results = await Promise.all(
      ["shortlisted", "rejected"].map((status) =>
        api("POST", `/api/admin/applications/${created.item.id}/status`, { cookie: hr, json: { status, expectedStatus: "submitted" } })
      )
    );
    expect(statuses(results)).toEqual([200, 409]);
    const loser = results.find((result) => result.status === 409);
    if (loser) expectApiError(loser, 409, "status_conflict");
    const detail = await api<{ application: { statusHistory: unknown[] } }>("GET", `/api/admin/applications/${created.item.id}`, { cookie: hr });
    expect(detail.body.application.statusHistory).toHaveLength(2);
  });

  test("simultaneous submissions for the same job and email create one application", async () => {
    const person = candidate("race-apply");
    const uploads = await Promise.all([1, 2, 3].map((index) => uploadDocuments("application", [cvFile(`race-${index}`)])));
    const results = await Promise.all(uploads.map((refs) => postApplication(applicationBody(job.id, person, refs))));
    const codes = statuses(results);
    expect(codes.filter((code) => code === 201), JSON.stringify(results.map((result) => result.text))).toHaveLength(1);
    expect(codes.every((code) => code === 201 || code === 409), JSON.stringify(results.map((result) => result.text))).toBe(true);
    for (const result of results.filter((item) => item.status === 409)) expectApiError(result, 409, "duplicate_application");
    await findApplication(admin, person.email, job.id);
  });

  test("the same upload claimed by two submissions at once is used only once", async () => {
    const shared = await uploadDocuments("application", [cvFile("shared")]);
    const results = await Promise.all(
      ["race-claim-a", "race-claim-b"].map((label) => postApplication(applicationBody(job.id, candidate(label), shared)))
    );
    expect(statuses(results), JSON.stringify(results.map((result) => result.text))).toEqual([201, 400]);
    const loser = results.find((result) => result.status === 400);
    if (loser) expectApiError(loser, 400, "upload_expired");
  });

  test("moving an application to the talent pool twice at once yields a single profile", async () => {
    const created = await createApplication(hr, job.id, "race-move");
    const results = await Promise.all(
      [1, 2, 3].map(() => api<MoveToTalentPoolResponse>("POST", `/api/admin/applications/${created.item.id}/talent-pool`, { cookie: hr, json: { tags: ["race"] } }))
    );
    for (const result of results) expectStatus(result, 200);
    const ids = new Set(results.map((result) => result.body.talentPoolEntryId));
    expect(ids.size).toBe(1);
    expect(results.filter((result) => result.body.created)).toHaveLength(1);
    const list = await api<{ total: number }>("GET", `/api/admin/talent-pool?q=${encodeURIComponent(created.person.email)}&archived=include`, { cookie: hr });
    expect(list.body.total).toBe(1);
  });

  test("simultaneous job transitions and deletes have exactly one winner", async () => {
    const draft = await createJob(hr, jobPayload("race-publish"));
    jobs.push(draft.id);
    const publishes = await Promise.all([1, 2, 3].map(() => api("POST", `/api/admin/jobs/${draft.id}/status`, { cookie: hr, json: { action: "publish" } })));
    expect(statuses(publishes)).toEqual([200, 409, 409]);

    const deletable = await createJob(hr, jobPayload("race-delete"));
    const deletes = await Promise.all([1, 2, 3].map(() => api("DELETE", `/api/admin/jobs/${deletable.id}`, { cookie: hr })));
    const codes = statuses(deletes);
    expect(codes.filter((code) => code === 200)).toHaveLength(1);
    expect(codes.every((code) => code === 200 || code === 404 || code === 409), JSON.stringify(deletes.map((result) => result.text))).toBe(true);
  });

  test("simultaneous permanent deletions of one record are erased and audited exactly once", async () => {
    const created = await createApplication(hr, job.id, "race-purge");
    await setApplicationArchived(hr, created.item.id, true);
    const results = await Promise.all([1, 2, 3].map(() => api("DELETE", `/api/admin/applications/${created.item.id}`, { cookie: admin })));
    const codes = statuses(results);
    expect(codes.every((code) => code === 200 || code === 404), JSON.stringify(results.map((result) => result.text))).toBe(true);
    expect(codes).toContain(200);
    expectApiError(await api("GET", `/api/admin/applications/${created.item.id}`, { cookie: admin }), 404, "application_not_found");
    // The erasure record in the audit log must describe what happened: one deletion, not three.
    const audit = await api<Paginated<AuditLogEntry>>("GET", `/api/admin/audit?action=application.purge&entityId=${created.item.id}`, { cookie: admin });
    expect(audit.body.items.map((entry) => entry.action), `HTTP results ${JSON.stringify(codes)}`).toEqual(["application.purge"]);
  });

  test("simultaneous permanent deletions of one talent profile are audited exactly once", async () => {
    const created = await createApplication(hr, job.id, "race-talent-purge");
    const move = await api<MoveToTalentPoolResponse>("POST", `/api/admin/applications/${created.item.id}/talent-pool`, { cookie: hr, json: {} });
    expectStatus(move, 200);
    const talentId = move.body.talentPoolEntryId;
    expectStatus(await api("POST", `/api/admin/talent-pool/${talentId}/archive`, { cookie: hr, json: { archived: true } }), 200);
    const results = await Promise.all([1, 2, 3].map(() => api("DELETE", `/api/admin/talent-pool/${talentId}`, { cookie: admin })));
    const codes = statuses(results);
    expect(codes.every((code) => code === 200 || code === 404), JSON.stringify(results.map((result) => result.text))).toBe(true);
    const audit = await api<Paginated<AuditLogEntry>>("GET", `/api/admin/audit?action=talent.purge&entityId=${talentId}`, { cookie: admin });
    expect(audit.body.items.map((entry) => entry.action), `HTTP results ${JSON.stringify(codes)}`).toEqual(["talent.purge"]);
    const application = await api<{ application: { talentPoolEntryId: string | null } }>("GET", `/api/admin/applications/${created.item.id}`, { cookie: hr });
    expect(application.body.application.talentPoolEntryId).toBeNull();
  });

  test("simultaneous creates with the same unique key produce one record and clean 409s", async () => {
    const payload = jobPayload("race-slug");
    const jobResults = await Promise.all([1, 2, 3].map(() => api("POST", "/api/admin/jobs", { cookie: hr, json: payload })));
    jobs.push(payload.slug);
    expect(statuses(jobResults), JSON.stringify(jobResults.map((result) => result.text))).toEqual([201, 409, 409]);
    for (const result of jobResults.filter((item) => item.status === 409)) expectApiError(result, 409, "duplicate_slug");

    const person = candidate("race-talent");
    const talentPayload = { name: person.name, email: person.email, phone: person.phone, areaOfInterest: "IT", tags: [], note: "", consentConfirmed: true, uploads: null };
    const talentResults = await Promise.all([1, 2, 3].map(() => api("POST", "/api/admin/talent-pool", { cookie: hr, json: talentPayload })));
    expect(statuses(talentResults), JSON.stringify(talentResults.map((result) => result.text))).toEqual([201, 409, 409]);
    for (const result of talentResults.filter((item) => item.status === 409)) expectApiError(result, 409, "duplicate_talent_profile", { fields: ["email"] });

    const userEmail = `e2e.race.${randomUUID().slice(0, 8)}@synergypharma.lk`;
    const userResults = await Promise.all(
      [1, 2, 3].map(() => api<{ user: { id: string } }>("POST", "/api/admin/users", { cookie: admin, json: { email: userEmail, name: "Race Condition", role: "hr" } }))
    );
    expect(statuses(userResults), JSON.stringify(userResults.map((result) => result.text))).toEqual([201, 409, 409]);
    for (const result of userResults.filter((item) => item.status === 409)) expectApiError(result, 409, "duplicate_email");
    const createdUser = userResults.find((result) => result.status === 201);
    if (createdUser) await deactivateUser(admin, createdUser.body.user.id);
  });

  test("considering one profile for the same job several times at once creates one application", async () => {
    const created = await createApplication(hr, job.id, "race-talent-apply");
    const move = await api<MoveToTalentPoolResponse>("POST", `/api/admin/applications/${created.item.id}/talent-pool`, { cookie: hr, json: {} });
    const target = await createOpenJob(admin, "race-talent-apply-target");
    jobs.push(target.id);
    const results = await Promise.all(
      [1, 2, 3].map(() => api<{ applicationId: string }>("POST", `/api/admin/talent-pool/${move.body.talentPoolEntryId}/apply`, { cookie: hr, json: { jobId: target.id } }))
    );
    for (const result of results) expectStatus(result, 201);
    expect(new Set(results.map((result) => result.body.applicationId)).size).toBe(1);
    const list = await api<{ total: number }>("GET", `/api/admin/applications?job=${target.id}&archived=include`, { cookie: hr });
    expect(list.body.total).toBe(1);
  });

  test("parallel wrong passwords still lock the account", async () => {
    const user = await createActiveUser(admin, "hr", "race-lockout");
    try {
      const attempts = await Promise.all(
        [1, 2, 3, 4, 5, 6, 7].map((index) => api("POST", "/api/admin/login", { json: { email: user.email, password: `Wrong-${index}-password-x` } }))
      );
      expect(attempts.every((result) => result.status === 401 || result.status === 429)).toBe(true);
      expect(attempts.some((result) => result.status === 429)).toBe(true);
      expectApiError(await api("POST", "/api/admin/login", { json: { email: user.email, password: user.password } }), 429, "account_locked");
    } finally {
      await deactivateUser(admin, user.id);
    }
  });

  test("a burst from one client cannot exceed the apply-ip limit", async () => {
    const ip = isolatedClientIp();
    const results = await Promise.all(Array.from({ length: 16 }, () => postApplication(applicationBody(job.id, candidate("race-burst"), { cv: randomUUID(), supporting: [] }), ip)));
    const allowed = results.filter((result) => result.status !== 429);
    expect(results.every((result) => result.status < 500), JSON.stringify(results.map((result) => result.status))).toBe(true);
    // Contract: never fewer than the limit, at worst slightly more.
    expect(allowed.length).toBeGreaterThanOrEqual(10);
    expect(allowed.length).toBeLessThanOrEqual(11);
  });
});
