import { getGoogleSettings } from "@/lib/google/auth";
import { googleJson } from "@/lib/google/request";

// Thin, typed wrapper over the Google Sheets v4 REST API. It knows about ranges and cells and
// nothing about the careers portal; the record-level store is src/lib/sheets-db.
//
// Every write uses valueInputOption=RAW so Sheets stores exactly the characters given. Besides
// being correct for dates and numeric-looking strings (phone numbers, ids), this is what stops
// a value like "=IMPORTXML(...)" submitted through a public form from becoming a live formula
// when HR opens the spreadsheet.

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export type CellValue = string | number | boolean;
export type Row = CellValue[];

function spreadsheetUrl(path = "", query: Record<string, string> = {}): string {
  const { spreadsheetId } = getGoogleSettings();
  const search = new URLSearchParams(query).toString();
  return `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}${path}${search ? `?${search}` : ""}`;
}

// 0 -> "A", 25 -> "Z", 26 -> "AA".
export function columnLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error("Invalid column index.");
  let value = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return letters;
}

// Quotes a sheet title for A1 notation. Titles may contain spaces and apostrophes.
export function quoteTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

// A1 notation for a whole tab, a row band, or a rectangle. With no bounds the range is the tab
// name alone, which is how the API spells "every cell with data" - "Title!A:" is not valid A1.
export function a1Range(title: string, opts: { firstRow?: number; lastRow?: number; firstColumn?: number; lastColumn?: number } = {}): string {
  const quoted = quoteTitle(title);
  const hasRows = opts.firstRow !== undefined || opts.lastRow !== undefined;
  const hasColumns = opts.firstColumn !== undefined || opts.lastColumn !== undefined;
  if (!hasRows && !hasColumns) return quoted;

  // Whole rows: "Title!1:1". Whole columns: "Title!A:D".
  if (hasRows && !hasColumns) {
    const first = opts.firstRow ?? 1;
    return `${quoted}!${first}:${opts.lastRow ?? first}`;
  }
  const firstColumn = columnLetter(opts.firstColumn ?? 0);
  const lastColumn = opts.lastColumn === undefined ? firstColumn : columnLetter(opts.lastColumn);
  if (!hasRows) return `${quoted}!${firstColumn}:${lastColumn}`;

  const firstRow = opts.firstRow ?? 1;
  const lastRow = opts.lastRow ?? firstRow;
  return `${quoted}!${firstColumn}${firstRow}:${lastColumn}${lastRow}`;
}

// The row number Sheets assigned, parsed out of an updatedRange like "Applications!A42:BZ42".
export function parseFirstRow(range: string): number | null {
  const match = /![A-Z]+(\d+)/.exec(range);
  return match ? Number.parseInt(match[1], 10) : null;
}

// ── Spreadsheet metadata ─────────────────────────────────────────────────────

export type SheetProperties = {
  sheetId: number;
  title: string;
  index: number;
  gridProperties: { rowCount: number; columnCount: number; frozenRowCount?: number };
};

export type SpreadsheetInfo = {
  spreadsheetId: string;
  properties: { title: string };
  sheets: { properties: SheetProperties }[];
};

// Sheet titles, ids and dimensions. `fields` keeps the response small: without it Google
// returns every cell of every tab.
export async function getSpreadsheetInfo(): Promise<SpreadsheetInfo> {
  const info = await googleJson<SpreadsheetInfo>({
    url: spreadsheetUrl("", { fields: "spreadsheetId,properties.title,sheets.properties" }),
    operation: "sheets.get",
  });
  if (!info) throw new Error("unreachable: sheets.get cannot return null");
  return info;
}

// ── Reading ──────────────────────────────────────────────────────────────────

type ValueRange = { range?: string; values?: CellValue[][] };
type BatchGetResponse = { valueRanges?: ValueRange[] };

