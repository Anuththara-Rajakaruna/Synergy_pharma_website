import { randomBytes } from "node:crypto";
import { api, clientIp, login, pdfBytes, uploadFiles, type UploadFile } from "../../support/api";

// API-level setup for the browser tests. Everything created here carries a unique token so
// tests never depend on (or disturb) data other suites put in the shared test database.

export type AdminJobDto = {
  id: string;
  title: string;
  department: string;
  location: string;
  type: string;
  experience: string;
  status: "draft" | "published" | "closed" | "archived";
  applicationDeadline: string | null;
  isOpen: boolean;
  applicationCount: number;
};

export type JobSeed = {
  slug: string;
  title: string;
  department: string;
  location: string;
  type: "Full-time" | "Part-time" | "Contract" | "Temporary" | "Internship";
  experience: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  qualifications: string[];
  benefits: string[];
  applicationDeadline: string | null;
};

export type Candidate = { name: string; email: string; phone: string };

export type AccountCredentials = { id: string; email: string; name: string; password: string; role: "admin" | "hr" };

// Lowercase hex token, safe for slugs, emails and search terms.
export function token(): string {
  return randomBytes(4).toString("hex");
}

// Person names must be letters only, so hex tokens are mapped onto letters.
export function letters(value: string = token()): string {
  const mapped = Array.from(value.toLowerCase())
    .map((char) => String.fromCharCode("a".charCodeAt(0) + Number.parseInt(char, 16)))
    .join("");
  return mapped.charAt(0).toUpperCase() + mapped.slice(1);
}

// A calendar date `days` from now in Sri Lanka time (deadlines are Sri Lanka calendar dates).
export function colomboDate(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
}

export function newCandidate(label = "Candidate"): Candidate {
  const id = token();
  return {
    name: `Nadeesha ${letters(id)}`,
    email: `ui.${label.toLowerCase()}.${id}@example.com`,
    phone: `+94 77 ${String(Number.parseInt(id.slice(0, 6), 16) % 1_000_0000).padStart(7, "0")}`,
  };
}

export function jobSeed(overrides: Partial<JobSeed> = {}): JobSeed {
  const id = token();
  return {
    slug: `ui-e2e-${id}`,
    title: `UI Quality Analyst ${id}`,
    department: "Quality Assurance",
    location: "Colombo, Sri Lanka",
    type: "Full-time",
    experience: "2+ years in pharmaceutical QA",
    description: `Join our quality team to keep every batch compliant.\n\nThis role (${id}) partners with production and regulatory teams.`,
    responsibilities: ["Review batch manufacturing records", "Maintain SOP documentation"],
    requirements: ["BSc in Chemistry or Pharmacy", "Strong attention to detail"],
    qualifications: ["GMP training certificate"],
    benefits: ["Medical insurance", "Structured training programme"],
    applicationDeadline: colomboDate(30),
    ...overrides,
  };
}

function expectStatus(result: { status: number; text: string }, expected: number, what: string): void {
  if (result.status !== expected) throw new Error(`${what} failed: ${result.status} ${result.text.slice(0, 300)}`);
}

export async function createJob(cookie: string, seed: JobSeed, status: "draft" | "published" = "published"): Promise<AdminJobDto> {
  const result = await api<{ job: AdminJobDto }>("POST", "/api/admin/jobs", { cookie, json: { ...seed, status } });
  expectStatus(result, 201, `Creating job ${seed.slug}`);
  return result.body.job;
}

export async function changeJobStatus(cookie: string, slug: string, action: "publish" | "unpublish" | "close" | "reopen" | "archive" | "restore"): Promise<AdminJobDto> {
  const result = await api<{ job: AdminJobDto }>("POST", `/api/admin/jobs/${slug}/status`, { cookie, json: { action } });
  expectStatus(result, 200, `Job ${slug} ${action}`);
  return result.body.job;
}

export async function getAdminJob(cookie: string, slug: string): Promise<AdminJobDto | null> {
  const result = await api<{ job: AdminJobDto }>("GET", `/api/admin/jobs/${slug}`, { cookie });
  return result.status === 200 ? result.body.job : null;
}

// Removes a test job from the public site once a test is done: deleted when possible, archived
// otherwise. Failures are ignored because the test may already have changed the job itself.
export async function retireJob(cookie: string, slug: string): Promise<void> {
  const job = await getAdminJob(cookie, slug);
  if (!job) return;
  if (job.status !== "archived") {
    await api("POST", `/api/admin/jobs/${slug}/status`, { cookie, json: { action: "archive" } });
  }
  if (job.applicationCount === 0) await api("DELETE", `/api/admin/jobs/${slug}`, { cookie });
}

export function cvFile(label: string, sizeBytes = 6000): UploadFile {
  return { kind: "cv", name: `cv-${label}.pdf`, bytes: pdfBytes(sizeBytes, label) };
}

