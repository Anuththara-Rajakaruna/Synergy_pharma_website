import { randomBytes, randomInt, randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { expect } from "@playwright/test";
import { api, clientIp, login, pdfBytes, uniqueSuffix, uploadFiles, type ApiResult, type UploadFile } from "../../support/api";
import { e2eEnv } from "../../support/env";
import type {
  AdminJob,
  AdminRole,
  AdminUserInfo,
  ApplicationDetail,
  ApplicationListItem,
  CreateAdminUserResponse,
  JobEditorPayload,
  JobStatusAction,
  Paginated,
  SubmissionResponse,
  TalentDetail,
  TalentListItem,
} from "@/types/careers";
import { expectStatus } from "./assertions";

// Builders for the records the API suites need. Everything is uniquely named so suites can share
// one database with other test runs, and cleanup only ever touches records created here.

export const VALID_PHONE = "+94 77 123 4567";
export const ORIGIN_EVIL = "https://evil.example";

// Person names may only contain letters, so hex suffixes are mapped onto letters.
export function lettersOnly(value: string): string {
  return value.replace(/[0-9]/g, (digit) => "ghijklmnop"[Number(digit)]);
}

// A client address outside the range used by the shared helpers, for tests that exhaust a
// rate-limit bucket on purpose.
export function isolatedClientIp(): string {
  return `100.${randomInt(64, 128)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}

export function randomObjectId(): string {
  return randomBytes(12).toString("hex");
}

export function strongPassword(): string {
  return `E2e-${randomUUID()}-Pw`;
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export type JobInput = JobEditorPayload & { slug: string };

export function jobPayload(label: string, overrides: Partial<JobInput> = {}): JobInput {
  const suffix = uniqueSuffix();
  return {
    slug: `e2e-api-${label}-${suffix}`,
    title: `E2E API ${label} ${suffix}`,
    department: "Quality Assurance",
    location: "Colombo, Sri Lanka",
    type: "Full-time",
    experience: "2+ years in a GMP environment",
    description: "Own quality checks for tablet production.\n\nWork with the QA and production teams.",
    responsibilities: ["Review batch manufacturing records", "Support internal audits"],
    requirements: ["BSc in Chemistry or Pharmacy"],
    qualifications: ["GMP training"],
    benefits: ["Medical cover"],
    applicationDeadline: null,
    ...overrides,
  };
}

export async function createJob(cookie: string, payload: JobInput, status: "draft" | "published" = "draft"): Promise<AdminJob> {
  const result = await api<{ job: AdminJob }>("POST", "/api/admin/jobs", { cookie, json: { ...payload, status } });
  expectStatus(result, 201);
  return result.body.job;
}

export async function changeJobStatus(cookie: string, slug: string, action: JobStatusAction): Promise<AdminJob> {
  const result = await api<{ job: AdminJob }>("POST", `/api/admin/jobs/${slug}/status`, { cookie, json: { action } });
  expectStatus(result, 200);
  return result.body.job;
}

export async function createOpenJob(cookie: string, label: string, overrides: Partial<JobInput> = {}): Promise<AdminJob> {
  return createJob(cookie, jobPayload(label, overrides), "published");
}

// Best-effort cleanup: deletes the job when allowed, otherwise archives it so it leaves the
// public site. Never throws.
export async function retireJob(cookie: string, slug: string): Promise<void> {
  try {
    const current = await api<{ job: AdminJob }>("GET", `/api/admin/jobs/${slug}`, { cookie });
    if (current.status !== 200) return;
    const { job } = current.body;
    if (job.status !== "archived" && job.status !== "draft") {
      await api("POST", `/api/admin/jobs/${slug}/status`, { cookie, json: { action: "archive" } });
    }
    if (job.applicationCount === 0) await api("DELETE", `/api/admin/jobs/${slug}`, { cookie });
  } catch {
    // Cleanup must never hide the real test result.
  }
}

// ── Candidates, uploads and submissions ──────────────────────────────────────

export type Candidate = {
  name: string;
  email: string;
  phone: string;
  coverLetter: string;
  linkedIn: string;
  portfolio: string;
};

export function candidate(label: string, overrides: Partial<Candidate> = {}): Candidate {
  const suffix = uniqueSuffix();
  return {
    name: `Nadeesha ${lettersOnly(suffix)} Perera`,
    email: `e2e.${label}.${suffix}@example.com`,
    phone: VALID_PHONE,
    coverLetter: "I have five years of experience in pharmaceutical quality assurance.",
    linkedIn: "",
    portfolio: "",
    ...overrides,
  };
}

export function cvFile(label = "cv", sizeBytes = 4096): UploadFile {
  return { kind: "cv", name: `${label}.pdf`, bytes: pdfBytes(sizeBytes, label) };
}

export function supportingFile(label = "certificate", sizeBytes = 2048): UploadFile {
  return { kind: "supporting", name: `${label}.pdf`, bytes: pdfBytes(sizeBytes, label) };
}

export type UploadRefs = { cv: string; supporting: string[] };

export async function uploadDocuments(
  purpose: "application" | "talent_pool" | "admin_talent",
  files: UploadFile[],
  options: { cookie?: string } = {}
): Promise<UploadRefs> {
  const { ids } = await uploadFiles(purpose, files, { cookie: options.cookie });
  const refs: UploadRefs = { cv: "", supporting: [] };
  files.forEach((file, index) => {
    if (file.kind === "cv") refs.cv = ids[index];
    else refs.supporting.push(ids[index]);
  });
  return refs;
}

export function applicationBody(jobSlug: string, person: Candidate, uploads: UploadRefs): Record<string, unknown> {
  return {
    jobId: jobSlug,
    name: person.name,
    email: person.email,
    phone: person.phone,
    coverLetter: person.coverLetter,
    linkedIn: person.linkedIn,
    portfolio: person.portfolio,
    consentGiven: true,
    uploads,
    website: "",
  };
}

export async function postApplication(body: Record<string, unknown>, ip = clientIp()): Promise<ApiResult<SubmissionResponse>> {
  return api<SubmissionResponse>("POST", "/api/apply", { json: body, ip });
}

// Uploads a CV (plus optional supporting documents) and submits an application; expects 201.
export async function submitApplication(
  jobSlug: string,
  person: Candidate,
  options: { files?: UploadFile[] } = {}
): Promise<{ reference: string; uploads: UploadRefs; files: UploadFile[] }> {
  const files = options.files ?? [cvFile()];
  const uploads = await uploadDocuments("application", files);
  const result = await postApplication(applicationBody(jobSlug, person, uploads));
  expectStatus(result, 201);
  return { reference: result.body.reference, uploads, files };
}

export async function findApplication(cookie: string, email: string, jobSlug?: string): Promise<ApplicationListItem> {
  const query = new URLSearchParams({ q: email, archived: "include" });
  if (jobSlug) query.set("job", jobSlug);
  const result = await api<Paginated<ApplicationListItem>>("GET", `/api/admin/applications?${query}`, { cookie });
  expectStatus(result, 200);
  const matches = result.body.items.filter((item) => item.email.toLowerCase() === email.toLowerCase());
  expect(matches.length, `applications for ${email}`).toBe(1);
  return matches[0];
}

export async function getApplication(cookie: string, id: string): Promise<ApplicationDetail> {
  const result = await api<{ application: ApplicationDetail }>("GET", `/api/admin/applications/${id}`, { cookie });
  expectStatus(result, 200);
  return result.body.application;
}

export async function createApplication(
  cookie: string,
  jobSlug: string,
  label: string,
  overrides: Partial<Candidate> = {}
): Promise<{ person: Candidate; reference: string; item: ApplicationListItem; uploads: UploadRefs; files: UploadFile[] }> {
  const person = candidate(label, overrides);
  const submitted = await submitApplication(jobSlug, person);
  const item = await findApplication(cookie, person.email, jobSlug);
  return { person, reference: submitted.reference, item, uploads: submitted.uploads, files: submitted.files };
}

export async function setApplicationArchived(cookie: string, id: string, archived: boolean): Promise<ApplicationDetail> {
  const result = await api<{ application: ApplicationDetail }>("POST", `/api/admin/applications/${id}/archive`, {
    cookie,
    json: { archived, reason: archived ? "E2E archive" : "" },
  });
  expectStatus(result, 200);
  return result.body.application;
}

export function talentBody(person: Candidate, uploads: UploadRefs, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: person.name,
    email: person.email,
    phone: person.phone,
    areaOfInterest: "Quality Control",
    notes: "Open to laboratory roles in Colombo.",
    consentGiven: true,
    uploads,
    website: "",
    ...overrides,
  };
}

export async function submitTalent(person: Candidate, overrides: Record<string, unknown> = {}): Promise<string> {
  const uploads = await uploadDocuments("talent_pool", [cvFile("talent-cv")]);
  const result = await api<SubmissionResponse>("POST", "/api/talent-pool", { json: talentBody(person, uploads, overrides) });
  expectStatus(result, 201);
  return result.body.reference;
}

export async function findTalent(cookie: string, email: string): Promise<TalentListItem> {
  const query = new URLSearchParams({ q: email, archived: "include" });
  const result = await api<Paginated<TalentListItem>>("GET", `/api/admin/talent-pool?${query}`, { cookie });
  expectStatus(result, 200);
  const matches = result.body.items.filter((item) => item.email.toLowerCase() === email.toLowerCase());
  expect(matches.length, `talent profiles for ${email}`).toBe(1);
  return matches[0];
}

export async function getTalent(cookie: string, id: string): Promise<TalentDetail> {
  const result = await api<{ talent: TalentDetail }>("GET", `/api/admin/talent-pool/${id}`, { cookie });
  expectStatus(result, 200);
  return result.body.talent;
}

export async function createHrTalent(cookie: string, label: string, overrides: Record<string, unknown> = {}): Promise<TalentDetail> {
  const person = candidate(label);
  const result = await api<{ talent: TalentDetail }>("POST", "/api/admin/talent-pool", {
    cookie,
    json: {
      name: person.name,
      email: person.email,
      phone: person.phone,
      areaOfInterest: "Regulatory Affairs",
      tags: [`e2e-${uniqueSuffix()}`],
      note: "Referred by the plant manager.",
      consentConfirmed: true,
      uploads: null,
      ...overrides,
    },
  });
  expectStatus(result, 201);
  return result.body.talent;
}

export async function setTalentArchived(cookie: string, id: string, archived: boolean): Promise<TalentDetail> {
  const result = await api<{ talent: TalentDetail }>("POST", `/api/admin/talent-pool/${id}/archive`, {
    cookie,
    json: { archived, reason: archived ? "E2E archive" : "" },
  });
  expectStatus(result, 200);
  return result.body.talent;
}

// ── Admin users ──────────────────────────────────────────────────────────────

export type FreshUser = { id: string; email: string; name: string; role: AdminRole; password: string; cookie: string };

export async function createUser(adminCookie: string, role: AdminRole, label: string): Promise<CreateAdminUserResponse> {
  const suffix = uniqueSuffix();
  const result = await api<CreateAdminUserResponse>("POST", "/api/admin/users", {
    cookie: adminCookie,
    json: { email: `e2e.${label}.${suffix}@synergypharma.lk`, name: `Test ${lettersOnly(suffix)} User`, role },
  });
  expectStatus(result, 201);
  return result.body;
}

// A user who has signed in with the temporary password and already chosen a real one. The
// returned cookie is the session that changed the password (it stays signed in).
export async function createActiveUser(adminCookie: string, role: AdminRole, label: string): Promise<FreshUser> {
  const { user, temporaryPassword } = await createUser(adminCookie, role, label);
  const cookie = await login(user.email, temporaryPassword);
  const password = strongPassword();
  const change = await api("POST", "/api/admin/password", {
    cookie,
    json: { currentPassword: temporaryPassword, newPassword: password },
  });
  expectStatus(change, 200);
  return { id: user.id, email: user.email, name: user.name, role, password, cookie };
}

// A user who still has to replace the temporary password, with a signed-in session.
export async function createPendingUser(
  adminCookie: string,
  role: AdminRole,
  label: string
): Promise<{ user: AdminUserInfo; temporaryPassword: string; cookie: string }> {
  const { user, temporaryPassword } = await createUser(adminCookie, role, label);
  const cookie = await login(user.email, temporaryPassword);
  return { user, temporaryPassword, cookie };
}

export async function deactivateUser(adminCookie: string, id: string): Promise<void> {
  try {
    await api("PATCH", `/api/admin/users/${id}`, { cookie: adminCookie, json: { active: false } });
  } catch {
    // Best-effort cleanup.
  }
}

// ── Raw requests ─────────────────────────────────────────────────────────────

// Sends a JSON body with chunked transfer encoding and no Content-Length, so the server's
// streaming size cap (not the declared length) is what rejects it. Uses a dedicated connection:
// a server that answers before reading the whole body closes the socket, which must not poison
// the keep-alive pool used by the other requests.
export async function sendStreamedJson(
  method: string,
  path: string,
  totalBytes: number,
  options: { cookie?: string; ip?: string } = {}
): Promise<{ status: number; text: string }> {
  const url = new URL(e2eEnv.baseUrl + path);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "transfer-encoding": "chunked",
    connection: "close",
    origin: e2eEnv.baseUrl,
    [e2eEnv.clientIpHeader]: options.ip ?? clientIp(),
  };
  if (options.cookie) headers.cookie = options.cookie;
  const requester = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = requester.request(url, { method, headers, agent: false }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    // The server may reset the connection after answering; the response (if any) already arrived.
    request.on("error", (err) => resolve({ status: 0, text: String(err) }));

    const chunk = "a".repeat(64 * 1024);
    let sent = 0;
    const writeMore = (): void => {
      if (request.destroyed) return;
      if (sent === 0) {
        request.write('{"padding":"');
        sent += 12;
      }
      while (sent < totalBytes) {
        sent += chunk.length;
        if (!request.write(chunk)) {
          request.once("drain", writeMore);
          return;
        }
      }
      request.end('"}');
    };
    writeMore();
  });
}
