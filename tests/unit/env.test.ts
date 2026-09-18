import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bearerTokenMatches, getConfigProblems, type ConfigProblem } from "@/lib/env";
import { withCleanEnv } from "./support/env";
import { DRIVE_FOLDER_ID, PEM_KEY, SERVICE_ACCOUNT_EMAIL, SPREADSHEET_ID, SHARED_DRIVE_ID, googleEnv } from "./support/google";

type Env = Record<string, string | undefined>;

const SECRET = "s3cr3t-value-that-must-never-appear-0123456789";

// A complete, correct production configuration. The data store is a Google Spreadsheet plus a
// Google Drive folder; there is no database server and no object storage any more.
const production: Env = {
  ...googleEnv,
  // A service account has no Drive storage quota of its own, so a production deployment needs a
  // Shared Drive (or domain-wide delegation) for uploads to be accepted at all.
  GOOGLE_DRIVE_SHARED_DRIVE_ID: SHARED_DRIVE_ID,
  NODE_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://www.synergypharma.lk",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_USER: "mailer",
  SMTP_PASS: SECRET,
  SMTP_FROM: "Synergy Careers <careers@synergypharma.lk>",
  HR_NOTIFICATION_EMAIL: "hr@synergypharma.lk, recruitment@synergypharma.lk",
  CONTACT_NOTIFICATION_EMAIL: "info@synergypharma.lk",
  CRON_SECRET: SECRET,
  HEALTHCHECK_TOKEN: SECRET,
  TRUSTED_IP_HEADER: "x-real-ip",
  DATA_RETENTION_MONTHS: "12",
  RETENTION_AUTO_PURGE: "false",
  AUDIT_RETENTION_MONTHS: "24",
};

// Every GOOGLE_ variable removed, as on a deployment where the store was never set up.
const withoutGoogle: Env = {
  ...production,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined,
  GOOGLE_PRIVATE_KEY: undefined,
  GOOGLE_SHEETS_SPREADSHEET_ID: undefined,
  GOOGLE_DRIVE_FOLDER_ID: undefined,
  GOOGLE_DRIVE_SHARED_DRIVE_ID: undefined,
};

function problems(env: Env): ConfigProblem[] {
  return withCleanEnv(env, () => getConfigProblems());
}

function find(list: ConfigProblem[], variable: string): ConfigProblem | undefined {
  return list.find((problem) => problem.variable === variable);
}

function levelOf(env: Env, variable: string): ConfigProblem["level"] | undefined {
  return find(problems(env), variable)?.level;
}

function googleProblems(env: Env): ConfigProblem[] {
  return problems(env).filter((problem) => problem.variable.startsWith("GOOGLE_"));
}

