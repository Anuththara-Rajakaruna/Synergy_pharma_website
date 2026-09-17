// Careers portal constants shared by server code, client components and scripts.
// Must stay free of Node.js / database imports so client bundles can use it.

export const CAREER_DEPARTMENTS = [
  "Accounts",
  "Analytical Development",
  "Development Quality Assurance",
  "EHS",
  "Engineering",
  "Finance",
  "Formulation Development",
  "HR & Admin",
  "IT",
  "Production",
  "Microbiology",
  "Packaging Development",
  "Production Planning & Inventory Control",
  "Purchase & Logistics",
  "Quality Assurance",
  "Quality Control",
  "Regulatory Affairs",
  "Sales & Marketing",
  "Strategy Planning",
  "Technology Transfer",
  "Warehouse",
] as const;

export const CAREER_DEPARTMENT_SET: ReadonlySet<string> = new Set(CAREER_DEPARTMENTS);

// ── Jobs ─────────────────────────────────────────────────────────────────────

export const JOB_TYPES = ["Full-time", "Part-time", "Contract", "Temporary", "Internship"] as const;
export type JobType = (typeof JOB_TYPES)[number];

// draft: never public. published: public while the application deadline has not passed.
// closed: no longer accepting applications, hidden publicly. archived: retired, hidden
// everywhere by default but kept (with its slug reserved) for the applications linked to it.
export const JOB_STATUSES = ["draft", "published", "closed", "archived"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: "Draft",
  published: "Published",
  closed: "Closed",
  archived: "Archived",
};

// Lifecycle actions exposed by POST /api/admin/jobs/[id]/status.
export const JOB_STATUS_ACTIONS = ["publish", "unpublish", "close", "reopen", "archive", "restore"] as const;
export type JobStatusAction = (typeof JOB_STATUS_ACTIONS)[number];

// Which statuses each action may be applied from, and the resulting status.
export const JOB_STATUS_TRANSITIONS: Record<JobStatusAction, { from: readonly JobStatus[]; to: JobStatus }> = {
  publish: { from: ["draft"], to: "published" },
  unpublish: { from: ["published", "closed"], to: "draft" },
  close: { from: ["published"], to: "closed" },
  reopen: { from: ["closed"], to: "published" },
  archive: { from: ["draft", "published", "closed"], to: "archived" },
  restore: { from: ["archived"], to: "draft" },
};

// Application deadlines are entered as calendar dates and apply until the end of that day
// in Sri Lanka time.
export const CAREERS_TIME_ZONE = "Asia/Colombo";
export const CAREERS_UTC_OFFSET = "+05:30";

// ── Applications ─────────────────────────────────────────────────────────────

export const APPLICATION_STATUSES = [
  "submitted",
  "under_review",
  "shortlisted",
  "interview",
  "selected",
  "rejected",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: "Submitted",
  under_review: "Under Review",
  shortlisted: "Shortlisted",
  interview: "Interview",
  selected: "Selected",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

// Statuses from the PostgreSQL release and the first MongoDB release.
export const LEGACY_APPLICATION_STATUS_MAP: Record<string, ApplicationStatus> = {
  new: "submitted",
  reviewing: "under_review",
  shortlisted: "shortlisted",
  rejected: "rejected",
  hired: "selected",
};

export const APPLICATION_SOURCES = ["website", "talent_pool", "legacy"] as const;
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];

// ── Talent pool ──────────────────────────────────────────────────────────────

export const TALENT_SOURCES = ["self_submitted", "application", "hr_added", "legacy"] as const;
export type TalentSource = (typeof TALENT_SOURCES)[number];

export const TALENT_SOURCE_LABELS: Record<TalentSource, string> = {
  self_submitted: "Website submission",
  application: "From application",
  hr_added: "Added by HR",
  legacy: "Imported",
};

// ── Documents / uploads ──────────────────────────────────────────────────────

export const DOCUMENT_KINDS = ["cv", "supporting"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const UPLOAD_PURPOSES = ["application", "talent_pool", "admin_talent"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const UPLOAD_LIMITS = {
  cvMaxBytes: 10 * 1024 * 1024,
  supportingMaxBytes: 5 * 1024 * 1024,
  maxSupportingDocuments: 3,
  allowedContentTypes: ["application/pdf"] as readonly string[],
  allowedExtensions: [".pdf"] as readonly string[],
  // How long a presigned upload URL stays valid, and how long an unclaimed upload is kept.
  presignExpirySeconds: 15 * 60,
  intentTtlSeconds: 2 * 60 * 60,
} as const;

// ── Admin users ──────────────────────────────────────────────────────────────

// admin: everything, including user management, audit log and permanent erasure.
// hr: jobs, applications and talent pool.
export const ADMIN_ROLES = ["admin", "hr"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  admin: "Administrator",
  hr: "HR / Recruitment",
};

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

// ── Field limits (characters unless noted) ───────────────────────────────────

export const FIELD_LIMITS = {
  name: 120,
  email: 254,
  phoneMin: 7,
  phoneMax: 20,
  coverLetter: 5000,
  url: 300,
  candidateNotes: 1500,
  areaOfInterest: 100,
  jobSlugMin: 3,
  jobSlugMax: 100,
  jobTitle: 150,
  department: 100,
  location: 150,
  experience: 200,
  jobDescription: 20000,
  listItem: 500,
  listItems: 40,
  hrNote: 5000,
  statusNote: 1000,
  candidateMessage: 2000,
  archiveReason: 500,
  tag: 30,
  tags: 20,
  searchQuery: 100,
  contactSubject: 150,
  contactMessage: 5000,
  originalFileName: 150,
} as const;

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;
