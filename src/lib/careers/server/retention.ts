// Data retention: applications and talent-pool profiles are kept for DATA_RETENTION_MONTHS
// (default 12) after they were created. The maintenance job reports overdue records and erases
// them when RETENTION_AUTO_PURGE=true. Server-only.

import type { Types } from "mongoose";
import { purgeApplicationRecord } from "@/lib/careers/server/applications";
import { purgeTalentRecord } from "@/lib/careers/server/talent-pool";
import { logger } from "@/lib/logger";
import { connectToDatabase } from "@/lib/mongodb";
import { ApplicationModel } from "@/models/application";
import { TalentPoolEntryModel } from "@/models/talent-pool-entry";

const DEFAULT_RETENTION_MONTHS = 12;
const RETENTION_QUERY_MAX_TIME_MS = 30_000;

// Invalid values fall back to the default; src/lib/env.ts reports them as configuration problems.
export function retentionMonths(): number {
  const raw = process.env.DATA_RETENTION_MONTHS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_RETENTION_MONTHS;
  const months = Number.parseInt(raw, 10);
  return months >= 1 && months <= 120 ? months : DEFAULT_RETENTION_MONTHS;
}

// Adds calendar months in UTC, clamping to the last day of the target month (31 Jan + 1 → 28/29 Feb).
function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function retentionDueAt(createdAt: Date): Date {
  return addMonths(new Date(createdAt), retentionMonths());
}

type OverdueRow = { _id: Types.ObjectId; createdAt: Date };

// A record is overdue once createdAt + months <= now, i.e. createdAt <= now - months.
function overdueCutoff(now: Date): Date {
  return addMonths(now, -retentionMonths());
}

async function findOverdueRows(now: Date, limit: number) {
  const cutoff = overdueCutoff(now);
  const size = Math.max(0, Math.floor(limit));
  if (size === 0) return { applications: [] as OverdueRow[], talent: [] as OverdueRow[] };
  const [applications, talent] = await Promise.all([
    ApplicationModel.find({ createdAt: { $lte: cutoff } })
      .select({ _id: 1, createdAt: 1 })
      .sort({ createdAt: 1, _id: 1 })
      .limit(size)
      .maxTimeMS(RETENTION_QUERY_MAX_TIME_MS)
      .lean<OverdueRow[]>(),
    TalentPoolEntryModel.find({ createdAt: { $lte: cutoff } })
      .select({ _id: 1, createdAt: 1 })
      .sort({ createdAt: 1, _id: 1 })
      .limit(size)
      .maxTimeMS(RETENTION_QUERY_MAX_TIME_MS)
      .lean<OverdueRow[]>(),
  ]);
  return { applications, talent };
}

// Oldest overdue records first, at most `limit` of each kind.
export async function findRetentionOverdue(
  limit: number
): Promise<{ applications: { id: string; createdAt: Date }[]; talent: { id: string; createdAt: Date }[] }> {
  await connectToDatabase();
  const rows = await findOverdueRows(new Date(), limit);
  const toResult = (row: OverdueRow) => ({ id: String(row._id), createdAt: new Date(row.createdAt) });
  return { applications: rows.applications.map(toResult), talent: rows.talent.map(toResult) };
}

// System erasure of overdue records (archived or not), using the same purge path as HR erasure.
// Applications go first so talent profiles are unlinked from them before their own purge.
// A failure on one record (e.g. storage unavailable) is counted and the rest continue.
export async function purgeRetentionOverdue(limit: number): Promise<{ applications: number; talent: number; errors: number }> {
  await connectToDatabase();
  const rows = await findOverdueRows(new Date(), limit);
  const result = { applications: 0, talent: 0, errors: 0 };

  for (const row of rows.applications) {
    try {
      await purgeApplicationRecord(row._id, { actor: null, ip: null, requireArchived: false, action: "retention.purge" });
      result.applications += 1;
    } catch (err) {
      result.errors += 1;
      logger.error("retention.purge_failed", { recordType: "application", recordId: String(row._id), err });
    }
  }
  for (const row of rows.talent) {
    try {
      await purgeTalentRecord(row._id, { actor: null, ip: null, requireArchived: false, action: "retention.purge" });
      result.talent += 1;
    } catch (err) {
      result.errors += 1;
      logger.error("retention.purge_failed", { recordType: "talent", recordId: String(row._id), err });
    }
  }

  if (result.applications > 0 || result.talent > 0 || result.errors > 0) {
    logger.info("retention.purge_completed", { ...result, months: retentionMonths() });
  }
  return result;
}