describe("getConfigProblems", () => {
  it("reports nothing for a complete production configuration", () => {
    assert.deepEqual(problems(production), []);
  });

  it("accepts the single-variable service account form and the optional Google settings", () => {
    const json = JSON.stringify({ client_email: SERVICE_ACCOUNT_EMAIL, private_key: PEM_KEY, private_key_id: "abc123" });
    assert.deepEqual(
      googleProblems({
        ...production,
        GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined,
        GOOGLE_PRIVATE_KEY: undefined,
        GOOGLE_SERVICE_ACCOUNT_JSON: json,
        GOOGLE_DRIVE_SHARED_DRIVE_ID: SHARED_DRIVE_ID,
        GOOGLE_IMPERSONATE_USER: "careers@synergypharma.lk",
      }),
      []
    );
  });

  it("never includes configured values in messages", () => {
    const list = problems({
      ...production,
      NEXT_PUBLIC_SITE_URL: `http://${SECRET}.example.com`,
      CRON_SECRET: "short-secret-xyz",
      GOOGLE_SHEETS_SPREADSHEET_ID: `bad id ${SECRET}`,
      GOOGLE_PRIVATE_KEY: `${SECRET}-not-a-pem`,
      SMTP_FROM: `${SECRET} <not-an-address>`,
      HR_NOTIFICATION_EMAIL: `${SECRET}@@example`,
      AUTH_SECRET: SECRET,
    });
    assert.ok(list.length >= 5);
    const text = JSON.stringify(list);
    assert.equal(text.includes(SECRET), false, text);
    assert.equal(text.includes("short-secret-xyz"), false, text);
    // Key material itself is never echoed (the PEM header may be named as a hint, the key may not).
    assert.equal(text.includes(PEM_KEY.split("\n")[1]), false, text);
  });

  it("flags placeholder values copied from .env.example as errors", () => {
    const list = problems({ ...production, SMTP_PASS: "replace-with-smtp-password", SOME_OTHER_SETTING: "replace-with-anything" });
    assert.equal(find(list, "SMTP_PASS")?.level, "error");
    assert.equal(find(list, "SOME_OTHER_SETTING")?.level, "error");
    assert.equal(JSON.stringify(list).includes("replace-with-smtp-password"), false);
  });

  it("reports a data store that was never configured as an error in every environment", () => {
    // Nothing the site does works without the spreadsheet and the Drive folder, so unlike SMTP
    // this is never softened to a warning in development.
    for (const env of [withoutGoogle, { ...withoutGoogle, NODE_ENV: "development" }]) {
      const reported = googleProblems(env);
      assert.deepEqual(reported.map((problem) => problem.variable), [
        "GOOGLE_SERVICE_ACCOUNT_EMAIL",
        "GOOGLE_PRIVATE_KEY",
        "GOOGLE_SHEETS_SPREADSHEET_ID",
        "GOOGLE_DRIVE_FOLDER_ID",
      ]);
      assert.ok(reported.every((problem) => problem.level === "error"), JSON.stringify(reported));
    }
  });

  it("warns in production when the service account has no Drive storage to write to", () => {
    // The production gotcha: a service account has no Drive quota of its own, so an upload into a
    // plain My Drive folder eventually fails with storageQuotaExceeded.
    const neither: Env = { ...production, GOOGLE_DRIVE_SHARED_DRIVE_ID: undefined, GOOGLE_IMPERSONATE_USER: undefined };
    const warning = find(problems(neither), "GOOGLE_DRIVE_SHARED_DRIVE_ID");
    assert.equal(warning?.level, "warning");
    assert.ok(warning?.message.includes("storageQuotaExceeded"), warning?.message);
    assert.ok(warning?.message.includes("GOOGLE_IMPERSONATE_USER"), warning?.message);

    // Either fix silences it, and it is a production-only concern.
    assert.equal(levelOf({ ...neither, GOOGLE_DRIVE_SHARED_DRIVE_ID: SHARED_DRIVE_ID }, "GOOGLE_DRIVE_SHARED_DRIVE_ID"), undefined);
    assert.equal(levelOf({ ...neither, GOOGLE_IMPERSONATE_USER: "careers@synergypharma.lk" }, "GOOGLE_DRIVE_SHARED_DRIVE_ID"), undefined);
    assert.equal(levelOf({ ...neither, NODE_ENV: "development" }, "GOOGLE_DRIVE_SHARED_DRIVE_ID"), undefined);
  });

  it("warns about the variables the migration retired", () => {
    const retired = {
      MONGODB_URI: "mongodb://127.0.0.1:27017",
      MONGODB_DB_NAME: "synergy",
      MONGODB_MAX_POOL_SIZE: "10",
      S3_BUCKET: "synergy-cvs",
      S3_REGION: "ap-south-1",
      S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
      S3_SECRET_ACCESS_KEY: "leftover-secret-that-should-be-revoked",
      AUTH_SECRET: SECRET,
      ADMIN_PASSWORD: "hunter2",
    };
    const list = problems({ ...production, ...retired });
    for (const name of Object.keys(retired)) {
      assert.equal(find(list, name)?.level, "warning", name);
    }
    // The values are credentials that should be revoked, so they are named but never echoed.
    const text = JSON.stringify(list);
    assert.equal(text.includes("leftover-secret-that-should-be-revoked"), false, text);
    assert.equal(text.includes("mongodb://"), false, text);
  });

  it("reports each incomplete or malformed Google setting against its own variable", () => {
    assert.equal(levelOf({ ...production, GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined }, "GOOGLE_SERVICE_ACCOUNT_EMAIL"), "error");
    assert.equal(levelOf({ ...production, GOOGLE_SERVICE_ACCOUNT_EMAIL: "not-an-email" }, "GOOGLE_SERVICE_ACCOUNT_EMAIL"), "error");
    assert.equal(levelOf({ ...production, GOOGLE_PRIVATE_KEY: undefined }, "GOOGLE_PRIVATE_KEY"), "error");
    assert.equal(levelOf({ ...production, GOOGLE_PRIVATE_KEY: "not a pem" }, "GOOGLE_PRIVATE_KEY"), "error");
    assert.equal(levelOf({ ...production, GOOGLE_SHEETS_SPREADSHEET_ID: undefined }, "GOOGLE_SHEETS_SPREADSHEET_ID"), "error");
    assert.equal(levelOf({ ...production, GOOGLE_SHEETS_SPREADSHEET_ID: "https://docs.google.com/spreadsheets/d/x/edit" }, "GOOGLE_SHEETS_SPREADSHEET_ID"), "error");
    assert.equal(levelOf({ ...production, GOOGLE_DRIVE_FOLDER_ID: undefined }, "GOOGLE_DRIVE_FOLDER_ID"), "error");
    assert.equal(levelOf({ ...production, GOOGLE_DRIVE_FOLDER_ID: "folder id with spaces" }, "GOOGLE_DRIVE_FOLDER_ID"), "error");
    assert.equal(levelOf({ ...production, GOOGLE_DRIVE_SHARED_DRIVE_ID: "not a drive id!" }, "GOOGLE_DRIVE_SHARED_DRIVE_ID"), "error");
    assert.equal(levelOf({ ...production, GOOGLE_IMPERSONATE_USER: "careers@" }, "GOOGLE_IMPERSONATE_USER"), "error");
    assert.equal(levelOf({ ...production, GOOGLE_SERVICE_ACCOUNT_JSON: "{ not json" }, "GOOGLE_SERVICE_ACCOUNT_JSON"), "error");
  });

  it("accepts the private key in the shapes a hosting dashboard produces", () => {
    const escaped = PEM_KEY.trimEnd().split("\n").join("\\n");
    assert.deepEqual(googleProblems({ ...production, GOOGLE_PRIVATE_KEY: escaped }), []);
    assert.deepEqual(googleProblems({ ...production, GOOGLE_PRIVATE_KEY: `"${escaped}"` }), []);
    assert.deepEqual(googleProblems({ ...production, GOOGLE_PRIVATE_KEY: Buffer.from(PEM_KEY, "utf8").toString("base64") }), []);
  });

  it("requires an https site URL in production only", () => {
    assert.equal(levelOf({ ...production, NEXT_PUBLIC_SITE_URL: "http://www.synergypharma.lk" }, "NEXT_PUBLIC_SITE_URL"), "error");
    assert.equal(levelOf({ ...production, NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }, "NEXT_PUBLIC_SITE_URL"), undefined);
    assert.equal(levelOf({ ...production, NEXT_PUBLIC_SITE_URL: "not a url" }, "NEXT_PUBLIC_SITE_URL"), "error");
    assert.equal(levelOf({ ...production, NEXT_PUBLIC_SITE_URL: "https://example.com/?next=1" }, "NEXT_PUBLIC_SITE_URL"), "error");
    assert.equal(levelOf({ ...production, NEXT_PUBLIC_SITE_URL: undefined }, "NEXT_PUBLIC_SITE_URL"), "warning");
  });

  it("treats missing SMTP as an error in production and a warning in development", () => {
    const withoutSmtp: Env = { ...production };
    for (const name of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) withoutSmtp[name] = undefined;
    assert.equal(levelOf(withoutSmtp, "SMTP_HOST"), "error");
    assert.equal(levelOf({ ...withoutSmtp, NODE_ENV: "development" }, "SMTP_HOST"), "warning");
  });

  it("reports incoherent SMTP settings", () => {
    assert.equal(levelOf({ ...production, SMTP_FROM: undefined }, "SMTP_FROM"), "error");
    assert.equal(levelOf({ ...production, SMTP_PORT: "99999" }, "SMTP_PORT"), "error");
    assert.equal(levelOf({ ...production, SMTP_PASS: "" }, "SMTP_PASS"), "error");
  });

  it("validates notification recipient lists", () => {
    assert.equal(levelOf({ ...production, HR_NOTIFICATION_EMAIL: undefined }, "HR_NOTIFICATION_EMAIL"), "warning");
    assert.equal(levelOf({ ...production, HR_NOTIFICATION_EMAIL: "hr@synergypharma.lk, not-an-email" }, "HR_NOTIFICATION_EMAIL"), "error");
    assert.equal(levelOf({ ...production, HR_NOTIFICATION_EMAIL: "HR <hr@synergypharma.lk>" }, "HR_NOTIFICATION_EMAIL"), "error");
    const many = Array.from({ length: 11 }, (_, i) => `hr${i}@synergypharma.lk`).join(",");
    assert.equal(levelOf({ ...production, HR_NOTIFICATION_EMAIL: many }, "HR_NOTIFICATION_EMAIL"), "warning");
    assert.equal(levelOf({ ...production, CONTACT_NOTIFICATION_EMAIL: undefined }, "CONTACT_NOTIFICATION_EMAIL"), undefined);
    assert.equal(levelOf({ ...production, CONTACT_NOTIFICATION_EMAIL: "info@" }, "CONTACT_NOTIFICATION_EMAIL"), "error");
  });

  it("checks secret lengths", () => {
    assert.equal(levelOf({ ...production, CRON_SECRET: "too-short" }, "CRON_SECRET"), "error");
    assert.equal(levelOf({ ...production, NODE_ENV: "development", CRON_SECRET: "too-short" }, "CRON_SECRET"), "warning");
    assert.equal(levelOf({ ...production, CRON_SECRET: undefined }, "CRON_SECRET"), "warning");
    assert.equal(levelOf({ ...production, NODE_ENV: "development", CRON_SECRET: undefined }, "CRON_SECRET"), undefined);
    assert.equal(levelOf({ ...production, HEALTHCHECK_TOKEN: "x".repeat(31) }, "HEALTHCHECK_TOKEN"), "error");
    assert.equal(levelOf({ ...production, HEALTHCHECK_TOKEN: "x".repeat(32) }, "HEALTHCHECK_TOKEN"), undefined);
    assert.equal(levelOf({ ...production, HEALTHCHECK_TOKEN: undefined }, "HEALTHCHECK_TOKEN"), undefined);
  });

  it("checks client IP detection settings", () => {
    const spoofable = find(problems({ ...production, TRUSTED_IP_HEADER: undefined }), "TRUSTED_IP_HEADER");
    assert.equal(spoofable?.level, "warning");
    assert.ok(spoofable?.message.includes("spoofed"));
    assert.equal(levelOf({ ...production, TRUSTED_IP_HEADER: undefined, VERCEL: "1" }, "TRUSTED_IP_HEADER"), undefined);
    assert.equal(levelOf({ ...production, NODE_ENV: "development", TRUSTED_IP_HEADER: undefined }, "TRUSTED_IP_HEADER"), undefined);
    assert.equal(levelOf({ ...production, TRUSTED_IP_HEADER: "x-real-ip, x-forwarded-for" }, "TRUSTED_IP_HEADER"), "error");
    for (const value of ["0", "11", "two", "1.5"]) {
      assert.equal(levelOf({ ...production, TRUSTED_PROXY_COUNT: value }, "TRUSTED_PROXY_COUNT"), "error", value);
    }
    assert.equal(levelOf({ ...production, TRUSTED_PROXY_COUNT: "2" }, "TRUSTED_PROXY_COUNT"), undefined);
  });

  it("validates retention settings", () => {
    for (const value of ["0", "121", "-1", "1.5", "twelve", "12 months"]) {
      assert.equal(levelOf({ ...production, DATA_RETENTION_MONTHS: value }, "DATA_RETENTION_MONTHS"), "error", value);
    }
    for (const value of ["1", "24", "120"]) {
      assert.equal(levelOf({ ...production, DATA_RETENTION_MONTHS: value }, "DATA_RETENTION_MONTHS"), undefined, value);
    }
    for (const value of ["yes", "TRUE", "1"]) {
      assert.equal(levelOf({ ...production, RETENTION_AUTO_PURGE: value }, "RETENTION_AUTO_PURGE"), "error", value);
    }
    assert.equal(levelOf({ ...production, RETENTION_AUTO_PURGE: "true" }, "RETENTION_AUTO_PURGE"), undefined);
  });

  it("validates AUDIT_RETENTION_MONTHS, which bounds the AuditLog tab", () => {
    // A spreadsheet is capped at 10 million cells, so the audit tab cannot grow forever.
    for (const value of ["0", "121", "-1", "1.5", "twentyfour", "24 months"]) {
      assert.equal(levelOf({ ...production, AUDIT_RETENTION_MONTHS: value }, "AUDIT_RETENTION_MONTHS"), "error", value);
    }
    for (const value of ["1", "24", "120"]) {
      assert.equal(levelOf({ ...production, AUDIT_RETENTION_MONTHS: value }, "AUDIT_RETENTION_MONTHS"), undefined, value);
    }
    assert.equal(levelOf({ ...production, AUDIT_RETENTION_MONTHS: undefined }, "AUDIT_RETENTION_MONTHS"), undefined, "the default of 24 months applies");
  });

  it("reads the spreadsheet and folder ids exactly as configured", () => {
    // Guards against a copy/paste of the whole sheet URL, which is the usual mistake.
    assert.deepEqual(googleProblems({ ...production, GOOGLE_SHEETS_SPREADSHEET_ID: SPREADSHEET_ID, GOOGLE_DRIVE_FOLDER_ID: DRIVE_FOLDER_ID }), []);
    assert.equal(
      levelOf({ ...production, GOOGLE_DRIVE_FOLDER_ID: `https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}` }, "GOOGLE_DRIVE_FOLDER_ID"),
      "error"
    );
  });
});

describe("bearerTokenMatches", () => {
  it("accepts only the exact configured token", () => {
    assert.equal(bearerTokenMatches(`Bearer ${SECRET}`, SECRET), true);
    assert.equal(bearerTokenMatches(`bearer   ${SECRET}  `, SECRET), true);
    assert.equal(bearerTokenMatches(`Bearer ${SECRET}x`, SECRET), false);
    assert.equal(bearerTokenMatches(`Bearer ${SECRET.slice(0, -1)}`, SECRET), false);
    assert.equal(bearerTokenMatches(`Basic ${SECRET}`, SECRET), false);
    assert.equal(bearerTokenMatches(SECRET, SECRET), false);
    assert.equal(bearerTokenMatches(`Bearer ${SECRET} extra`, SECRET), false);
  });

  it("rejects missing headers and unconfigured secrets", () => {
    assert.equal(bearerTokenMatches(null, SECRET), false);
    assert.equal(bearerTokenMatches("", SECRET), false);
    assert.equal(bearerTokenMatches("Bearer ", ""), false);
    assert.equal(bearerTokenMatches("Bearer anything", ""), false);
  });
});
