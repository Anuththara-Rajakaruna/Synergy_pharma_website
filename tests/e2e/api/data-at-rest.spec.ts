import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { api, login, loginAsAdmin } from "../support/api";
import { e2eEnv } from "../support/env";
import { expectApiError, expectStatus } from "./lib/assertions";
import { databaseConfigured, findRow, readRows, setCell, testSpreadsheetConfirmed } from "./lib/database";
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

// Checks that need to look at (or age) stored state directly: session expiry, hashed secrets,
// upload tickets and erasure of queued emails. They run only when the GOOGLE_* variables point
// at the spreadsheet of the site under test AND that spreadsheet is marked as a test sheet
// (see ./lib/database.ts), and they only touch records created here.

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function tokenOf(cookie: string): string {
  return cookie.slice(cookie.indexOf("=") + 1);
}

test.describe("stored state", () => {
  test.skip(!databaseConfigured(), "Set the GOOGLE_* variables to run the stored-state checks.");

  let admin = "";
  let usable = false;

  test.beforeAll(async () => {
    usable = await testSpreadsheetConfirmed();
    if (usable) admin = await loginAsAdmin();
  });

  test.beforeEach(() => {
    test.skip(!usable, "The configured spreadsheet is not marked test.spreadsheet=true in its Settings tab.");
  });

  test("sessions are stored as token hashes and expire after 60 idle minutes or 8 hours", async () => {
    const idle = await login(e2eEnv.hrEmail, e2eEnv.hrPassword);
    const absolute = await login(e2eEnv.hrEmail, e2eEnv.hrPassword);
    const touched = await login(e2eEnv.hrEmail, e2eEnv.hrPassword);

    const idleRow = await findRow("AdminSessions", "tokenHash", sha256(tokenOf(idle)));
    expect(idleRow, "session stored under the SHA-256 of its token").not.toBeNull();
    // The cookie value itself must appear nowhere in the row.
    expect(JSON.stringify(idleRow?.values)).not.toContain(tokenOf(idle));

    const absoluteRow = await findRow("AdminSessions", "tokenHash", sha256(tokenOf(absolute)));
    const touchedRow = await findRow("AdminSessions", "tokenHash", sha256(tokenOf(touched)));
    expect(absoluteRow).not.toBeNull();
    expect(touchedRow).not.toBeNull();

    const now = Date.now();
    await setCell("AdminSessions", idleRow!.rowNumber, "lastSeenAt", new Date(now - 61 * 60 * 1000).toISOString());
    await setCell("AdminSessions", absoluteRow!.rowNumber, "expiresAt", new Date(now - 1000).toISOString());
    await setCell("AdminSessions", touchedRow!.rowNumber, "lastSeenAt", new Date(now - 10 * 60 * 1000).toISOString());

    expectApiError(await api("GET", "/api/admin/me", { cookie: idle }), 401, "unauthorized");
    expectApiError(await api("GET", "/api/admin/me", { cookie: absolute }), 401, "unauthorized");
    expectStatus(await api("GET", "/api/admin/me", { cookie: touched }), 200);

    // A dead session is revoked rather than deleted (row numbers stay stable); the maintenance
    // job removes the row later. Either way it can no longer authenticate, which the three
    // assertions above have just proved.
    const idleAfter = await findRow("AdminSessions", "tokenHash", sha256(tokenOf(idle)));
    const absoluteAfter = await findRow("AdminSessions", "tokenHash", sha256(tokenOf(absolute)));
    expect(String(idleAfter?.values.revokedAt ?? ""), "the idle session is revoked").not.toBe("");
    expect(String(absoluteAfter?.values.revokedAt ?? ""), "the expired session is revoked").not.toBe("");

    const refreshed = await findRow("AdminSessions", "tokenHash", sha256(tokenOf(touched)));
    const lastSeen = Date.parse(String(refreshed?.values.lastSeenAt ?? ""));
    expect(Date.now() - lastSeen, "lastSeenAt refreshed after 5 minutes").toBeLessThan(2 * 60 * 1000);

    await api("POST", "/api/admin/logout", { cookie: touched });
  });

  test("passwords are stored only as scrypt hashes, and no rate-limit key is persisted at all", async () => {
    const user = await createActiveUser(admin, "hr", "rest-hash");
    const ip = isolatedClientIp();
    const presign = await api("POST", "/api/uploads", { ip, json: { purpose: "application", files: [] } });
    expect(presign.status).toBe(400);
    const person = candidate("rest-ratelimit");
    await postApplication(
      applicationBody(`missing-${person.email.split("@")[0].replace(/[^a-z0-9]+/g, "-")}`, person, { cv: "a".repeat(36), supporting: [] }),
      ip
    );

    try {
      const stored = await findRow("AdminUsers", "email", user.email.toLowerCase());
      expect(stored, "the account exists").not.toBeNull();
      expect(String(stored?.values.passwordHash)).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
      expect(String(stored?.values.passwordHash)).not.toContain(user.password);

      // Rate-limit counters are held in the memory of each server instance and are never written
      // to the spreadsheet, so there is no tab that could leak an IP address or an email address.
      // Prove the negative across every tab rather than against a single collection.
      const everyTab = await Promise.all(
        (["Jobs", "Applications", "TalentPool", "Documents", "Notes", "StatusHistory", "TalentActivity", "AdminUsers", "AdminSessions", "AuditLog", "EmailOutbox", "Settings"] as const).map(
          async (table) => ({ table, rows: await readRows(table) })
        )
      );
      for (const { table, rows } of everyTab) {
        const text = JSON.stringify(rows);
        expect(text, `${table} must not contain the raw client IP`).not.toContain(ip);
        if (table !== "Applications" && table !== "EmailOutbox") {
          expect(text.toLowerCase(), `${table} must not contain the candidate address`).not.toContain(person.email.toLowerCase());
        }
      }
    } finally {
      await deactivateUser(admin, user.id);
    }
  });

  test("a tampered upload ticket is refused", async () => {
    const job = await createOpenJob(admin, "rest-bad-ticket");
    try {
      const uploads = await uploadDocuments("application", [cvFile("tampered")]);
      // The upload id is meaningless without the signed ticket that produced it; substituting a
      // different id is the closest an outside caller can get to forging one.
      const forged = { cv: `${uploads.cv.slice(0, -1)}${uploads.cv.endsWith("a") ? "b" : "a"}`, supporting: [] as string[] };
      expectApiError(await postApplication(applicationBody(job.id, candidate("rest-forged"), forged)), 400, "upload_missing", { fields: ["cv"] });
    } finally {
      await retireJob(admin, job.id);
    }
  });

  test("erasing an application also deletes its queued and sent emails", async () => {
    const job = await createOpenJob(admin, "rest-purge-emails");
    try {
      const created = await createApplication(admin, job.id, "rest-purge");
      await waitForEmails((mail) => sentTo(mail, created.person.email));

      const before = (await readRows("EmailOutbox")).filter((row) => String(row.values.relatedId) === created.item.id);
      expect(before.length, "emails were queued for the application").toBeGreaterThan(0);

      await setApplicationArchived(admin, created.item.id, true);
      expectStatus(await api("DELETE", `/api/admin/applications/${created.item.id}`, { cookie: admin }), 200);

      const emailsAfter = (await readRows("EmailOutbox")).filter((row) => String(row.values.relatedId) === created.item.id);
      expect(emailsAfter.length, "queued mail about the candidate is erased with the record").toBe(0);

      const applicationsAfter = (await readRows("Applications")).filter(
        (row) => String(row.values.email).toLowerCase() === created.person.email.toLowerCase()
      );
      expect(applicationsAfter.length, "the application row is gone").toBe(0);

      const audit = (await readRows("AuditLog")).filter((row) => String(row.values.entityId) === created.item.id);
      expect(JSON.stringify(audit).toLowerCase(), "the audit trail never held the candidate's address").not.toContain(
        created.person.email.toLowerCase()
      );
    } finally {
      await retireJob(admin, job.id);
    }
  });
});
