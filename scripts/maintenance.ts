// Runs the periodic maintenance job once and prints its report as JSON.
//
//   npm run jobs:maintenance
//
// Delivers queued emails, removes abandoned uploads under incoming/ and applies the data
// retention policy (purging overdue records only when RETENTION_AUTO_PURGE=true). Use it on
// hosts without Vercel Cron, e.g. from a system cron entry every few hours.

import "./lib/load-env";
import { runMaintenance } from "@/lib/careers/server/maintenance";
import { logger } from "@/lib/logger";
import { connectToDatabase, disconnectFromDatabase } from "@/lib/mongodb";

async function main() {
  await connectToDatabase({ autoSchemaSetup: false });
  try {
    const report = await runMaintenance();
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await disconnectFromDatabase();
  }
}

main().catch((err: unknown) => {
  logger.error("maintenance.cli_failed", { err });
  process.exitCode = 1;
});
