// Dashboard counters for the admin portal. Server-only.
//
// MongoDB answered this with nine parallel counts and aggregations. There is no aggregation
// pipeline here, so the four tabs the dashboard summarises are loaded in one batchGet and counted
// in this process: one Google API call for the whole dashboard instead of nine queries, and the
// loaded tabs stay in the store's cache for the rest of the request.

import { APPLICATION_STATUSES, JOB_STATUSES, type ApplicationStatus, type JobStatus } from "@/lib/careers/constants";
import { ensureStoreReady, loadTables } from "@/lib/sheets-db";
import { listAllApplications } from "@/lib/sheets-db/repositories/applications";
import { countEmailsByStatus } from "@/lib/sheets-db/repositories/email";
import { listAllJobs } from "@/lib/sheets-db/repositories/jobs";
import { listAllTalent } from "@/lib/sheets-db/repositories/talent";
import type { AdminStats } from "@/types/careers";

const DAY_MS = 24 * 60 * 60 * 1000;

// Every key of the enum is present even at zero, so the dashboard never has to guard against a
// missing status. This is what countsByKey() guaranteed when it seeded the counters from the
// status list before filling in the aggregation rows.
function zeroFilled<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

// A job is "open" when it is published and its deadline has not passed - the same rule the public
// site uses to decide what is visible. It is an extra key alongside the four status counts and
// deliberately overlaps with `published`.
function isOpen(job: { status: JobStatus; applicationDeadline: Date | null }, now: Date): boolean {
  if (job.status !== "published") return false;
  return job.applicationDeadline === null || job.applicationDeadline.getTime() >= now.getTime();
}

export async function getAdminStats(): Promise<AdminStats> {
  ensureStoreReady();
  const now = new Date();
  const since = now.getTime() - 7 * DAY_MS;

  // One batchGet for the four tabs; the repository calls below read the cached copies.
  await loadTables(["Jobs", "Applications", "TalentPool", "EmailOutbox"]);
  const [jobs, applications, talent, emails] = await Promise.all([
    listAllJobs(),
    listAllApplications(),
    listAllTalent(),
    countEmailsByStatus(),
  ]);

  // Jobs are counted including archived ones, as the aggregation did.
  const jobCounts = zeroFilled<JobStatus>(JOB_STATUSES);
  let openJobs = 0;
  for (const job of jobs) {
    jobCounts[job.status] += 1;
    if (isOpen(job, now)) openJobs += 1;
  }

  // `total` is the number of NON-archived applications: it is the sum of the per-status counts
  // below, exactly as the previous implementation summed the aggregation rows, and it excludes
  // archived records (which are reported separately).
  const byStatus = zeroFilled<ApplicationStatus>(APPLICATION_STATUSES);
  let applicationTotal = 0;
  let archivedApplications = 0;
  let last7Days = 0;
  for (const application of applications) {
    if (application.archivedAt !== null) {
      archivedApplications += 1;
      continue;
    }
    applicationTotal += 1;
    byStatus[application.status] += 1;
    if (application.createdAt.getTime() >= since) last7Days += 1;
  }

  let talentTotal = 0;
  let talentArchived = 0;
  for (const entry of talent) {
    if (entry.archivedAt !== null) talentArchived += 1;
    else talentTotal += 1;
  }

  return {
    jobs: { ...jobCounts, open: openJobs },
    applications: {
      total: applicationTotal,
      archived: archivedApplications,
      last7Days,
      byStatus,
    },
    talentPool: { total: talentTotal, archived: talentArchived },
    // "sending" rows are still awaiting a delivery result, so they count as pending.
    emails: { pending: emails.pending + emails.sending, failed: emails.failed },
  };
}
