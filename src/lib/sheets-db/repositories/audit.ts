import { ADMIN_ROLES, type AdminRole } from "@/lib/careers/constants";
import { idTimestamp } from "@/lib/careers/server/ids";
import type { AuditLogRecord } from "@/lib/careers/server/records";
import { logger } from "@/lib/logger";
import { decodeDateOr, decodeEnum, decodeJson, decodeText, decodeTextOrNull, encodeDate, encodeJson, encodeText } from "@/lib/sheets-db/codec";
import { allRecords, appendRecords, type RecordValues } from "@/lib/sheets-db/table";

// The AuditLog tab: append-only, newest last.
//
// Audit writes sit on the request path of every security-relevant action, and a Google Sheets
// append costs a round trip. Writes are therefore coalesced: entries queued within a short
// window go out as a single append. A failed flush is logged and dropped, never thrown - an
// audit problem must not fail the operation being audited, which is exactly what the previous
// implementation guaranteed with its swallowed try/catch.

export function toAuditRecord(values: RecordValues): AuditLogRecord {
  const id = decodeText(values.id);
  const actorId = decodeText(values.actorId);
  return {
    id,
    at: decodeDateOr(values.at, idTimestamp(id) ?? new Date(0)),
    actor: actorId
      ? {
          user: actorId,
          email: decodeText(values.actorEmail),
          name: decodeText(values.actorName),
          role: decodeEnum<AdminRole>(values.actorRole, ADMIN_ROLES, "hr"),
        }
      : null,
    action: decodeText(values.action),
    entityType: decodeText(values.entityType),
    entityId: decodeText(values.entityId),
    summary: decodeText(values.summary),
    meta: decodeJson<Record<string, unknown>>(values.meta, {}),
    ip: decodeTextOrNull(values.ip),
  };
}

export function auditRow(entry: AuditLogRecord): RecordValues {
  return {
    id: entry.id,
    at: encodeDate(entry.at),
    actorId: entry.actor?.user ?? "",
    actorEmail: encodeText(entry.actor?.email ?? "", 254),
    actorName: encodeText(entry.actor?.name ?? "", 200),
    actorRole: entry.actor?.role ?? "",
    action: encodeText(entry.action, 80),
    entityType: encodeText(entry.entityType, 40),
    entityId: encodeText(entry.entityId, 120),
    summary: encodeText(entry.summary, 500),
    meta: encodeJson(entry.meta),
    ip: encodeText(entry.ip, 100),
  };
}

export async function listAuditRecords(opts: { maxAgeMs?: number } = {}): Promise<AuditLogRecord[]> {
  const rows = await allRecords("AuditLog", opts);
  return rows.filter((row) => decodeText(row.values.id) !== "").map((row) => toAuditRecord(row.values));
}

// ── Buffered writes ──────────────────────────────────────────────────────────

// How long an entry may wait to be batched with others. Short enough that an admin who performs
// an action and immediately opens the audit view sees it.
const FLUSH_DELAY_MS = 400;
const MAX_BUFFER = 100;

type AuditBuffer = { queued: AuditLogRecord[]; timer: ReturnType<typeof setTimeout> | null; flushing: Promise<void> | null };

declare global {
  var __synergyAuditBuffer: AuditBuffer | undefined;
}

const buffer: AuditBuffer = (globalThis.__synergyAuditBuffer ??= { queued: [], timer: null, flushing: null });

async function writeBatch(entries: AuditLogRecord[]): Promise<void> {
  if (entries.length === 0) return;
  await appendRecords("AuditLog", entries.map(auditRow));
}

// Writes everything queued so far. Safe to call at any time; never rejects.
export async function flushAuditBuffer(): Promise<void> {
  if (buffer.timer) {
    clearTimeout(buffer.timer);
    buffer.timer = null;
  }
  if (buffer.flushing) await buffer.flushing.catch(() => undefined);
  if (buffer.queued.length === 0) return;

  const entries = buffer.queued;
  buffer.queued = [];
  buffer.flushing = writeBatch(entries)
    .catch((err) => {
      // The audited action already happened and must not be undone because its record could not
      // be written. Losing the entry is reported loudly instead.
      logger.error("audit.write_failed", { err, count: entries.length, actions: entries.map((entry) => entry.action) });
    })
    .finally(() => {
      buffer.flushing = null;
    });
  await buffer.flushing;
}

// Queues an entry and returns immediately. The caller decides whether to await the flush:
// request handlers let it happen in the background, scripts flush before exiting.
export function queueAuditRecord(entry: AuditLogRecord): void {
  buffer.queued.push(entry);
  if (buffer.queued.length >= MAX_BUFFER) {
    void flushAuditBuffer();
    return;
  }
  if (!buffer.timer) {
    buffer.timer = setTimeout(() => {
      buffer.timer = null;
      void flushAuditBuffer();
    }, FLUSH_DELAY_MS);
    // Do not hold a CLI process open just for the audit timer.
    buffer.timer.unref?.();
  }
}

// Writes one entry straight away, used where the entry must be durable before the response is
// sent (a document download is audited before the bytes are handed over).
export async function writeAuditRecordNow(entry: AuditLogRecord): Promise<void> {
  buffer.queued.push(entry);
  await flushAuditBuffer();
}

// Row numbers of entries older than the cutoff, for the maintenance sweep that keeps the audit
// tab inside the spreadsheet's 10 million cell ceiling.
export async function auditRowsOlderThan(cutoff: Date): Promise<number[]> {
  const rows = await allRecords("AuditLog", { maxAgeMs: 0 });
  return rows
    .filter((row) => {
      const at = decodeDateOr(row.values.at, idTimestamp(decodeText(row.values.id)) ?? new Date(0));
      return at.getTime() < cutoff.getTime();
    })
    .map((row) => row.rowNumber);
}
