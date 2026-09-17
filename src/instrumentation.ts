import type { Instrumentation } from "next";
import { logger } from "@/lib/logger";

// Runs once when a server instance starts. Configuration problems are logged rather than
// thrown so a single bad optional setting cannot take the whole public website offline.
export async function register() {
  // The condition wraps the import (rather than returning early) so bundlers drop the Node.js-only
  // configuration modules from any Edge build of this file.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { getConfigProblems } = await import("@/lib/env");
      for (const problem of getConfigProblems()) {
        const meta = { variable: problem.variable, message: problem.message };
        if (problem.level === "error") logger.error("config.problem", meta);
        else logger.warn("config.problem", meta);
      }
    } catch (err) {
      logger.error("config.check_failed", { err });
    }
  }
}

// Uncaught errors from pages, route handlers, server actions and the proxy. Only structural
// details are logged: error messages and the query string can carry personal data (e.g. an
// email filter). The digest links the entry to the reference shown on the error page.
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const digest =
    typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  logger.error("request.unhandled_error", {
    path: request.path.split("?")[0],
    method: request.method,
    routeType: context.routeType,
    routePath: context.routePath,
    digest,
    errorName: error instanceof Error ? error.name : typeof error,
  });
};
