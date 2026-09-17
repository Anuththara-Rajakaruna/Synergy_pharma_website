// Loads .env.local / .env the same way `next dev` and `next start` do, so CLI scripts
// see the same configuration as the app. Variables already set in the process
// environment (CI, hosting provider, shell) always take precedence over files.
//
// Pass --no-env-files (or set SCRIPTS_NO_ENV_FILES=1) to use only the process environment.
// Do this when running a script against production with exported variables: otherwise a
// variable you forgot to export (e.g. MONGODB_DB_NAME) is silently taken from .env.local.
import { loadEnvConfig } from "@next/env";

export const envFilesDisabled =
  process.argv.slice(2).includes("--no-env-files") ||
  ["1", "true"].includes((process.env.SCRIPTS_NO_ENV_FILES ?? "").trim().toLowerCase());

if (!envFilesDisabled) {
  const { loadedEnvFiles } = loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", {
    info: () => {},
    error: console.error,
  });
  if (loadedEnvFiles.length > 0) {
    // stderr, so scripts that print machine-readable output on stdout stay parseable.
    console.error(
      `Environment files loaded: ${loadedEnvFiles.map((file) => file.path).join(", ")} ` +
        "(exported variables take precedence; pass --no-env-files to ignore these files)."
    );
  }
}
