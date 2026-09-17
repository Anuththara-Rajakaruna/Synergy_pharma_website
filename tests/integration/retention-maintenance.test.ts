import "./support/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Types } from "mongoose";
import type { AdminContext } from "@/lib/auth/session";
import { submitApplication } from "@/lib/careers/server/applications";
import { runMaintenance } from "@/lib/careers/server/maintenance";
import { findRetentionOverdue, purgeRetentionOverdue, retentionDueAt, retentionMonths } from "@/lib/careers/server/retention";
import { submitTalentProfile } from "@/lib/careers/server/talent-pool";
import { ApplicationModel } from "@/models/application";
import { EmailOutboxModel } from "@/models/email-outbox";
import { TalentPoolEntryModel } from "@/models/talent-pool-entry";
import type { AdminJob } from "@/types/careers";
import { setEnv } from "./support/env";
import { adminContext, applicationSubmission, auditEntries, pdfBytes, publishedJob, talentSubmission, uploadDocument } from "./support/fixtures";
import { startIntegration, type Integration } from "./support/harness";
import { objectExists, putObject } from "./support/s3";
import type { SmtpSink } from "./support/smtp-sink";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function monthsAgo(months: number, extraMs = 0): Date {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - months);
  return new Date(date.getTime() - extraMs);
}

async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(patch).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(patch)) setEnv(name, value);
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) setEnv(name, value);
  }
}

