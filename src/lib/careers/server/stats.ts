// Dashboard counters for the admin portal. Server-only.

import { APPLICATION_STATUSES, JOB_STATUSES, type ApplicationStatus, type JobStatus } from "@/lib/careers/constants";
import { openJobFilter } from "@/lib/careers/server/jobs";
import { LIST_MAX_TIME_MS } from "@/lib/careers/server/mappers";
import { connectToDatabase } from "@/lib/mongodb";
import { ApplicationModel } from "@/models/application";
import { EmailOutboxModel } from "@/models/email-outbox";
import { JobModel } from "@/models/job";
import { TalentPoolEntryModel } from "@/models/talent-pool-entry";
import type { AdminStats } from "@/types/careers";

const DAY_MS = 24 * 60 * 60 * 1000;

type CountRow = { _id: string | null; count: number };

function countsByKey<K extends string>(keys: readonly K[], rows: CountRow[]): Record<K, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const row of rows) {
    if (row._id !== null && (keys as readonly string[]).includes(row._id)) counts[row._id as K] = row.count;
  }
  return counts;
}

export async function getAdminStats(): Promise<AdminStats> {
  await connectToDatabase();
  const since = new Date(Date.now() - 7 * DAY_MS);

  const [
    jobRows,
    openJobs,
    applicationRows,
    archivedApplications,
    recentApplications,
    talentTotal,
    talentArchived,
    pendingEmails,
    failedEmails,
  ] = await Promise.all([
    JobModel.aggregate<CountRow>([{ $group: { _id: "$status", count: { $sum: 1 } } }]).option({ maxTimeMS: LIST_MAX_TIME_MS }),
    JobModel.countDocuments(openJobFilter()).maxTimeMS(LIST_MAX_TIME_MS),
    ApplicationModel.aggregate<CountRow>([
      { $match: { archivedAt: null } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).option({ maxTimeMS: LIST_MAX_TIME_MS }),
    ApplicationModel.countDocuments({ archivedAt: { $ne: null } }).maxTimeMS(LIST_MAX_TIME_MS),
    ApplicationModel.countDocuments({ archivedAt: null, createdAt: { $gte: since } }).maxTimeMS(LIST_MAX_TIME_MS),
    TalentPoolEntryModel.countDocuments({ archivedAt: null }).maxTimeMS(LIST_MAX_TIME_MS),
    TalentPoolEntryModel.countDocuments({ archivedAt: { $ne: null } }).maxTimeMS(LIST_MAX_TIME_MS),
    // "sending" rows are still awaiting a delivery result.
    EmailOutboxModel.countDocuments({ status: { $in: ["pending", "sending"] } }).maxTimeMS(LIST_MAX_TIME_MS),
    EmailOutboxModel.countDocuments({ status: "failed" }).maxTimeMS(LIST_MAX_TIME_MS),
  ]);

  const byStatus = countsByKey<ApplicationStatus>(APPLICATION_STATUSES, applicationRows);
  const jobs = countsByKey<JobStatus>(JOB_STATUSES, jobRows);

  return {
    jobs: { ...jobs, open: openJobs },
    applications: {
      total: applicationRows.reduce((sum, row) => sum + row.count, 0),
      archived: archivedApplications,
      last7Days: recentApplications,
      byStatus,
    },
    talentPool: { total: talentTotal, archived: talentArchived },
    emails: { pending: pendingEmails, failed: failedEmails },
  };
}
