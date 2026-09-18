import "./support/env";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AdminContext } from "@/lib/auth/session";
import { submitApplication } from "@/lib/careers/server/applications";
import { runMaintenance, auditRetentionMonths } from "@/lib/careers/server/maintenance";
import { findRetentionOverdue, purgeRetentionOverdue, retentionDueAt, retentionMonths } from "@/lib/careers/server/retention";
import { submitTalentProfile } from "@/lib/careers/server/talent-pool";
import { documentFolderId } from "@/lib/careers/server/uploads";
import { updateRecord } from "@/lib/sheets-db";
import { encodeDate } from "@/lib/sheets-db/codec";
import { findApplicationById, loadApplication } from "@/lib/sheets-db/repositories/applications";
import { listEmails } from "@/lib/sheets-db/repositories/email";
import { findTalentById, loadTalent } from "@/lib/sheets-db/repositories/talent";
import { markDocumentsDeleted } from "@/lib/sheets-db/repositories/subrecords";
import type { AdminJob } from "@/types/careers";
import { setEnv, suiteSkip } from "./support/env";
import { FOLDER_NAMES, driveFileExists, listFilesIn, putDriveFile } from "./support/drive";
import { adminContext, applicationSubmission, auditEntries, pdfBytes, publishedJob, talentSubmission, uploadDocument } from "./support/fixtures";
import { clearTableRows, startIntegration, type Integration } from "./support/harness";

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

// Emails for a record, straight off the tab.
async function emailsFor(entityId: string): Promise<number> {
  return (await listEmails({ maxAgeMs: 0 })).filter((message) => message.related?.entityId === entityId).length;
}