// Reads several ranges in ONE API call. Rows are returned ragged: Sheets omits trailing empty
// cells, so callers must pad. UNFORMATTED_VALUE keeps numbers numeric and avoids locale
// formatting; serial numbers never reach us because every date column is written as an ISO string.
export async function batchGetValues(ranges: string[]): Promise<CellValue[][][]> {
  if (ranges.length === 0) return [];
  const query = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
    majorDimension: "ROWS",
  });
  for (const range of ranges) query.append("ranges", range);

  const response = await googleJson<BatchGetResponse>({
    url: `${spreadsheetUrl("/values:batchGet")}?${query.toString()}`,
    operation: "sheets.values.batchGet",
  });
  const valueRanges = response?.valueRanges ?? [];
  return ranges.map((_, index) => valueRanges[index]?.values ?? []);
}

export async function getValues(range: string): Promise<CellValue[][]> {
  const [values] = await batchGetValues([range]);
  return values ?? [];
}

// ── Writing ──────────────────────────────────────────────────────────────────

export type AppendResult = { updatedRange: string; firstRow: number; updatedRows: number };

// Appends rows after the last row that contains data in `range`'s table. INSERT_ROWS makes
// Sheets insert new rows rather than overwriting whatever sits below the table.
//
// Not retried on transport failures: a retry of an append that actually succeeded would add the
// row twice. Callers reconcile instead (src/lib/sheets-db/table.ts).
export async function appendValues(range: string, rows: Row[]): Promise<AppendResult> {
  if (rows.length === 0) throw new Error("appendValues called with no rows.");
  const response = await googleJson<{ updates?: { updatedRange?: string; updatedRows?: number } }>({
    method: "POST",
    url: spreadsheetUrl(`/values/${encodeURIComponent(range)}:append`, {
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      includeValuesInResponse: "false",
    }),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
    operation: "sheets.values.append",
    maxAttempts: 1,
  });

  const updatedRange = response?.updates?.updatedRange ?? "";
  const firstRow = parseFirstRow(updatedRange);
  if (firstRow === null) {
    throw new Error("Google Sheets did not report where the appended rows were written.");
  }
  return { updatedRange, firstRow, updatedRows: response?.updates?.updatedRows ?? rows.length };
}

// Overwrites an exact range. Safe to retry: writing the same cells twice is idempotent.
export async function updateValues(range: string, rows: Row[]): Promise<void> {
  await googleJson({
    method: "PUT",
    url: spreadsheetUrl(`/values/${encodeURIComponent(range)}`, { valueInputOption: "RAW" }),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ range, majorDimension: "ROWS", values: rows }),
    operation: "sheets.values.update",
  });
}

export type ValueUpdate = { range: string; values: Row[] };

// Several exact-range writes in ONE API call. The main tool for staying inside the quota when a
// single operation touches rows in more than one tab (e.g. a status change writes the
// application row, a status-history row and an audit row).
export async function batchUpdateValues(updates: ValueUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  await googleJson({
    method: "POST",
    url: spreadsheetUrl("/values:batchUpdate"),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      valueInputOption: "RAW",
      data: updates.map((update) => ({ range: update.range, majorDimension: "ROWS", values: update.values })),
    }),
    operation: "sheets.values.batchUpdate",
  });
}

// ── Structural changes ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SheetRequest = Record<string, any>;

export type BatchUpdateReply = { replies?: { addSheet?: { properties?: SheetProperties } }[] };

// Structural edits: creating tabs, freezing header rows, deleting rows, protecting ranges.
export async function batchUpdateSpreadsheet(requests: SheetRequest[]): Promise<BatchUpdateReply> {
  if (requests.length === 0) return {};
  const reply = await googleJson<BatchUpdateReply>({
    method: "POST",
    url: spreadsheetUrl(":batchUpdate"),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests, includeSpreadsheetInResponse: false }),
    operation: "sheets.batchUpdate",
  });
  return reply ?? {};
}

// Round-trips a tiny read to the spreadsheet. Used by the health check.
export async function pingSheets(): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const started = Date.now();
  try {
    await googleJson({
      url: spreadsheetUrl("", { fields: "spreadsheetId" }),
      operation: "sheets.ping",
      timeoutMs: 5_000,
      maxAttempts: 1,
    });
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    if (err instanceof Error && err.name === "GoogleConfigError") return { ok: false, error: "misconfigured" };
    if (err instanceof Error && err.name === "GoogleNotFoundError") return { ok: false, error: "spreadsheet_not_found" };
    return { ok: false, error: "unavailable" };
  }
}
