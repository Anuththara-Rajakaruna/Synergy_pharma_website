import { randomUUID } from "node:crypto";
import { idTimestamp } from "@/lib/careers/server/ids";
import { EMAIL_STATUSES, type EmailOutboxRecord, type EmailStatus } from "@/lib/careers/server/records";
import { logger } from "@/lib/logger";
import {
  decodeDate,
  decodeDateOr,
  decodeEnum,
  decodeInteger,
  decodeMultiline,
  decodeText,
  decodeTextOrNull,
  encodeDate,
  encodeNumber,
  encodeText,
  MAX_CELL_LENGTH,
} from "@/lib/sheets-db/codec";
import { allRecords, appendRecords, findById, updateRecord, updateRecordsBatch, type RecordValues } from "@/lib/sheets-db/table";

// The EmailOutbox tab.
//
// The one thing MongoDB gave this queue that Google Sheets cannot is an atomic claim: a single
// findOneAndUpdate that flipped a row to "sending" and stamped a lock, so two delivery runs
// could never pick up the same message. Here the claim is optimistic instead: a run writes its
// own random token, reads the row back, and only sends when the token it reads is still its own.
// A run that lost the race backs off and leaves the message to the winner.
//
// That is best-effort rather than a guarantee, so the ordering is chosen to fail safely: the
// re-read happens after the write, and the in-process lock in the delivery code serialises runs
// inside one instance. A duplicate send would need two instances to interleave inside a few
// hundred milliseconds; a *lost* message is not possible at all, because nothing is ever removed
// from the queue until it is confirmed sent or permanently failed.

// A rendered email body larger than a spreadsheet cell. The templates in this application
// produce a few kilobytes at most; the guard exists so an unexpectedly large body degrades to a
// truncated message rather than a rejected write that would lose the mail entirely.
const MAX_BODY = MAX_CELL_LENGTH;

export function toEmailRecord(values: RecordValues): EmailOutboxRecord {
  const id = decodeText(values.id);
  const createdAt = decodeDateOr(values.createdAt, idTimestamp(id) ?? new Date(0));
  const relatedType = decodeText(values.relatedType);
  const relatedId = decodeText(values.relatedId);
  return {
    id,
    to: decodeText(values.to),
    replyTo: decodeTextOrNull(values.replyTo),
    template: decodeText(values.template),
    subject: decodeMultiline(values.subject),
    text: decodeMultiline(values.text),
    html: decodeMultiline(values.html),
    status: decodeEnum<EmailStatus>(values.status, EMAIL_STATUSES, "pending"),
    attempts: Math.max(0, decodeInteger(values.attempts, 0)),
    maxAttempts: Math.max(1, decodeInteger(values.maxAttempts, 6)),
    nextAttemptAt: decodeDateOr(values.nextAttemptAt, createdAt),
    lockedUntil: decodeDate(values.lockedUntil),
    lockToken: decodeTextOrNull(values.lockToken),
    lastError: decodeTextOrNull(values.lastError),
    related: relatedType && relatedId ? { entityType: relatedType, entityId: relatedId } : null,
    sentAt: decodeDate(values.sentAt),
    purgeAt: decodeDate(values.purgeAt),
    createdAt,
    updatedAt: decodeDateOr(values.updatedAt, createdAt),
  };
}

export function emailRow(message: EmailOutboxRecord): RecordValues {
  return {
    id: message.id,
    to: encodeText(message.to, 254),
    replyTo: encodeText(message.replyTo, 254),
    template: encodeText(message.template, 60),
    subject: encodeText(message.subject, 300),
    text: encodeText(message.text, MAX_BODY),
    html: encodeText(message.html, MAX_BODY),
    status: message.status,
    attempts: encodeNumber(message.attempts),
    maxAttempts: encodeNumber(message.maxAttempts),
    nextAttemptAt: encodeDate(message.nextAttemptAt),
    lockedUntil: encodeDate(message.lockedUntil),
    lockToken: message.lockToken ?? "",
    lastError: encodeText(message.lastError, 500),
    relatedType: encodeText(message.related?.entityType ?? "", 40),
    relatedId: encodeText(message.related?.entityId ?? "", 120),
    sentAt: encodeDate(message.sentAt),
    purgeAt: encodeDate(message.purgeAt),
    createdAt: encodeDate(message.createdAt),
    updatedAt: encodeDate(message.updatedAt),
  };
}

export async function insertEmails(messages: EmailOutboxRecord[]): Promise<void> {
  if (messages.length === 0) return;
  for (const message of messages) {
    if (message.html.length > MAX_BODY || message.text.length > MAX_BODY) {
      logger.warn("email.body_truncated", { template: message.template, htmlLength: message.html.length });
    }
  }
  await appendRecords("EmailOutbox", messages.map(emailRow));
}

export async function listEmails(opts: { maxAgeMs?: number } = {}): Promise<EmailOutboxRecord[]> {
  const rows = await allRecords("EmailOutbox", opts);
  return rows.filter((row) => decodeText(row.values.id) !== "").map((row) => toEmailRecord(row.values));
}

export async function findEmailById(id: string): Promise<EmailOutboxRecord | null> {
  const row = await findById("EmailOutbox", id, { maxAgeMs: 0 });
  return row ? toEmailRecord(row.values) : null;
}