describe("retention and maintenance", { timeout: 300_000, skip: suiteSkip() }, () => {
  let integration: Integration;
  let sink: NonNullable<Integration["smtp"]>;
  let hr: AdminContext;
  let job: AdminJob;

  // createdAt is immutable through the repositories, so ageing a record writes the cell directly.
  async function ageApplication(id: string, createdAt: Date): Promise<void> {
    assert.ok(await updateRecord("Applications", id, { createdAt: encodeDate(createdAt) }));
  }

  async function application(createdAt: Date): Promise<{ id: string; email: string; fileIds: string[] }> {
    const cv = await uploadDocument("application", "cv");
    const input = applicationSubmission(job.id, { cv });
    const { id } = await submitApplication(input, { ip: "198.51.100.90" });
    await ageApplication(id, createdAt);
    const record = await loadApplication(id);
    return { id, email: input.email, fileIds: (record?.documents ?? []).map((document) => document.driveFileId) };
  }

  async function talent(createdAt: Date): Promise<{ id: string; email: string; fileIds: string[] }> {
    const cv = await uploadDocument("talent_pool", "cv");
    const input = talentSubmission({ cv });
    const { id } = await submitTalentProfile(input, { ip: "198.51.100.90" });
    assert.ok(await updateRecord("TalentPool", id, { createdAt: encodeDate(createdAt) }));
    const record = await loadTalent(id);
    return { id, email: input.email, fileIds: (record?.documents ?? []).map((document) => document.driveFileId) };
  }

  async function clearRecords(): Promise<void> {
    for (const table of ["Applications", "TalentPool", "EmailOutbox", "Documents", "Notes", "StatusHistory", "TalentActivity"] as const) {
      await clearTableRows(table);
    }
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

    it("reads AUDIT_RETENTION_MONTHS with a default of 24 months", async () => {
      // New: the AuditLog tab is the one tab that only ever grows, and a spreadsheet is capped at
      // 10 million cells, so it needs a ceiling.
      await withEnv({ AUDIT_RETENTION_MONTHS: undefined }, () => assert.equal(auditRetentionMonths(), 24));
      await withEnv({ AUDIT_RETENTION_MONTHS: "6" }, () => assert.equal(auditRetentionMonths(), 6));
      await withEnv({ AUDIT_RETENTION_MONTHS: "120" }, () => assert.equal(auditRetentionMonths(), 120));
      for (const invalid of ["0", "121", "abc", "6.5", "-3"]) {
        await withEnv({ AUDIT_RETENTION_MONTHS: invalid }, () => assert.equal(auditRetentionMonths(), 24, invalid));
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

      const result = await purgeRetentionOverdue(50);
      assert.deepEqual(result, { applications: 1, talent: 1, errors: 0 });

      assert.equal(await findApplicationById(overdueApp.id, { maxAgeMs: 0 }), null);
      assert.equal(await findTalentById(overdueTalent.id, { maxAgeMs: 0 }), null);
      assert.ok(await findApplicationById(keptApp.id, { maxAgeMs: 0 }));
      for (const fileId of [...overdueApp.fileIds, ...overdueTalent.fileIds]) {
        assert.equal(await driveFileExists(fileId), false, fileId);
      }
      for (const fileId of keptApp.fileIds) assert.ok(await driveFileExists(fileId));
      assert.equal(await emailsFor(overdueApp.id), 0);
      assert.equal(await emailsFor(overdueTalent.id), 0);
      assert.equal(await emailsFor(keptApp.id), 2);

      const audits = await auditEntries({ action: "retention.purge" });
      assert.deepEqual(audits.map((entry) => entry.entityId).sort(), [overdueApp.id, overdueTalent.id].sort());
      assert.ok(audits.every((entry) => entry.actor === null));
      const auditText = JSON.stringify(audits).toLowerCase();
      assert.equal(auditText.includes(overdueApp.email.toLowerCase()), false);
      assert.equal(auditText.includes(overdueTalent.email.toLowerCase()), false);
    });

    it("treats a document whose Drive file is already gone as erased", async () => {
      // BEHAVIOUR CHANGE: deleting a Drive file that no longer exists succeeds, where deleting an
      // S3 object under a malformed key failed. A record can therefore no longer be stranded by a
      // document that was removed from storage behind the application's back.
      await clearRecords();
      const orphaned = await application(monthsAgo(15));
      const record = await loadApplication(orphaned.id);
      assert.ok(record && record.documents.length > 0);
      const { deleteFile } = await import("@/lib/google/drive");
      for (const document of record.documents) await deleteFile(document.driveFileId);

      assert.deepEqual(await purgeRetentionOverdue(50), { applications: 1, talent: 0, errors: 0 });
      assert.equal(await findApplicationById(orphaned.id, { maxAgeMs: 0 }), null);
    });
  });

  describe("runMaintenance", () => {
    it("removes abandoned staged uploads older than 24 hours and leaves stored documents alone", async () => {
      await clearRecords();
      // A ticket that was uploaded but never submitted: the file sits in the staging folder.
      const abandoned = await uploadDocument("application", "cv");
      const stored = await putDriveFile(await documentFolderId("application"), `keep-me-${Date.now()}.pdf`, pdfBytes(1024));

      const fresh = await runMaintenance();
      assert.equal(fresh.uploads.errors, 0);
      const stagedNow = (await listFilesIn(FOLDER_NAMES.staging)).map((file) => file.name);
      assert.ok(stagedNow.includes(`${abandoned}.pdf`), "uploads younger than 24 hours are kept");

      const later = await runMaintenance({ now: new Date(Date.now() + 25 * HOUR) });
      assert.ok(later.uploads.deletedObjects >= 1);
      assert.equal(later.uploads.errors, 0);
      const stagedAfter = (await listFilesIn(FOLDER_NAMES.staging)).map((file) => file.name);
      assert.equal(stagedAfter.includes(`${abandoned}.pdf`), false);
      assert.ok(await driveFileExists(stored.id), "only the staging folder is swept");
      assert.equal(typeof later.durationMs, "number");
    });

    it("reports overdue records without purging unless RETENTION_AUTO_PURGE=true, and delivers due emails", async () => {
      await clearRecords();
      const overdue = await application(monthsAgo(13));
      const recent = await application(monthsAgo(2));

      const reportOnly = await withEnv({ RETENTION_AUTO_PURGE: undefined }, () => runMaintenance());
      assert.deepEqual(reportOnly.retention, { overdueApplications: 1, overdueTalent: 0, purgedApplications: 0, purgedTalent: 0, autoPurge: false });
      assert.ok(await findApplicationById(overdue.id, { maxAgeMs: 0 }));
      assert.equal(reportOnly.emails.sent, 4, "both applications' pending emails were delivered");
      assert.equal(sink.messagesTo(recent.email).length, 1);

      const overdueTwo = await application(monthsAgo(13));
      const purged = await withEnv({ RETENTION_AUTO_PURGE: "true" }, () => runMaintenance());
      assert.deepEqual(purged.retention, { overdueApplications: 2, overdueTalent: 0, purgedApplications: 2, purgedTalent: 0, autoPurge: true });
      assert.equal(await findApplicationById(overdue.id, { maxAgeMs: 0 }), null);
      assert.equal(await findApplicationById(overdueTwo.id, { maxAgeMs: 0 }), null);
      assert.ok(await findApplicationById(recent.id, { maxAgeMs: 0 }));
      assert.equal(sink.messagesTo(overdueTwo.email).length, 0, "emails about purged records are removed before delivery");
      assert.equal(purged.emails.sent, 0);
    });

    it("reports email delivery results in the maintenance report", async () => {
      await clearRecords();
      await application(new Date(Date.now() - 24 * HOUR));
      await sink.stop();
      try {
        const report = await runMaintenance();
        assert.deepEqual(report.emails, { sent: 0, failed: 0, retried: 2, skipped: 0 });
      } finally {
        await sink.start();
      }
      assert.ok(integration.logs().includes("\"event\":\"maintenance.completed\""));
    });

    it("sweeps the rows a TTL index used to remove: expired sessions, purgeable emails and old audit entries", async () => {
      // MongoDB expired these rows itself. A spreadsheet has no TTL, so the maintenance job is
      // what keeps the tabs inside the 10 million cell ceiling.
      await clearRecords();
      const report = await runMaintenance();
      assert.equal(report.sessions.errors, 0);
      assert.equal(report.outboxRows.errors, 0);
      assert.equal(report.auditLog.errors, 0);
      assert.equal(report.auditLog.olderThanMonths, auditRetentionMonths());
      assert.equal(report.errors, 0, "a healthy run reports no failed steps");
    });

    it("leaves a document row marked deleted rather than removing it", async () => {
      // Sub-record rows are never deleted during normal operation: deleting would renumber the
      // tab under every cached row number.
      await clearRecords();
      const created = await application(new Date());
      const record = await loadApplication(created.id);
      assert.ok(record);
      const ids = record.documents.map((document) => document.id);
      await markDocumentsDeleted(ids, new Date());
      const after = await loadApplication(created.id);
      assert.deepEqual(after?.documents ?? [], [], "a deleted document is no longer attached to the record");
    });
  });
});
