import { parseArgs, type ParseArgsConfig } from "node:util";

type ParseArgsOptionsConfig = NonNullable<ParseArgsConfig["options"]>;

// Options every data-store script accepts. --no-env-files is acted on by scripts/lib/load-env.ts.
export const COMMON_OPTIONS = {
  "no-env-files": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

// Strict argument parsing: unknown flags and stray positional arguments print the usage and
// exit, so a mistyped safety flag (e.g. --dryrun) can never be silently ignored.
export function parseScriptArgs<const O extends ParseArgsOptionsConfig>(options: O, usage: string) {
  const values = (() => {
    try {
      return parseArgs({ args: process.argv.slice(2), options, strict: true, allowPositionals: false }).values;
    } catch (err) {
      console.error(`${err instanceof Error ? err.message : String(err)}\n\n${usage}`);
      process.exit(1);
    }
  })();
  if ((values as Record<string, unknown>).help === true) {
    console.log(usage);
    process.exit(0);
  }
  return values;
}

// One-line description of an unexpected failure that is safe to print. The data layer's errors
// (src/lib/google/errors.ts) are written so their messages never contain credentials, access
// tokens, spreadsheet contents or applicant data; nothing else from an error object is echoed.
// Matched by name rather than by `instanceof` so this module stays free of server imports.
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return typeof err === "string" ? err : "Unknown error";
  const firstLine = err.message.split("\n")[0];

  if (err.name === "GoogleConfigError") return `Configuration problem: ${firstLine}`;
  if (err.name === "GoogleUnavailableError") {
    const retryAfter = (err as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    const wait = typeof retryAfter === "number" && Number.isFinite(retryAfter) ? ` (retry after ${retryAfter}s)` : "";
    return `Google could not be reached: ${firstLine}${wait}`;
  }
  if (err.name === "GoogleNotFoundError") return `Not found: ${firstLine}`;

  // Node transport failures (ECONNRESET, ENOTFOUND, UND_ERR_CONNECT_TIMEOUT, ...).
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && code) return `${err.name} (${code}): ${firstLine}`;
  return `${err.name}: ${firstLine}`;
}

export function printTable(headers: string[], rows: (string | number)[][], log: (line: string) => void = console.log): void {
  const cells = [headers, ...rows.map((row) => row.map(String))];
  const widths = headers.map((_, column) => Math.max(...cells.map((row) => (row[column] ?? "").length)));
  const format = (row: string[]) =>
    row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join(" | ");
  log(`  ${format(cells[0])}`);
  log(`  ${widths.map((width) => "-".repeat(width)).join("-+-")}`);
  for (const row of cells.slice(1)) log(`  ${format(row)}`);
}
