import {
  a1Range,
  batchUpdateSpreadsheet,
  batchUpdateValues,
  columnLetter,
  getSpreadsheetInfo,
  quoteTitle,
  updateValues,
  type SheetRequest,
} from "@/lib/google/sheets";
import { logger } from "@/lib/logger";
import { SCHEMA_VERSION, SETTINGS_KEYS, TABLES, TABLE_NAMES, type TableName } from "@/lib/sheets-db/schema";
import { setSetting } from "@/lib/sheets-db/repositories/settings";
import { invalidateTable, loadTable } from "@/lib/sheets-db/table";

// Creating and repairing the spreadsheet's structure. Run by `npm run sheets:setup`, checked by
// `npm run sheets:check` and by /api/health.
//
// Everything here is idempotent: a tab that exists is left alone, a header row that is already
// correct is not rewritten, and a column added by a later release is appended rather than
// replacing what is there. Running setup against a spreadsheet full of live data is safe.

export type SchemaProblem = { level: "error" | "warning"; table: TableName | null; message: string };

// "'Jobs'!A1:X1" - an exact rectangle, so the write can never be rejected for spilling past the
// range the way a whole-row range can.
function headerRange(table: TableName, columnCount: number): string {
  return a1Range(table, { firstRow: 1, lastRow: 1, firstColumn: 0, lastColumn: Math.max(0, columnCount - 1) });
}

// ── Inspection ───────────────────────────────────────────────────────────────

export type SchemaReport = {
  spreadsheetTitle: string;
  tables: { name: TableName; exists: boolean; rowCount: number; missingColumns: string[]; extraColumns: string[] }[];
  problems: SchemaProblem[];
};

export async function inspectSchema(): Promise<SchemaReport> {
  const info = await getSpreadsheetInfo();
  const present = new Map(info.sheets.map((sheet) => [sheet.properties.title, sheet.properties]));
  const problems: SchemaProblem[] = [];
  const tables: SchemaReport["tables"] = [];

  for (const name of TABLE_NAMES) {
    const properties = present.get(name);
    if (!properties) {
      problems.push({ level: "error", table: name, message: `The "${name}" tab is missing. Run: npm run sheets:setup` });
      tables.push({ name, exists: false, rowCount: 0, missingColumns: [...TABLES[name].columns], extraColumns: [] });
      continue;
    }

    const table = await loadTable(name, { maxAgeMs: 0 });
    const expected = TABLES[name].columns;
    const missingColumns = expected.filter((column) => !table.index.has(column));
    const extraColumns = table.header.filter((column) => column && !expected.includes(column));

    if (missingColumns.length > 0) {
      problems.push({
        level: "error",
        table: name,
        message: `The "${name}" tab is missing the column(s): ${missingColumns.join(", ")}. Run: npm run sheets:setup`,
      });
    }
    if (properties.gridProperties.frozenRowCount !== 1) {
      problems.push({ level: "warning", table: name, message: `The header row of "${name}" is not frozen.` });
    }
    tables.push({ name, exists: true, rowCount: table.records.length, missingColumns, extraColumns });
  }

  return { spreadsheetTitle: info.properties.title, tables, problems };
}

// ── Creation and repair ──────────────────────────────────────────────────────

export type SetupResult = { createdTables: TableName[]; repairedTables: TableName[]; alreadyCorrect: TableName[] };

