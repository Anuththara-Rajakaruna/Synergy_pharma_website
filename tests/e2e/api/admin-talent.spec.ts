import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { api, loginAsAdmin, loginAsHr, uniqueSuffix } from "../support/api";
import type {
  AdminJob,
  AdminStats,
  AuditLogEntry,
  Paginated,
  TalentApplyResponse,
  TalentDetail,
  TalentListItem,
} from "@/types/careers";
import { expectApiError, expectExactKeys, expectIsoDate, expectNoSensitiveData, expectStatus, isRecord } from "./lib/assertions";
import {
  VALID_PHONE,
  candidate,
  changeJobStatus,
  createApplication,
  createHrTalent,
  createJob,
  createOpenJob,
  cvFile,
  getApplication,
  getTalent,
  jobPayload,
  randomObjectId,
  retireJob,
  setTalentArchived,
  submitTalent,
  supportingFile,
  uploadDocuments,
} from "./lib/fixtures";

// Talent pool management, dashboard stats and data-subject exports.

const LIST_ITEM_KEYS = [
  "id",
  "name",
  "email",
  "phone",
  "areaOfInterest",
  "tags",
  "source",
  "createdAt",
  "updatedAt",
  "archived",
  "applicationCount",
  "documentCount",
] as const;

const DETAIL_KEYS = [
  ...LIST_ITEM_KEYS,
  "candidateNotes",
  "consentGiven",
  "consentAt",
  "documents",
  "notes",
  "applications",
  "sourceApplicationId",
  "archivedAt",
  "archivedByName",
  "archiveReason",
  "activity",
] as const;

