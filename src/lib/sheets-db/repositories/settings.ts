import { columnLetter, updateValues, quoteTitle } from "@/lib/google/sheets";
import { decodeText, encodeDate, encodeText } from "@/lib/sheets-db/codec";
import { SETTINGS_COLUMNS } from "@/lib/sheets-db/schema";
import { allRecords, appendRecord, invalidateTable, loadTable } from "@/lib/sheets-db/table";

// The Settings tab: a small key/value store for the schema version and operational bookkeeping
// (when maintenance last ran, when retention was last reported).
//
// Unlike every other tab these rows are keyed by `key` rather than by an `id` column, so writes
// address the row directly instead of going through updateRecord(). Nothing on a request path
// reads from here.

const LAST_COLUMN = columnLetter(SETTINGS_COLUMNS.length - 1);

export async function getSetting(key: string): Promise<string | null> {
  const table = await loadTable("Settings", { maxAgeMs: 0 });
  const row = table.records.find((record) => decodeText(record.values.key) === key);
  return row ? decodeText(row.values.value) : null;
}

export async function setSetting(key: string, value: string, description = ""): Promise<void> {
  const now = new Date();
  const table = await loadTable("Settings", { maxAgeMs: 0 });
  const existing = table.records.find((record) => decodeText(record.values.key) === key);
  const cells = [key, encodeText(value, 5000), encodeDate(now), encodeText(description, 500)];

  if (existing) {
    await updateValues(`${quoteTitle("Settings")}!A${existing.rowNumber}:${LAST_COLUMN}${existing.rowNumber}`, [cells]);
    invalidateTable("Settings");
    return;
  }
  await appendRecord("Settings", { key: cells[0], value: cells[1], updatedAt: cells[2], description: cells[3] });
}

export async function listSettings(): Promise<{ key: string; value: string; updatedAt: string }[]> {
  const rows = await allRecords("Settings", { maxAgeMs: 0 });
  return rows
    .filter((row) => decodeText(row.values.key) !== "")
    .map((row) => ({
      key: decodeText(row.values.key),
      value: decodeText(row.values.value),
      updatedAt: decodeText(row.values.updatedAt),
    }));
}
