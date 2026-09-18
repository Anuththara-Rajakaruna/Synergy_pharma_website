// The shape of the Google Spreadsheet that backs the careers portal.
//
// One tab per record type, one row per record, one column per field. Row 1 always holds the
// column names and is frozen; the store maps names to positions by reading that row, so a
// column that is moved or an extra column added by hand in the sheet does not break anything.
//
// Two structural rules make this work as a database:
//
//   1. Rows are never deleted during normal operation. Records are archived with a flag, exactly
//      as they were under MongoDB. Row numbers therefore stay stable, which is what lets a cached
//      read address a row for a later write. Only the retention purge deletes rows, and it
//      invalidates the whole cache afterwards.
//
//   2. Sub-records that MongoDB embedded in an array (documents, notes, status history, talent
//      activity) get their own append-only tab keyed by the owning record's id. Appending a note
//      is then one append of one row instead of a read-modify-write of a whole record, so two
//      admins adding notes at the same time cannot overwrite each other.

export const SCHEMA_VERSION = "2";

export type TableName =
  | "Jobs"
  | "Applications"
  | "TalentPool"
  | "Documents"
  | "Notes"
  | "StatusHistory"
  | "TalentActivity"
  | "AdminUsers"
  | "AdminSessions"
  | "AuditLog"
  | "EmailOutbox"
  | "Settings";

export type TableDefinition = {
  title: TableName;
  columns: readonly string[];
  // Shown in the sheet so someone opening the document knows what they are looking at.
  description: string;
  // Columns holding personal data. Used by the bootstrap script to warn when the sheet is shared
  // more widely than the service account.
  sensitive?: readonly string[];
};

// ── Jobs ─────────────────────────────────────────────────────────────────────

export const JOBS_COLUMNS = [
  "id",
  "slug",
  "title",
  "department",
  "location",
  "type",
  "experience",
  "description",
  "responsibilities",
  "requirements",
  "qualifications",
  "benefits",
  "applicationDeadline",
  "status",
  "publishedAt",
  "closedAt",
  "archivedAt",
  "createdBy",
  "createdByName",
  "updatedBy",
  "updatedByName",
  "origin",
  "createdAt",
  "updatedAt",
] as const;

// ── Applications ─────────────────────────────────────────────────────────────

export const APPLICATIONS_COLUMNS = [
  "id",
  "reference",
  "jobId",
  "jobSlug",
  "jobTitle",
  "department",
  "name",
  "email",
  "emailNormalized",
  "phone",
  "coverLetter",
  "linkedIn",
  "portfolio",
  "consentGiven",
  "consentAt",
  "status",
  "statusChangedAt",
  "source",
  "talentPoolEntryId",
  "archivedAt",
  "archivedBy",
  "archivedByName",
  "archiveReason",
  // Set when a cross-instance race produced a second row for the same job and candidate. The
  // duplicate is hidden everywhere and points at the row that won.
  "supersededBy",
  "createdAt",
  "updatedAt",
] as const;

// ── Talent pool ──────────────────────────────────────────────────────────────

export const TALENT_POOL_COLUMNS = [
  "id",
  "name",
  "email",
  "emailNormalized",
  "phone",
  "areaOfInterest",
  "candidateNotes",
  "tags",
  "consentGiven",
  "consentAt",
  "source",
  "sourceApplicationId",
  "applicationIds",
  "createdBy",
  "archivedAt",
  "archivedBy",
  "archivedByName",
  "archiveReason",
  "supersededBy",
  "createdAt",
  "updatedAt",
] as const;

// ── Sub-records ──────────────────────────────────────────────────────────────

// A candidate document. The bytes live in Google Drive; this row is the index entry.
export const DOCUMENTS_COLUMNS = [
  "id",
  // "application" | "talent"
  "ownerType",
  "ownerId",
  // "cv" | "supporting"
  "kind",
  "driveFileId",
  "originalName",
  "size",
  "contentType",
  "uploadedAt",
  // Set instead of deleting the row when the document is erased.
  "deletedAt",
] as const;

export const NOTES_COLUMNS = ["id", "ownerType", "ownerId", "body", "authorId", "authorName", "createdAt"] as const;

export const STATUS_HISTORY_COLUMNS = [
  "id",
  "applicationId",
  "from",
  "to",
  "changedAt",
  "changedBy",
  "changedByName",
  "note",
  "candidateNotified",
] as const;

export const TALENT_ACTIVITY_COLUMNS = ["id", "talentId", "action", "at", "actorId", "actorName", "detail"] as const;

// ── Administration ───────────────────────────────────────────────────────────

export const ADMIN_USERS_COLUMNS = [
  "id",
  "email",
  "name",
  "role",
  // scrypt hash; see src/lib/auth/password.ts. Never leaves the server.
  "passwordHash",
  "active",
  "mustChangePassword",
  "lastLoginAt",
  "failedLoginAttempts",
  "lockedUntil",
  "passwordChangedAt",
  "createdBy",
  "createdAt",
  "updatedAt",
] as const;