test.describe("admin talent pool API", () => {
  let admin = "";
  let hr = "";
  let hrName = "";
  let job: AdminJob;
  const jobs: string[] = [];

  test.beforeAll(async () => {
    admin = await loginAsAdmin();
    hr = await loginAsHr();
    hrName = (await api<{ user: { name: string } }>("GET", "/api/admin/me", { cookie: hr })).body.user.name;
    job = await createOpenJob(admin, "talent-admin");
    jobs.push(job.id);
  });

  test.afterAll(async () => {
    for (const slug of jobs) await retireJob(admin, slug);
  });

  function createTalent(json: Record<string, unknown>) {
    return api<{ talent: TalentDetail }>("POST", "/api/admin/talent-pool", { cookie: hr, json });
  }

  test("HR adds a candidate with documents uploaded under the admin_talent purpose", async () => {
    const person = candidate("talent-hr");
    const uploads = await uploadDocuments("admin_talent", [cvFile("hr-cv", 4500), supportingFile("hr-letter", 1500)], { cookie: hr });
    const result = await createTalent({
      name: person.name,
      email: person.email.toUpperCase(),
      phone: person.phone,
      areaOfInterest: "  Biotech research  ",
      tags: ["Senior", "senior", " HPLC "],
      note: "Met at the career fair.",
      consentConfirmed: true,
      uploads,
    });
    expectStatus(result, 201);
    expectExactKeys(result.body, ["talent"], "create body");
    const { talent } = result.body;
    expectExactKeys(talent, DETAIL_KEYS, "talent detail");
    expect(talent).toMatchObject({
      name: person.name,
      areaOfInterest: "Biotech research",
      source: "hr_added",
      consentGiven: true,
      documentCount: 2,
      applicationCount: 0,
      archived: false,
      candidateNotes: "",
    });
    expect([...talent.tags].sort()).toEqual(["hplc", "senior"]);
    expect(talent.notes).toHaveLength(1);
    expect(talent.notes[0]).toMatchObject({ body: "Met at the career fair.", authorName: hrName });
    expectIsoDate(talent.consentAt, "consentAt");
    expect(talent.documents.map((doc) => [doc.kind, doc.size])).toEqual([
      ["cv", 4500],
      ["supporting", 1500],
    ]);
    expectNoSensitiveData(result.body, "talent create");

    const duplicate = await createTalent({ name: "Other Person", email: person.email, phone: VALID_PHONE, areaOfInterest: "IT", tags: [], note: "", consentConfirmed: true, uploads: null });
    const error = expectApiError(duplicate, 409, "duplicate_talent_profile", { fields: ["email"] });
    expect(Object.keys(error).sort()).toEqual(["code", "error", "fields"]);
  });

  test("HR create validates fields and only accepts admin_talent uploads", async () => {
    const tooManyTags = Array.from({ length: 21 }, (_, index) => `tag-${index}`);
    const invalid = await createTalent({ name: "", email: "x", phone: "", areaOfInterest: "", tags: tooManyTags, note: "n".repeat(5001), consentConfirmed: false, uploads: null });
    expectApiError(invalid, 400, "invalid_input", { fields: ["name", "email", "phone", "areaOfInterest", "tags", "note", "consentConfirmed"] });

    const person = candidate("talent-hr-purpose");
    const base = { name: person.name, email: person.email, phone: person.phone, areaOfInterest: "IT", tags: [], note: "", consentConfirmed: true };
    const publicUpload = await uploadDocuments("talent_pool", [cvFile("public")]);
    expectApiError(await createTalent({ ...base, uploads: publicUpload }), 400, "upload_expired", { fields: ["cv"] });
    expectApiError(await createTalent({ ...base, consentConfirmed: "true", uploads: null }), 400, "invalid_input", { fields: ["consentConfirmed"] });
    expectApiError(await createTalent({ ...base, tags: [{ $ne: null }], uploads: null }), 400, "invalid_input", { fields: ["tags"] });
    expectApiError(await createTalent({ ...base, uploads: { cv: randomUUID(), supporting: [] } }), 400, "upload_expired");
  });

  test("lists and filters profiles, with tags for suggestions", async () => {
    const tag = `e2e-${uniqueSuffix()}`;
    const first = await createHrTalent(hr, "talent-list-a", { tags: [tag], areaOfInterest: "Microbiology" });
    const second = await createHrTalent(hr, "talent-list-b", { tags: [tag, "night-shift"] });
    const archived = await createHrTalent(hr, "talent-list-c", { tags: [tag] });
    await setTalentArchived(hr, archived.id, true);
    const publicPerson = candidate("talent-list-public");
    await submitTalent(publicPerson);

    const list = async (query: Record<string, string>) => {
      const result = await api<Paginated<TalentListItem>>("GET", `/api/admin/talent-pool?${new URLSearchParams(query)}`, { cookie: hr });
      expectStatus(result, 200);
      return result.body;
    };
    const byTag = await list({ tag });
    expect(byTag.total).toBe(2);
    expect(byTag.items.map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
    for (const item of byTag.items) expectExactKeys(item, LIST_ITEM_KEYS, "talent list item");
    expectNoSensitiveData(byTag, "talent list");

    expect((await list({ tag: tag.toUpperCase(), archived: "include" })).total).toBe(3);
    expect((await list({ tag, archived: "only" })).items.map((item) => item.id)).toEqual([archived.id]);
    expect((await list({ tag, area: "Microbiology" })).items.map((item) => item.id)).toEqual([first.id]);
    expect((await list({ tag, source: "self_submitted" })).total).toBe(0);
    expect((await list({ q: publicPerson.email, source: "self_submitted" })).total).toBe(1);
    expect((await list({ tag, q: `${tag}.*` })).total).toBe(0);
    expect((await list({ tag: ".*" })).items.map((item) => item.id)).not.toContain(first.id);
    expect((await list({ tag, source: "hacker", area: "all", limit: "1", page: "2" }))).toMatchObject({ total: 2, page: 2, limit: 1, pageCount: 2 });

    const tags = await api<{ tags: string[] }>("GET", "/api/admin/talent-pool/tags", { cookie: hr });
    expectStatus(tags, 200);
    expectExactKeys(tags.body, ["tags"], "tags body");
    expect(tags.body.tags).toContain(tag);
    expect(new Set(tags.body.tags).size).toBe(tags.body.tags.length);
  });

  test("PATCH updates the profile but never the email", async () => {
    const talent = await createHrTalent(hr, "talent-patch");
    const patch = (json: unknown) => api<{ talent: TalentDetail }>("PATCH", `/api/admin/talent-pool/${talent.id}`, { cookie: hr, json });

    const updated = await patch({ name: "Updated Name", phone: "+94 11 234 5678", areaOfInterest: "Production", tags: ["Packaging"], email: "hijack@example.com" });
    expectStatus(updated, 200);
    expect(updated.body.talent).toMatchObject({ name: "Updated Name", phone: "+94 11 234 5678", areaOfInterest: "Production", tags: ["packaging"], email: talent.email });
    expect(updated.body.talent.activity.map((entry) => entry.action)).toEqual(expect.arrayContaining(["tags_changed"]));

    expectApiError(await patch({ email: "hijack@example.com" }), 400, "nothing_to_update");
    expectApiError(await patch({ phone: "call me" }), 400, "invalid_input", { fields: ["phone"] });
    expectApiError(await patch({ name: { $set: "x" } }), 400, "invalid_input", { fields: ["name"] });
    expectApiError(await patch({ areaOfInterest: "" }), 400, "invalid_input", { fields: ["areaOfInterest"] });
    expectApiError(await patch({ tags: "x".repeat(31) }), 400, "invalid_input", { fields: ["tags"] });
  });

  test("notes, archive and restore follow the read-only rule for archived profiles", async () => {
    const talent = await createHrTalent(hr, "talent-archive");
    const note = await api<{ talent: TalentDetail }>("POST", `/api/admin/talent-pool/${talent.id}/notes`, { cookie: hr, json: { body: "Called, available in March." } });
    expectStatus(note, 201);
    expect(note.body.talent.notes.at(-1)).toMatchObject({ body: "Called, available in March.", authorName: hrName });
    expectApiError(await api("POST", `/api/admin/talent-pool/${talent.id}/notes`, { cookie: hr, json: { body: "" } }), 400, "invalid_input", { fields: ["body"] });

    const archived = await api<{ talent: TalentDetail }>("POST", `/api/admin/talent-pool/${talent.id}/archive`, { cookie: hr, json: { archived: true, reason: "Candidate asked" } });
    expectStatus(archived, 200);
    expect(archived.body.talent).toMatchObject({ archived: true, archiveReason: "Candidate asked", archivedByName: hrName });

    expectApiError(await api("PATCH", `/api/admin/talent-pool/${talent.id}`, { cookie: hr, json: { name: "Edited Name" } }), 409, "archived");
    expectApiError(await api("POST", `/api/admin/talent-pool/${talent.id}/notes`, { cookie: hr, json: { body: "Late" } }), 409, "archived");
    expectApiError(await api("POST", `/api/admin/talent-pool/${talent.id}/apply`, { cookie: hr, json: { jobId: job.id } }), 409, "archived");
    expectApiError(await api("POST", `/api/admin/talent-pool/${talent.id}/archive`, { cookie: hr, json: { archived: 1 } }), 400, "invalid_input", { fields: ["archived"] });

    const restored = await setTalentArchived(hr, talent.id, false);
    expect(restored).toMatchObject({ archived: false, archivedAt: null });
    expectStatus(await api("PATCH", `/api/admin/talent-pool/${talent.id}`, { cookie: hr, json: { name: "Edited Name" } }), 200);
  });

  test("a profile can be considered for a job, once per job", async () => {
    const person = candidate("talent-apply");
    await submitTalent(person);
    const talentId = (await api<Paginated<TalentListItem>>("GET", `/api/admin/talent-pool?q=${encodeURIComponent(person.email)}`, { cookie: hr })).body.items[0].id;
    const draftJob = await createJob(hr, jobPayload("talent-apply-draft"));
    jobs.push(draftJob.id);

    const applied = await api<TalentApplyResponse>("POST", `/api/admin/talent-pool/${talentId}/apply`, { cookie: hr, json: { jobId: draftJob.id.toUpperCase(), note: "Strong match" } });
    expectStatus(applied, 201);
    expectExactKeys(applied.body, ["applicationId"], "apply body");
    const application = await getApplication(hr, applied.body.applicationId);
    expect(application).toMatchObject({
      source: "talent_pool",
      jobId: draftJob.id,
      email: person.email,
      coverLetter: "",
      linkedIn: null,
      portfolio: null,
      status: "submitted",
      talentPoolEntryId: talentId,
    });
    expect(application.statusHistory[0]).toMatchObject({ from: null, to: "submitted", changedByName: hrName });
    expect(application.statusHistory[0].note).toContain(`Created from talent pool by ${hrName}`);
    expect(application.notes.map((note) => note.body)).toContain("Strong match");
    expect(application.documents).toHaveLength(1);

    const again = await api<TalentApplyResponse>("POST", `/api/admin/talent-pool/${talentId}/apply`, { cookie: hr, json: { jobId: draftJob.id } });
    expectStatus(again, 201);
    expect(again.body.applicationId).toBe(applied.body.applicationId);
    const detail = await getTalent(hr, talentId);
    expect(detail.applications.map((link) => link.id)).toEqual([applied.body.applicationId]);

    // A website application for the same job and email already exists: a genuine duplicate.
    const websiteApplicant = await createApplication(hr, job.id, "talent-apply-web");
    const linked = await createHrTalent(hr, "talent-apply-web-profile", { email: websiteApplicant.person.email });
    expectApiError(await api("POST", `/api/admin/talent-pool/${linked.id}/apply`, { cookie: hr, json: { jobId: job.id } }), 409, "duplicate_application");

    const archivedJob = await changeJobStatus(hr, (await createJob(hr, jobPayload("talent-apply-archived"))).id, "archive");
    jobs.push(archivedJob.id);
    expectApiError(await api("POST", `/api/admin/talent-pool/${talentId}/apply`, { cookie: hr, json: { jobId: archivedJob.id } }), 409, "job_archived");
    expectApiError(await api("POST", `/api/admin/talent-pool/${talentId}/apply`, { cookie: hr, json: { jobId: `missing-${uniqueSuffix()}` } }), 404, "job_not_found");
    expectApiError(await api("POST", `/api/admin/talent-pool/${talentId}/apply`, { cookie: hr, json: { jobId: { $ne: null } } }), 400, "invalid_input", { fields: ["jobId"] });
    expectApiError(await api("POST", `/api/admin/talent-pool/${talentId}/apply`, { cookie: hr, json: {} }), 400, "invalid_input", { fields: ["jobId"] });
  });

  test("unknown, malformed and foreign ids are 404 on every talent route", async () => {
    const created = await createApplication(hr, job.id, "talent-foreign");
    const ids = [randomObjectId(), "nope", "%24where", created.item.id];
    for (const id of ids) {
      expectApiError(await api("GET", `/api/admin/talent-pool/${id}`, { cookie: hr }), 404, "talent_not_found");
      expectApiError(await api("PATCH", `/api/admin/talent-pool/${id}`, { cookie: hr, json: { name: "Someone Else" } }), 404, "talent_not_found");
      expectApiError(await api("POST", `/api/admin/talent-pool/${id}/notes`, { cookie: hr, json: { body: "x" } }), 404, "talent_not_found");
      expectApiError(await api("POST", `/api/admin/talent-pool/${id}/archive`, { cookie: hr, json: { archived: true } }), 404, "talent_not_found");
      expectApiError(await api("POST", `/api/admin/talent-pool/${id}/apply`, { cookie: hr, json: { jobId: job.id } }), 404, "talent_not_found");
      expectApiError(await api("DELETE", `/api/admin/talent-pool/${id}`, { cookie: admin }), 404, "talent_not_found");
    }
  });

  test("permanent deletion is admin-only, requires archiving and unlinks applications", async () => {
    const created = await createApplication(hr, job.id, "talent-purge");
    const move = await api<{ talentPoolEntryId: string }>("POST", `/api/admin/applications/${created.item.id}/talent-pool`, { cookie: hr, json: {} });
    expectStatus(move, 200);
    const talentId = move.body.talentPoolEntryId;
    const talentDetail = await getTalent(hr, talentId);
    const documentId = talentDetail.documents[0].id;
    const presigned = (await api("GET", talentDetail.documents[0].downloadUrl, { cookie: hr })).headers.get("location") ?? "";
    expect(presigned).toContain("talent-pool/");

    expectApiError(await api("DELETE", `/api/admin/talent-pool/${talentId}`, { cookie: hr }), 403, "forbidden");
    expectApiError(await api("DELETE", `/api/admin/talent-pool/${talentId}`, { cookie: admin }), 409, "not_archived");
    await setTalentArchived(hr, talentId, true);
    const purged = await api("DELETE", `/api/admin/talent-pool/${talentId}`, { cookie: admin });
    expectStatus(purged, 200);
    expect(purged.body).toEqual({ success: true });

    expectApiError(await api("GET", `/api/admin/talent-pool/${talentId}`, { cookie: admin }), 404, "talent_not_found");
    expectApiError(await api("GET", `/api/admin/documents/${documentId}`, { cookie: admin }), 404, "document_not_found");
    expect((await fetch(presigned)).status, "stored talent CV after erasure").toBe(404);
    const application = await getApplication(hr, created.item.id);
    // The application keeps its own copy of the CV.
    expect((await api("GET", application.documents[0].downloadUrl, { cookie: hr })).status).toBe(302);
    expect(application).toMatchObject({ inTalentPool: false, talentPoolEntryId: null });
    const audit = await api<Paginated<AuditLogEntry>>("GET", `/api/admin/audit?action=talent.purge&entityId=${talentId}`, { cookie: admin });
    expect(audit.body.items).toHaveLength(1);
  });
});

test.describe("admin stats and candidate data export", () => {
  let admin = "";
  let hr = "";
  let job: AdminJob;

  test.beforeAll(async () => {
    admin = await loginAsAdmin();
    hr = await loginAsHr();
    job = await createOpenJob(admin, "export");
  });

  test.afterAll(async () => {
    await retireJob(admin, job.id);
  });

  test("GET /api/admin/stats returns the dashboard counters", async () => {
    const before = await api<AdminStats>("GET", "/api/admin/stats", { cookie: hr });
    expectStatus(before, 200);
    expectExactKeys(before.body, ["jobs", "applications", "talentPool", "emails"], "stats");
    expectExactKeys(before.body.jobs, ["draft", "published", "closed", "archived", "open"], "jobs");
    expectExactKeys(before.body.applications, ["total", "archived", "last7Days", "byStatus"], "applications");
    expectExactKeys(
      before.body.applications.byStatus,
      ["submitted", "under_review", "shortlisted", "interview", "selected", "rejected", "withdrawn"],
      "byStatus"
    );
    expectExactKeys(before.body.talentPool, ["total", "archived"], "talentPool");
    expectExactKeys(before.body.emails, ["pending", "failed"], "emails");
    const numbers = JSON.stringify(before.body).match(/:(-?\d+(?:\.\d+)?)/g) ?? [];
    for (const value of numbers) expect(Number(value.slice(1))).toBeGreaterThanOrEqual(0);
    expect(before.body.jobs.open).toBeGreaterThanOrEqual(1);
    expect(before.body.jobs.open).toBeLessThanOrEqual(before.body.jobs.published);
  });

  test("admins export everything held about one candidate as a JSON attachment", async () => {
    const created = await createApplication(hr, job.id, "export-subject");
    await api("POST", `/api/admin/applications/${created.item.id}/notes`, { cookie: hr, json: { body: "Internal note for export" } });
    await api("POST", `/api/admin/applications/${created.item.id}/talent-pool`, { cookie: hr, json: { tags: ["export"] } });

    const result = await api<Record<string, unknown>>("GET", `/api/admin/candidates/export?email=${encodeURIComponent(created.person.email.toUpperCase())}`, { cookie: admin });
    expectStatus(result, 200);
    expect(result.headers.get("content-type")).toContain("application/json");
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(result.headers.get("content-disposition")).toMatch(/^attachment; filename="candidate-data-\d{4}-\d{2}-\d{2}\.json"$/);
    const data = result.body;
    expect(data.email).toBe(created.person.email.toLowerCase());
    const applications = data.applications;
    const profiles = data.talentPoolProfiles;
    if (!Array.isArray(applications) || !Array.isArray(profiles)) throw new Error("Export is missing record lists.");
    expect(applications).toHaveLength(1);
    expect(profiles).toHaveLength(1);
    const exported = applications[0];
    if (!isRecord(exported)) throw new Error("Exported application is not an object.");
    expect(exported.reference).toBe(created.reference);
    expect(JSON.stringify(exported.notes)).toContain("Internal note for export");
    expect(result.text).not.toMatch(/"(?:applications|talent-pool|incoming|cvs)\/[^"]*\.pdf"/);
    expectNoSensitiveData(data, "candidate export");

    const audit = await api<Paginated<AuditLogEntry>>("GET", "/api/admin/audit?action=candidate.export&limit=5", { cookie: admin });
    expect(audit.body.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit.body).toLowerCase()).not.toContain(created.person.email.toLowerCase());
  });

  test("candidate export validates the email and is admin-only", async () => {
    expectApiError(await api("GET", "/api/admin/candidates/export", { cookie: admin }), 400, "invalid_input", { fields: ["email"] });
    expectApiError(await api("GET", "/api/admin/candidates/export?email=not-an-email", { cookie: admin }), 400, "invalid_input", { fields: ["email"] });
    expectApiError(await api("GET", "/api/admin/candidates/export?email[$ne]=x", { cookie: admin }), 400, "invalid_input", { fields: ["email"] });
    // Addresses are matched exactly, never as patterns.
    expectApiError(await api("GET", `/api/admin/candidates/export?email=${encodeURIComponent(".*@example.com")}`, { cookie: admin }), 404, "no_records");
    expectApiError(await api("GET", `/api/admin/candidates/export?email=nobody.${uniqueSuffix()}@example.com`, { cookie: admin }), 404, "no_records");
    expectApiError(await api("GET", "/api/admin/candidates/export?email=someone@example.com", { cookie: hr }), 403, "forbidden");
    expectApiError(await api("GET", "/api/admin/candidates/export?email=someone@example.com"), 401, "unauthorized");
  });
});
