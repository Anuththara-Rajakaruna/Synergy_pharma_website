import "./support/env";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { toAuditActor, type AdminContext } from "@/lib/auth/session";
import { flushAuditLog, listAuditLogs, recordAudit } from "@/lib/careers/server/audit";
import { newId } from "@/lib/careers/server/ids";
import type { AuditLogRecord } from "@/lib/careers/server/records";
import type { AdminRole } from "@/lib/careers/constants";
import { appendRecords, invalidateTable } from "@/lib/sheets-db";
import { auditRow, listAuditRecords } from "@/lib/sheets-db/repositories/audit";
import { setEnv, suiteSkip } from "./support/env";
import { adminContext, auditEntries } from "./support/fixtures";
import { clearTableRows, startIntegration, type Integration } from "./support/harness";

// Writes one entry per row on the AuditLog tab, bypassing the service so the entry can carry an
// exact timestamp. This is the direct-store access the MongoDB version did with create().
async function insertEntries(rows: { at: Date; actor: AuditLogRecord["actor"]; action: string; entityType: string; entityId: string; ip?: string | null }[]): Promise<void> {
  await appendRecords(
    "AuditLog",
    rows.map((row) =>
      auditRow({
        id: newId(row.at),
        at: row.at,
        actor: row.actor,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        summary: row.action,
        meta: {},
        ip: row.ip ?? "203.0.113.5",
      })
    )
  );
}

describe("audit log", { timeout: 120_000, skip: suiteSkip() }, () => {
  let integration: Integration;
  let hr: AdminContext;
  let admin: AdminContext;

  before(async () => {
    integration = await startIntegration();
    hr = await adminContext("hr", "Hiruni Recruiter");
    admin = await adminContext("admin", "Asela Administrator");
    await clearTableRows("AuditLog");
  });

  after(async () => {
    await integration.stop();
  });

  it("records entries with the actor snapshot, clipping long values and dropping unknown IPs", async () => {
    await recordAudit({
      actor: toAuditActor(hr),
      action: "job.update",
      entityType: "job",
      entityId: "qa-executive",
      summary: `Updated job "${"T".repeat(600)}"`,
      meta: { changedFields: ["title"] },
      ip: "unknown",
    });
    const [entry] = await auditEntries({ action: "job.update" });
    assert.ok(entry);
    assert.equal(entry.actor?.user, hr.userId);
    assert.equal(entry.actor?.name, "Hiruni Recruiter");
    assert.equal(entry.actor?.role, "hr");
    assert.equal(entry.summary.length, 500);
    assert.equal(entry.ip, null);
    assert.deepEqual(entry.meta, { changedFields: ["title"] });
  });

  it("never throws when the entry cannot be written", async () => {
    // Point the store at a spreadsheet that does not exist, so the append fails the way a Google
    // outage or a revoked share would. The action being audited must still succeed.
    const configured = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    setEnv("GOOGLE_SHEETS_SPREADSHEET_ID", "1ThisSpreadsheetDoesNotExist0000000000000000");
    invalidateTable();
    try {
      await recordAudit({
        actor: { user: newId(), email: "x@example.com", name: "Broken Actor", role: "superuser" as AdminRole },
        action: "job.create",
        entityType: "job",
        entityId: "broken",
        summary: "should not be stored",
      });
      await flushAuditLog();
    } finally {
      setEnv("GOOGLE_SHEETS_SPREADSHEET_ID", configured);
      invalidateTable();
    }
    assert.equal((await auditEntries({ entityId: "broken" })).length, 0);
    assert.ok(integration.logs().includes("audit.write_failed"));
  });

  it("lists newest first with exact, prefix, entity, actor and date filters", async () => {
    await clearTableRows("AuditLog");
    const base = Date.now();
    await insertEntries([
      { at: new Date(base - 5 * 60_000), action: "auth.login", entityType: "admin_user", entityId: hr.userId, actor: toAuditActor(hr) },
      { at: new Date(base - 4 * 60_000), action: "auth.login_failed", entityType: "admin_user", entityId: "unknown", actor: null },
      { at: new Date(base - 3 * 60_000), action: "job.publish", entityType: "job", entityId: "qa-executive", actor: toAuditActor(admin) },
      { at: new Date(base - 2 * 60_000), action: "application.view", entityType: "application", entityId: "66e9a1b2c3d4e5f601234567", actor: toAuditActor(hr) },
      { at: new Date(base - 1 * 60_000), action: "authz.custom", entityType: "other", entityId: "x", actor: null },
    ]);

    const actions = async (filters: Partial<Parameters<typeof listAuditLogs>[0]>) =>
      (await listAuditLogs({ page: 1, limit: 25, ...filters })).items.map((item) => item.action);

    assert.deepEqual(await actions({}), ["authz.custom", "application.view", "job.publish", "auth.login_failed", "auth.login"]);
    assert.deepEqual(await actions({ action: "auth" }), ["auth.login_failed", "auth.login"], "a prefix matches whole segments only");
    assert.deepEqual(await actions({ action: "auth.login" }), ["auth.login"]);
    assert.deepEqual(await actions({ action: "a.*" }), []);
    assert.deepEqual(await actions({ entityType: "job", entityId: "qa-executive" }), ["job.publish"]);
    assert.deepEqual(await actions({ actorId: hr.userId }), ["application.view", "auth.login"]);
    assert.deepEqual(await actions({ from: new Date(base - 3.5 * 60_000), to: new Date(base - 1.5 * 60_000) }), ["application.view", "job.publish"]);

    const page = await listAuditLogs({ page: 2, limit: 2 });
    assert.deepEqual(
      { total: page.total, page: page.page, limit: page.limit, pageCount: page.pageCount, actions: page.items.map((item) => item.action) },
      { total: 5, page: 2, limit: 2, pageCount: 3, actions: ["job.publish", "auth.login_failed"] }
    );
    const first = (await listAuditLogs({ page: 1, limit: 1, action: "job.publish" })).items[0];
    assert.deepEqual(
      { actorName: first.actorName, actorEmail: first.actorEmail, entityType: first.entityType, ip: first.ip },
      { actorName: "Asela Administrator", actorEmail: admin.user.email, entityType: "job", ip: "203.0.113.5" }
    );
    assert.equal("meta" in first, false, "meta is written for forensics and never returned by the API");
  });

  it("keeps the tab readable by hand: one row per entry, newest last", async () => {
    await clearTableRows("AuditLog");
    await recordAudit({ actor: toAuditActor(admin), action: "job.create", entityType: "job", entityId: "row-order-1", summary: "First" });
    await flushAuditLog();
    await recordAudit({ actor: toAuditActor(admin), action: "job.create", entityType: "job", entityId: "row-order-2", summary: "Second" });
    await flushAuditLog();
    const records = await listAuditRecords({ maxAgeMs: 0 });
    assert.deepEqual(
      records.map((record) => record.entityId),
      ["row-order-1", "row-order-2"],
      "the AuditLog tab is append-only, so rows are in the order they happened"
    );
  });
});
