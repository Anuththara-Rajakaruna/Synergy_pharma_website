import { createHash, timingSafeEqual } from "node:crypto";
import { isValidEmail } from "@/lib/careers/validation";
import { inspectEmailConfig } from "@/lib/email/transport";
import { DatabaseConfigError, readDatabaseConfig } from "@/lib/mongodb";
import { readStorageEnv } from "@/lib/storage-origin";

// Central configuration check. Reported at server start (src/instrumentation.ts) and by
// `npm run db:check`. Messages name variables but never include their values.

export type ConfigProblem = { level: "error" | "warning"; variable: string; message: string };

const MIN_SECRET_LENGTH = 32;

function value(name: string): string {
  return (process.env[name] ?? "").trim();
}

function checkRecipientList(name: string, problems: ConfigProblem[], required: { level: "error" | "warning"; message: string } | null) {
  const raw = value(name);
  if (!raw) {
    if (required) problems.push({ level: required.level, variable: name, message: required.message });
    return;
  }
  const entries = raw.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  if (entries.length === 0 || entries.some((entry) => !isValidEmail(entry))) {
    problems.push({ level: "error", variable: name, message: `${name} must be one or more valid email addresses separated by commas.` });
  } else if (entries.length > 10) {
    problems.push({ level: "warning", variable: name, message: `${name} lists more than 10 addresses; only the first 10 are used.` });
  }
}

