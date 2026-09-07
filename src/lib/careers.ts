import { pool } from "@/lib/db";
import { deletePrivateObject, getPrivateObject, putPrivateObject } from "@/lib/storage";
import { Job, ApplicationRecord, TalentPoolRecord } from "@/types/careers";

function createRecordId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeFileName(fileName: string) {
  return fileName.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | undefined)?.code === "23505";
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

// ── Row <-> domain type mapping ─────────────────────────────────────────────

type JobRow = {
  id: string;
  title: string;
  department: string;
  location: string;
  type: string;
  status: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
};

function jobFromRow(row: JobRow): Job {
  return {
    id: row.id,
    title: row.title,
    department: row.department,
    location: row.location,
    type: row.type as Job["type"],
    status: row.status as Job["status"],
    description: row.description,
    responsibilities: row.responsibilities,
    requirements: row.requirements,
  };
}

type ApplicationRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  job_id: string;
  cover_letter: string;
  cv_file_name: string;
  cv_file_path: string;
  status: string;
  notes: string;
  consent_given: boolean;
  linked_in: string | null;
  portfolio: string | null;
  created_at: Date;
};

function applicationFromRow(row: ApplicationRow): ApplicationRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    position: row.position,
    jobId: row.job_id,
    coverLetter: row.cover_letter,
    cvFileName: row.cv_file_name,
    cvFilePath: row.cv_file_path,
    status: row.status as ApplicationRecord["status"],
    notes: row.notes,
    consentGiven: row.consent_given,
    createdAt: row.created_at.toISOString(),
    ...(row.linked_in ? { linkedIn: row.linked_in } : {}),
    ...(row.portfolio ? { portfolio: row.portfolio } : {}),
  };
}

type TalentPoolRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  area_of_interest: string;
  notes: string;
  cv_file_name: string;
  cv_file_path: string;
  consent_given: boolean;
  created_at: Date;
};

function talentPoolFromRow(row: TalentPoolRow): TalentPoolRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    areaOfInterest: row.area_of_interest,
    notes: row.notes,
    cvFileName: row.cv_file_name,
    cvFilePath: row.cv_file_path,
    consentGiven: row.consent_given,
    createdAt: row.created_at.toISOString(),
  };
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export async function getJobs(): Promise<Job[]> {
  const { rows } = await pool.query<JobRow>(
    `SELECT id, title, department, location, type, status, description, responsibilities, requirements
     FROM jobs ORDER BY created_at DESC`
  );
  return rows.map(jobFromRow);
}

export async function getPublishedJobs(): Promise<Job[]> {
  const { rows } = await pool.query<JobRow>(
    `SELECT id, title, department, location, type, status, description, responsibilities, requirements
     FROM jobs WHERE status = 'published' ORDER BY created_at DESC`
  );
  return rows.map(jobFromRow);
}

export async function getJobById(id: string): Promise<Job | null> {
  const { rows } = await pool.query<JobRow>(
    `SELECT id, title, department, location, type, status, description, responsibilities, requirements
     FROM jobs WHERE id = $1`,
    [id]
  );
  return rows[0] ? jobFromRow(rows[0]) : null;
}

export async function createJob(job: Job): Promise<{ job: Job } | { error: string }> {
  const existing = await pool.query("SELECT 1 FROM jobs WHERE id = $1", [job.id]);
  if ((existing.rowCount ?? 0) > 0) {
    return { error: "A job with this ID already exists." };
  }

  const status = job.status ?? "published";
  try {
    const { rows } = await pool.query<JobRow>(
      `INSERT INTO jobs (id, title, department, location, type, status, description, responsibilities, requirements)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, department, location, type, status, description, responsibilities, requirements`,
      [
        job.id,
        job.title,
        job.department,
        job.location,
        job.type,
        status,
        job.description,
        JSON.stringify(job.responsibilities),
        JSON.stringify(job.requirements),
      ]
    );
    return { job: jobFromRow(rows[0]) };
  } catch (err) {
    if (isUniqueViolation(err)) return { error: "A job with this ID already exists." };
    throw err;
  }
}

export async function updateJob(id: string, updates: Job): Promise<Job | null> {
  const { rows } = await pool.query<JobRow>(
    `UPDATE jobs SET title = $2, department = $3, location = $4, type = $5, status = $6,
       description = $7, responsibilities = $8, requirements = $9, updated_at = now()
     WHERE id = $1
     RETURNING id, title, department, location, type, status, description, responsibilities, requirements`,
    [
      id,
      updates.title,
      updates.department,
      updates.location,
      updates.type,
      updates.status ?? "published",
      updates.description,
      JSON.stringify(updates.responsibilities),
      JSON.stringify(updates.requirements),
    ]
  );
  return rows[0] ? jobFromRow(rows[0]) : null;
}

