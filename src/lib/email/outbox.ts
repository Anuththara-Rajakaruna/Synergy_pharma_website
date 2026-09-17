import { after } from "next/server";
import { Types } from "mongoose";
import { isValidEmail } from "@/lib/careers/validation";
import { describeEmailError, isEmailConfigured, isPermanentEmailError, sendEmailNow } from "@/lib/email/transport";
import { logger } from "@/lib/logger";
import { connectToDatabase } from "@/lib/mongodb";
import { EmailOutboxModel } from "@/models/email-outbox";
import type { EmailDeliveryInfo } from "@/types/careers";

// Transactional email outbox. Callers write messages with enqueueEmails() in the same request
// that changes the data, then call scheduleEmailDelivery() so they are sent after the response.
// Anything not delivered then (SMTP outage, function timeout, CLI context) is picked up by the
// maintenance job, so a slow or failing mail server never fails or delays a submission.

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
const NOT_CONFIGURED_RETRY_MS = 30 * 60_000;
const MAX_BATCH = 500;
// Batch runs stop claiming new messages after this long so a large backlog cannot outlive the
// function's time limit; the next run continues where this one stopped.
const BATCH_TIME_BUDGET_MS = 120_000;

export async function enqueueEmails(items: EnqueueEmailInput[]): Promise<Types.ObjectId[]> {
  if (items.length === 0) return [];
  for (const item of items) {
    if (!isValidEmail(item.to)) throw new Error("Cannot enqueue an email with an invalid recipient.");
    if (item.replyTo && !isValidEmail(item.replyTo)) throw new Error("Cannot enqueue an email with an invalid reply-to address.");
  }
  await connectToDatabase();
  const now = new Date();
  const docs = items.map((item) => ({
    _id: new Types.ObjectId(),
    to: item.to,
    replyTo: item.replyTo || null,
    template: item.template,
    subject: item.content.subject,
    text: item.content.text,
    html: item.content.html,
    status: "pending" as const,
    attempts: 0,
    maxAttempts: RETRY_BACKOFF_MS.length + 1,
    nextAttemptAt: now,
    lockedUntil: null,
    lastError: null,
    related: item.related ?? null,
    sentAt: null,
    purgeAt: null,
  }));
  await EmailOutboxModel.insertMany(docs, { ordered: true });
  return docs.map((doc) => doc._id);
}

// Sends the given messages after the current response has been sent. Outside a request (CLI
// scripts) after() is unavailable; the messages then stay pending for the maintenance job.
export function scheduleEmailDelivery(ids: Types.ObjectId[]): void {
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

type ClaimedEmail = {
  _id: Types.ObjectId;
  to: string;
  replyTo: string | null;
  template: string;
  subject: string;
  text: string;
  html: string;
  attempts: number;
  maxAttempts: number;
};

async function claim(filter: Record<string, unknown>, lockedUntil: Date): Promise<ClaimedEmail | null> {
  return EmailOutboxModel.findOneAndUpdate(
    filter,
    { $set: { status: "sending", lockedUntil } },
    {
      returnDocument: "after",
      sort: { nextAttemptAt: 1, _id: 1 },
      projection: { to: 1, replyTo: 1, template: 1, subject: 1, text: 1, html: 1, attempts: 1, maxAttempts: 1 },
    }
  ).lean<ClaimedEmail>();
}

async function processClaimed(email: ClaimedEmail, lockedUntil: Date, configured: boolean, result: DeliveryResult): Promise<void> {
  const meta = { emailId: String(email._id), template: email.template };
  // Only the worker holding this exact lock may complete the message.
  const owned = { _id: email._id, status: "sending" as const, lockedUntil };
  const now = new Date();

  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      await EmailOutboxModel.updateOne(owned, {
        $set: {
          status: "pending",
          lockedUntil: null,
          nextAttemptAt: new Date(now.getTime() + NOT_CONFIGURED_RETRY_MS),
          lastError: "smtp_not_configured",
        },
      });
      result.retried += 1;
      logger.warn("email.retry_scheduled", { ...meta, reason: "smtp_not_configured" });
    } else {
      await EmailOutboxModel.updateOne(owned, {
        $set: { status: "skipped", lockedUntil: null, lastError: "smtp_not_configured", purgeAt: now },
      });
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
      await EmailOutboxModel.updateOne(owned, {
        $set: { status: "failed", attempts, lockedUntil: null, lastError, purgeAt: new Date() },
      });
      result.failed += 1;
      logger.error("email.failed", { ...meta, attempts, error: lastError });
    } else {
      const delay = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];
      await EmailOutboxModel.updateOne(owned, {
        $set: { status: "pending", attempts, lockedUntil: null, lastError, nextAttemptAt: new Date(Date.now() + delay) },
      });
      result.retried += 1;
      logger.warn("email.retry_scheduled", { ...meta, attempts, error: lastError });
    }
    return;
  }

  const sentAt = new Date();
  await EmailOutboxModel.updateOne(owned, {
    $set: { status: "sent", attempts: email.attempts + 1, lockedUntil: null, lastError: null, sentAt, purgeAt: sentAt },
  });
  result.sent += 1;
  logger.info("email.sent", meta);
}

// Delivers the listed messages, or (without ids) up to `limit` messages that are due. Messages
// are claimed atomically, so concurrent runs never send the same message twice.
export async function deliverEmails(ids?: Types.ObjectId[], limit = 50): Promise<DeliveryResult> {
  const result: DeliveryResult = { sent: 0, failed: 0, retried: 0, skipped: 0 };
  if (ids && ids.length === 0) return result;
  await connectToDatabase();
  const configured = isEmailConfigured();

  if (ids) {
    for (const id of ids.slice(0, MAX_BATCH)) {
      const now = new Date();
      const lockedUntil = new Date(now.getTime() + LOCK_MS);
      const email = await claim(
        { _id: id, $or: [{ status: "pending" }, { status: "sending", lockedUntil: { $lt: now } }] },
        lockedUntil
      );
      if (email) await processClaimed(email, lockedUntil, configured, result);
    }
    return result;
  }

  const max = Math.max(1, Math.min(Math.floor(limit), MAX_BATCH));
  const started = Date.now();
  const processed: Types.ObjectId[] = [];
  while (processed.length < max && Date.now() - started < BATCH_TIME_BUDGET_MS) {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + LOCK_MS);
    const email = await claim(
      {
        ...(processed.length > 0 ? { _id: { $nin: processed } } : {}),
        $or: [
          { status: "pending", nextAttemptAt: { $lte: now } },
          { status: "sending", lockedUntil: { $lt: now } },
        ],
      },
      lockedUntil
    );
    if (!email) break;
    processed.push(email._id);
    await processClaimed(email, lockedUntil, configured, result);
  }
  return result;
}

export async function listEmailsFor(entityType: string, entityId: string): Promise<EmailDeliveryInfo[]> {
  await connectToDatabase();
  const rows = await EmailOutboxModel.find(
    { "related.entityType": entityType, "related.entityId": entityId },
    { template: 1, status: 1, attempts: 1, createdAt: 1, sentAt: 1 }
  )
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return rows.map((row) => ({
    id: String(row._id),
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
