import "./support/env";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  contactRecipients,
  deliverEmails,
  enqueueEmails,
  hrNotificationRecipients,
  listEmailsFor,
  scheduleEmailDelivery,
  type EnqueueEmailInput,
} from "@/lib/email/outbox";
import { applicationReceivedEmail } from "@/lib/email/templates";
import type { EmailOutboxRecord } from "@/lib/careers/server/records";
import { updateRecord, type RecordValues } from "@/lib/sheets-db";
import { encodeDate, encodeNumber } from "@/lib/sheets-db/codec";
import { findEmailById, listEmails } from "@/lib/sheets-db/repositories/email";
import { integrationConfig, setEnv, suiteSkip } from "./support/env";
import { assertNoPersonalData, uniqueSuffix } from "./support/fixtures";
import { startIntegration, type Integration } from "./support/harness";
import type { SmtpSink } from "./support/smtp-sink";

const MINUTE = 60 * 1000;

function message(overrides: Partial<EnqueueEmailInput> = {}): EnqueueEmailInput {
  const suffix = uniqueSuffix();
  return {
    to: `candidate.${suffix}@example.com`,
    replyTo: integrationConfig.hrEmail,
    template: "application_received",
    content: applicationReceivedEmail({ name: "Nimal Perera", jobTitle: "QA Executive", reference: `APP-${suffix.toUpperCase()}` }),
    related: { entityType: "application", entityId: `66e9a1b2c3d4e5f6${suffix}` },
    ...overrides,
  };
}

async function row(id: string): Promise<EmailOutboxRecord> {
  const record = await findEmailById(id);
  assert.ok(record, `outbox row ${id} not found`);
  return record;
}

// Direct cell writes for the states a delivery run cannot be asked to produce (a message due in
// the future, a lock that has not expired, an attempt count near the limit).
async function patchEmail(id: string, patch: Partial<Record<"status" | "nextAttemptAt" | "lockedUntil" | "attempts" | "createdAt", unknown>>): Promise<void> {
  const values: RecordValues = {};
  if (patch.status !== undefined) values.status = String(patch.status);
  if (patch.nextAttemptAt !== undefined) values.nextAttemptAt = encodeDate(patch.nextAttemptAt as Date);
  if (patch.lockedUntil !== undefined) values.lockedUntil = encodeDate(patch.lockedUntil as Date | null);
  if (patch.attempts !== undefined) values.attempts = encodeNumber(patch.attempts as number);
  if (patch.createdAt !== undefined) values.createdAt = encodeDate(patch.createdAt as Date);
  assert.ok(await updateRecord("EmailOutbox", id, values));
}

async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(patch).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(patch)) setEnv(name, value);
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) setEnv(name, value);
  }
}