export function getConfigProblems(): ConfigProblem[] {
  const production = process.env.NODE_ENV === "production";
  const problems: ConfigProblem[] = [];

  // Placeholders copied from .env.example.
  for (const [name, raw] of Object.entries(process.env)) {
    if (typeof raw === "string" && raw.trim().startsWith("replace-with-")) {
      problems.push({ level: "error", variable: name, message: `${name} still contains a placeholder value from .env.example.` });
    }
  }

  // Database
  try {
    readDatabaseConfig();
  } catch (err) {
    if (err instanceof DatabaseConfigError) {
      problems.push({
        level: "error",
        variable: err.message.includes("MONGODB_DB_NAME") ? "MONGODB_DB_NAME" : "MONGODB_URI",
        message: err.message,
      });
    } else {
      throw err;
    }
  }

  // Site URL
  const siteUrl = value("NEXT_PUBLIC_SITE_URL");
  if (!siteUrl) {
    if (production) {
      problems.push({
        level: "warning",
        variable: "NEXT_PUBLIC_SITE_URL",
        message: "NEXT_PUBLIC_SITE_URL is not set; links in emails, the sitemap and metadata use the default production domain.",
      });
    }
  } else {
    let url: URL | null = null;
    try {
      url = new URL(siteUrl);
    } catch {
      url = null;
    }
    if (!url || (url.protocol !== "https:" && url.protocol !== "http:") || url.search || url.hash || url.username || url.password) {
      problems.push({ level: "error", variable: "NEXT_PUBLIC_SITE_URL", message: "NEXT_PUBLIC_SITE_URL must be an absolute URL such as https://www.example.com." });
    } else if (production && url.protocol !== "https:") {
      problems.push({ level: "error", variable: "NEXT_PUBLIC_SITE_URL", message: "NEXT_PUBLIC_SITE_URL must use https in production." });
    }
  }

  // Object storage
  const storage = readStorageEnv();
  if (!storage.anySet) {
    problems.push({
      level: production ? "error" : "warning",
      variable: "S3_BUCKET",
      message: "Object storage is not configured (S3_BUCKET, S3_REGION or S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY); CV uploads and downloads will fail.",
    });
  } else {
    for (const problem of storage.problems) problems.push({ level: "error", ...problem });
    if (production && storage.settings) {
      for (const endpoint of [storage.settings.endpoint, storage.settings.publicEndpoint]) {
        if (endpoint && endpoint.startsWith("http://")) {
          problems.push({
            level: "warning",
            variable: endpoint === storage.settings.endpoint ? "S3_ENDPOINT" : "S3_PUBLIC_ENDPOINT",
            message: "The storage endpoint uses http://; candidate documents would travel unencrypted.",
          });
        }
      }
    }
  }

  // Email
  const smtpSet = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SMTP_SECURE"].some((name) => value(name) !== "");
  if (!smtpSet) {
    problems.push({
      level: production ? "error" : "warning",
      variable: "SMTP_HOST",
      message: production
        ? "SMTP is not configured; emails stay queued in the outbox until it is."
        : "SMTP is not configured; outgoing emails are recorded as skipped.",
    });
  } else {
    for (const problem of inspectEmailConfig()) problems.push({ level: "error", ...problem });
  }

  checkRecipientList("HR_NOTIFICATION_EMAIL", problems, {
    level: "warning",
    message: "HR_NOTIFICATION_EMAIL is not set; HR will not be emailed about new applications, talent pool profiles or contact messages.",
  });
  checkRecipientList("CONTACT_NOTIFICATION_EMAIL", problems, null);

  // Secrets
  const cronSecret = value("CRON_SECRET");
  if (!cronSecret) {
    if (production) {
      problems.push({
        level: "warning",
        variable: "CRON_SECRET",
        message: "CRON_SECRET is not set; /api/cron/maintenance is disabled, so queued emails are not retried and retention checks do not run unless `npm run jobs:maintenance` is scheduled.",
      });
    }
  } else if (cronSecret.length < MIN_SECRET_LENGTH) {
    problems.push({
      level: production ? "error" : "warning",
      variable: "CRON_SECRET",
      message: `CRON_SECRET must be at least ${MIN_SECRET_LENGTH} characters (generate one with: openssl rand -hex 32).`,
    });
  }

  const healthToken = value("HEALTHCHECK_TOKEN");
  if (healthToken && healthToken.length < MIN_SECRET_LENGTH) {
    problems.push({
      level: production ? "error" : "warning",
      variable: "HEALTHCHECK_TOKEN",
      message: `HEALTHCHECK_TOKEN must be at least ${MIN_SECRET_LENGTH} characters (generate one with: openssl rand -hex 32).`,
    });
  }

  // Client IP detection (rate limiting, audit log)
  const ipHeader = value("TRUSTED_IP_HEADER");
  if (ipHeader && !/^[A-Za-z0-9-]{1,64}$/.test(ipHeader)) {
    problems.push({ level: "error", variable: "TRUSTED_IP_HEADER", message: "TRUSTED_IP_HEADER must be a single HTTP header name (e.g. x-real-ip)." });
  }
  const proxyCount = value("TRUSTED_PROXY_COUNT");
  if (proxyCount && (!/^\d+$/.test(proxyCount) || Number(proxyCount) < 1 || Number(proxyCount) > 10)) {
    problems.push({ level: "error", variable: "TRUSTED_PROXY_COUNT", message: "TRUSTED_PROXY_COUNT must be a whole number between 1 and 10." });
  }
  if (production && process.env.VERCEL !== "1" && !ipHeader) {
    problems.push({
      level: "warning",
      variable: "TRUSTED_IP_HEADER",
      message: "Client IPs for rate limiting can be spoofed unless a reverse proxy overwrites X-Forwarded-For. Set TRUSTED_IP_HEADER to the header your proxy sets.",
    });
  }

  // Retention
  const retention = value("DATA_RETENTION_MONTHS");
  if (retention && (!/^\d+$/.test(retention) || Number(retention) < 1 || Number(retention) > 120)) {
    problems.push({ level: "error", variable: "DATA_RETENTION_MONTHS", message: "DATA_RETENTION_MONTHS must be a whole number of months between 1 and 120." });
  }
  const autoPurge = value("RETENTION_AUTO_PURGE");
  if (autoPurge && autoPurge !== "true" && autoPurge !== "false") {
    problems.push({ level: "error", variable: "RETENTION_AUTO_PURGE", message: "RETENTION_AUTO_PURGE must be true or false." });
  }

  // Settings from the previous release that no longer have any effect.
  for (const name of ["AUTH_SECRET", "ADMIN_PASSWORD"]) {
    if (value(name)) {
      problems.push({
        level: "warning",
        variable: name,
        message: `${name} is no longer used (admin users sign in with individual accounts). Remove it from the environment.`,
      });
    }
  }

  return problems;
}

function digest(input: string): Buffer {
  return createHash("sha256").update(input, "utf8").digest();
}

// Constant-time check of an `Authorization: Bearer <token>` header against a configured secret.
export function bearerTokenMatches(authorizationHeader: string | null, secret: string): boolean {
  if (!authorizationHeader || !secret) return false;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorizationHeader);
  if (!match) return false;
  return timingSafeEqual(digest(match[1]), digest(secret));
}
