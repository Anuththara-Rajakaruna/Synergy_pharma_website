// Runs the periodic maintenance job once and prints its report as JSON.
//
//   npm run jobs:maintenance
//
// Delivers queued emails, removes abandoned uploads from the Drive staging folder, applies the
// data retention policy (purging overdue records only when RETENTION_AUTO_PURGE=true) and trims
// the rows MongoDB's TTL indexes used to remove on their own (expired sessions, sent email, old
// audit entries). Use it on hosts without Vercel Cron, e.g. from a system cron entry every few
// hours.

import "./lib/load-env";
import { flushAuditLog } from "@/lib/careers/server/audit";
import { runMaintenance } from "@/lib/careers/server/maintenance";
import { logger } from "@/lib/logger";
import { ensureStoreReady } from "@/lib/sheets-db";

async function main() {
  // No connection to open; this fails fast when the Google configuration is incomplete.
  ensureStoreReady();
  try {
    const report = await runMaintenance();
    console.log(JSON.stringify(report, null, 2));
  } finally {
    // The retention purge and the sweeps write audit entries through the buffer, which would
    // otherwise die with the process.
    await flushAuditLog();
  }
}

main().catch((err: unknown) => {
  logger.error("maintenance.cli_failed", { err });
  process.exitCode = 1;
});
