import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bearerTokenMatches, getConfigProblems, type ConfigProblem } from "@/lib/env";
import { withCleanEnv } from "./support/env";

type Env = Record<string, string | undefined>;

const SECRET = "s3cr3t-value-that-must-never-appear-0123456789";

const database: Env = { MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_DB_NAME: "synergy_unit_test" };

// A complete, correct production configuration.
const production: Env = {
  ...database,
  MONGODB_URI: `mongodb+srv://app:${SECRET}@cluster0.example.mongodb.net`,
  NODE_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://www.synergypharma.lk",
  S3_BUCKET: "synergy-cvs",
  S3_REGION: "ap-south-1",
  S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
  S3_SECRET_ACCESS_KEY: SECRET,
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

describe("getConfigProblems", () => {
  it("reports nothing for a complete production configuration", () => {
    assert.deepEqual(problems(production), []);
  });

  it("never includes configured values in messages", () => {
    const list = problems({
      ...production,
      NEXT_PUBLIC_SITE_URL: `http://${SECRET}.example.com`,
      CRON_SECRET: "short-secret-xyz",
      S3_REGION: `bad region ${SECRET}`,
      SMTP_FROM: `${SECRET} <not-an-address>`,
      HR_NOTIFICATION_EMAIL: `${SECRET}@@example`,
      AUTH_SECRET: SECRET,
    });
    assert.ok(list.length >= 5);
    const text = JSON.stringify(list);
    assert.equal(text.includes(SECRET), false, text);
    assert.equal(text.includes("short-secret-xyz"), false, text);
  });

  it("flags placeholder values copied from .env.example as errors", () => {
    const list = problems({ ...production, SMTP_PASS: "replace-with-smtp-password", SOME_OTHER_SETTING: "replace-with-anything" });
    assert.equal(find(list, "SMTP_PASS")?.level, "error");
    assert.equal(find(list, "SOME_OTHER_SETTING")?.level, "error");
    assert.equal(JSON.stringify(list).includes("replace-with-smtp-password"), false);
  });

  it("requires the database settings", () => {
    assert.equal(levelOf({ ...production, MONGODB_URI: undefined }, "MONGODB_URI"), "error");
    assert.equal(levelOf({ ...production, MONGODB_URI: "postgres://localhost" }, "MONGODB_URI"), "error");
    assert.equal(levelOf({ ...production, MONGODB_DB_NAME: undefined }, "MONGODB_DB_NAME"), "error");
    assert.equal(levelOf({ ...production, MONGODB_DB_NAME: "bad.name" }, "MONGODB_DB_NAME"), "error");
  });

  it("requires an https site URL in production only", () => {
    assert.equal(levelOf({ ...production, NEXT_PUBLIC_SITE_URL: "http://www.synergypharma.lk" }, "NEXT_PUBLIC_SITE_URL"), "error");
    assert.equal(levelOf({ ...production, NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }, "NEXT_PUBLIC_SITE_URL"), undefined);
    assert.equal(levelOf({ ...production, NEXT_PUBLIC_SITE_URL: "not a url" }, "NEXT_PUBLIC_SITE_URL"), "error");
    assert.equal(levelOf({ ...production, NEXT_PUBLIC_SITE_URL: "https://example.com/?next=1" }, "NEXT_PUBLIC_SITE_URL"), "error");
    assert.equal(levelOf({ ...production, NEXT_PUBLIC_SITE_URL: undefined }, "NEXT_PUBLIC_SITE_URL"), "warning");
  });

  it("treats missing storage and SMTP as errors in production and warnings in development", () => {
    const withoutServices: Env = { ...production };
    for (const name of ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) {
      withoutServices[name] = undefined;
    }
    assert.equal(levelOf(withoutServices, "S3_BUCKET"), "error");
    assert.equal(levelOf(withoutServices, "SMTP_HOST"), "error");
    assert.equal(levelOf({ ...withoutServices, NODE_ENV: "development" }, "S3_BUCKET"), "warning");
    assert.equal(levelOf({ ...withoutServices, NODE_ENV: "development" }, "SMTP_HOST"), "warning");
  });

  it("reports incoherent storage and SMTP settings", () => {
    assert.equal(levelOf({ ...production, S3_REGION: "auto" }, "S3_REGION"), "error");
    assert.equal(levelOf({ ...production, S3_ENDPOINT: "http://minio.internal:9000", S3_REGION: undefined }, "S3_ENDPOINT"), "warning");
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

  it("warns about settings from the previous release", () => {
    assert.equal(levelOf({ ...production, AUTH_SECRET: SECRET }, "AUTH_SECRET"), "warning");
    assert.equal(levelOf({ ...production, ADMIN_PASSWORD: "hunter2" }, "ADMIN_PASSWORD"), "warning");
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
