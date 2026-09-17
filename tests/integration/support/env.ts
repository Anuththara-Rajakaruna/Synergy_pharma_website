// Environment for the integration suite. Import this module FIRST in every integration test file:
// application modules read some variables when they are loaded (site URL, cookie name).
//
// The suite talks to real services. Defaults match a local development setup and can be
// overridden with INTEGRATION_* variables (CI):
//   INTEGRATION_MONGODB_URI          default mongodb://127.0.0.1:27017
//   INTEGRATION_MONGODB_DB_NAME      default synergy_integration_test (must end with _test; it is dropped)
//   INTEGRATION_S3_ENDPOINT          default http://127.0.0.1:18333 (S3-compatible server, e.g. SeaweedFS/MinIO)
//   INTEGRATION_S3_BUCKET            default synergy-integration-test (created if missing, emptied at start)
//   INTEGRATION_S3_ACCESS_KEY_ID / INTEGRATION_S3_SECRET_ACCESS_KEY
// Variables of the application itself (MONGODB_DB_NAME, S3_BUCKET, ...) are always overwritten so
// the suite can never write to a development or production database by accident.

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function setting(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export const integrationConfig = {
  mongoUri: setting("INTEGRATION_MONGODB_URI", "mongodb://127.0.0.1:27017"),
  dbName: setting("INTEGRATION_MONGODB_DB_NAME", "synergy_integration_test"),
  s3Endpoint: setting("INTEGRATION_S3_ENDPOINT", "http://127.0.0.1:18333"),
  s3Bucket: setting("INTEGRATION_S3_BUCKET", "synergy-integration-test"),
  s3AccessKeyId: setting("INTEGRATION_S3_ACCESS_KEY_ID", "verifykey"),
  s3SecretAccessKey: setting("INTEGRATION_S3_SECRET_ACCESS_KEY", "verifysecret"),
  hrEmail: "hr.integration@example.com",
  smtpFrom: "Synergy Careers Integration <careers.integration@example.com>",
} as const;

if (!integrationConfig.dbName.endsWith("_test")) {
  throw new Error(`Refusing to run integration tests against database "${integrationConfig.dbName}": the name must end with _test.`);
}

const baseline: Record<string, string | undefined> = {
  NODE_ENV: "test",
  MONGODB_URI: integrationConfig.mongoUri,
  MONGODB_DB_NAME: integrationConfig.dbName,
  MONGODB_MAX_POOL_SIZE: "10",
  NEXT_PUBLIC_SITE_URL: undefined,
  S3_BUCKET: integrationConfig.s3Bucket,
  S3_ENDPOINT: integrationConfig.s3Endpoint,
  S3_REGION: undefined,
  S3_PUBLIC_ENDPOINT: undefined,
  S3_FORCE_PATH_STYLE: "true",
  S3_ACCESS_KEY_ID: integrationConfig.s3AccessKeyId,
  S3_SECRET_ACCESS_KEY: integrationConfig.s3SecretAccessKey,
  S3_SERVER_SIDE_ENCRYPTION: undefined,
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
  TRUSTED_IP_HEADER: undefined,
  TRUSTED_PROXY_COUNT: undefined,
  VERCEL: undefined,
  CRON_SECRET: undefined,
  HEALTHCHECK_TOKEN: undefined,
};

for (const [name, value] of Object.entries(baseline)) setEnv(name, value);

export { setEnv };
