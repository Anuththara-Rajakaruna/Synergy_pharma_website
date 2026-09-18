import type {
  AdminRole,
  ApplicationSource,
  ApplicationStatus,
  DocumentKind,
  JobStatus,
  JobType,
  TalentSource,
} from "@/lib/careers/constants";

// The careers portal's domain records, as the service layer sees them.
//
// These replace the Mongoose document interfaces one for one: the same field names, the same
// meaning, the same nullability. Only two things changed, and both are deliberate:
//
//   * `_id: Types.ObjectId` became `id: string`. Ids are still 24 hex characters
//     (src/lib/careers/server/ids.ts), so references, route parameters and the admin UI are
//     unaffected - there is simply no BSON type any more.
//   * Fields MongoDB embedded as arrays (documents, notes, statusHistory, activity) are loaded
//     separately and attached by the repository, because each lives in its own tab. A record
//     type therefore carries them as plain arrays exactly as before.
//
// Nothing here imports from the storage layer, so these types stay usable from scripts and tests.

export const JOB_ORIGINS = ["admin", "seed", "postgres"] as const;
export type JobOrigin = (typeof JOB_ORIGINS)[number];

export type OwnerType = "application" | "talent";

// ── Shared sub-records ───────────────────────────────────────────────────────

// A candidate document. The bytes live in Google Drive; `driveFileId` is the only handle, and it
// never reaches the browser - downloads go through /api/admin/documents/<id>.
export type StoredDocument = {
  id: string;
  kind: DocumentKind;
  driveFileId: string;
  originalName: string;
  size: number | null;
  contentType: string;
  uploadedAt: Date;
};

export type NoteEntry = {
  id: string;
  body: string;
  author: string | null;
  authorName: string;
  createdAt: Date;
};

export type StatusHistoryEntryRecord = {
  id: string;
  from: ApplicationStatus | null;
  to: ApplicationStatus;
  changedAt: Date;
  changedBy: string | null;
  changedByName: string | null;
  note: string;
  candidateNotified: boolean;
};

export type TalentActivityRecord = {
  id: string;
  action: string;
  at: Date;
  actor: string | null;
  actorName: string | null;
  detail: string;
};

// Fields shared by records that are archived instead of destroyed.
export type ArchiveState = {
  archivedAt: Date | null;
  archivedBy: string | null;
  archivedByName: string | null;
  archiveReason: string;
};

// ── Jobs ─────────────────────────────────────────────────────────────────────

export type JobRecord = {
  id: string;
  // Public identifier used in URLs (/careers/<slug>) and exposed by the API as `id`.
  // Immutable and never reused, including after the job is archived.
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
  // Last moment applications are accepted (end of the chosen day, Sri Lanka time).
  applicationDeadline: Date | null;
  status: JobStatus;
  publishedAt: Date | null;
  closedAt: Date | null;
  archivedAt: Date | null;
  createdBy: string | null;
  createdByName: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  origin: JobOrigin;
  createdAt: Date;
  updatedAt: Date;
};

// ── Applications ─────────────────────────────────────────────────────────────

export type ApplicationRecord = ArchiveState & {
  id: string;
  // The job applied for. Jobs with applications are archived, never deleted, so this stays valid.
  job: string;
  // Snapshots taken from the job at submission time (never from client input).
  jobSlug: string;
  jobTitle: string;
  department: string;
  name: string;
  email: string;
  // Lower-cased email; backs the one-application-per-job rule.
  emailNormalized: string;
  phone: string;
  coverLetter: string;
  linkedIn: string | null;
  portfolio: string | null;
  consentGiven: boolean;
  consentAt: Date | null;
  documents: StoredDocument[];
  status: ApplicationStatus;
  statusChangedAt: Date;
  // Append-only; every status change (including the initial submission) adds an entry.
  statusHistory: StatusHistoryEntryRecord[];
  // Append-only internal HR notes.
  notes: NoteEntry[];
  source: ApplicationSource;
  talentPoolEntry: string | null;
  // Set when a cross-instance race produced a second row for the same job and candidate; the
  // row that was written first wins and this one is hidden everywhere.
  supersededBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ── Talent pool ──────────────────────────────────────────────────────────────

export type TalentPoolRecord = ArchiveState & {
  id: string;
  name: string;
  email: string;
  // Lower-cased email; one talent-pool profile per person.
  emailNormalized: string;
  phone: string;
  areaOfInterest: string;
  // What the candidate wrote when submitting their profile.
  candidateNotes: string;
  tags: string[];
  notes: NoteEntry[];
  documents: StoredDocument[];
  consentGiven: boolean;
  consentAt: Date | null;
  source: TalentSource;
  sourceApplication: string | null;
  applications: string[];
  createdBy: string | null;
  // Profile timeline (created, linked application, tags changed, archived, ...).
  activity: TalentActivityRecord[];
  supersededBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ── Admin accounts and sessions ──────────────────────────────────────────────

export type AdminUserRecord = {
  id: string;
  email: string; // stored lower-cased
  name: string;
  role: AdminRole;
  // scrypt hash (see src/lib/auth/password.ts). Only loaded where it is actually needed.
  passwordHash: string;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  passwordChangedAt: Date;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminSessionRecord = {
  id: string;
  // SHA-256 of the random session token; the token itself only exists in the browser cookie.
  tokenHash: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  // Absolute expiry. Expired rows are cleared by the maintenance job (MongoDB's TTL monitor
  // used to do this).
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
  revokedAt: Date | null;
};

// ── Audit ────────────────────────────────────────────────────────────────────

export type AuditActor = {
  user: string;
  email: string;
  name: string;
  role: AdminRole;
};

export type AuditLogRecord = {
  id: string;
  at: Date;
  // null for public or system events (e.g. failed login for an unknown email, cron jobs).
  actor: AuditActor | null;
  // Dotted verb, e.g. "job.publish", "application.status_change", "document.download".
  action: string;
  entityType: string;
  entityId: string;
  // Human-readable one-liner shown in the admin audit view. Must not contain candidate PII
  // beyond what HR already sees (no emails, phone numbers or document contents).
  summary: string;
  meta: Record<string, unknown>;
  ip: string | null;
};

// ── Email outbox ─────────────────────────────────────────────────────────────

export const EMAIL_STATUSES = ["pending", "sending", "sent", "failed", "skipped"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export type EmailOutboxRecord = {
  id: string;
  to: string;
  replyTo: string | null;
  template: string;
  subject: string;
  text: string;
  html: string;
  status: EmailStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  // Set while a delivery run owns the message; a stale lock becomes claimable again once it
  // passes. `lockToken` identifies which run owns it - a worker only sends a message whose
  // token still matches the one it wrote a moment earlier.
  lockedUntil: Date | null;
  lockToken: string | null;
  lastError: string | null;
  related: { entityType: string; entityId: string } | null;
  sentAt: Date | null;
  // Set once delivered or given up; the maintenance job removes the row 180 days later.
  purgeAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
