import { findRetentionOverdue, purgeRetentionOverdue } from "@/lib/careers/server/retention";
import { deliverEmails, type DeliveryResult } from "@/lib/email/outbox";
import { logger } from "@/lib/logger";
import { connectToDatabase } from "@/lib/mongodb";
import { deleteObject, isStorageConfigured, listObjectsOlderThan } from "@/lib/storage";

// Periodic housekeeping, run by the Vercel cron route (/api/cron/maintenance) or
// `npm run jobs:maintenance`: retries queued emails, removes abandoned uploads and applies the
// data retention policy. Safe to run concurrently and repeatedly.

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
  durationMs: number;
};

const INCOMING_PREFIX = "incoming/";
// Uploads are claimed within UPLOAD_LIMITS.intentTtlSeconds (2 hours); anything older than a day
// under incoming/ was never submitted.
const INCOMING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const INCOMING_DELETE_LIMIT = 500;
const DELETE_CONCURRENCY = 8;
const RETENTION_REPORT_LIMIT = 1000;
const RETENTION_PURGE_LIMIT = 100;
const EMAIL_BATCH_LIMIT = 200;

async function sweepIncomingUploads(now: Date): Promise<MaintenanceReport["uploads"]> {
  const result = { deletedObjects: 0, errors: 0 };
  if (!isStorageConfigured()) {
    logger.warn("maintenance.uploads_skipped", { reason: "storage_not_configured" });
    return result;
  }
  let stale: { key: string }[];
  try {
    stale = await listObjectsOlderThan(INCOMING_PREFIX, new Date(now.getTime() - INCOMING_MAX_AGE_MS), INCOMING_DELETE_LIMIT);
  } catch (err) {
    logger.error("maintenance.uploads_list_failed", { err });
    result.errors += 1;
    return result;
  }
  for (let index = 0; index < stale.length; index += DELETE_CONCURRENCY) {
    const batch = stale.slice(index, index + DELETE_CONCURRENCY);
    const outcomes = await Promise.allSettled(batch.map((item) => deleteObject(item.key)));
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") result.deletedObjects += 1;
      else result.errors += 1;
    }
  }
  if (result.errors > 0) logger.warn("maintenance.uploads_delete_failed", { errors: result.errors });
  return result;
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

export async function runMaintenance(options: { now?: Date } = {}): Promise<MaintenanceReport> {
  const started = Date.now();
  const now = options.now ?? new Date();
  await connectToDatabase();

  const uploads = await sweepIncomingUploads(now);
  // Retention runs before email delivery so messages about purged records are removed, not sent.
  const retention = await applyRetention();
  const emails = await deliverEmails(undefined, EMAIL_BATCH_LIMIT);

  const report: MaintenanceReport = { emails, uploads, retention, durationMs: Date.now() - started };
  logger.info("maintenance.completed", {
    emails: report.emails,
    uploads: report.uploads,
    retention: report.retention,
    durationMs: report.durationMs,
  });
  return report;
}
