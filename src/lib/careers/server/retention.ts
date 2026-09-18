// Data retention: applications and talent-pool profiles are kept for DATA_RETENTION_MONTHS
// (default 12) after they were created. The maintenance job reports overdue records and erases
// them when RETENTION_AUTO_PURGE=true. Server-only.
//
// The overdue set used to come from an indexed, time-capped MongoDB query. There is no index and
// no server-side time limit on a spreadsheet, so both tabs are read (through the store's cache,
// in a single batchGet) and filtered, sorted and limited here instead. The records themselves
// are unchanged: createdAt is immutable, so the clock below still produces the same answer it
// always did.

import { purgeApplicationRecord } from "@/lib/careers/server/applications";
import { compareByDateAsc } from "@/lib/careers/server/mappers";
import { purgeTalentRecord } from "@/lib/careers/server/talent-pool";
import { logger } from "@/lib/logger";
import { ensureStoreReady, loadTables } from "@/lib/sheets-db";
import { listAllApplications } from "@/lib/sheets-db/repositories/applications";
import { listAllTalent } from "@/lib/sheets-db/repositories/talent";

const DEFAULT_RETENTION_MONTHS = 12;

// Invalid values fall back to the default; src/lib/env.ts reports them as configuration problems.
export function retentionMonths(): number {
  const raw = process.env.DATA_RETENTION_MONTHS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_RETENTION_MONTHS;
  const months = Number.parseInt(raw, 10);
  return months >= 1 && months <= 120 ? months : DEFAULT_RETENTION_MONTHS;
}

// Adds calendar months in UTC, clamping to the last day of the target month (31 Jan + 1 → 28/29 Feb).
// Exported because the maintenance job needs the same arithmetic for the audit-log trim.
export function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function retentionDueAt(createdAt: Date): Date {
  return addCalendarMonths(new Date(createdAt), retentionMonths());
}

type OverdueRow = { id: string; createdAt: Date };

// A record is overdue once createdAt + months <= now, i.e. createdAt <= now - months.
function overdueCutoff(now: Date): Date {
  return addCalendarMonths(now, -retentionMonths());
}

// Oldest first, with the id as the tie-breaker - the sort({createdAt:1, _id:1}) the index used
// to provide, so two records written in the same second keep a stable order between runs.
function overdueOf(rows: { id: string; createdAt: Date }[], cutoff: Date, size: number): OverdueRow[] {
  return rows
    .filter((row) => row.createdAt.getTime() <= cutoff.getTime())
    .map((row) => ({ id: row.id, createdAt: new Date(row.createdAt) }))
    .sort(
      compareByDateAsc<OverdueRow>(
        (row) => row.createdAt,
        (row) => row.id
      )
    )
    .slice(0, size);
}

async function findOverdueRows(now: Date, limit: number): Promise<{ applications: OverdueRow[]; talent: OverdueRow[] }> {
  const size = Math.max(0, Math.floor(limit));
  if (size === 0) return { applications: [], talent: [] };
  const cutoff = overdueCutoff(now);
  // Erasure decides on the state of the sheet right now, not on a cached copy that may be a few
  // seconds old. Both tabs are refreshed in one batchGet; the repository reads below then come
  // straight from that.
  await loadTables(["Applications", "TalentPool"], { maxAgeMs: 0 });
  const [applications, talent] = await Promise.all([listAllApplications(), listAllTalent()]);
  return { applications: overdueOf(applications, cutoff, size), talent: overdueOf(talent, cutoff, size) };
}

// Oldest overdue records first, at most `limit` of each kind.
export async function findRetentionOverdue(
  limit: number
): Promise<{ applications: { id: string; createdAt: Date }[]; talent: { id: string; createdAt: Date }[] }> {
  ensureStoreReady();
  return findOverdueRows(new Date(), limit);
}

// System erasure of overdue records (archived or not), using the same purge path as HR erasure.
// Applications go first so talent profiles are unlinked from them before their own purge.
// A failure on one record (e.g. storage unavailable) is counted and the rest continue.
export async function purgeRetentionOverdue(limit: number): Promise<{ applications: number; talent: number; errors: number }> {
  ensureStoreReady();
  const rows = await findOverdueRows(new Date(), limit);
  const result = { applications: 0, talent: 0, errors: 0 };

  for (const row of rows.applications) {
    try {
      await purgeApplicationRecord(row.id, { actor: null, ip: null, requireArchived: false, action: "retention.purge" });
      result.applications += 1;
    } catch (err) {
      result.errors += 1;
      logger.error("retention.purge_failed", { recordType: "application", recordId: row.id, err });
    }
  }
  for (const row of rows.talent) {
    try {
      await purgeTalentRecord(row.id, { actor: null, ip: null, requireArchived: false, action: "retention.purge" });
      result.talent += 1;
    } catch (err) {
      result.errors += 1;
      logger.error("retention.purge_failed", { recordType: "talent", recordId: row.id, err });
    }
  }

  if (result.applications > 0 || result.talent > 0 || result.errors > 0) {
    logger.info("retention.purge_completed", { ...result, months: retentionMonths() });
  }
  return result;
}
