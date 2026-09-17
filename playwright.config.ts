import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against an already running deployment (usually `npm run build && npm run
// start` with a dedicated test database, S3-compatible bucket and SMTP capture server).
// See "Automated tests" (section 13) in DEPLOYMENT.md for the required environment variables.
const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error("Set E2E_BASE_URL to the running site under test, e.g. http://localhost:3300");
}

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { outputFolder: "test-results/e2e-report", open: "never" }]],
  globalSetup: "./tests/e2e/support/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "api", testMatch: /api\/.*\.spec\.ts$/ },
    { name: "ui-desktop", testMatch: /ui\/.*\.spec\.ts$/, testIgnore: /\.mobile\.spec\.ts$/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "ui-mobile", testMatch: /ui\/.*\.mobile\.spec\.ts$/, use: { ...devices["Pixel 7"] } },
    { name: "regression", testMatch: /regression\/.*\.spec\.ts$/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