// Messages attached to one record, newest first. Backs the "emails" section of the application
// and talent detail views.
export async function listEmailsRelatedTo(entityType: string, entityId: string, limit: number): Promise<EmailOutboxRecord[]> {
  const rows = await allRecords("EmailOutbox");
  return rows
    .filter((row) => decodeText(row.values.relatedType) === entityType && decodeText(row.values.relatedId) === entityId)
    .map((row) => toEmailRecord(row.values))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
    .slice(0, limit);
}

// ── Claiming ─────────────────────────────────────────────────────────────────

export type ClaimedEmail = EmailOutboxRecord & { lockToken: string };

function isDue(message: EmailOutboxRecord, now: Date): boolean {
  if (message.status === "pending") return message.nextAttemptAt.getTime() <= now.getTime();
  // A run that crashed mid-delivery leaves a message "sending"; it becomes claimable again once
  // its lock passes.
  if (message.status === "sending") return message.lockedUntil !== null && message.lockedUntil.getTime() <= now.getTime();
  return false;
}

// Claims up to `limit` messages. `ids` restricts the run to specific messages (used right after
// a submission, where nextAttemptAt is deliberately ignored so the mail goes out immediately).
export async function claimEmails(opts: {
  now: Date;
  lockMs: number;
  limit: number;
  ids?: string[] | null;
  exclude?: Set<string>;
}): Promise<ClaimedEmail[]> {
  const wanted = opts.ids ? new Set(opts.ids) : null;
  const messages = await listEmails({ maxAgeMs: 0 });

  const candidates = messages
    .filter((message) => {
      if (opts.exclude?.has(message.id)) return false;
      if (wanted) return wanted.has(message.id) && (message.status === "pending" || isDue(message, opts.now));
      return isDue(message, opts.now);
    })
    // Most overdue first, id as a stable tie-breaker - the order the indexed MongoDB query gave.
    .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, opts.limit);
  if (candidates.length === 0) return [];

  const lockedUntil = new Date(opts.now.getTime() + opts.lockMs);
  const token = randomUUID();
  await updateRecordsBatch(
    candidates.map((message) => ({
      table: "EmailOutbox" as const,
      id: message.id,
      patch: {
        status: "sending",
        lockedUntil: encodeDate(lockedUntil),
        lockToken: token,
        updatedAt: encodeDate(opts.now),
      },
    }))
  );

  // Read back and keep only the messages this run still owns. Another run that claimed the same
  // message a moment later will have replaced the token.
  const confirmed = await listEmails({ maxAgeMs: 0 });
  const owned = new Map(confirmed.map((message) => [message.id, message]));
  const claimed: ClaimedEmail[] = [];
  for (const candidate of candidates) {
    const current = owned.get(candidate.id);
    if (current?.lockToken === token) {
      claimed.push({ ...current, lockToken: token });
    } else {
      logger.info("email.claim_lost", { template: candidate.template });
    }
  }
  return claimed;
}

// Completion writes are conditional on still holding the lock, mirroring the ownership-guarded
// update the MongoDB version used.
export async function completeEmail(
  message: ClaimedEmail,
  patch: Partial<Pick<EmailOutboxRecord, "status" | "attempts" | "nextAttemptAt" | "lastError" | "sentAt" | "purgeAt">>
): Promise<boolean> {
  const current = await findEmailById(message.id);
  if (!current || current.lockToken !== message.lockToken) {
    logger.warn("email.complete_lock_lost", { template: message.template });
    return false;
  }

  const values: RecordValues = { lockedUntil: "", lockToken: "", updatedAt: encodeDate(new Date()) };
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.attempts !== undefined) values.attempts = encodeNumber(patch.attempts);
  if (patch.nextAttemptAt !== undefined) values.nextAttemptAt = encodeDate(patch.nextAttemptAt);
  if (patch.lastError !== undefined) values.lastError = encodeText(patch.lastError, 500);
  if (patch.sentAt !== undefined) values.sentAt = encodeDate(patch.sentAt);
  if (patch.purgeAt !== undefined) values.purgeAt = encodeDate(patch.purgeAt);

  return updateRecord("EmailOutbox", message.id, values);
}

// ── Housekeeping ─────────────────────────────────────────────────────────────

export async function emailRowsRelatedTo(entityType: string, entityIds: Set<string>): Promise<number[]> {
  const rows = await allRecords("EmailOutbox", { maxAgeMs: 0 });
  return rows
    .filter((row) => decodeText(row.values.relatedType) === entityType && entityIds.has(decodeText(row.values.relatedId)))
    .map((row) => row.rowNumber);
}

// Replaces the 180-day TTL index: rows whose purgeAt has passed are removed by the maintenance
// job. Only completed messages ever get a purgeAt, so nothing pending is ever swept up.
export async function purgeableEmailRows(now: Date, retentionMs: number): Promise<number[]> {
  const rows = await allRecords("EmailOutbox", { maxAgeMs: 0 });
  const cutoff = now.getTime() - retentionMs;
  return rows
    .filter((row) => {
      const purgeAt = decodeDate(row.values.purgeAt);
      return purgeAt !== null && purgeAt.getTime() < cutoff;
    })
    .map((row) => row.rowNumber);
}

export async function countEmailsByStatus(): Promise<Record<EmailStatus, number>> {
  const messages = await listEmails();
  const counts: Record<EmailStatus, number> = { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
  for (const message of messages) counts[message.status] += 1;
  return counts;
}
