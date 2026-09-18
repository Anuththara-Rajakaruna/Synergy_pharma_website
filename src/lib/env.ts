import { createHash, timingSafeEqual } from "node:crypto";
import { isValidEmail } from "@/lib/careers/validation";
import { inspectEmailConfig } from "@/lib/email/transport";
import { readGoogleEnv } from "@/lib/google/config";

// Central configuration check. Reported at server start (src/instrumentation.ts) and by
// `npm run sheets:check`. Messages name variables but never include their values.

export type ConfigProblem = { level: "error" | "warning"; variable: string; message: string };

const MIN_SECRET_LENGTH = 32;

// Variables the previous releases read and this one does not. Flagged so an operator who
// migrated a deployment can see what is now dead weight (and, for the credentials among them,
// what should be revoked rather than merely deleted).
const RETIRED_VARIABLES: { names: readonly string[]; reason: string }[] = [
  {
    names: ["MONGODB_URI", "MONGODB_DB_NAME", "MONGODB_MAX_POOL_SIZE"],
    reason: "records are held in the Google spreadsheet, not in a database server",
  },
  {
    names: [
      "S3_BUCKET",
      "S3_REGION",
      "S3_ENDPOINT",
      "S3_PUBLIC_ENDPOINT",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_FORCE_PATH_STYLE",
      "S3_SERVER_SIDE_ENCRYPTION",
    ],
    reason: "candidate documents are held in the Google Drive folder, not in object storage",
  },
  {
    names: ["AUTH_SECRET", "ADMIN_PASSWORD"],
    reason: "admin users sign in with individual accounts",
  },
];

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

// A whole number of months within the range the reader accepts. Anything outside it is silently
// replaced by the default at the point of use, which is exactly why it is reported here.
function checkMonths(name: string, problems: ConfigProblem[]) {
  const raw = value(name);
  if (!raw) return;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 120) {
    problems.push({ level: "error", variable: name, message: `${name} must be a whole number of months between 1 and 120.` });
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

  // Data store: the Google spreadsheet (records) and the Google Drive folder (candidate files).
  // Nothing the site does works without both, in every environment, so each problem readGoogleEnv
  // reports is an error and is attributed to the variable that caused it.
  const google = readGoogleEnv();
  for (const problem of google.problems) problems.push({ level: "error", ...problem });
  if (production && google.settings && !google.settings.sharedDriveId && !google.settings.impersonateUser) {
    problems.push({
      level: "warning",
      variable: "GOOGLE_DRIVE_SHARED_DRIVE_ID",
      message:
        "Neither GOOGLE_DRIVE_SHARED_DRIVE_ID nor GOOGLE_IMPERSONATE_USER is set. A service account has no Drive storage quota of its own, so a file it uploads into a plain My Drive folder is charged against a quota of zero and the upload is refused with storageQuotaExceeded. Put the folder on a Shared Drive and set GOOGLE_DRIVE_SHARED_DRIVE_ID, or set up domain-wide delegation and set GOOGLE_IMPERSONATE_USER.",
    });
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
  checkMonths("DATA_RETENTION_MONTHS", problems);
  const autoPurge = value("RETENTION_AUTO_PURGE");
  if (autoPurge && autoPurge !== "true" && autoPurge !== "false") {
    problems.push({ level: "error", variable: "RETENTION_AUTO_PURGE", message: "RETENTION_AUTO_PURGE must be true or false." });
  }
  // The AuditLog tab is the only one that grows for ever, and a spreadsheet holds at most ten
  // million cells, so how long audit rows are kept is a capacity setting as well as a policy one.
  checkMonths("AUDIT_RETENTION_MONTHS", problems);

  // Settings from previous releases that no longer have any effect.
  for (const group of RETIRED_VARIABLES) {
    for (const name of group.names) {
      if (value(name)) {
        problems.push({
          level: "warning",
          variable: name,
          message: `${name} is no longer used (${group.reason}). Remove it from the environment.`,
        });
      }
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
