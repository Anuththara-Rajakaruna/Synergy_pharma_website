// Audit trail of security-relevant and data-changing admin actions. Writing an entry never
// fails the action being audited; a failed write is logged instead.
//
// Entries are rows on the AuditLog tab, appended and never updated or deleted. Because a Google
// Sheets append is a network round trip sitting on the request path of every mutation, writes go
// through the repository's buffer: recordAudit() clips and queues the entry and returns, and the
// queue is flushed a moment later as a single append (or on demand - scripts call
// flushAuditLog() before exiting). The exception is the small set of actions whose entry must be
// durable before the response leaves, which are written straight through; see DURABLE_ACTIONS.

import { newId } from "@/lib/careers/server/ids";
import { compareByDateDesc, paginate, toPaginated } from "@/lib/careers/server/mappers";
import type { AuditActor, AuditLogRecord } from "@/lib/careers/server/records";
import { logger } from "@/lib/logger";
import { ensureStoreReady } from "@/lib/sheets-db";
import {
  flushAuditBuffer,
  listAuditRecords,
  queueAuditRecord,
  writeAuditRecordNow,
} from "@/lib/sheets-db/repositories/audit";
import type { AuditLogEntry, Paginated } from "@/types/careers";

export type AuditEntryInput = {
  actor: AuditActor | null;
  action: string;
  entityType: string;
  entityId: string;
  // Shown to administrators. Never include candidate emails, phone numbers or note bodies.
  summary: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
};

// Column limits; values are clipped so an unusually long title never loses the entry.
const LIMITS = { action: 80, entityType: 40, entityId: 120, summary: 500, ip: 100, actorName: 200 } as const;

// Actions whose entry must be on the tab before the caller continues, rather than a moment
// later. A document download is audited before the bytes are handed over, so who read a CV is
// recorded even if the process is frozen the instant the response is returned. Everything else
// is queued: an admin performs one action per page view, and a per-action append would cost a
// Sheets round trip on every mutation.
const DURABLE_ACTIONS: ReadonlySet<string> = new Set(["document.download"]);

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// The stored form of an entry: clipped to the column limits, with the actor denormalised as a
// snapshot so a later rename or deletion does not rewrite history.
function toAuditLogRecord(entry: AuditEntryInput, at: Date): AuditLogRecord {
  // getClientIp() yields the literal "unknown" when no address could be determined; that is
  // stored as an empty cell rather than as a fake address.
  const ip = entry.ip && entry.ip !== "unknown" ? entry.ip.slice(0, LIMITS.ip) : null;
  return {
    id: newId(at),
    at,
    actor: entry.actor
      ? {
          user: entry.actor.user,
          email: entry.actor.email,
          name: clip(entry.actor.name, LIMITS.actorName),
          role: entry.actor.role,
        }
      : null,
    action: entry.action.slice(0, LIMITS.action),
    entityType: entry.entityType.slice(0, LIMITS.entityType),
    entityId: (entry.entityId || "unknown").slice(0, LIMITS.entityId),
    summary: clip(entry.summary || entry.action, LIMITS.summary),
    meta: entry.meta ?? {},
    ip,
  };
}

export async function recordAudit(entry: AuditEntryInput): Promise<void> {
  try {
    const record = toAuditLogRecord(entry, new Date());
    if (DURABLE_ACTIONS.has(record.action)) await writeAuditRecordNow(record);
    else queueAuditRecord(record);
  } catch (err) {
    // Auditing can never fail the action being audited.
    logger.error("audit.write_failed", { action: entry.action, entityType: entry.entityType, entityId: entry.entityId, err });
  }
}

// Writes everything queued so far. Request handlers do not need this - the buffer flushes
// itself - but a script or a cron job that is about to exit does, otherwise its entries die with
// the process. Never rejects.
export async function flushAuditLog(): Promise<void> {
  await flushAuditBuffer();
}

export type AuditLogFilters = {
  page: number;
  limit: number;
  // "job.publish" matches exactly; a bare prefix such as "job" matches every "job.*" action.
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
};

export function toAuditLogEntry(
  record: Pick<AuditLogRecord, "id" | "at" | "actor" | "action" | "entityType" | "entityId" | "summary" | "ip">
): AuditLogEntry {
  return {
    id: record.id,
    at: record.at.toISOString(),
    actorName: record.actor?.name ?? null,
    actorEmail: record.actor?.email ?? null,
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    summary: record.summary,
    ip: record.ip ?? null,
  };
  // `meta` is deliberately not exposed: it is written for forensics and never read back by the API.
}

// The filter set, applied in this process over the loaded tab. The prefix rule is the one piece
// of behaviour worth restating: an `action` containing a dot is an exact match, while a bare
// "auth" matches every "auth.*" action but not an action literally named "auth" - the same
// semantics as the `^auth\.` regex the MongoDB query built.
function matchesFilters(record: AuditLogRecord, filters: AuditLogFilters): boolean {
  if (filters.action) {
    const matches = filters.action.includes(".") ? record.action === filters.action : record.action.startsWith(`${filters.action}.`);
    if (!matches) return false;
  }
  if (filters.entityType && record.entityType !== filters.entityType) return false;
  if (filters.entityId && record.entityId !== filters.entityId) return false;
  if (filters.actorId && record.actor?.user !== filters.actorId) return false;
  const at = record.at.getTime();
  if (filters.from && at < filters.from.getTime()) return false;
  if (filters.to && at > filters.to.getTime()) return false;
  return true;
}

export async function listAuditLogs(filters: AuditLogFilters): Promise<Paginated<AuditLogEntry>> {
  ensureStoreReady();
  const page = Math.max(1, Math.floor(filters.page));
  const limit = Math.max(1, Math.floor(filters.limit));

  // An admin who performs an action and immediately opens this view expects to see it, so the
  // buffer is emptied before the tab is read. The append updates the cached copy in place, which
  // is why the read below can still use the cache.
  await flushAuditLog();

  const records = await listAuditRecords();
  const matches = records.filter((record) => matchesFilters(record, filters));
  // Newest first, id breaking ties so paging is stable for entries written in the same second.
  matches.sort(compareByDateDesc<AuditLogRecord>((record) => record.at, (record) => record.id));

  const pagination = { page, limit, skip: (page - 1) * limit };
  return toPaginated(paginate(matches, pagination).map(toAuditLogEntry), matches.length, pagination);
}
