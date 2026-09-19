// Data transfer types for the careers portal: what API routes return and accept, and what
// server components pass to client components. Dates are ISO 8601 strings.

import type {
  AdminRole,
  ApplicationSource,
  ApplicationStatus,
  DocumentKind,
  JobStatus,
  JobStatusAction,
  JobType,
  TalentSource,
  UploadPurpose,
} from "@/lib/careers/constants";

export type {
  AdminRole,
  ApplicationSource,
  ApplicationStatus,
  DocumentKind,
  JobStatus,
  JobStatusAction,
  JobType,
  TalentSource,
  UploadPurpose,
};

// ── Shared ───────────────────────────────────────────────────────────────────

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pageCount: number;
};

// Every non-2xx JSON response from the careers API.
export type ApiErrorBody = {
  error: string;
  code: string;
  fields?: Record<string, string>;
};

// ── Jobs ─────────────────────────────────────────────────────────────────────

// A job as shown on the public site. Only open jobs (published, deadline not passed) are
// ever returned in this shape.
export type Job = {
  id: string; // URL slug
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
  // Optional, set by the static jobs list (src/lib/careers/static-jobs.ts): a short card
  // summary, and where to call and apply by email. The Google Sheets store does not have them.
  summary?: string;
  contactPhone?: string;
  applyEmail?: string;
  applicationDeadline: string | null;
  publishedAt: string | null;
  updatedAt: string;
};

export type AdminJob = Job & {
  status: JobStatus;
  createdAt: string;
  closedAt: string | null;
  archivedAt: string | null;
  // Whether the job currently appears on the public site.
  isOpen: boolean;
  applicationCount: number;
  createdByName: string | null;
  updatedByName: string | null;
};

// POST /api/admin/jobs and PATCH /api/admin/jobs/[id]. Lists may be arrays or newline-separated
// strings. applicationDeadline is "YYYY-MM-DD" (end of that day, Sri Lanka time) or "" / null.
export type JobEditorPayload = {
  slug?: string; // create only; immutable afterwards
  title: string;
  department: string;
  location: string;
  type: JobType;
  experience: string;
  description: string;
  responsibilities: string[] | string;
  requirements: string[] | string;
  qualifications: string[] | string;
  benefits: string[] | string;
  applicationDeadline: string | null;
  // create only: "draft" (default) or "published".
  status?: "draft" | "published";
};

export type JobStatusChangePayload = { action: JobStatusAction };

// ── Uploads ──────────────────────────────────────────────────────────────────

// POST /api/uploads
export type UploadRequestPayload = {
  purpose: UploadPurpose;
  files: { kind: DocumentKind; name: string; size: number; contentType: string }[];
};

export type UploadTicket = {
  uploadId: string;
  kind: DocumentKind;
  method: "PUT";
  url: string;
  // Headers the browser must send with the PUT exactly as given.
  headers: Record<string, string>;
  expiresAt: string;
};

export type UploadResponse = { uploads: UploadTicket[] };

export type DocumentInfo = {
  id: string;
  kind: DocumentKind;
  originalName: string;
  size: number | null;
  contentType: string;
  uploadedAt: string;
  // Admin-only endpoint that redirects to a short-lived download URL.
  downloadUrl: string;
};

// ── Public submissions ───────────────────────────────────────────────────────

// POST /api/apply (JSON)
export type ApplicationSubmitPayload = {
  jobId: string;
  name: string;
  email: string;
  phone: string;
  coverLetter: string;
  linkedIn: string;
  portfolio: string;
  consentGiven: boolean;
  uploads: { cv: string; supporting: string[] };
};

// POST /api/talent-pool (JSON)
export type TalentSubmitPayload = {
  name: string;
  email: string;
  phone: string;
  areaOfInterest: string;
  notes: string;
  consentGiven: boolean;
  uploads: { cv: string; supporting: string[] };
};

export type SubmissionResponse = {
  success: true;
  // Short human-readable reference, e.g. "APP-7F3A9C21".
  reference: string;
  message: string;
};

// ── Applications (admin) ─────────────────────────────────────────────────────

export type NoteInfo = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
};

export type StatusHistoryEntry = {
  id: string;
  from: ApplicationStatus | null;
  to: ApplicationStatus;
  changedAt: string;
  changedByName: string | null;
  note: string;
  candidateNotified: boolean;
};

export type EmailDeliveryInfo = {
  id: string;
  template: string;
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  attempts: number;
  createdAt: string;
  sentAt: string | null;
};

