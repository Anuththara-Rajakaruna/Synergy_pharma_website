// Helpers for unit tests that depend on environment variables. Every helper restores the exact
// previous environment afterwards, so tests stay independent of each other and of the shell.

type EnvPatch = Record<string, string | undefined>;

// Variables read by the modules under test. withCleanEnv removes all of them before applying the
// patch, so a developer's shell (or CI) configuration can never change a test's outcome.
export const APP_ENV_VARIABLES = [
  "NODE_ENV",
  "VERCEL",
  // Google Sheets / Google Drive data store (src/lib/google/config.ts).
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_PRIVATE_KEY_ID",
  "GOOGLE_SHEETS_SPREADSHEET_ID",
  "GOOGLE_DRIVE_FOLDER_ID",
  "GOOGLE_DRIVE_SHARED_DRIVE_ID",
  "GOOGLE_IMPERSONATE_USER",
  "NEXT_PUBLIC_SITE_URL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "SMTP_ALLOW_INSECURE_LOCAL",
  "HR_NOTIFICATION_EMAIL",
  "CONTACT_NOTIFICATION_EMAIL",
  "CRON_SECRET",
  "HEALTHCHECK_TOKEN",
  "TRUSTED_IP_HEADER",
  "TRUSTED_PROXY_COUNT",
  "DATA_RETENTION_MONTHS",
  "RETENTION_AUTO_PURGE",
  "AUDIT_RETENTION_MONTHS",
  "AUTH_SECRET",
  "ADMIN_PASSWORD",
] as const;

function snapshot(): EnvPatch {
  return { ...process.env };
}

function restore(saved: EnvPatch): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function apply(patch: EnvPatch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// Runs fn with the patch applied on top of the current environment.
export function withEnv<T>(patch: EnvPatch, fn: () => T): T {
  const saved = snapshot();
  apply(patch);
  try {
    return fn();
  } finally {
    restore(saved);
  }
}

// Runs fn with every application variable (and any "replace-with-" placeholder) removed first.
export function withCleanEnv<T>(patch: EnvPatch, fn: () => T): T {
  const saved = snapshot();
  for (const name of APP_ENV_VARIABLES) delete process.env[name];
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && value.trim().startsWith("replace-with-")) delete process.env[key];
  }
  apply(patch);
  try {
    return fn();
  } finally {
    restore(saved);
  }
}

export async function withEnvAsync<T>(patch: EnvPatch, fn: () => Promise<T>): Promise<T> {
  const saved = snapshot();
  apply(patch);
  try {
    return await fn();
  } finally {
    restore(saved);
  }
}
