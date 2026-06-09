import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Job, ApplicationRecord, TalentPoolRecord } from "@/types/careers";

const dataDirectory = path.join(process.cwd(), "src", "data");
const privateUploadsDirectory = path.join(process.cwd(), "private-uploads");
const jobsFile = path.join(dataDirectory, "jobs.json");
const applicationsFile = path.join(dataDirectory, "applications.json");
const talentPoolFile = path.join(dataDirectory, "talent-pool.json");

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

function isPdfMagicBytes(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  );
}

export async function getJobs(): Promise<Job[]> {
  const jobs = await readJsonFile<Job[]>(jobsFile, "[]");
  return jobs.map((job) => ({ ...job, status: job.status ?? "published" }));
}

export async function getPublishedJobs(): Promise<Job[]> {
  const jobs = await getJobs();
  return jobs.filter((job) => job.status === "published");
}

export async function getJobById(id: string) {
  const jobs = await getJobs();
  return jobs.find((job) => job.id === id) ?? null;
}

export async function createJob(job: Job): Promise<{ job: Job } | { error: string }> {
  const jobs = await getJobs();
  if (jobs.some((existing) => existing.id === job.id)) {
    return { error: "A job with this ID already exists." };
  }
  const jobWithStatus: Job = { ...job, status: job.status ?? "published" };
  jobs.unshift(jobWithStatus);
  await writeJsonFile(jobsFile, jobs);
  return { job: jobWithStatus };
}

export async function updateJob(id: string, updates: Job) {
  const jobs = await getJobs();
  const index = jobs.findIndex((job) => job.id === id);
  if (index === -1) return null;
  jobs[index] = updates;
  await writeJsonFile(jobsFile, jobs);
  return jobs[index];
}

export async function deleteJob(id: string) {
  const jobs = await getJobs();
  const nextJobs = jobs.filter((job) => job.id !== id);
  if (nextJobs.length === jobs.length) return false;
  await writeJsonFile(jobsFile, nextJobs);
  return true;
}

export async function getApplications(): Promise<ApplicationRecord[]> {
  const records = await readJsonFile<ApplicationRecord[]>(applicationsFile, "[]");
  return records.map((r) => ({
    ...r,
    status: r.status ?? ("new" as const),
    notes: r.notes ?? "",
    consentGiven: r.consentGiven ?? false,
  }));
}

export async function getTalentPoolEntries(): Promise<TalentPoolRecord[]> {
  const records = await readJsonFile<TalentPoolRecord[]>(talentPoolFile, "[]");
  return records.map((r) => ({ ...r, consentGiven: r.consentGiven ?? false }));
}

export async function updateApplicationRecord(
  id: string,
  updates: Partial<Pick<ApplicationRecord, "status" | "notes">>
) {
  const applications = await getApplications();
  const index = applications.findIndex((a) => a.id === id);
  if (index === -1) return null;
  applications[index] = { ...applications[index], ...updates };
  await writeJsonFile(applicationsFile, applications);
  return applications[index];
}

export async function deleteApplicationRecord(id: string): Promise<boolean> {
  const applications = await getApplications();
  const record = applications.find((a) => a.id === id);
  if (!record) return false;
  if (record.cvFileName) {
    const filePath = path.join(privateUploadsDirectory, "cvs", record.cvFileName);
    await unlink(filePath).catch(() => {});
  }
  const next = applications.filter((a) => a.id !== id);
  await writeJsonFile(applicationsFile, next);
  return true;
}

export async function deleteTalentPoolRecord(id: string): Promise<boolean> {
  const records = await getTalentPoolEntries();
  const record = records.find((r) => r.id === id);
  if (!record) return false;
  if (record.cvFileName) {
    const filePath = path.join(privateUploadsDirectory, "talent-pool", record.cvFileName);
    await unlink(filePath).catch(() => {});
  }
  const next = records.filter((r) => r.id !== id);
  await writeJsonFile(talentPoolFile, next);
  return true;
}

export async function getPrivateFilePath(directory: string, fileName: string): Promise<string> {
  return path.join(privateUploadsDirectory, directory, fileName);
}

async function persistUpload(
  file: File,
  directory: string
): Promise<{ fileName: string; apiPath: string } | { error: string }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!isPdfMagicBytes(buffer)) {
    return { error: "Uploaded file is not a valid PDF." };
  }
  const safeName = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const targetDirectory = path.join(privateUploadsDirectory, directory);
  const targetFilePath = path.join(targetDirectory, safeName);
  await mkdir(targetDirectory, { recursive: true });
  await writeFile(targetFilePath, buffer);
  return {
    fileName: safeName,
    apiPath: `/api/files/${directory}/${safeName}`,
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
  consentGiven: boolean;
}): Promise<{ record: ApplicationRecord } | { error: string }> {
  const uploadResult = await persistUpload(data.cv, "cvs");
  if ("error" in uploadResult) return { error: uploadResult.error };

  const applications = await getApplications();
  const duplicate = applications.some(
    (a) => a.email.toLowerCase() === data.email.toLowerCase() && a.jobId === data.jobId
  );
  if (duplicate) {
    return { error: "You have already submitted an application for this position." };
  }

  const record: ApplicationRecord = {
    id: createRecordId("application"),
    name: data.name,
    email: data.email,
    phone: data.phone,
    position: data.position,
    jobId: data.jobId,
    coverLetter: data.coverLetter,
    cvFileName: uploadResult.fileName,
    cvFilePath: uploadResult.apiPath,
    status: "new",
    notes: "",
    consentGiven: data.consentGiven,
    createdAt: new Date().toISOString(),
  };

  applications.unshift(record);
  await writeJsonFile(applicationsFile, applications);
  return { record };
}

export async function createTalentPoolRecord(data: {
  name: string;
  email: string;
  phone: string;
  areaOfInterest: string;
  notes: string;
  cv: File;
  consentGiven: boolean;
}): Promise<{ record: TalentPoolRecord } | { error: string }> {
  const uploadResult = await persistUpload(data.cv, "talent-pool");
  if ("error" in uploadResult) return { error: uploadResult.error };

  const records = await getTalentPoolEntries();

  const record: TalentPoolRecord = {
    id: createRecordId("talent"),
    name: data.name,
    email: data.email,
    phone: data.phone,
    areaOfInterest: data.areaOfInterest,
    notes: data.notes,
    cvFileName: uploadResult.fileName,
    cvFilePath: uploadResult.apiPath,
    consentGiven: data.consentGiven,
    createdAt: new Date().toISOString(),
  };

  records.unshift(record);
  await writeJsonFile(talentPoolFile, records);
  return { record };
}
