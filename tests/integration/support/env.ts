// Environment for the integration suite. Import this module FIRST in every integration test file:
// application modules read some variables when they are loaded (site URL, cookie name).
//
// The suite talks to the real Google Sheets and Google Drive APIs. There is no local server to
// start, so it needs a spreadsheet and a Drive folder that exist and are shared with a service
// account as an Editor:
//
//   INTEGRATION_GOOGLE_SHEETS_SPREADSHEET_ID   the test spreadsheet (required, never inherited)
//   INTEGRATION_GOOGLE_DRIVE_FOLDER_ID         the test Drive folder (required, never inherited)
//   INTEGRATION_GOOGLE_SERVICE_ACCOUNT_EMAIL   \
//   INTEGRATION_GOOGLE_PRIVATE_KEY              |  credentials; each falls back to the
//   INTEGRATION_GOOGLE_PRIVATE_KEY_ID           |  GOOGLE_* variable of the same name
//   INTEGRATION_GOOGLE_SERVICE_ACCOUNT_JSON    /
//   INTEGRATION_GOOGLE_DRIVE_SHARED_DRIVE_ID   optional, and recommended: a service account has
//                                              no Drive storage quota of its own
//   INTEGRATION_GOOGLE_IMPERSONATE_USER        optional alternative to a Shared Drive
//
// Two rules keep a production spreadsheet safe:
//
//   1. The spreadsheet id and the folder id are only ever read from an INTEGRATION_ variable.
//      A developer's GOOGLE_SHEETS_SPREADSHEET_ID is deliberately NOT a fallback, so the suite
//      cannot be pointed at the live sheet by having the application configured locally.
//   2. The harness refuses to touch a spreadsheet whose Settings tab does not carry
//      `test.spreadsheet` = `true` (see harness.ts). That row has to be typed in by hand.
//
// When the required variables are absent the whole suite skips rather than fails, so
// `npm test` and a checkout without Google credentials stay green.

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function read(name: string): string {
  return (process.env[name] ?? "").trim();
}

// An INTEGRATION_ variable, falling back to the plain application variable of the same name.
// Only used for credentials, never for the ids that decide which documents are written to.
function credential(suffix: string): string {
  return read(`INTEGRATION_${suffix}`) || read(suffix);
}

const spreadsheetId = read("INTEGRATION_GOOGLE_SHEETS_SPREADSHEET_ID");
const driveFolderId = read("INTEGRATION_GOOGLE_DRIVE_FOLDER_ID");
const serviceAccountEmail = credential("GOOGLE_SERVICE_ACCOUNT_EMAIL");
const privateKey = credential("GOOGLE_PRIVATE_KEY");
const serviceAccountJson = credential("GOOGLE_SERVICE_ACCOUNT_JSON");

const missing: string[] = [];
if (!spreadsheetId) missing.push("INTEGRATION_GOOGLE_SHEETS_SPREADSHEET_ID");
if (!driveFolderId) missing.push("INTEGRATION_GOOGLE_DRIVE_FOLDER_ID");
if (!serviceAccountJson && !(serviceAccountEmail && privateKey)) {
  missing.push("INTEGRATION_GOOGLE_SERVICE_ACCOUNT_JSON (or INTEGRATION_GOOGLE_SERVICE_ACCOUNT_EMAIL and INTEGRATION_GOOGLE_PRIVATE_KEY)");
}

export const integrationConfig = {
  enabled: missing.length === 0,
  missing,
  spreadsheetId,
  driveFolderId,
  sharedDriveId: read("INTEGRATION_GOOGLE_DRIVE_SHARED_DRIVE_ID") || credential("GOOGLE_DRIVE_SHARED_DRIVE_ID"),
  impersonateUser: read("INTEGRATION_GOOGLE_IMPERSONATE_USER") || credential("GOOGLE_IMPERSONATE_USER"),
  hrEmail: "hr.integration@example.com",
  smtpFrom: "Synergy Careers Integration <careers.integration@example.com>",
} as const;

// The reason to skip, or false to run. Pass it as the `skip` option of the suite's describe():
//   describe("jobs service", { timeout: 120_000, skip: suiteSkip() }, () => { ... });
export function suiteSkip(): string | false {
  if (integrationConfig.enabled) return false;
  return `Set ${missing.join(", ")} to a test spreadsheet and Drive folder to run the integration suite.`;
}

// Variables of the application itself are always overwritten, so the suite can never read or
// write a development or production spreadsheet by accident.
const baseline: Record<string, string | undefined> = {
  NODE_ENV: "test",
  GOOGLE_SHEETS_SPREADSHEET_ID: spreadsheetId || undefined,
  GOOGLE_DRIVE_FOLDER_ID: driveFolderId || undefined,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: serviceAccountEmail || undefined,
  GOOGLE_PRIVATE_KEY: privateKey || undefined,
  GOOGLE_PRIVATE_KEY_ID: credential("GOOGLE_PRIVATE_KEY_ID") || undefined,
  GOOGLE_SERVICE_ACCOUNT_JSON: serviceAccountJson || undefined,
  GOOGLE_DRIVE_SHARED_DRIVE_ID: integrationConfig.sharedDriveId || undefined,
  GOOGLE_IMPERSONATE_USER: integrationConfig.impersonateUser || undefined,
  NEXT_PUBLIC_SITE_URL: undefined,
  // SMTP_PORT is set by the harness once the capture server has a free port.
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: undefined,
  SMTP_SECURE: "false",
  SMTP_ALLOW_INSECURE_LOCAL: "true",
  SMTP_USER: undefined,
  SMTP_PASS: undefined,
  SMTP_FROM: integrationConfig.smtpFrom,
  HR_NOTIFICATION_EMAIL: integrationConfig.hrEmail,
  CONTACT_NOTIFICATION_EMAIL: undefined,
  DATA_RETENTION_MONTHS: undefined,
  RETENTION_AUTO_PURGE: undefined,
  AUDIT_RETENTION_MONTHS: undefined,
  TRUSTED_IP_HEADER: undefined,
  TRUSTED_PROXY_COUNT: undefined,
  VERCEL: undefined,
  CRON_SECRET: undefined,
  HEALTHCHECK_TOKEN: undefined,
};

for (const [name, value] of Object.entries(baseline)) setEnv(name, value);

export { setEnv };
