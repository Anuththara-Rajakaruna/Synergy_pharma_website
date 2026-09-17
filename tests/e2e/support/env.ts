// Configuration for the end-to-end suite. Values come from the environment so the same tests run
// locally and in CI. The accounts must already exist in the database used by the site under test
// (create them with `npm run admin:user -- create ... --password-stdin`).

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} is required for the end-to-end tests.`);
  return value;
}

export const e2eEnv = {
  get baseUrl() {
    return required("E2E_BASE_URL").replace(/\/$/, "");
  },
  get adminEmail() {
    return required("E2E_ADMIN_EMAIL");
  },
  get adminPassword() {
    return required("E2E_ADMIN_PASSWORD");
  },
  get hrEmail() {
    return required("E2E_HR_EMAIL");
  },
  get hrPassword() {
    return required("E2E_HR_PASSWORD");
  },
  // Directory where the SMTP capture server (npm run test:smtp-sink) writes messages.
  get mailboxDir() {
    return required("E2E_MAILBOX_DIR");
  },
  // Must match TRUSTED_IP_HEADER of the server under test so each test can act as a distinct
  // client for rate limiting.
  get clientIpHeader() {
    return (process.env.E2E_CLIENT_IP_HEADER ?? "x-real-ip").toLowerCase();
  },
  get cronSecret() {
    return process.env.E2E_CRON_SECRET ?? "";
  },
  get healthToken() {
    return process.env.E2E_HEALTHCHECK_TOKEN ?? "";
  },
};