// Replaces MongoDB's TTL-expiring sessions collection. Expired rows are removed by the
// maintenance job rather than by the database.
export const ADMIN_SESSIONS_COLUMNS = [
  "id",
  // SHA-256 of the cookie token; the token itself only ever exists in the browser.
  "tokenHash",
  "userId",
  "createdAt",
  "lastSeenAt",
  "expiresAt",
  "ip",
  "userAgent",
  "revokedAt",
] as const;

export const AUDIT_LOG_COLUMNS = [
  "id",
  "at",
  "actorId",
  "actorEmail",
  "actorName",
  "actorRole",
  "action",
  "entityType",
  "entityId",
  "summary",
  "meta",
  "ip",
] as const;

export const EMAIL_OUTBOX_COLUMNS = [
  "id",
  "to",
  "replyTo",
  "template",
  "subject",
  "text",
  "html",
  "status",
  "attempts",
  "maxAttempts",
  "nextAttemptAt",
  "lockedUntil",
  // Random value written by the delivery run that claimed the message. A worker only sends a
  // message whose token still matches the one it wrote, which is how two concurrent runs avoid
  // sending the same message twice without a conditional update.
  "lockToken",
  "lastError",
  "relatedType",
  "relatedId",
  "sentAt",
  "purgeAt",
  "createdAt",
  "updatedAt",
] as const;

export const SETTINGS_COLUMNS = ["key", "value", "updatedAt", "description"] as const;

// ── Table registry ───────────────────────────────────────────────────────────

export const TABLES: Record<TableName, TableDefinition> = {
  Jobs: {
    title: "Jobs",
    columns: JOBS_COLUMNS,
    description: "Job vacancies. Only rows with status=published and an unexpired deadline appear on the public site.",
  },
  Applications: {
    title: "Applications",
    columns: APPLICATIONS_COLUMNS,
    description: "Job applications submitted from the website. One row per application.",
    sensitive: ["name", "email", "emailNormalized", "phone", "coverLetter", "linkedIn", "portfolio"],
  },
  TalentPool: {
    title: "TalentPool",
    columns: TALENT_POOL_COLUMNS,
    description: "Speculative candidate profiles, submitted by candidates or added by HR.",
    sensitive: ["name", "email", "emailNormalized", "phone", "candidateNotes"],
  },
  Documents: {
    title: "Documents",
    columns: DOCUMENTS_COLUMNS,
    description: "Index of CVs and supporting documents. The files themselves are in the Google Drive folder.",
    sensitive: ["originalName"],
  },
  Notes: { title: "Notes", columns: NOTES_COLUMNS, description: "Internal HR notes on applications and talent profiles.", sensitive: ["body"] },
  StatusHistory: {
    title: "StatusHistory",
    columns: STATUS_HISTORY_COLUMNS,
    description: "Append-only record of every application status change, including the initial submission.",
  },
  TalentActivity: { title: "TalentActivity", columns: TALENT_ACTIVITY_COLUMNS, description: "Timeline of changes to each talent pool profile." },
  AdminUsers: {
    title: "AdminUsers",
    columns: ADMIN_USERS_COLUMNS,
    description: "Administrator and HR accounts. Password hashes are scrypt; they are not reversible.",
    sensitive: ["email", "passwordHash"],
  },
  AdminSessions: {
    title: "AdminSessions",
    columns: ADMIN_SESSIONS_COLUMNS,
    description: "Signed-in admin sessions. Expired rows are cleared by the maintenance job.",
    sensitive: ["tokenHash", "ip", "userAgent"],
  },
  AuditLog: {
    title: "AuditLog",
    columns: AUDIT_LOG_COLUMNS,
    description: "Who did what, when. Append-only.",
    sensitive: ["actorEmail", "ip"],
  },
  EmailOutbox: {
    title: "EmailOutbox",
    columns: EMAIL_OUTBOX_COLUMNS,
    description: "Outgoing email queue. A message is written here first and delivered afterwards, so a mail outage never loses it.",
    sensitive: ["to", "subject", "text", "html"],
  },
  Settings: {
    title: "Settings",
    columns: SETTINGS_COLUMNS,
    description: "Schema version and operational settings. Do not rename the key column.",
  },
};

export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

// Tabs the application reads on nearly every admin request. Loaded together in a single
// batchGet so a page view costs one Google API call rather than one per tab.
export const CORE_TABLES: TableName[] = ["Jobs", "Applications", "TalentPool"];

export type OwnerType = "application" | "talent";

export const SETTINGS_KEYS = {
  schemaVersion: "schema.version",
  createdAt: "schema.createdAt",
  lastMaintenanceAt: "maintenance.lastRunAt",
  lastRetentionReportAt: "retention.lastReportAt",
} as const;
