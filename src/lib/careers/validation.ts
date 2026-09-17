// Input validation shared by the careers API routes (authoritative) and the client forms
// (for immediate feedback). Pure functions only: no Node.js, database or React imports.

import {
  ADMIN_ROLES,
  APPLICATION_STATUSES,
  CAREERS_UTC_OFFSET,
  CAREERS_TIME_ZONE,
  CAREER_DEPARTMENT_SET,
  FIELD_LIMITS,
  JOB_STATUSES,
  JOB_TYPES,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  UPLOAD_LIMITS,
  type AdminRole,
  type ApplicationStatus,
  type DocumentKind,
  type JobStatus,
  type JobType,
  type UploadPurpose,
} from "@/lib/careers/constants";

export type FieldErrors = Record<string, string>;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldErrors; message: string };

function fail<T>(errors: FieldErrors): ValidationResult<T> {
  const message = Object.values(errors)[0] ?? "Some of the submitted values are invalid.";
  return { ok: false, errors, message };
}

// ── Primitive helpers ────────────────────────────────────────────────────────

// C0 control characters and DEL, optionally allowing tab/newline/carriage return.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const CONTROL_CHARS_STRICT = /[\x00-\x1F\x7F]/;

export function hasControlCharacters(value: string, allowNewlines = false): boolean {
  return (allowNewlines ? CONTROL_CHARS : CONTROL_CHARS_STRICT).test(value);
}

// Reads an optional string field from untrusted input. Non-strings become undefined.
function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
}

type TextRule = {
  field: string;
  label: string;
  required?: boolean;
  max: number;
  min?: number;
  multiline?: boolean;
};

// Trims and checks a free-text value. Never truncates: over-long input is an error.
function checkText(raw: string | undefined, rule: TextRule, errors: FieldErrors): string {
  const value = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!value) {
    if (rule.required) errors[rule.field] = `${rule.label} is required.`;
    return "";
  }
  if (hasControlCharacters(value, rule.multiline)) {
    errors[rule.field] = `${rule.label} contains characters that are not allowed.`;
  } else if (value.length > rule.max) {
    errors[rule.field] = `${rule.label} must be ${rule.max} characters or fewer.`;
  } else if (rule.min !== undefined && value.length < rule.min) {
    errors[rule.field] = `${rule.label} must be at least ${rule.min} characters.`;
  }
  return value;
}

// ── People ───────────────────────────────────────────────────────────────────

// Letters (any script, incl. Sinhala/Tamil combining marks), spaces, dots, apostrophes, hyphens.
// Zero-width (non-)joiners are part of normal Sinhala spelling (the rakaransaya in ප්‍රියංකා).
const PERSON_NAME = /^[\p{L}\p{M}][\p{L}\p{M}‌‍ .'’-]*$/u;

export function validatePersonName(raw: string | undefined, errors: FieldErrors, field = "name"): string {
  const value = checkText(raw, { field, label: "Full name", required: true, max: FIELD_LIMITS.name }, errors).replace(/\s+/g, " ");
  if (value && !errors[field] && (!PERSON_NAME.test(value) || value.length < 2)) {
    errors[field] = "Please enter your name using letters only.";
  }
  return value;
}

// Deliberately stricter than RFC 5322: no quoted local parts, commas, angle brackets or
// whitespace, so the value is always safe to use as a single mail recipient.
const EMAIL =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= FIELD_LIMITS.email && EMAIL.test(value) && !value.includes("..");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(raw: string | undefined, errors: FieldErrors, field = "email", label = "Email address"): string {
  const value = (raw ?? "").trim();
  if (!value) errors[field] = `${label} is required.`;
  else if (!isValidEmail(value)) errors[field] = "Please enter a valid email address.";
  return value;
}

const PHONE = /^\+?[0-9 ()\-.]+$/;

export function validatePhone(raw: string | undefined, errors: FieldErrors, field = "phone"): string {
  const value = (raw ?? "").trim().replace(/\s+/g, " ");
  const digits = value.replace(/\D/g, "").length;
  if (!value) errors[field] = "Phone number is required.";
  else if (
    !PHONE.test(value) ||
    value.length > FIELD_LIMITS.phoneMax ||
    digits < FIELD_LIMITS.phoneMin ||
    digits > 15
  ) {
    errors[field] = "Please enter a valid phone number.";
  }
  return value;
}

// Accepts "linkedin.com/in/x" or a full URL; returns a normalized https/http URL or "".
export function validateOptionalUrl(
  raw: string | undefined,
  errors: FieldErrors,
  field: string,
  label: string,
  options: { hostSuffix?: string } = {}
): string {
  const input = (raw ?? "").trim();
  if (!input) return "";
  if (input.length > FIELD_LIMITS.url || hasControlCharacters(input) || /\s/.test(input)) {
    errors[field] = `Please enter a valid ${label} URL.`;
    return "";
  }
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    errors[field] = `Please enter a valid ${label} URL.`;
    return "";
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname.includes(".") || url.username || url.password) {
    errors[field] = `Please enter a valid ${label} URL.`;
    return "";
  }
  if (options.hostSuffix) {
    const host = url.hostname.toLowerCase();
    if (host !== options.hostSuffix && !host.endsWith(`.${options.hostSuffix}`)) {
      errors[field] = `Please enter a ${label} URL on ${options.hostSuffix}.`;
      return "";
    }
  }
  const normalized = url.toString();
  if (normalized.length > FIELD_LIMITS.url) {
    errors[field] = `Please enter a valid ${label} URL.`;
    return "";
  }
  return normalized;
}