export type ApplicationListItem = {
  id: string;
  reference: string;
  name: string;
  email: string;
  phone: string;
  jobId: string; // job slug
  jobTitle: string;
  department: string;
  status: ApplicationStatus;
  source: ApplicationSource;
  createdAt: string;
  statusChangedAt: string;
  archived: boolean;
  inTalentPool: boolean;
  documentCount: number;
  noteCount: number;
};

export type ApplicationDetail = ApplicationListItem & {
  coverLetter: string;
  linkedIn: string | null;
  portfolio: string | null;
  consentGiven: boolean;
  consentAt: string | null;
  documents: DocumentInfo[];
  notes: NoteInfo[];
  statusHistory: StatusHistoryEntry[];
  talentPoolEntryId: string | null;
  jobStillExists: boolean;
  archivedAt: string | null;
  archivedByName: string | null;
  archiveReason: string;
  emails: EmailDeliveryInfo[];
  updatedAt: string;
};

// POST /api/admin/applications/[id]/status
export type ApplicationStatusChangePayload = {
  status: ApplicationStatus;
  // The status the admin was looking at; a mismatch returns 409 so concurrent edits are not lost.
  expectedStatus: ApplicationStatus;
  note?: string;
  notifyCandidate?: boolean;
  candidateMessage?: string;
};

export type NotePayload = { body: string };
export type ArchivePayload = { archived: boolean; reason?: string };

// POST /api/admin/applications/[id]/talent-pool
export type MoveToTalentPoolPayload = { tags?: string[]; note?: string };
export type MoveToTalentPoolResponse = { talentPoolEntryId: string; created: boolean };

// ── Talent pool (admin) ──────────────────────────────────────────────────────

export type TalentListItem = {
  id: string;
  name: string;
  email: string;
  phone: string;
  areaOfInterest: string;
  tags: string[];
  source: TalentSource;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  applicationCount: number;
  documentCount: number;
};

export type TalentApplicationLink = {
  id: string;
  jobId: string;
  jobTitle: string;
  status: ApplicationStatus;
  createdAt: string;
  archived: boolean;
};

export type TalentActivity = {
  id: string;
  action: string;
  at: string;
  actorName: string | null;
  detail: string;
};

export type TalentDetail = TalentListItem & {
  candidateNotes: string;
  consentGiven: boolean;
  consentAt: string | null;
  documents: DocumentInfo[];
  notes: NoteInfo[];
  applications: TalentApplicationLink[];
  sourceApplicationId: string | null;
  archivedAt: string | null;
  archivedByName: string | null;
  archiveReason: string;
  activity: TalentActivity[];
};

// POST /api/admin/talent-pool
export type HrTalentPayload = {
  name: string;
  email: string;
  phone: string;
  areaOfInterest: string;
  tags: string[];
  note: string;
  consentConfirmed: boolean;
  uploads: { cv: string; supporting: string[] } | null;
};

// PATCH /api/admin/talent-pool/[id]
export type TalentUpdatePayload = {
  name?: string;
  phone?: string;
  areaOfInterest?: string;
  tags?: string[];
};

// POST /api/admin/talent-pool/[id]/apply
export type TalentApplyPayload = { jobId: string; note?: string };
export type TalentApplyResponse = { applicationId: string };

// ── Admin users, sessions, audit ─────────────────────────────────────────────

export type AdminSessionUser = {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  mustChangePassword: boolean;
};

export type AdminUserInfo = {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
};

// POST /api/admin/users
export type CreateAdminUserPayload = { email: string; name: string; role: AdminRole };
// Response includes a one-time temporary password the admin passes on securely.
export type CreateAdminUserResponse = { user: AdminUserInfo; temporaryPassword: string };

// PATCH /api/admin/users/[id]
export type UpdateAdminUserPayload = { name?: string; role?: AdminRole; active?: boolean };
// POST /api/admin/users/[id]/reset-password → { temporaryPassword }

// POST /api/admin/password
export type ChangePasswordPayload = { currentPassword: string; newPassword: string };

export type AuditLogEntry = {
  id: string;
  at: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  ip: string | null;
};

export type AdminStats = {
  jobs: Record<JobStatus, number> & { open: number };
  applications: {
    total: number; // excludes archived
    archived: number;
    last7Days: number;
    byStatus: Record<ApplicationStatus, number>;
  };
  talentPool: { total: number; archived: number };
  emails: { pending: number; failed: number };
};
