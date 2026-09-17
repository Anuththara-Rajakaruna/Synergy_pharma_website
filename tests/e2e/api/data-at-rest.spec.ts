import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { api, login, loginAsAdmin } from "../support/api";
import { e2eEnv } from "../support/env";
import { expectApiError, expectStatus } from "./lib/assertions";
import { databaseConfigured, withDatabase } from "./lib/database";
import {
  applicationBody,
  createActiveUser,
  createApplication,
  createOpenJob,
  cvFile,
  deactivateUser,
  isolatedClientIp,
  postApplication,
  candidate,
  retireJob,
  setApplicationArchived,
  uploadDocuments,
} from "./lib/fixtures";
import { sentTo, waitForEmails } from "./lib/mail";

// Checks that need to look at (or age) stored state directly: session expiry, hashed secrets and
// keys, upload expiry and erasure of queued emails. They run only when E2E_MONGODB_URI and
// E2E_MONGODB_DB_NAME point at the database of the site under test, and only touch records
// created here.

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function tokenOf(cookie: string): string {
  return cookie.slice(cookie.indexOf("=") + 1);
}

test.describe("stored state", () => {
  test.skip(!databaseConfigured(), "Set E2E_MONGODB_URI and E2E_MONGODB_DB_NAME to run the stored-state checks.");

  let admin = "";

  test.beforeAll(async () => {
    admin = await loginAsAdmin();
  });

  test("sessions are stored as token hashes and expire after 60 idle minutes or 8 hours", async () => {
    const idle = await login(e2eEnv.hrEmail, e2eEnv.hrPassword);
    const absolute = await login(e2eEnv.hrEmail, e2eEnv.hrPassword);
    const touched = await login(e2eEnv.hrEmail, e2eEnv.hrPassword);

    await withDatabase(async (connection) => {
      const sessions = connection.collection("admin_sessions");
      const stored = await sessions.findOne({ tokenHash: sha256(tokenOf(idle)) });
      expect(stored, "session stored under the SHA-256 of its token").not.toBeNull();
      expect(JSON.stringify(stored)).not.toContain(tokenOf(idle));

      const now = Date.now();
      await sessions.updateOne({ tokenHash: sha256(tokenOf(idle)) }, { $set: { lastSeenAt: new Date(now - 61 * 60 * 1000) } });
      await sessions.updateOne({ tokenHash: sha256(tokenOf(absolute)) }, { $set: { expiresAt: new Date(now - 1000) } });
      await sessions.updateOne({ tokenHash: sha256(tokenOf(touched)) }, { $set: { lastSeenAt: new Date(now - 10 * 60 * 1000) } });
    });

    expectApiError(await api("GET", "/api/admin/me", { cookie: idle }), 401, "unauthorized");
    expectApiError(await api("GET", "/api/admin/me", { cookie: absolute }), 401, "unauthorized");
    expectStatus(await api("GET", "/api/admin/me", { cookie: touched }), 200);

    await withDatabase(async (connection) => {
      const sessions = connection.collection("admin_sessions");
      expect(await sessions.countDocuments({ tokenHash: { $in: [sha256(tokenOf(idle)), sha256(tokenOf(absolute))] } }), "dead sessions are deleted").toBe(0);
      const refreshed = await sessions.findOne({ tokenHash: sha256(tokenOf(touched)) });
      const lastSeen = refreshed?.lastSeenAt instanceof Date ? refreshed.lastSeenAt.getTime() : 0;
      expect(Date.now() - lastSeen, "lastSeenAt refreshed after 5 minutes").toBeLessThan(2 * 60 * 1000);
    });
    await api("POST", "/api/admin/logout", { cookie: touched });
  });

  test("passwords are scrypt hashes and rate-limit keys never store raw IPs or emails", async () => {
    const user = await createActiveUser(admin, "hr", "rest-hash");
    const ip = isolatedClientIp();
    const presign = await api("POST", "/api/uploads", { ip, json: { purpose: "application", files: [] } });
    expect(presign.status).toBe(400);
    const person = candidate("rest-ratelimit");
    await postApplication(applicationBody(`missing-${person.email.split("@")[0].replace(/[^a-z0-9]+/g, "-")}`, person, { cv: "a".repeat(36), supporting: [] }), ip);
    try {
      await withDatabase(async (connection) => {
        const stored = await connection.collection("admin_users").findOne({ email: user.email });
        expect(String(stored?.passwordHash)).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
        expect(String(stored?.passwordHash)).not.toContain(user.password);

        const limits = connection.collection<{ _id: string }>("rate_limits");
        expect(await limits.countDocuments({ _id: `upload-ip:${sha256(ip).slice(0, 32)}` })).toBe(1);
        expect(await limits.countDocuments({ _id: `apply-email:${sha256(person.email.toLowerCase()).slice(0, 32)}` })).toBe(1);
        const escaped = ip.replace(/\./g, "\\.");
        expect(await limits.countDocuments({ _id: { $regex: escaped } })).toBe(0);
        expect(await limits.countDocuments({ _id: { $regex: "@" } })).toBe(0);
      });
    } finally {
      await deactivateUser(admin, user.id);
    }
  });

  test("an upload intent past its expiry can no longer be claimed", async () => {
    const job = await createOpenJob(admin, "rest-expired-upload");
    try {
      const uploads = await uploadDocuments("application", [cvFile("expiring")]);
      await withDatabase(async (connection) => {
        const update = await connection.collection<{ _id: string }>("upload_intents").updateOne({ _id: uploads.cv }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
        expect(update.matchedCount).toBe(1);
      });
      expectApiError(await postApplication(applicationBody(job.id, candidate("rest-expired"), uploads)), 400, "upload_expired", { fields: ["cv"] });
    } finally {
      await retireJob(admin, job.id);
    }
  });

  test("erasing an application also deletes its queued and sent emails", async () => {
    const job = await createOpenJob(admin, "rest-purge-emails");
    try {
      const created = await createApplication(admin, job.id, "rest-purge");
      await waitForEmails((mail) => sentTo(mail, created.person.email));
      await withDatabase(async (connection) => {
        const count = await connection.collection("email_outbox").countDocuments({ "related.entityType": "application", "related.entityId": created.item.id });
        expect(count).toBeGreaterThan(0);
      });
      await setApplicationArchived(admin, created.item.id, true);
      expectStatus(await api("DELETE", `/api/admin/applications/${created.item.id}`, { cookie: admin }), 200);
      await withDatabase(async (connection) => {
        expect(await connection.collection("email_outbox").countDocuments({ "related.entityId": created.item.id })).toBe(0);
        expect(await connection.collection("applications").countDocuments({ email: created.person.email })).toBe(0);
        const audit = await connection.collection("audit_logs").find({ entityId: created.item.id }).toArray();
        expect(JSON.stringify(audit).toLowerCase()).not.toContain(created.person.email.toLowerCase());
      });
    } finally {
      await retireJob(admin, job.id);
    }
  });
});
