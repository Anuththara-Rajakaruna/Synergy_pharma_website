import { parseArgs, type ParseArgsConfig } from "node:util";

type ParseArgsOptionsConfig = NonNullable<ParseArgsConfig["options"]>;

// Options every database script accepts. --no-env-files is acted on by scripts/lib/load-env.ts.
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

// Mongoose validation errors: field paths and failure kinds only. Messages can quote the
// offending values (candidate names, emails), so they are never printed.
export function validationProblems(err: unknown): string[] {
  const errors = (err as { errors?: Record<string, { kind?: unknown }> } | null)?.errors;
  if (errors && typeof errors === "object") {
    return Object.entries(errors).map(([path, detail]) => `${path} (${typeof detail?.kind === "string" ? detail.kind : "invalid"})`);
  }
  if (err instanceof Error && err.name === "StrictModeError") {
    const path = (err as { path?: unknown }).path;
    return [`${typeof path === "string" ? path : "unknown field"} (not in schema)`];
  }
  if (err instanceof Error && err.name === "CastError") {
    const path = (err as { path?: unknown }).path;
    return [`${typeof path === "string" ? path : "unknown field"} (cast)`];
  }
  return [err instanceof Error ? err.name : "invalid value"];
}

// One-line description of an unexpected failure that is safe to print (no document values).
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return typeof err === "string" ? err : "Unknown error";
  const code = (err as { code?: unknown }).code;
  if (code === 11000) return `${err.name}: duplicate key (E11000)`;
  if (err.name === "ValidationError" || err.name === "StrictModeError" || err.name === "CastError") {
    return `${err.name}: ${validationProblems(err).join(", ")}`;
  }
  if (err.name.startsWith("Mongo") && typeof code === "number") {
    const codeName = (err as { codeName?: unknown }).codeName;
    return `${err.name} (code ${code}${typeof codeName === "string" ? ` ${codeName}` : ""}): ${err.message.split("\n")[0]}`;
  }
  return `${err.name}: ${err.message}`;
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

// Runs `fn` over `items` with at most `limit` calls in flight.
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