describe("email outbox", { timeout: 240_000, skip: suiteSkip() }, () => {
  let integration: Integration;
  let sink: SmtpSink;

  before(async () => {
    integration = await startIntegration({ smtp: true });
    assert.ok(integration.smtp);
    sink = integration.smtp;
  });

  after(async () => {
    await integration.stop();
  });

  describe("enqueueEmails", () => {
    it("stores pending messages with their related record", async () => {
      const input = message();
      const [id] = await enqueueEmails([input]);
      const doc = await row(id);
      assert.equal(doc.status, "pending");
      assert.equal(doc.attempts, 0);
      assert.equal(doc.maxAttempts, 6);
      assert.equal(doc.to, input.to);
      assert.equal(doc.replyTo, integrationConfig.hrEmail);
      assert.deepEqual(doc.related, input.related);
      assert.ok(doc.nextAttemptAt.getTime() <= Date.now());
      assert.deepEqual(await enqueueEmails([]), []);
    });

    it("refuses invalid recipients and reply-to addresses without writing anything", async () => {
      const before = (await listEmails({ maxAgeMs: 0 })).length;
      await assert.rejects(enqueueEmails([message(), message({ to: "Nimal <nimal@example.com>" })]), /invalid recipient/);
      await assert.rejects(enqueueEmails([message({ replyTo: "a@b.com, c@d.com" })]), /invalid reply-to/);
      assert.equal((await listEmails({ maxAgeMs: 0 })).length, before);
    });

    it("leaves messages pending when delivery is scheduled outside a request", async () => {
      const ids = await enqueueEmails([message()]);
      scheduleEmailDelivery(ids);
      assert.equal((await row(ids[0])).status, "pending");
      assert.ok(integration.logs().includes("email.delivery_deferred"));
    });

    it("writes one row per message, in one append", async () => {
      const inputs = [message(), message(), message()];
      const ids = await enqueueEmails(inputs);
      assert.equal(new Set(ids).size, 3);
      const rows = await listEmails({ maxAgeMs: 0 });
      for (const id of ids) assert.equal(rows.filter((item) => item.id === id).length, 1);
    });
  });

  describe("recipient configuration", () => {
    it("parses, de-duplicates and caps HR recipients, and falls back for contact messages", async () => {
      const many = Array.from({ length: 12 }, (_, i) => `hr${i}@synergypharma.test`).join(";");
      await withEnv({ HR_NOTIFICATION_EMAIL: `HR@synergypharma.test, hr@synergypharma.test, not-an-email, ${many}`, CONTACT_NOTIFICATION_EMAIL: undefined }, async () => {
        const recipients = hrNotificationRecipients();
        assert.equal(recipients.length, 10);
        assert.equal(recipients[0], "HR@synergypharma.test");
        assert.equal(recipients.includes("not-an-email"), false);
        assert.deepEqual(contactRecipients(), recipients);
      });
      await withEnv({ CONTACT_NOTIFICATION_EMAIL: "info@synergypharma.test" }, async () => {
        assert.deepEqual(contactRecipients(), ["info@synergypharma.test"]);
      });
      await withEnv({ HR_NOTIFICATION_EMAIL: undefined, CONTACT_NOTIFICATION_EMAIL: undefined }, async () => {
        assert.deepEqual(hrNotificationRecipients(), []);
        assert.deepEqual(contactRecipients(), []);
      });
    });
  });

  describe("delivery", () => {
    it("sends listed messages through SMTP and marks them sent", async () => {
      const input = message();
      const [id] = await enqueueEmails([input]);
      const result = await deliverEmails([id]);
      assert.deepEqual(result, { sent: 1, failed: 0, retried: 0, skipped: 0 });

      const [received] = sink.messagesTo(input.to);
      assert.ok(received, "the capture server received the message");
      assert.deepEqual(received.to, [input.to]);
      assert.equal(received.from, "careers.integration@example.com");
      const headers = received.raw.slice(0, received.raw.indexOf("\r\n\r\n"));
      assert.match(headers, /^Auto-Submitted: auto-generated$/m);
      assert.match(headers, new RegExp(`^Reply-To: ${integrationConfig.hrEmail.replace(/\./g, "\\.")}$`, "m"));
      assert.match(headers, /^Subject: Application received: QA Executive \(APP-/m);
      assert.match(headers, /^From: Synergy Careers Integration <careers\.integration@example\.com>$/m);

      const doc = await row(id);
      assert.equal(doc.status, "sent");
      assert.equal(doc.attempts, 1);
      assert.equal(doc.lockedUntil, null);
      assert.equal(doc.lastError, null);
      assert.ok(doc.sentAt);
      assert.ok(doc.purgeAt, "a sent message gets a purgeAt so the maintenance sweep can remove its row");

      assert.deepEqual(await deliverEmails([id]), { sent: 0, failed: 0, retried: 0, skipped: 0 }, "sent messages are never re-sent");
      assert.equal(sink.messagesTo(input.to).length, 1);
      assert.ok(integration.logs().includes("\"event\":\"email.sent\""));
    });

    it("delivers due messages in batch mode, skipping messages scheduled for later and fresh locks", async () => {
      const due = message();
      const later = message();
      const locked = message();
      const [dueId, laterId, lockedId] = await enqueueEmails([due, later, locked]);
      await patchEmail(laterId, { nextAttemptAt: new Date(Date.now() + 10 * MINUTE) });
      await patchEmail(lockedId, { status: "sending", lockedUntil: new Date(Date.now() + MINUTE) });

      const result = await deliverEmails(undefined, 50);
      assert.ok(result.sent >= 1);
      assert.equal((await row(dueId)).status, "sent");
      assert.equal((await row(laterId)).status, "pending");
      assert.equal((await row(lockedId)).status, "sending");
      assert.equal(sink.messagesTo(later.to).length, 0);
      assert.equal(sink.messagesTo(locked.to).length, 0);
    });

    it("reclaims messages whose sending lock has expired", async () => {
      const input = message();
      const [id] = await enqueueEmails([input]);
      await patchEmail(id, { status: "sending", lockedUntil: new Date(Date.now() - 1000) });
      await deliverEmails(undefined, 50);
      assert.equal((await row(id)).status, "sent");
      assert.equal(sink.messagesTo(input.to).length, 1);
    });

    it("never sends a message twice when deliveries run concurrently", async () => {
      const inputs = Array.from({ length: 4 }, () => message());
      const ids = await enqueueEmails(inputs);
      const results = await Promise.all([deliverEmails(ids), deliverEmails(ids), deliverEmails(undefined, 50)]);
      assert.equal(results.reduce((total, result) => total + result.sent, 0), 4);
      for (const input of inputs) assert.equal(sink.messagesTo(input.to).length, 1, input.to);
    });

    it("lists delivery states for a record without message bodies", async () => {
      const related = { entityType: "application", entityId: `listing-${uniqueSuffix()}` };
      const [first] = await enqueueEmails([message({ related })]);
      await deliverEmails([first]);
      await patchEmail(first, { createdAt: new Date(Date.now() - MINUTE) });
      const [second] = await enqueueEmails([message({ related, template: "hr_new_application" })]);
      const listed = await listEmailsFor(related.entityType, related.entityId);
      assert.deepEqual(
        listed.map((item) => [item.id, item.template, item.status, item.attempts]),
        [
          [second, "hr_new_application", "pending", 0],
          [first, "application_received", "sent", 1],
        ]
      );
      assert.equal(JSON.stringify(listed).includes("@example.com"), false);
      assert.deepEqual(await listEmailsFor("application", "nothing-here"), []);
    });
  });

  describe("when SMTP is not configured", () => {
    it("marks messages skipped outside production", async () => {
      const [id] = await enqueueEmails([message()]);
      const result = await withEnv({ SMTP_HOST: undefined }, () => deliverEmails([id]));
      assert.deepEqual(result, { sent: 0, failed: 0, retried: 0, skipped: 1 });
      const doc = await row(id);
      assert.equal(doc.status, "skipped");
      assert.equal(doc.lastError, "smtp_not_configured");
      assert.equal(doc.attempts, 0);
      assert.ok(doc.purgeAt);
    });

    it("keeps messages pending for 30 minutes in production without counting an attempt", async () => {
      const [id] = await enqueueEmails([message()]);
      const started = Date.now();
      const result = await withEnv({ SMTP_HOST: undefined, NODE_ENV: "production" }, () => deliverEmails([id]));
      assert.deepEqual(result, { sent: 0, failed: 0, retried: 1, skipped: 0 });
      const doc = await row(id);
      assert.equal(doc.status, "pending");
      assert.equal(doc.attempts, 0);
      assert.equal(doc.lastError, "smtp_not_configured");
      assert.equal(doc.lockedUntil, null);
      assert.ok(Math.abs(doc.nextAttemptAt.getTime() - (started + 30 * MINUTE)) < 5000);
    });
  });

  describe("delivery failures", () => {
    it("fails permanently rejected recipients immediately", async () => {
      const input = message();
      sink.rejectedRecipients.add(input.to.toLowerCase());
      try {
        const [id] = await enqueueEmails([input]);
        const result = await deliverEmails([id]);
        assert.deepEqual(result, { sent: 0, failed: 1, retried: 0, skipped: 0 });
        const doc = await row(id);
        assert.equal(doc.status, "failed");
        assert.equal(doc.attempts, 1);
        assert.ok(doc.purgeAt);
        assert.ok(doc.lastError?.includes("550"), String(doc.lastError));
        assertNoPersonalData(String(doc.lastError), [input.to], "lastError");
      } finally {
        sink.rejectedRecipients.clear();
      }
    });

    it("schedules retries with backoff while the SMTP server is unreachable, then fails after the last attempt", async () => {
      const input = message();
      const [id] = await enqueueEmails([input]);
      await sink.stop();
      try {
        const first = Date.now();
        assert.deepEqual(await deliverEmails([id]), { sent: 0, failed: 0, retried: 1, skipped: 0 });
        let doc = await row(id);
        assert.equal(doc.status, "pending");
        assert.equal(doc.attempts, 1);
        assert.equal(doc.lockedUntil, null);
        assert.ok(doc.lastError);
        assertNoPersonalData(doc.lastError, [input.to], "lastError");
        assert.ok(Math.abs(doc.nextAttemptAt.getTime() - (first + MINUTE)) < 5000, "first retry after 1 minute");

        const scheduled = doc.nextAttemptAt.getTime();
        await deliverEmails(undefined, 50);
        doc = await row(id);
        assert.deepEqual([doc.attempts, doc.nextAttemptAt.getTime()], [1, scheduled], "a batch run leaves messages that are not due yet alone");

        await patchEmail(id, { nextAttemptAt: new Date(Date.now() - 1000) });
        const second = Date.now();
        await deliverEmails(undefined, 50);
        doc = await row(id);
        assert.equal(doc.attempts, 2);
        assert.ok(Math.abs(doc.nextAttemptAt.getTime() - (second + 5 * MINUTE)) < 5000, "second retry after 5 minutes");

        await patchEmail(id, { attempts: 5, nextAttemptAt: new Date(Date.now() - 1000) });
        assert.deepEqual(await deliverEmails([id]), { sent: 0, failed: 1, retried: 0, skipped: 0 });
        doc = await row(id);
        assert.equal(doc.status, "failed");
        assert.equal(doc.attempts, 6);
        assert.ok(doc.purgeAt);

        const logs = integration.logs();
        assert.ok(logs.includes("\"event\":\"email.retry_scheduled\""));
        assert.ok(logs.includes("\"event\":\"email.failed\""));
        assertNoPersonalData(logs, [input.to], "delivery logs");
      } finally {
        await sink.start();
      }

      const [recovered] = await enqueueEmails([message()]);
      assert.deepEqual(await deliverEmails([recovered]), { sent: 1, failed: 0, retried: 0, skipped: 0 }, "delivery resumes once SMTP is back");
    });
  });
});
