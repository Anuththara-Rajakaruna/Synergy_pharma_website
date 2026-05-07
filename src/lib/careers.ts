import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Job, ApplicationRecord, TalentPoolRecord } from "@/types/careers";

const dataDirectory = path.join(process.cwd(), "src", "data");
const publicDirectory = path.join(process.cwd(), "public");
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

export async function getJobs() {
  return readJsonFile<Job[]>(jobsFile, "[]");
}

export async function getJobById(id: string) {
  const jobs = await getJobs();
  return jobs.find((job) => job.id === id) ?? null;
}

export async function createJob(job: Job) {
  const jobs = await getJobs();
  jobs.unshift(job);
  await writeJsonFile(jobsFile, jobs);
  return job;
}

export async function updateJob(id: string, updates: Job) {
  const jobs = await getJobs();
  const index = jobs.findIndex((job) => job.id === id);

  if (index === -1) {
    return null;
  }

  jobs[index] = updates;
  await writeJsonFile(jobsFile, jobs);
  return jobs[index];
}

export async function deleteJob(id: string) {
  const jobs = await getJobs();
  const nextJobs = jobs.filter((job) => job.id !== id);

  if (nextJobs.length === jobs.length) {
    return false;
  }

  await writeJsonFile(jobsFile, nextJobs);
  return true;
}

export async function getApplications() {
  return readJsonFile<ApplicationRecord[]>(applicationsFile, "[]");
}

export async function getTalentPoolEntries() {
  return readJsonFile<TalentPoolRecord[]>(talentPoolFile, "[]");
}

async function persistUpload(file: File, directory: string) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const targetDirectory = path.join(publicDirectory, "uploads", directory);
  const targetFilePath = path.join(targetDirectory, safeName);

  await mkdir(targetDirectory, { recursive: true });
  await writeFile(targetFilePath, buffer);

  return {
    fileName: safeName,
    publicPath: `/uploads/${directory}/${safeName}`,
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
}) {
  const uploads = await persistUpload(data.cv, "cvs");
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
  };

  applications.unshift(record);
  await writeJsonFile(applicationsFile, applications);
  return record;
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
  };

  records.unshift(record);
  await writeJsonFile(talentPoolFile, records);
  return record;
}
