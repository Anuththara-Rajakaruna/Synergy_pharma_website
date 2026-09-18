import { readGoogleEnv } from "@/lib/google/config";
import { getValues, updateValues, a1Range, columnLetter, quoteTitle, type CellValue } from "@/lib/google/sheets";
import type { TableName } from "@/lib/sheets-db/schema";

// Optional direct store access, for the few end-to-end states the API cannot produce on demand
// (a published job whose application deadline has already passed, or what a record actually
// looks like at rest). It reads and writes the same spreadsheet the site under test uses, so it
// is gated twice:
//
//   * the GOOGLE_* variables must be configured at all, and
//   * the spreadsheet's Settings tab must carry test.spreadsheet = true, set by hand.
//
// The second gate is the important one. These helpers edit live rows, and a misconfigured CI run
// pointed at the production spreadsheet would otherwise rewrite real candidate data. A sheet
// without the marker is treated as production and refused.
//
// Only records created by the calling test may be modified.

const MARKER_KEY = "test.spreadsheet";

let markerChecked: boolean | null = null;

export function databaseConfigured(): boolean {
  return readGoogleEnv().settings !== null;
}

// True when the configured spreadsheet is explicitly marked as a test sheet. Cached for the run.
export async function testSpreadsheetConfirmed(): Promise<boolean> {
  if (markerChecked !== null) return markerChecked;
  if (!databaseConfigured()) {
    markerChecked = false;
    return markerChecked;
  }
  try {
    const rows = await getValues(a1Range("Settings"));
    markerChecked = rows.some(
      (row) => String(row[0] ?? "").trim() === MARKER_KEY && ["true", "TRUE", "yes"].includes(String(row[1] ?? "").trim())
    );
  } catch {
    markerChecked = false;
  }
  return markerChecked;
}

function assertUsable(): void {
  if (!databaseConfigured()) {
    throw new Error("The GOOGLE_* variables are required for this test.");
  }
  if (markerChecked !== true) {
    throw new Error(
      `Refusing to modify the spreadsheet: its Settings tab does not carry ${MARKER_KEY}=true. ` +
        "Add that row by hand to the scratch spreadsheet you want these tests to use."
    );
  }
}

export type SheetRow = { rowNumber: number; values: Record<string, CellValue> };

// Every row of a tab, keyed by the header names actually present in row 1.
export async function readRows(table: TableName): Promise<SheetRow[]> {
  if (!(await testSpreadsheetConfirmed())) assertUsable();
  const rows = await getValues(a1Range(table));
  const header = (rows[0] ?? []).map((cell) => String(cell ?? "").trim());
  return rows
    .slice(1)
    .map((row, index) => {
      const values: Record<string, CellValue> = {};
      header.forEach((name, position) => {
        if (name) values[name] = row[position] ?? "";
      });
      return { rowNumber: index + 2, values };
    })
    .filter((row) => Object.values(row.values).some((cell) => cell !== ""));
}

// Overwrites one cell of one row. Used to age a record past a boundary the API will not cross.
export async function setCell(table: TableName, rowNumber: number, column: string, value: CellValue): Promise<void> {
  await testSpreadsheetConfirmed();
  assertUsable();
  const rows = await getValues(a1Range(table, { firstRow: 1, lastRow: 1 }));
  const header = (rows[0] ?? []).map((cell) => String(cell ?? "").trim());
  const index = header.indexOf(column);
  if (index === -1) throw new Error(`The "${table}" tab has no "${column}" column.`);
  const letter = columnLetter(index);
  await updateValues(`${quoteTitle(table)}!${letter}${rowNumber}:${letter}${rowNumber}`, [[value]]);
}

// Finds the row a test just created, by any column value.
export async function findRow(table: TableName, column: string, value: string): Promise<SheetRow | null> {
  const rows = await readRows(table);
  return rows.find((row) => String(row.values[column] ?? "") === value) ?? null;
}
