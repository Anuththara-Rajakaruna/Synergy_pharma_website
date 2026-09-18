import { addCalendarMonths, findRetentionOverdue, purgeRetentionOverdue } from "@/lib/careers/server/retention";
import { sweepStagedUploads } from "@/lib/careers/server/uploads";
import { deliverEmails, type DeliveryResult } from "@/lib/email/outbox";
import { logger } from "@/lib/logger";
import { deleteRows, ensureStoreReady, isStoreConfigured, withLock } from "@/lib/sheets-db";
import { expiredSessionRows } from "@/lib/sheets-db/repositories/admin";
import { auditRowsOlderThan } from "@/lib/sheets-db/repositories/audit";
import { purgeableEmailRows } from "@/lib/sheets-db/repositories/email";

// Periodic housekeeping, run by the Vercel cron route (/api/cron/maintenance) or
// `npm run jobs:maintenance`: retries queued emails, removes abandoned uploads, applies the data
// retention policy and trims the rows MongoDB's TTL monitor used to remove on its own. Safe to
// run concurrently and repeatedly.
//
// Every step is independent and every step is allowed to fail on its own: a Drive outage must
// not stop the email queue from draining, and a failing retention sweep must not leave expired
// sessions in the sheet. Failures are counted in `errors` and logged with their own event.

export type SweepResult = { deletedRows: number; errors: number };

export type MaintenanceReport = {
  emails: DeliveryResult;
  uploads: { deletedObjects: number; errors: number };
  retention: {
    overdueApplications: number;
    overdueTalent: number;
    purgedApplications: number;
    purgedTalent: number;
    autoPurge: boolean;
  };
  // Replaces the expiresAt TTL index on the admin sessions collection.
  sessions: SweepResult;
  // Replaces the 180-day purgeAt TTL index on the email outbox collection.
  outboxRows: SweepResult;
  // New: MongoDB let the audit log grow without limit. A spreadsheet cannot.
  auditLog: SweepResult & { olderThanMonths: number };
  // How many of the six steps failed outright. Zero on a healthy run.
  errors: number;
  durationMs: number;
};

// Uploads are claimed within UPLOAD_LIMITS.intentTtlSeconds (2 hours); anything left in the
// staging folder for a day was never submitted.
const STAGED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STAGED_DELETE_LIMIT = 500;
const RETENTION_REPORT_LIMIT = 1000;
const RETENTION_PURGE_LIMIT = 100;
const EMAIL_BATCH_LIMIT = 200;

// A session row is removed once it has been expired or revoked for this long. MongoDB's TTL
// monitor deleted at expiresAt (give or take its own minute); the grace covers clock skew
// between instances and keeps a just-revoked session visible for a moment.
const SESSION_GRACE_MS = 60 * 60 * 1000;
// The old TTL index: expireAfterSeconds 180 * 24 * 60 * 60 on purgeAt. Only sent, failed and
// skipped messages ever get a purgeAt, so nothing still queued is swept up.
const OUTBOX_PURGE_AFTER_MS = 180 * 24 * 60 * 60 * 1000;
const DEFAULT_AUDIT_RETENTION_MONTHS = 24;

// Deleting a row shifts every row below it, so a sweep re-reads the tab, deletes, and drops the
// cache. Each sweep is capped per run and the oldest rows go first - they sit together at the
// top of the tab, so the cap also keeps the delete request to a handful of ranges. Whatever is
// left over goes in the next run.
const ROW_DELETE_LIMIT = 500;
// Two sweeps inside one process must not compute row numbers from the same read and then both
// delete: the second would delete rows that have already moved.
const ROW_SWEEP_LOCK = "maintenance-row-sweep";

// How long audit entries are kept. This bound is new. MongoDB was happy to hold an unbounded
// audit collection, but a Google spreadsheet is capped at 10,000,000 cells across every tab -
// roughly 550,000 rows at these column counts, shared with jobs, applications, talent and the
// outbox - so the audit tab, the one tab that only ever grows, needs a ceiling or it will
// eventually take the whole workbook down with it. Invalid values fall back to the default.
export function auditRetentionMonths(): number {
  const raw = process.env.AUDIT_RETENTION_MONTHS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_AUDIT_RETENTION_MONTHS;
  const months = Number.parseInt(raw, 10);
  return months >= 1 && months <= 120 ? months : DEFAULT_AUDIT_RETENTION_MONTHS;
}

// Files that were uploaded but never attached to a submission. Drive has folders rather than key
// prefixes, so "everything under incoming/" is now "everything in the staging folder".
async function sweepStagedDocuments(now: Date): Promise<MaintenanceReport["uploads"]> {
  if (!isStoreConfigured()) {
    logger.warn("maintenance.uploads_skipped", { reason: "storage_not_configured" });
    return { deletedObjects: 0, errors: 0 };
  }
  const swept = await sweepStagedUploads(new Date(now.getTime() - STAGED_MAX_AGE_MS), STAGED_DELETE_LIMIT);
  // A file Drive refused to delete is counted and retried on the next run.
  if (swept.failed > 0) logger.warn("maintenance.uploads_delete_failed", { errors: swept.failed });
  return { deletedObjects: swept.deleted, errors: swept.failed };
}