export async function deleteJob(id: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM jobs WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

// ── Applications ─────────────────────────────────────────────────────────────

export async function getApplications(): Promise<ApplicationRecord[]> {
  const { rows } = await pool.query<ApplicationRow>(
    `SELECT id, name, email, phone, position, job_id, cover_letter, cv_file_name, cv_file_path,
            status, notes, consent_given, linked_in, portfolio, created_at
     FROM applications ORDER BY created_at DESC`
  );
  return rows.map(applicationFromRow);
}

export async function getTalentPoolEntries(): Promise<TalentPoolRecord[]> {
  const { rows } = await pool.query<TalentPoolRow>(
    `SELECT id, name, email, phone, area_of_interest, notes, cv_file_name, cv_file_path,
            consent_given, created_at
     FROM talent_pool ORDER BY created_at DESC`
  );
  return rows.map(talentPoolFromRow);
}

export async function updateApplicationRecord(
  id: string,
  updates: Partial<Pick<ApplicationRecord, "status" | "notes">>
): Promise<ApplicationRecord | null> {
  const { rows } = await pool.query<ApplicationRow>(
    `UPDATE applications SET
       status = COALESCE($2, status),
       notes = COALESCE($3, notes)
     WHERE id = $1
     RETURNING id, name, email, phone, position, job_id, cover_letter, cv_file_name, cv_file_path,
               status, notes, consent_given, linked_in, portfolio, created_at`,
    [id, updates.status ?? null, updates.notes ?? null]
  );
  return rows[0] ? applicationFromRow(rows[0]) : null;
}

export async function deleteApplicationRecord(id: string): Promise<boolean> {
  const { rows } = await pool.query<{ cv_file_name: string }>(
    "DELETE FROM applications WHERE id = $1 RETURNING cv_file_name",
    [id]
  );
  if (rows.length === 0) return false;
  await deletePrivateObject(`cvs/${rows[0].cv_file_name}`);
  return true;
}

export async function deleteTalentPoolRecord(id: string): Promise<boolean> {
  const { rows } = await pool.query<{ cv_file_name: string }>(
    "DELETE FROM talent_pool WHERE id = $1 RETURNING cv_file_name",
    [id]
  );
  if (rows.length === 0) return false;
  await deletePrivateObject(`talent-pool/${rows[0].cv_file_name}`);
  return true;
}

export async function getPrivateFileBuffer(directory: string, fileName: string): Promise<Buffer | null> {
  return getPrivateObject(`${directory}/${fileName}`);
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
  await putPrivateObject(`${directory}/${safeName}`, buffer, "application/pdf");
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
  linkedIn?: string;
  portfolio?: string;
}): Promise<{ record: ApplicationRecord } | { error: string }> {
  const existing = await pool.query(
    "SELECT 1 FROM applications WHERE lower(email) = lower($1) AND job_id = $2",
    [data.email, data.jobId]
  );
  if ((existing.rowCount ?? 0) > 0) {
    return { error: "You have already submitted an application for this position." };
  }

  const uploadResult = await persistUpload(data.cv, "cvs");
  if ("error" in uploadResult) return { error: uploadResult.error };

  const id = createRecordId("application");
  try {
    const { rows } = await pool.query<ApplicationRow>(
      `INSERT INTO applications
         (id, name, email, phone, position, job_id, cover_letter, cv_file_name, cv_file_path,
          status, notes, consent_given, linked_in, portfolio)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', '', $10, $11, $12)
       RETURNING id, name, email, phone, position, job_id, cover_letter, cv_file_name, cv_file_path,
                 status, notes, consent_given, linked_in, portfolio, created_at`,
      [
        id,
        data.name,
        data.email,
        data.phone,
        data.position,
        data.jobId,
        data.coverLetter,
        uploadResult.fileName,
        uploadResult.apiPath,
        data.consentGiven,
        data.linkedIn ?? null,
        data.portfolio ?? null,
      ]
    );
    return { record: applicationFromRow(rows[0]) };
  } catch (err) {
    await deletePrivateObject(`cvs/${uploadResult.fileName}`);
    if (isUniqueViolation(err)) {
      return { error: "You have already submitted an application for this position." };
    }
    throw err;
  }
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
  const existing = await pool.query("SELECT 1 FROM talent_pool WHERE lower(email) = lower($1)", [data.email]);
  if ((existing.rowCount ?? 0) > 0) {
    return { error: "A profile with this email address is already in our talent pool." };
  }

  const uploadResult = await persistUpload(data.cv, "talent-pool");
  if ("error" in uploadResult) return { error: uploadResult.error };

  const id = createRecordId("talent");
  try {
    const { rows } = await pool.query<TalentPoolRow>(
      `INSERT INTO talent_pool
         (id, name, email, phone, area_of_interest, notes, cv_file_name, cv_file_path, consent_given)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, email, phone, area_of_interest, notes, cv_file_name, cv_file_path,
                 consent_given, created_at`,
      [
        id,
        data.name,
        data.email,
        data.phone,
        data.areaOfInterest,
        data.notes,
        uploadResult.fileName,
        uploadResult.apiPath,
        data.consentGiven,
      ]
    );
    return { record: talentPoolFromRow(rows[0]) };
  } catch (err) {
    await deletePrivateObject(`talent-pool/${uploadResult.fileName}`);
    if (isUniqueViolation(err)) {
      return { error: "A profile with this email address is already in our talent pool." };
    }
    throw err;
  }
}
