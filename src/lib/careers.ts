import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Job, ApplicationRecord, TalentPoolRecord, ApplicantStatus, EmailTemplate } from "@/types/careers";
import { withLock } from "@/lib/mutex";

const dataDirectory = path.join(process.cwd(), "src", "data");
// CVs are stored outside public/ so they are not directly accessible via HTTP.
// They are served through /api/cvs/[filename] which checks admin auth.
const uploadsDirectory = path.join(process.cwd(), "private", "uploads");
const jobsFile = path.join(dataDirectory, "jobs.json");
const applicationsFile = path.join(dataDirectory, "applications.json");
const talentPoolFile = path.join(dataDirectory, "talent-pool.json");
const jobViewsFile = path.join(dataDirectory, "job-views.json");
const emailTemplatesFile = path.join(dataDirectory, "email-templates.json");

async function ensureJsonFile(filePath: string, initialValue: string) {
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, initialValue, "utf8");
  }
}

async function readJsonFile<T>(filePath: string, initialValue: string): Promise<T> {
  await ensureJsonFile(filePath, initialValue);
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

async function writeJsonFile<T>(filePath: string, value: T) {
  await ensureJsonFile(filePath, JSON.stringify(value, null, 2));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createRecordId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeFileName(fileName: string) {
  return fileName.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
}

export async function getJobs() {
  return readJsonFile<Job[]>(jobsFile, "[]");
}

export async function getActiveJobs() {
  const jobs = await getJobs();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return jobs.filter((job) => {
    if (!job.closingDate) return true;
    return new Date(job.closingDate) >= today;
  });
}

export async function getJobById(id: string) {
  const jobs = await getJobs();
  return jobs.find((job) => job.id === id) ?? null;
}

export async function createJob(job: Job) {
  return withLock("jobs", async () => {
    const jobs = await getJobs();
    jobs.unshift(job);
    await writeJsonFile(jobsFile, jobs);
    return job;
  });
}

export async function updateJob(id: string, updates: Job) {
  return withLock("jobs", async () => {
    const jobs = await getJobs();
    const index = jobs.findIndex((job) => job.id === id);

    if (index === -1) return null;

    jobs[index] = updates;
    await writeJsonFile(jobsFile, jobs);
    return jobs[index];
  });
}

export async function deleteJob(id: string) {
  return withLock("jobs", async () => {
    const jobs = await getJobs();
    const nextJobs = jobs.filter((job) => job.id !== id);

    if (nextJobs.length === jobs.length) return false;

    await writeJsonFile(jobsFile, nextJobs);
    return true;
  });
}

export async function getApplications() {
  return readJsonFile<ApplicationRecord[]>(applicationsFile, "[]");
}

export async function getTalentPoolEntries() {
  return readJsonFile<TalentPoolRecord[]>(talentPoolFile, "[]");
}

export async function applicationExists(email: string, jobId: string): Promise<boolean> {
  const applications = await getApplications();
  return applications.some(
    (a) => a.email.toLowerCase() === email.toLowerCase() && a.jobId === jobId
  );
}

export async function updateApplicationStatus(id: string, status: ApplicantStatus) {
  return withLock("applications", async () => {
    const applications = await getApplications();
    const index = applications.findIndex((a) => a.id === id);

    if (index === -1) return null;

    applications[index] = { ...applications[index], status };
    await writeJsonFile(applicationsFile, applications);
    return applications[index];
  });
}

export async function updateTalentPoolStatus(id: string, status: ApplicantStatus) {
  return withLock("talent-pool", async () => {
    const records = await getTalentPoolEntries();
    const index = records.findIndex((r) => r.id === id);

    if (index === -1) return null;

    records[index] = { ...records[index], status };
    await writeJsonFile(talentPoolFile, records);
    return records[index];
  });
}

export async function updateApplicationNotes(id: string, notes: string) {
  return withLock("applications", async () => {
    const applications = await getApplications();
    const index = applications.findIndex((a) => a.id === id);

    if (index === -1) return null;

    applications[index] = { ...applications[index], notes };
    await writeJsonFile(applicationsFile, applications);
    return applications[index];
  });
}

export async function updateTalentPoolNotes(id: string, adminNotes: string) {
  return withLock("talent-pool", async () => {
    const records = await getTalentPoolEntries();
    const index = records.findIndex((r) => r.id === id);

    if (index === -1) return null;

    records[index] = { ...records[index], adminNotes };
    await writeJsonFile(talentPoolFile, records);
    return records[index];
  });
}

async function persistUpload(file: File, directory: string) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const targetDirectory = path.join(uploadsDirectory, directory);
  const targetFilePath = path.join(targetDirectory, safeName);

  await mkdir(targetDirectory, { recursive: true });
  await writeFile(targetFilePath, buffer);

  return {
    fileName: safeName,
    publicPath: `/api/cvs/${directory}/${safeName}`,
  };
}

export async function createApplicationRecord(data: {
  name: string;
  email: string;
  phone: string;
  position: string;
  jobId: string;
  coverLetter: string;
  cv: File;
  source?: string;
}) {
  const uploads = await persistUpload(data.cv, "cvs");

  return withLock("applications", async () => {
    const applications = await getApplications();

    const record: ApplicationRecord = {
      id: createRecordId("application"),
      name: data.name,
      email: data.email,
      phone: data.phone,
      position: data.position,
      jobId: data.jobId,
      coverLetter: data.coverLetter,
      cvFileName: uploads.fileName,
      cvFilePath: uploads.publicPath,
      createdAt: new Date().toISOString(),
      status: "applied",
      ...(data.source ? { source: data.source } : {}),
    };

    applications.unshift(record);
    await writeJsonFile(applicationsFile, applications);
    return record;
  });
}

export async function createTalentPoolRecord(data: {
  name: string;
  email: string;
  phone: string;
  areaOfInterest: string;
  notes: string;
  cv: File;
}) {
  const uploads = await persistUpload(data.cv, "talent-pool");

  return withLock("talent-pool", async () => {
    const records = await getTalentPoolEntries();

    const record: TalentPoolRecord = {
      id: createRecordId("talent"),
      name: data.name,
      email: data.email,
      phone: data.phone,
      areaOfInterest: data.areaOfInterest,
      notes: data.notes,
      cvFileName: uploads.fileName,
      cvFilePath: uploads.publicPath,
      createdAt: new Date().toISOString(),
      status: "applied",
    };

    records.unshift(record);
    await writeJsonFile(talentPoolFile, records);
    return record;
  });
}

export async function getApplicationByEmailAndJob(email: string, jobId: string) {
  const applications = await getApplications();
  return applications.find(
    (a) => a.email.toLowerCase() === email.toLowerCase() && a.jobId === jobId
  ) ?? null;
}

// ─── Interview link ───────────────────────────────────────────────────────────

export async function updateInterviewLink(id: string, interviewLink: string) {
  return withLock("applications", async () => {
    const applications = await getApplications();
    const index = applications.findIndex((a) => a.id === id);
    if (index === -1) return null;
    applications[index] = { ...applications[index], interviewLink };
    await writeJsonFile(applicationsFile, applications);
    return applications[index];
  });
}

// ─── Bulk status update ───────────────────────────────────────────────────────

export async function bulkUpdateApplicationStatus(ids: string[], status: ApplicantStatus) {
  return withLock("applications", async () => {
    const applications = await getApplications();
    const idSet = new Set(ids);
    let updated = 0;
    for (const app of applications) {
      if (idSet.has(app.id)) { app.status = status; updated++; }
    }
    await writeJsonFile(applicationsFile, applications);
    return updated;
  });
}

export async function bulkUpdateTalentPoolStatus(ids: string[], status: ApplicantStatus) {
  return withLock("talent-pool", async () => {
    const records = await getTalentPoolEntries();
    const idSet = new Set(ids);
    let updated = 0;
    for (const rec of records) {
      if (idSet.has(rec.id)) { rec.status = status; updated++; }
    }
    await writeJsonFile(talentPoolFile, records);
    return updated;
  });
}

// ─── Job view tracking ────────────────────────────────────────────────────────

export async function getJobViews(): Promise<Record<string, number>> {
  return readJsonFile<Record<string, number>>(jobViewsFile, "{}");
}

export async function incrementJobViews(jobId: string) {
  return withLock("job-views", async () => {
    const views = await getJobViews();
    views[jobId] = (views[jobId] ?? 0) + 1;
    await writeJsonFile(jobViewsFile, views);
    return views[jobId];
  });
}

// ─── Email templates ─────────────────────────────────────────────────────────

export async function getEmailTemplates(): Promise<EmailTemplate[]> {
  return readJsonFile<EmailTemplate[]>(emailTemplatesFile, "[]");
}

export async function updateEmailTemplate(name: string, updates: Partial<Omit<EmailTemplate, "name">>) {
  return withLock("email-templates", async () => {
    const templates = await getEmailTemplates();
    const index = templates.findIndex((t) => t.name === name);
    if (index === -1) return null;
    templates[index] = { ...templates[index], ...updates };
    await writeJsonFile(emailTemplatesFile, templates);
    return templates[index];
  });
}
