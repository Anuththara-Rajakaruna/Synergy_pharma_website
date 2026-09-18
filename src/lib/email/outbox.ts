import { after } from "next/server";
import { newId } from "@/lib/careers/server/ids";
import type { EmailOutboxRecord } from "@/lib/careers/server/records";
import { isValidEmail } from "@/lib/careers/validation";
import { describeEmailError, isEmailConfigured, isPermanentEmailError, sendEmailNow } from "@/lib/email/transport";
import { logger } from "@/lib/logger";
import { ensureStoreReady, withLock } from "@/lib/sheets-db";
import {
  claimEmails,
  completeEmail,
  countEmailsByStatus,
  insertEmails,
  listEmailsRelatedTo,
  type ClaimedEmail,
} from "@/lib/sheets-db/repositories/email";
import type { EmailDeliveryInfo } from "@/types/careers";

// Transactional email outbox. Callers write messages with enqueueEmails() in the same request
// that changes the data, then call scheduleEmailDelivery() so they are sent after the response.
// Anything not delivered then (SMTP outage, function timeout, CLI context) is picked up by the
// maintenance job, so a slow or failing mail server never fails or delays a submission.
//
// The queue now lives in the EmailOutbox tab of the spreadsheet. MongoDB gave this file one
// thing Google Sheets cannot: findOneAndUpdate, a single atomic compare-and-set that flipped a
// row to "sending" and stamped a lock. Two things stand in for it:
//
//   * src/lib/sheets-db/repositories/email.ts claims optimistically - it writes a random token,
//     reads the rows back, and keeps only the ones whose token is still its own.
//   * Every delivery run holds the in-process DELIVERY_LOCK, so two runs on one instance cannot
//     interleave at all. Only two separate instances claiming within the same few hundred
//     milliseconds can still collide, and the worst outcome is a duplicate send; a message is
//     never lost, because nothing leaves the queue until it is confirmed sent or given up on.

export type EnqueueEmailInput = {
  to: string;
  replyTo?: string | null;
  template: string;
  content: { subject: string; text: string; html: string };
  related?: { entityType: string; entityId: string } | null;
};

export type DeliveryResult = { sent: number; failed: number; retried: number; skipped: number };

const LOCK_MS = 2 * 60 * 1000;
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000];
// One attempt beyond the last backoff step: 6 attempts spanning 8h36m before a message is given
// up on. Stored per row, so a message keeps the ladder it was queued with.
const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;
const NOT_CONFIGURED_RETRY_MS = 30 * 60_000;
const MAX_BATCH = 500;
// Batch runs stop claiming new messages after this long so a large backlog cannot outlive the
// function's time limit; the next run continues where this one stopped.
const BATCH_TIME_BUDGET_MS = 120_000;
// How many messages a batch run claims per round trip. A claim costs three Sheets calls whatever
// its size, so claiming one at a time (as the MongoDB version did) would be wasteful; claiming
// the whole batch at once would lock messages this run may never reach. Anything claimed but not
// processed becomes claimable again when its lock expires, exactly like a crashed worker's.
const CLAIM_CHUNK = 20;
// Serialises delivery runs inside one process. The wait is long enough for a queued run to get
// its turn after an ordinary burst and short enough that an after() callback is never held for
// minutes: a run that cannot get in raises, and scheduleEmailDelivery then leaves the messages
// to the maintenance job.
const DELIVERY_LOCK = "email-delivery";
const DELIVERY_LOCK_WAIT_MS = 30_000;
const LIST_LIMIT = 100;

export async function enqueueEmails(items: EnqueueEmailInput[]): Promise<string[]> {
  if (items.length === 0) return [];
  // Validate everything before writing anything: never half a batch of half-checked rows.
  for (const item of items) {
    if (!isValidEmail(item.to)) throw new Error("Cannot enqueue an email with an invalid recipient.");
    if (item.replyTo && !isValidEmail(item.replyTo)) throw new Error("Cannot enqueue an email with an invalid reply-to address.");
  }
  ensureStoreReady();
  const now = new Date();
  const records: EmailOutboxRecord[] = items.map((item) => ({
    id: newId(now),
    to: item.to,
    replyTo: item.replyTo || null,
    template: item.template,
    subject: item.content.subject,
    text: item.content.text,
    html: item.content.html,
    status: "pending",
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    nextAttemptAt: now,
    lockedUntil: null,
    lockToken: null,
    lastError: null,
    related: item.related ?? null,
    sentAt: null,
    purgeAt: null,
    createdAt: now,
    updatedAt: now,
  }));
  await insertEmails(records);
  // Ids are minted before the write, so the caller can target exactly these rows.
  return records.map((record) => record.id);
}

// Sends the given messages after the current response has been sent. Outside a request (CLI
// scripts) after() is unavailable; the messages then stay pending for the maintenance job.
export function scheduleEmailDelivery(ids: string[]): void {
  if (ids.length === 0) return;
  try {
    after(async () => {
      try {
        await deliverEmails(ids);
      } catch (err) {
        logger.error("email.delivery_run_failed", { err, count: ids.length });
      }
    });
  } catch {
    logger.info("email.delivery_deferred", { count: ids.length, reason: "outside_request_scope" });
  }
}

