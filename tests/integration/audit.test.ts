import "./support/env";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Types } from "mongoose";
import { toAuditActor, type AdminContext } from "@/lib/auth/session";
import { listAuditLogs, recordAudit } from "@/lib/careers/server/audit";
import { AuditLogModel } from "@/models/audit-log";
import type { AdminRole } from "@/lib/careers/constants";
import { adminContext } from "./support/fixtures";
import { startIntegration, type Integration } from "./support/harness";

describe("audit log", { timeout: 60_000 }, () => {
  let integration: Integration;
  let hr: AdminContext;
  let admin: AdminContext;

  before(async () => {
    integration = await startIntegration();
    hr = await adminContext("hr", "Hiruni Recruiter");
    admin = await adminContext("admin", "Asela Administrator");
    await AuditLogModel.deleteMany({});
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
    const [entry] = await AuditLogModel.find({ action: "job.update" }).lean();
    assert.ok(entry);
    assert.ok(entry.actor?.user.equals(hr.userId));
    assert.equal(entry.actor?.name, "Hiruni Recruiter");
    assert.equal(entry.actor?.role, "hr");
    assert.equal(entry.summary.length, 500);
    assert.equal(entry.ip, null);
    assert.deepEqual(entry.meta, { changedFields: ["title"] });
  });

  it("never throws when the entry cannot be written", async () => {
    await recordAudit({
      actor: { user: new Types.ObjectId(), email: "x@example.com", name: "Broken Actor", role: "superuser" as AdminRole },
      action: "job.create",
      entityType: "job",
      entityId: "broken",
      summary: "should not be stored",
    });
    assert.equal(await AuditLogModel.exists({ entityId: "broken" }), null);
    assert.ok(integration.logs().includes("audit.write_failed"));
  });

  it("lists newest first with exact, prefix, entity, actor and date filters", async () => {
    await AuditLogModel.deleteMany({});
    const base = Date.now();
    const rows = [
      { action: "auth.login", entityType: "admin_user", entityId: String(hr.userId), actor: toAuditActor(hr), offset: 5 },
      { action: "auth.login_failed", entityType: "admin_user", entityId: "unknown", actor: null, offset: 4 },
      { action: "job.publish", entityType: "job", entityId: "qa-executive", actor: toAuditActor(admin), offset: 3 },
      { action: "application.view", entityType: "application", entityId: "66e9a1b2c3d4e5f601234567", actor: toAuditActor(hr), offset: 2 },
      { action: "authz.custom", entityType: "other", entityId: "x", actor: null, offset: 1 },
    ];
    for (const row of rows) {
      await AuditLogModel.create({
        at: new Date(base - row.offset * 60_000),
        actor: row.actor,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        summary: row.action,
        meta: {},
        ip: "203.0.113.5",
      });
    }
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
  });
});