describe("retention and maintenance", { timeout: 240_000 }, () => {
  let integration: Integration;
  let sink: SmtpSink;
  let hr: AdminContext;
  let job: AdminJob;

  async function application(createdAt: Date): Promise<{ id: string; email: string; keys: string[] }> {
    const cv = await uploadDocument("application", "cv");
    const input = applicationSubmission(job.id, { cv });
    const { id } = await submitApplication(input, { ip: "198.51.100.90" });
    await ApplicationModel.collection.updateOne({ _id: new Types.ObjectId(id) }, { $set: { createdAt } });
    const doc = await ApplicationModel.findById(id).lean();
    return { id, email: input.email, keys: (doc?.documents ?? []).map((document) => document.key) };
  }

  async function talent(createdAt: Date): Promise<{ id: string; email: string; keys: string[] }> {
    const cv = await uploadDocument("talent_pool", "cv");
    const input = talentSubmission({ cv });
    const { id } = await submitTalentProfile(input, { ip: "198.51.100.90" });
    await TalentPoolEntryModel.collection.updateOne({ _id: new Types.ObjectId(id) }, { $set: { createdAt } });
    const doc = await TalentPoolEntryModel.findById(id).lean();
    return { id, email: input.email, keys: (doc?.documents ?? []).map((document) => document.key) };
  }

  async function clearRecords(): Promise<void> {
    await Promise.all([ApplicationModel.deleteMany({}), TalentPoolEntryModel.deleteMany({}), EmailOutboxModel.deleteMany({})]);
  }

  before(async () => {
    integration = await startIntegration({ smtp: true });
    assert.ok(integration.smtp);
    sink = integration.smtp;
    hr = await adminContext("hr");
    job = await publishedJob(hr);
  });

  after(async () => {
    await integration.stop();
  });

  describe("retention period", () => {
    it("reads DATA_RETENTION_MONTHS with a default of 12 months", async () => {
      await withEnv({ DATA_RETENTION_MONTHS: undefined }, () => assert.equal(retentionMonths(), 12));
      await withEnv({ DATA_RETENTION_MONTHS: "6" }, () => assert.equal(retentionMonths(), 6));
      for (const invalid of ["0", "121", "abc", "6.5", "-3"]) {
        await withEnv({ DATA_RETENTION_MONTHS: invalid }, () => assert.equal(retentionMonths(), 12, invalid));
      }
    });

    it("adds calendar months, clamping to the end of shorter months", async () => {
      await withEnv({ DATA_RETENTION_MONTHS: "1" }, () => {
        assert.equal(retentionDueAt(new Date("2026-01-31T10:00:00.000Z")).toISOString(), "2026-02-28T10:00:00.000Z");
        assert.equal(retentionDueAt(new Date("2028-01-31T10:00:00.000Z")).toISOString(), "2028-02-29T10:00:00.000Z");
      });
      await withEnv({ DATA_RETENTION_MONTHS: "12" }, () => {
        assert.equal(retentionDueAt(new Date("2024-02-29T08:30:00.000Z")).toISOString(), "2025-02-28T08:30:00.000Z");
        assert.equal(retentionDueAt(new Date("2026-09-17T00:00:00.000Z")).toISOString(), "2027-09-17T00:00:00.000Z");
      });
    });
  });

  describe("findRetentionOverdue / purgeRetentionOverdue", () => {
    it("finds records older than the retention period, oldest first, up to the limit", async () => {
      await clearRecords();
      const oldest = await application(monthsAgo(14));
      const old = await application(monthsAgo(12, HOUR));
      const recent = await application(monthsAgo(11));
      const oldTalent = await talent(monthsAgo(13));
      const recentTalent = await talent(new Date());

      const overdue = await findRetentionOverdue(10);
      assert.deepEqual(overdue.applications.map((item) => item.id), [oldest.id, old.id]);
      assert.deepEqual(overdue.talent.map((item) => item.id), [oldTalent.id]);
      assert.ok(overdue.applications[0].createdAt instanceof Date);
      assert.deepEqual((await findRetentionOverdue(1)).applications.map((item) => item.id), [oldest.id]);
      assert.deepEqual(await findRetentionOverdue(0), { applications: [], talent: [] });

      await withEnv({ DATA_RETENTION_MONTHS: "24" }, async () => {
        assert.deepEqual(await findRetentionOverdue(10), { applications: [], talent: [] });
      });
      assert.ok(recent.id && recentTalent.id);
    });

    it("erases overdue records (archived or not) with their documents and emails, and audits as the system", async () => {
      await clearRecords();
      const overdueApp = await application(monthsAgo(13));
      const overdueTalent = await talent(monthsAgo(13));
      const keptApp = await application(monthsAgo(1));
      const brokenApp = await application(monthsAgo(15));
      await ApplicationModel.updateOne(
        { _id: brokenApp.id },
        { $set: { "documents.0.key": "/storage-rejects-this-key.pdf" } }
      );

      const result = await purgeRetentionOverdue(50);
      assert.deepEqual(result, { applications: 1, talent: 1, errors: 1 });

      assert.equal(await ApplicationModel.exists({ _id: overdueApp.id }), null);
      assert.equal(await TalentPoolEntryModel.exists({ _id: overdueTalent.id }), null);
      assert.ok(await ApplicationModel.exists({ _id: keptApp.id }));
      assert.ok(await ApplicationModel.exists({ _id: brokenApp.id }), "a record whose files cannot be deleted is kept for the next run");
      for (const key of [...overdueApp.keys, ...overdueTalent.keys]) assert.equal(await objectExists(key), false, key);
      for (const key of keptApp.keys) assert.ok(await objectExists(key));
      assert.equal(await EmailOutboxModel.countDocuments({ "related.entityId": { $in: [overdueApp.id, overdueTalent.id] } }), 0);
      assert.equal(await EmailOutboxModel.countDocuments({ "related.entityId": keptApp.id }), 2);

      const audits = await auditEntries({ action: "retention.purge" });
      assert.deepEqual(audits.map((entry) => entry.entityId).sort(), [overdueApp.id, overdueTalent.id].sort());
      assert.ok(audits.every((entry) => entry.actor === null));
      const auditText = JSON.stringify(audits).toLowerCase();
      assert.equal(auditText.includes(overdueApp.email.toLowerCase()), false);
      assert.equal(auditText.includes(overdueTalent.email.toLowerCase()), false);
    });
  });

  describe("runMaintenance", () => {
    it("removes abandoned uploads older than 24 hours and leaves everything else", async () => {
      const abandoned = `incoming/${randomUUID()}.pdf`;
      const stored = `applications/${new Types.ObjectId().toHexString()}/${new Types.ObjectId().toHexString()}.pdf`;
      await putObject(abandoned, pdfBytes(1024));
      await putObject(stored, pdfBytes(1024));

      const fresh = await runMaintenance();
      assert.ok(await objectExists(abandoned), "uploads younger than 24 hours are kept");
      assert.equal(fresh.uploads.errors, 0);

      const later = await runMaintenance({ now: new Date(Date.now() + 25 * HOUR) });
      assert.ok(later.uploads.deletedObjects >= 1);
      assert.equal(later.uploads.errors, 0);
      assert.equal(await objectExists(abandoned), false);
      assert.ok(await objectExists(stored), "only incoming/ is swept");
      assert.equal(typeof later.durationMs, "number");
    });

    it("reports overdue records without purging unless RETENTION_AUTO_PURGE=true, and delivers due emails", async () => {
      await clearRecords();
      const overdue = await application(monthsAgo(13));
      const recent = await application(monthsAgo(2));

      const reportOnly = await withEnv({ RETENTION_AUTO_PURGE: undefined }, () => runMaintenance());
      assert.deepEqual(reportOnly.retention, { overdueApplications: 1, overdueTalent: 0, purgedApplications: 0, purgedTalent: 0, autoPurge: false });
      assert.ok(await ApplicationModel.exists({ _id: overdue.id }));
      assert.equal(reportOnly.emails.sent, 4, "both applications' pending emails were delivered");
      assert.equal(sink.messagesTo(recent.email).length, 1);

      const overdueTwo = await application(monthsAgo(13));
      const purged = await withEnv({ RETENTION_AUTO_PURGE: "true" }, () => runMaintenance());
      assert.deepEqual(purged.retention, { overdueApplications: 2, overdueTalent: 0, purgedApplications: 2, purgedTalent: 0, autoPurge: true });
      assert.equal(await ApplicationModel.exists({ _id: overdue.id }), null);
      assert.equal(await ApplicationModel.exists({ _id: overdueTwo.id }), null);
      assert.ok(await ApplicationModel.exists({ _id: recent.id }));
      assert.equal(sink.messagesTo(overdueTwo.email).length, 0, "emails about purged records are removed before delivery");
      assert.equal(purged.emails.sent, 0);
    });

    it("reports email delivery results in the maintenance report", async () => {
      await clearRecords();
      await application(new Date(Date.now() - DAY));
      await sink.stop();
      try {
        const report = await runMaintenance();
        assert.deepEqual(report.emails, { sent: 0, failed: 0, retried: 2, skipped: 0 });
      } finally {
        await sink.start();
      }
      assert.ok(integration.logs().includes("\"event\":\"maintenance.completed\""));
    });
  });
});