// Completes one claimed message. Every write goes through completeEmail, which refuses to write
// unless this run still holds the message's lock - the stand-in for the MongoDB update that was
// filtered on {_id, status:'sending', lockedUntil}.
//
// The counters move on regardless of whether that write landed, because they describe what this
// run did: once sendEmailNow() has returned, the mail really has gone out.
async function processClaimed(email: ClaimedEmail, configured: boolean, result: DeliveryResult): Promise<void> {
  const meta = { emailId: email.id, template: email.template };
  const now = new Date();

  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      // Never give up in production: a missing SMTP configuration is an operator problem, not a
      // bad message. attempts is deliberately not incremented, so the retry ladder is untouched.
      await completeEmail(email, {
        status: "pending",
        nextAttemptAt: new Date(now.getTime() + NOT_CONFIGURED_RETRY_MS),
        lastError: "smtp_not_configured",
      });
      result.retried += 1;
      logger.warn("email.retry_scheduled", { ...meta, reason: "smtp_not_configured" });
    } else {
      await completeEmail(email, { status: "skipped", lastError: "smtp_not_configured", purgeAt: now });
      result.skipped += 1;
      logger.info("email.skipped", { ...meta, reason: "smtp_not_configured" });
    }
    return;
  }

  try {
    await sendEmailNow({ to: email.to, replyTo: email.replyTo, subject: email.subject, text: email.text, html: email.html });
  } catch (err) {
    const attempts = email.attempts + 1;
    const lastError = describeEmailError(err);
    if (attempts >= email.maxAttempts || isPermanentEmailError(err)) {
      await completeEmail(email, { status: "failed", attempts, lastError, purgeAt: new Date() });
      result.failed += 1;
      logger.error("email.failed", { ...meta, attempts, error: lastError });
    } else {
      const delay = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];
      await completeEmail(email, { status: "pending", attempts, lastError, nextAttemptAt: new Date(Date.now() + delay) });
      result.retried += 1;
      logger.warn("email.retry_scheduled", { ...meta, attempts, error: lastError });
    }
    return;
  }

  const sentAt = new Date();
  await completeEmail(email, { status: "sent", attempts: email.attempts + 1, lastError: null, sentAt, purgeAt: sentAt });
  result.sent += 1;
  logger.info("email.sent", meta);
}

// Targeted delivery. nextAttemptAt is deliberately ignored so a message queued a moment ago goes
// out in this request's after() callback rather than waiting for the maintenance job.
async function deliverTargeted(ids: string[], configured: boolean, result: DeliveryResult): Promise<void> {
  const wanted = ids.slice(0, MAX_BATCH);
  const claimed = await claimEmails({ now: new Date(), lockMs: LOCK_MS, limit: wanted.length, ids: wanted });
  for (const email of claimed) await processClaimed(email, configured, result);
}

// Batch drain: the messages that are actually due, most overdue first, bounded by both `limit`
// and the wall-clock budget.
async function deliverDue(limit: number, configured: boolean, result: DeliveryResult): Promise<void> {
  const max = Math.max(1, Math.min(Math.floor(limit), MAX_BATCH));
  const started = Date.now();
  // Replaces the {_id: {$nin: processed}} arm of the MongoDB claim: a message this run has
  // already handled must not be picked up again, however its row now looks.
  const processed = new Set<string>();

  while (processed.size < max && Date.now() - started < BATCH_TIME_BUDGET_MS) {
    const claimed = await claimEmails({
      now: new Date(),
      lockMs: LOCK_MS,
      limit: Math.min(max - processed.size, CLAIM_CHUNK),
      exclude: processed,
    });
    if (claimed.length === 0) break;
    for (const email of claimed) {
      processed.add(email.id);
      await processClaimed(email, configured, result);
      if (Date.now() - started >= BATCH_TIME_BUDGET_MS) break;
    }
  }

  // Cheap - the counts come from the copy of the tab this run has already loaded - and the only
  // place an operator can see a backlog building up behind a failing mail server.
  const counts = await countEmailsByStatus();
  if (counts.pending > 0 || counts.sending > 0) logger.info("email.queue_depth", { ...counts });
}

// Delivers the listed messages, or (without ids) up to `limit` messages that are due. Messages
// are claimed before they are sent, and the whole run holds the delivery lock, so two runs in
// one process never send the same message twice.
export async function deliverEmails(ids?: string[], limit = 50): Promise<DeliveryResult> {
  const result: DeliveryResult = { sent: 0, failed: 0, retried: 0, skipped: 0 };
  if (ids && ids.length === 0) return result;
  ensureStoreReady();

  return withLock(
    DELIVERY_LOCK,
    async () => {
      // Read once per run and passed down, so every message in this run is treated the same way
      // even if the environment changes underneath it.
      const configured = isEmailConfigured();
      if (ids) await deliverTargeted(ids, configured, result);
      else await deliverDue(limit, configured, result);
      return result;
    },
    { timeoutMs: DELIVERY_LOCK_WAIT_MS }
  );
}

export async function listEmailsFor(entityType: string, entityId: string): Promise<EmailDeliveryInfo[]> {
  ensureStoreReady();
  const rows = await listEmailsRelatedTo(entityType, entityId, LIST_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    template: row.template,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
  }));
}

const MAX_RECIPIENTS = 10;

function parseRecipientList(raw: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw ?? "").split(/[,;]/)) {
    const address = part.trim();
    if (!address || !isValidEmail(address)) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(address);
    if (out.length >= MAX_RECIPIENTS) break;
  }
  return out;
}

// Invalid entries are ignored here and reported by the configuration check (src/lib/env.ts).
export function hrNotificationRecipients(): string[] {
  return parseRecipientList(process.env.HR_NOTIFICATION_EMAIL);
}

export function contactRecipients(): string[] {
  const contact = parseRecipientList(process.env.CONTACT_NOTIFICATION_EMAIL);
  return contact.length > 0 ? contact : hrNotificationRecipients();
}

// The same list under the longer name, so a caller can read either way round. contactRecipients
// stays the primary spelling because /api/contact already imports it.
export const contactNotificationRecipients = contactRecipients;