async function applyRetention(): Promise<MaintenanceReport["retention"]> {
  const autoPurge = process.env.RETENTION_AUTO_PURGE?.trim() === "true";
  const overdue = await findRetentionOverdue(RETENTION_REPORT_LIMIT);
  const report = {
    overdueApplications: overdue.applications.length,
    overdueTalent: overdue.talent.length,
    purgedApplications: 0,
    purgedTalent: 0,
    autoPurge,
  };
  if (autoPurge && (report.overdueApplications > 0 || report.overdueTalent > 0)) {
    const purged = await purgeRetentionOverdue(RETENTION_PURGE_LIMIT);
    report.purgedApplications = purged.applications;
    report.purgedTalent = purged.talent;
    if (purged.errors > 0) logger.warn("maintenance.retention_purge_errors", { errors: purged.errors });
  } else if (report.overdueApplications > 0 || report.overdueTalent > 0) {
    logger.warn("maintenance.retention_overdue", {
      applications: report.overdueApplications,
      talent: report.overdueTalent,
    });
  }
  return report;
}

// Deletes the given rows under the sweep lock, oldest first and capped for this run. The row
// numbers are read inside the lock so nothing can move between reading them and deleting them.
async function deleteOldestRows(
  table: "AdminSessions" | "EmailOutbox" | "AuditLog",
  rowsOf: () => Promise<number[]>,
  events: { swept: string; failed: string }
): Promise<SweepResult> {
  const result: SweepResult = { deletedRows: 0, errors: 0 };
  try {
    result.deletedRows = await withLock(ROW_SWEEP_LOCK, async () => {
      const rows = (await rowsOf()).sort((a, b) => a - b).slice(0, ROW_DELETE_LIMIT);
      if (rows.length === 0) return 0;
      return deleteRows(table, rows);
    });
    if (result.deletedRows > 0) logger.info(events.swept, { rows: result.deletedRows });
  } catch (err) {
    result.errors += 1;
    logger.error(events.failed, { err });
  }
  return result;
}

export async function runMaintenance(options: { now?: Date } = {}): Promise<MaintenanceReport> {
  const started = Date.now();
  const now = options.now ?? new Date();
  ensureStoreReady();
  let errors = 0;

  let uploads: MaintenanceReport["uploads"] = { deletedObjects: 0, errors: 0 };
  try {
    uploads = await sweepStagedDocuments(now);
  } catch (err) {
    errors += 1;
    uploads = { deletedObjects: 0, errors: 1 };
    logger.error("maintenance.uploads_list_failed", { err });
  }

  // Retention runs before email delivery so messages about purged records are removed, not sent.
  let retention: MaintenanceReport["retention"] = {
    overdueApplications: 0,
    overdueTalent: 0,
    purgedApplications: 0,
    purgedTalent: 0,
    autoPurge: process.env.RETENTION_AUTO_PURGE?.trim() === "true",
  };
  try {
    retention = await applyRetention();
  } catch (err) {
    errors += 1;
    logger.error("maintenance.retention_failed", { err });
  }

  let emails: DeliveryResult = { sent: 0, failed: 0, retried: 0, skipped: 0 };
  try {
    emails = await deliverEmails(undefined, EMAIL_BATCH_LIMIT);
  } catch (err) {
    errors += 1;
    logger.error("maintenance.email_delivery_failed", { err });
  }

  // The row sweeps run last: deleting rows shifts every row below them and drops the whole read
  // cache, so everything that wanted a warm copy of a tab has had it by now.
  const sessions = await deleteOldestRows("AdminSessions", () => expiredSessionRows(now, SESSION_GRACE_MS), {
    swept: "maintenance.sessions_swept",
    failed: "maintenance.sessions_sweep_failed",
  });
  const outboxRows = await deleteOldestRows("EmailOutbox", () => purgeableEmailRows(now, OUTBOX_PURGE_AFTER_MS), {
    swept: "maintenance.outbox_swept",
    failed: "maintenance.outbox_sweep_failed",
  });
  const olderThanMonths = auditRetentionMonths();
  const auditCutoff = addCalendarMonths(now, -olderThanMonths);
  const auditTrim = await deleteOldestRows("AuditLog", () => auditRowsOlderThan(auditCutoff), {
    swept: "maintenance.audit_trimmed",
    failed: "maintenance.audit_trim_failed",
  });

  errors += sessions.errors + outboxRows.errors + auditTrim.errors;

  const report: MaintenanceReport = {
    emails,
    uploads,
    retention,
    sessions,
    outboxRows,
    auditLog: { ...auditTrim, olderThanMonths },
    errors,
    durationMs: Date.now() - started,
  };
  logger.info("maintenance.completed", {
    emails: report.emails,
    uploads: report.uploads,
    retention: report.retention,
    sessions: report.sessions,
    outboxRows: report.outboxRows,
    auditLog: report.auditLog,
    errors: report.errors,
    durationMs: report.durationMs,
  });
  return report;
}