export function validatePassword(raw: unknown, errors: FieldErrors, field = "password"): string {
  const value = typeof raw === "string" ? raw : "";
  if (value.length < PASSWORD_MIN_LENGTH) {
    errors[field] = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  } else if (value.length > PASSWORD_MAX_LENGTH) {
    errors[field] = `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  } else if (hasControlCharacters(value)) {
    errors[field] = "Password contains characters that are not allowed.";
  } else if (new Set(value).size < 5) {
    errors[field] = "Password is too simple. Use a longer mix of characters.";
  }
  return value;
}

// ── Tags ─────────────────────────────────────────────────────────────────────

// Letters of any script (with their combining vowel signs and joiners), digits, simple punctuation.
const TAG = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}‌‍ &+./#-]*$/u;

export function normalizeTags(raw: unknown, errors: FieldErrors, field = "tags"): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : raw == null ? [] : null;
  if (list === null) {
    errors[field] = "Tags must be a list.";
    return [];
  }
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") {
      errors[field] = "Tags must be text.";
      return [];
    }
    const tag = item.trim().replace(/\s+/g, " ").toLowerCase();
    if (!tag) continue;
    if (tag.length > FIELD_LIMITS.tag || !TAG.test(tag)) {
      errors[field] = `Tags may use letters, numbers and simple punctuation, up to ${FIELD_LIMITS.tag} characters each.`;
      return [];
    }
    seen.add(tag);
  }
  if (seen.size > FIELD_LIMITS.tags) {
    errors[field] = `Use at most ${FIELD_LIMITS.tags} tags.`;
    return [];
  }
  return [...seen];
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidJobSlug(value: string): boolean {
  return value.length >= FIELD_LIMITS.jobSlugMin && value.length <= FIELD_LIMITS.jobSlugMax && SLUG.test(value);
}

export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, FIELD_LIMITS.jobSlugMax)
    .replace(/-+$/g, "");
}

// Converts a textarea (one item per line) or an array into a clean list.
export function normalizeList(raw: unknown): string[] | null {
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split("\n") : raw == null ? [] : null;
  if (items === null) return null;
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") return null;
    const trimmed = item.replace(/\s+/g, " ").trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

function checkList(raw: unknown, field: string, label: string, errors: FieldErrors): string[] {
  const list = normalizeList(raw);
  if (list === null) {
    errors[field] = `${label} must be a list of text items.`;
    return [];
  }
  if (list.length > FIELD_LIMITS.listItems) {
    errors[field] = `${label} can have at most ${FIELD_LIMITS.listItems} items.`;
  } else if (list.some((item) => item.length > FIELD_LIMITS.listItem)) {
    errors[field] = `Each item in ${label.toLowerCase()} must be ${FIELD_LIMITS.listItem} characters or fewer.`;
  } else if (list.some((item) => hasControlCharacters(item))) {
    errors[field] = `${label} contains characters that are not allowed.`;
  }
  return list;
}

// "YYYY-MM-DD" → the last millisecond of that day in Sri Lanka time.
export function parseDeadlineDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(`${value}T23:59:59.999${CAREERS_UTC_OFFSET}`);
  if (Number.isNaN(date.getTime())) return null;
  // Reject rolled-over dates such as 2026-02-31.
  return formatDeadlineDate(date) === value ? date : null;
}

// Date → "YYYY-MM-DD" as seen in Sri Lanka time (used to prefill the admin date input).
export function formatDeadlineDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAREERS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isJobOpen(job: { status: JobStatus | string; applicationDeadline?: string | Date | null }, now = new Date()): boolean {
  if (job.status !== "published") return false;
  if (!job.applicationDeadline) return true;
  return new Date(job.applicationDeadline).getTime() >= now.getTime();
}

export type JobInput = {
  slug: string;
  title: string;
  department: string;
  location: string;
  type: JobType;
  experience: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  qualifications: string[];
  benefits: string[];
  applicationDeadline: Date | null;
};

// Validates the job editor payload. `slug` is only read when creating (it is immutable).
// Accepts `id` as an alias for `slug` for compatibility with the existing editor.
export function validateJobInput(input: unknown, mode: "create" | "update"): ValidationResult<JobInput> {
  const body = asRecord(input);
  if (!body) return fail({ body: "Invalid request body." });
  const errors: FieldErrors = {};

  let slug = "";
  if (mode === "create") {
    slug = (readString(body, "slug") ?? readString(body, "id") ?? "").trim().toLowerCase();
    if (!slug) errors.slug = "Job ID is required.";
    else if (!isValidJobSlug(slug)) {
      errors.slug = `Job ID must be ${FIELD_LIMITS.jobSlugMin}-${FIELD_LIMITS.jobSlugMax} characters using lowercase letters, numbers and single hyphens.`;
    }
  }

  const title = checkText(readString(body, "title"), { field: "title", label: "Job title", required: true, max: FIELD_LIMITS.jobTitle }, errors);
  const department = checkText(readString(body, "department"), { field: "department", label: "Department", required: true, max: FIELD_LIMITS.department }, errors);
  const location = checkText(readString(body, "location"), { field: "location", label: "Location", required: true, max: FIELD_LIMITS.location }, errors);
  const experience = checkText(readString(body, "experience"), { field: "experience", label: "Experience", max: FIELD_LIMITS.experience }, errors);
  const description = checkText(
    readString(body, "description"),
    { field: "description", label: "Description", required: true, max: FIELD_LIMITS.jobDescription, multiline: true },
    errors
  );

  const typeRaw = readString(body, "type");
  let type: JobType = "Full-time";
  if (!typeRaw) errors.type = "Employment type is required.";
  else if (!(JOB_TYPES as readonly string[]).includes(typeRaw)) errors.type = "Invalid employment type.";
  else type = typeRaw as JobType;

  const responsibilities = checkList(body.responsibilities, "responsibilities", "Responsibilities", errors);
  const requirements = checkList(body.requirements, "requirements", "Requirements", errors);
  const qualifications = checkList(body.qualifications, "qualifications", "Qualifications", errors);
  const benefits = checkList(body.benefits, "benefits", "Benefits", errors);
  if (!errors.responsibilities && responsibilities.length === 0) errors.responsibilities = "Add at least one responsibility.";
  if (!errors.requirements && requirements.length === 0) errors.requirements = "Add at least one requirement.";

  let applicationDeadline: Date | null = null;
  const deadlineRaw = body.applicationDeadline;
  if (deadlineRaw !== undefined && deadlineRaw !== null && deadlineRaw !== "") {
    if (typeof deadlineRaw !== "string") errors.applicationDeadline = "Invalid application deadline.";
    else {
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(deadlineRaw) ? parseDeadlineDate(deadlineRaw) : null;
      if (!parsed) errors.applicationDeadline = "Application deadline must be a valid date (YYYY-MM-DD).";
      else applicationDeadline = parsed;
    }
  }

  if (Object.keys(errors).length > 0) return fail(errors);
  return {
    ok: true,
    value: {
      slug,
      title,
      department,
      location,
      type,
      experience,
      description,
      responsibilities,
      requirements,
      qualifications,
      benefits,
      applicationDeadline,
    },
  };
}

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value);
}

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && (APPLICATION_STATUSES as readonly string[]).includes(value);
}

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

// ── Uploads ──────────────────────────────────────────────────────────────────

export type UploadFileDescriptor = {
  kind: DocumentKind;
  name: string;
  size: number;
  contentType: string;
};

// Keeps a readable, safe display name. Storage keys never use it.
export function sanitizeOriginalFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  let cleaned = base
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9 ._()-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .replace(/^[ .]+|[ .]+$/g, "");
  if (!cleaned.toLowerCase().endsWith(".pdf")) cleaned = `${cleaned.replace(/\.[A-Za-z0-9]{1,5}$/, "")}.pdf`;
  if (cleaned === ".pdf" || cleaned.length === 0) cleaned = "document.pdf";
  if (cleaned.length > FIELD_LIMITS.originalFileName) {
    cleaned = `${cleaned.slice(0, FIELD_LIMITS.originalFileName - 4).trimEnd()}.pdf`;
  }
  return cleaned;
}

export function describeFileProblem(file: { name: string; size: number; type: string }, kind: DocumentKind): string | null {
  const lower = file.name.toLowerCase();
  const maxBytes = kind === "cv" ? UPLOAD_LIMITS.cvMaxBytes : UPLOAD_LIMITS.supportingMaxBytes;
  const label = kind === "cv" ? "CV" : "Supporting document";
  if (!UPLOAD_LIMITS.allowedExtensions.some((ext) => lower.endsWith(ext))) return `${label} must be a PDF file.`;
  // Some browsers/OSes report an empty type for PDFs; the server re-checks the file bytes.
  if (file.type && !UPLOAD_LIMITS.allowedContentTypes.includes(file.type)) return `${label} must be a PDF file.`;
  if (file.size <= 0) return `${label} is empty.`;
  if (file.size > maxBytes) return `${label} must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller.`;
  return null;
}

export function validateUploadRequest(input: unknown): ValidationResult<{ purpose: UploadPurpose; files: UploadFileDescriptor[] }> {
  const body = asRecord(input);
  if (!body) return fail({ body: "Invalid request body." });
  const purpose = body.purpose;
  if (purpose !== "application" && purpose !== "talent_pool" && purpose !== "admin_talent") {
    return fail({ purpose: "Invalid upload purpose." });
  }
  if (!Array.isArray(body.files) || body.files.length === 0) return fail({ files: "Select a file to upload." });

  const files: UploadFileDescriptor[] = [];
  let cvCount = 0;
  let supportingCount = 0;
  for (const raw of body.files) {
    const item = asRecord(raw);
    if (!item) return fail({ files: "Invalid file description." });
    const kind = item.kind;
    const name = item.name;
    const size = item.size;
    const contentType = typeof item.contentType === "string" && item.contentType ? item.contentType : "application/pdf";
    if ((kind !== "cv" && kind !== "supporting") || typeof name !== "string" || typeof size !== "number" || !Number.isInteger(size)) {
      return fail({ files: "Invalid file description." });
    }
    if (name.length > 255 || hasControlCharacters(name)) return fail({ files: "Invalid file name." });
    const problem = describeFileProblem({ name, size, type: contentType }, kind);
    if (problem) return fail({ files: problem });
    if (kind === "cv") cvCount += 1;
    else supportingCount += 1;
    files.push({ kind, name, size, contentType: "application/pdf" });
  }
  if (cvCount > 1) return fail({ files: "Only one CV can be uploaded." });
  if (supportingCount > UPLOAD_LIMITS.maxSupportingDocuments) {
    return fail({ files: `Upload at most ${UPLOAD_LIMITS.maxSupportingDocuments} supporting documents.` });
  }
  return { ok: true, value: { purpose, files } };
}

function readUploadIds(body: Record<string, unknown>, errors: FieldErrors): { cv: string; supporting: string[] } {
  const uploads = asRecord(body.uploads);
  const cv = uploads && typeof uploads.cv === "string" ? uploads.cv.trim() : "";
  if (!cv) errors.cv = "Please upload your CV.";
  const supportingRaw = uploads?.supporting ?? [];
  const supporting: string[] = [];
  if (!Array.isArray(supportingRaw)) errors.supporting = "Invalid supporting documents.";
  else {
    for (const id of supportingRaw) {
      if (typeof id !== "string" || !id.trim()) {
        errors.supporting = "Invalid supporting documents.";
        break;
      }
      supporting.push(id.trim());
    }
    if (supporting.length > UPLOAD_LIMITS.maxSupportingDocuments) {
      errors.supporting = `Upload at most ${UPLOAD_LIMITS.maxSupportingDocuments} supporting documents.`;
    }
  }
  const all = [cv, ...supporting].filter(Boolean);
  if (new Set(all).size !== all.length) errors.supporting = "The same file was attached twice.";
  if (all.some((id) => id.length > 64 || !/^[A-Za-z0-9-]+$/.test(id))) errors.cv = "Invalid upload reference.";
  return { cv, supporting };
}

// ── Public submissions ───────────────────────────────────────────────────────

export type ApplicationSubmission = {
  jobSlug: string;
  name: string;
  email: string;
  phone: string;
  coverLetter: string;
  linkedIn: string;
  portfolio: string;
  uploads: { cv: string; supporting: string[] };
};

export function validateApplicationSubmission(input: unknown): ValidationResult<ApplicationSubmission> {
  const body = asRecord(input);
  if (!body) return fail({ body: "Invalid request body." });
  const errors: FieldErrors = {};
  const jobSlug = (readString(body, "jobId") ?? readString(body, "jobSlug") ?? "").trim().toLowerCase();
  if (!jobSlug || !isValidJobSlug(jobSlug)) errors.jobId = "The selected role could not be found.";
  const name = validatePersonName(readString(body, "name"), errors);
  const email = validateEmail(readString(body, "email"), errors);
  const phone = validatePhone(readString(body, "phone"), errors);
  const coverLetter = checkText(
    readString(body, "coverLetter"),
    { field: "coverLetter", label: "Cover letter", max: FIELD_LIMITS.coverLetter, multiline: true },
    errors
  );
  const linkedIn = validateOptionalUrl(readString(body, "linkedIn"), errors, "linkedIn", "LinkedIn", { hostSuffix: "linkedin.com" });
  const portfolio = validateOptionalUrl(readString(body, "portfolio"), errors, "portfolio", "portfolio");
  if (body.consentGiven !== true) errors.consentGiven = "You must consent to data processing to apply.";
  const uploads = readUploadIds(body, errors);
  if (Object.keys(errors).length > 0) return fail(errors);
  return { ok: true, value: { jobSlug, name, email, phone, coverLetter, linkedIn, portfolio, uploads } };
}

export type TalentSubmission = {
  name: string;
  email: string;
  phone: string;
  areaOfInterest: string;
  candidateNotes: string;
  uploads: { cv: string; supporting: string[] };
};

export function validateTalentSubmission(input: unknown): ValidationResult<TalentSubmission> {
  const body = asRecord(input);
  if (!body) return fail({ body: "Invalid request body." });
  const errors: FieldErrors = {};
  const name = validatePersonName(readString(body, "name"), errors);
  const email = validateEmail(readString(body, "email"), errors);
  const phone = validatePhone(readString(body, "phone"), errors);
  const areaOfInterest = (readString(body, "areaOfInterest") ?? "").trim();
  if (!areaOfInterest) errors.areaOfInterest = "Please choose an area of interest.";
  else if (!CAREER_DEPARTMENT_SET.has(areaOfInterest)) errors.areaOfInterest = "Please choose an area of interest from the list.";
  const candidateNotes = checkText(
    readString(body, "notes"),
    { field: "notes", label: "Notes", max: FIELD_LIMITS.candidateNotes, multiline: true },
    errors
  );
  if (body.consentGiven !== true) errors.consentGiven = "You must consent to data processing to submit your profile.";
  const uploads = readUploadIds(body, errors);
  if (Object.keys(errors).length > 0) return fail(errors);
  return { ok: true, value: { name, email, phone, areaOfInterest, candidateNotes, uploads } };
}

// HR adding a candidate manually. The CV is optional here (e.g. a referral by phone).
export type HrTalentInput = {
  name: string;
  email: string;
  phone: string;
  areaOfInterest: string;
  tags: string[];
  note: string;
  consentConfirmed: true;
  uploads: { cv: string; supporting: string[] } | null;
};

export function validateHrTalentInput(input: unknown): ValidationResult<HrTalentInput> {
  const body = asRecord(input);
  if (!body) return fail({ body: "Invalid request body." });
  const errors: FieldErrors = {};
  const name = validatePersonName(readString(body, "name"), errors);
  const email = validateEmail(readString(body, "email"), errors);
  const phone = validatePhone(readString(body, "phone"), errors);
  const areaOfInterest = checkText(
    readString(body, "areaOfInterest"),
    { field: "areaOfInterest", label: "Area of interest", required: true, max: FIELD_LIMITS.areaOfInterest },
    errors
  );
  const tags = normalizeTags(body.tags, errors);
  const note = checkText(readString(body, "note"), { field: "note", label: "Note", max: FIELD_LIMITS.hrNote, multiline: true }, errors);
  if (body.consentConfirmed !== true) {
    errors.consentConfirmed = "Confirm that the candidate agreed to be kept on file.";
  }
  let uploads: HrTalentInput["uploads"] = null;
  const uploadsRecord = asRecord(body.uploads);
  if (uploadsRecord && (uploadsRecord.cv || (Array.isArray(uploadsRecord.supporting) && uploadsRecord.supporting.length > 0))) {
    uploads = readUploadIds(body, errors);
  }
  if (Object.keys(errors).length > 0) return fail(errors);
  return { ok: true, value: { name, email, phone, areaOfInterest, tags, note, consentConfirmed: true, uploads } };
}

export type ContactSubmission = {
  fullName: string;
  email: string;
  phone: string;
  company: string;
  subject: string;
  message: string;
};

// Mirrors the fields of src/components/contact-form.tsx (errors are keyed by its field names).
export function validateContactSubmission(input: unknown): ValidationResult<ContactSubmission> {
  const body = asRecord(input);
  if (!body) return fail({ body: "Invalid request body." });
  const errors: FieldErrors = {};
  const fullName = validatePersonName(readString(body, "fullName"), errors, "fullName");
  const email = validateEmail(readString(body, "email"), errors);
  const phoneRaw = (readString(body, "phone") ?? "").trim();
  const phone = phoneRaw ? validatePhone(phoneRaw, errors) : "";
  const company = checkText(readString(body, "company"), { field: "company", label: "Company", max: FIELD_LIMITS.name }, errors);
  const subject = checkText(
    readString(body, "subject"),
    { field: "subject", label: "Subject", required: true, max: FIELD_LIMITS.contactSubject },
    errors
  );
  const message = checkText(
    readString(body, "message"),
    { field: "message", label: "Message", required: true, max: FIELD_LIMITS.contactMessage, multiline: true },
    errors
  );
  if (Object.keys(errors).length > 0) return fail(errors);
  return { ok: true, value: { fullName, email, phone, company, subject, message } };
}

// ── Admin list queries ───────────────────────────────────────────────────────

export type Pagination = { page: number; limit: number; skip: number };

export function parsePagination(params: URLSearchParams): Pagination {
  const pageRaw = Number.parseInt(params.get("page") ?? "1", 10);
  const limitRaw = Number.parseInt(params.get("limit") ?? String(PAGE_SIZE_DEFAULT), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 10_000) : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(limitRaw, PAGE_SIZE_MAX) : PAGE_SIZE_DEFAULT;
  return { page, limit, skip: (page - 1) * limit };
}

export function parseSearchQuery(params: URLSearchParams, key = "q"): string {
  const value = (params.get(key) ?? "").replace(/\s+/g, " ").trim();
  return hasControlCharacters(value) ? "" : value.slice(0, FIELD_LIMITS.searchQuery);
}

// Parses a "YYYY-MM-DD" filter bound as the start (or end) of that day in Sri Lanka time.
export function parseDateFilter(value: string | null, bound: "start" | "end"): Date | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  // Reject rolled-over dates such as 2026-02-30. Checked on the calendar alone: a time-zone
  // round trip would reject valid historic dates, when Colombo was not yet at UTC+05:30.
  const [year, month, day] = match.slice(1).map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const time = bound === "start" ? "00:00:00.000" : "23:59:59.999";
  const date = new Date(`${value}T${time}${CAREERS_UTC_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── CSV ──────────────────────────────────────────────────────────────────────

// Quotes a CSV cell and neutralizes spreadsheet formulas (=, +, -, @, tab, CR).
export function escapeCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