export async function submitApplication(
  jobSlug: string,
  candidate: Candidate,
  options: { coverLetter?: string; supporting?: number } = {}
): Promise<{ reference: string }> {
  const ip = clientIp();
  const files: UploadFile[] = [cvFile(candidate.email)];
  for (let index = 0; index < (options.supporting ?? 0); index += 1) {
    files.push({ kind: "supporting", name: `certificate-${index + 1}.pdf`, bytes: pdfBytes(3000, `support-${index}`) });
  }
  const { ids } = await uploadFiles("application", files, { ip });
  const result = await api<{ reference: string }>("POST", "/api/apply", {
    ip,
    json: {
      jobId: jobSlug,
      ...candidate,
      coverLetter: options.coverLetter ?? "",
      linkedIn: "",
      portfolio: "",
      consentGiven: true,
      uploads: { cv: ids[0], supporting: ids.slice(1) },
    },
  });
  expectStatus(result, 201, `Applying to ${jobSlug}`);
  return { reference: result.body.reference };
}

export type ApplicationListItemDto = { id: string; reference: string; name: string; email: string; status: string; archived: boolean };

export async function findApplication(cookie: string, email: string): Promise<ApplicationListItemDto> {
  const result = await api<{ items: ApplicationListItemDto[] }>("GET", `/api/admin/applications?archived=include&q=${encodeURIComponent(email)}`, { cookie });
  expectStatus(result, 200, "Searching applications");
  const item = result.body.items.find((entry) => entry.email.toLowerCase() === email.toLowerCase());
  if (!item) throw new Error(`No application found for ${email}`);
  return item;
}

export async function submitTalentProfile(candidate: Candidate, areaOfInterest = "Quality Control"): Promise<{ reference: string }> {
  const ip = clientIp();
  const { ids } = await uploadFiles("talent_pool", [cvFile(candidate.email)], { ip });
  const result = await api<{ reference: string }>("POST", "/api/talent-pool", {
    ip,
    json: { ...candidate, areaOfInterest, notes: "Open to laboratory roles.", consentGiven: true, uploads: { cv: ids[0], supporting: [] } },
  });
  expectStatus(result, 201, "Submitting talent profile");
  return result.body;
}

export async function createAccount(adminCookie: string, role: "admin" | "hr", label = "User"): Promise<{ id: string; email: string; name: string; temporaryPassword: string }> {
  const id = token();
  const email = `ui.${label.toLowerCase()}.${id}@synergypharma.lk`;
  const name = `Tharindu ${letters(id)}`;
  const result = await api<{ user: { id: string }; temporaryPassword: string }>("POST", "/api/admin/users", {
    cookie: adminCookie,
    json: { email, name, role },
  });
  expectStatus(result, 201, "Creating admin user");
  return { id: result.body.user.id, email, name, temporaryPassword: result.body.temporaryPassword };
}

// A new account whose temporary password has already been replaced, ready to sign in normally.
export async function createActiveAccount(adminCookie: string, role: "admin" | "hr", label = "User"): Promise<AccountCredentials> {
  const account = await createAccount(adminCookie, role, label);
  const password = `Ui-${token()}-Passw0rd!${token()}`;
  const cookie = await login(account.email, account.temporaryPassword);
  const change = await api("POST", "/api/admin/password", { cookie, json: { currentPassword: account.temporaryPassword, newPassword: password } });
  expectStatus(change, 200, "Setting the new account password");
  return { id: account.id, email: account.email, name: account.name, password, role };
}

export async function changeApplicationStatus(cookie: string, applicationId: string, from: string, to: string): Promise<void> {
  const result = await api("POST", `/api/admin/applications/${applicationId}/status`, { cookie, json: { status: to, expectedStatus: from, note: "", notifyCandidate: false } });
  expectStatus(result, 200, `Changing application ${applicationId} to ${to}`);
}

export async function archiveApplication(cookie: string, applicationId: string, reason = "Archived by UI test setup"): Promise<void> {
  const result = await api("POST", `/api/admin/applications/${applicationId}/archive`, { cookie, json: { archived: true, reason } });
  expectStatus(result, 200, `Archiving application ${applicationId}`);
}

// Runs async tasks with limited concurrency (keeps setup fast without flooding the server).
export async function inBatches<T>(count: number, size: number, task: (index: number) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  for (let start = 0; start < count; start += size) {
    const batch = Array.from({ length: Math.min(size, count - start) }, (_, offset) => task(start + offset));
    results.push(...(await Promise.all(batch)));
  }
  return results;
}

export async function createHrTalent(cookie: string, candidate: Candidate, tags: string[], areaOfInterest = "Production"): Promise<{ id: string }> {
  const result = await api<{ talent: { id: string } }>("POST", "/api/admin/talent-pool", {
    cookie,
    json: { ...candidate, areaOfInterest, tags, note: "", consentConfirmed: true, uploads: null },
  });
  expectStatus(result, 201, "Creating a talent profile as HR");
  return { id: result.body.talent.id };
}