export async function ensureSchema(): Promise<SetupResult> {
  const info = await getSpreadsheetInfo();
  const present = new Set(info.sheets.map((sheet) => sheet.properties.title));

  // 1. Create every missing tab in one structural call.
  const toCreate = TABLE_NAMES.filter((name) => !present.has(name));
  if (toCreate.length > 0) {
    await batchUpdateSpreadsheet(
      toCreate.map<SheetRequest>((name) => ({
        addSheet: {
          properties: {
            title: name,
            gridProperties: { rowCount: 1000, columnCount: Math.max(TABLES[name].columns.length, 8), frozenRowCount: 1 },
          },
        },
      }))
    );
    logger.info("sheets.tabs_created", { tables: toCreate });
    invalidateTable();
  }

  // 2. Write the header row of every new tab, and append any column a previous release did not
  //    have. Existing columns are never moved: row data is addressed by column name.
  const repaired: TableName[] = [];
  const correct: TableName[] = [];
  const headerWrites: { range: string; values: string[][] }[] = [];

  for (const name of TABLE_NAMES) {
    const expected = TABLES[name].columns;
    if (toCreate.includes(name)) {
      headerWrites.push({ range: headerRange(name, expected.length), values: [[...expected]] });
      continue;
    }

    const table = await loadTable(name, { maxAgeMs: 0 });
    const missing = expected.filter((column) => !table.index.has(column));
    if (missing.length === 0) {
      correct.push(name);
      continue;
    }
    const header = [...table.header];
    // Drop trailing blanks so new columns land immediately after the last real one.
    while (header.length > 0 && header[header.length - 1] === "") header.pop();
    header.push(...missing);
    headerWrites.push({ range: headerRange(name, header.length), values: [header] });
    repaired.push(name);
    logger.info("sheets.columns_added", { table: name, added: missing });
  }

  if (headerWrites.length > 0) {
    await batchUpdateValues(headerWrites);
    invalidateTable();
  }

  // 3. Freeze and bold the header row, and widen the tabs that need more columns than the
  //    default grid provides.
  const formatting: SheetRequest[] = [];
  const refreshed = await getSpreadsheetInfo();
  for (const sheet of refreshed.sheets) {
    const name = sheet.properties.title as TableName;
    if (!TABLE_NAMES.includes(name)) continue;
    const needed = TABLES[name].columns.length;

    if (sheet.properties.gridProperties.columnCount < needed) {
      formatting.push({
        updateSheetProperties: {
          properties: { sheetId: sheet.properties.sheetId, gridProperties: { columnCount: needed + 4 } },
          fields: "gridProperties.columnCount",
        },
      });
    }
    if (sheet.properties.gridProperties.frozenRowCount !== 1) {
      formatting.push({
        updateSheetProperties: {
          properties: { sheetId: sheet.properties.sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      });
    }
    formatting.push({
      repeatCell: {
        range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat.bold",
      },
    });
  }
  if (formatting.length > 0) await batchUpdateSpreadsheet(formatting);

  await setSetting(SETTINGS_KEYS.schemaVersion, SCHEMA_VERSION, "Structure version of this spreadsheet. Do not edit.");
  if (toCreate.length > 0) {
    await setSetting(SETTINGS_KEYS.createdAt, new Date().toISOString(), "When these tabs were first created.");
  }
  invalidateTable();

  return { createdTables: toCreate, repairedTables: repaired, alreadyCorrect: correct };
}

// ── Row deletion ─────────────────────────────────────────────────────────────

// Deleting rows is the only operation that renumbers a tab, so it is confined to the retention
// purge and the maintenance sweeps. Rows are removed bottom-up: deleting row 10 before row 5
// would leave row 5's index pointing at what used to be row 6.
export async function deleteRows(table: TableName, rowNumbers: number[]): Promise<number> {
  const unique = [...new Set(rowNumbers)].filter((row) => row > 1).sort((a, b) => b - a);
  if (unique.length === 0) return 0;

  const info = await getSpreadsheetInfo();
  const sheet = info.sheets.find((item) => item.properties.title === table);
  if (!sheet) throw new Error(`The "${table}" tab does not exist.`);
  const sheetId = sheet.properties.sheetId;

  // Collapse consecutive rows into single ranges: 40 individual deletes become one request.
  const requests: SheetRequest[] = [];
  let index = 0;
  while (index < unique.length) {
    const end = unique[index];
    let start = end;
    while (index + 1 < unique.length && unique[index + 1] === start - 1) {
      index += 1;
      start = unique[index];
    }
    requests.push({
      deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: start - 1, endIndex: end } },
    });
    index += 1;
  }

  await batchUpdateSpreadsheet(requests);
  // Every cached row number for this tab is now wrong.
  invalidateTable(table);
  logger.info("sheets.rows_deleted", { table, count: unique.length });
  return unique.length;
}

// Writes the header row of one tab without touching its data. Used by the repair path in tests.
export async function writeHeader(table: TableName): Promise<void> {
  const columns = TABLES[table].columns;
  await updateValues(`${quoteTitle(table)}!A1:${columnLetter(columns.length - 1)}1`, [[...columns]]);
  invalidateTable(table);
}
