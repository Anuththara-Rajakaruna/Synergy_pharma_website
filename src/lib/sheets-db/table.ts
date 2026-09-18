import {
  a1Range,
  appendValues,
  batchGetValues,
  batchUpdateValues,
  columnLetter,
  quoteTitle,
  updateValues,
  type CellValue,
  type ValueUpdate,
} from "@/lib/google/sheets";
import { logger } from "@/lib/logger";
import { MAX_CELL_LENGTH } from "@/lib/sheets-db/codec";
import { TABLES, type TableName } from "@/lib/sheets-db/schema";

// Record-level access to the spreadsheet: load a tab, find rows, append rows, update cells.
//
// Reads are cached per process for a few seconds. That is what makes the Sheets API viable as a
// data store: the quota is 60 reads per minute per user, while one admin page view touches five
// or six tabs. A cached load of every tab the request needs costs a single batchGet.
//
// The cache is deliberately short-lived and is updated in place after every write, so a request
// always sees its own writes. Across serverless instances a read can be up to CACHE_TTL_MS
// stale; every place where that would be incorrect rather than merely slow (claiming a unique
// email, resolving a session token) asks for a fresh read explicitly.

// How long a loaded tab may be reused for an ordinary read.
const CACHE_TTL_MS = 10_000;

// Writes always re-read the tab first, rather than trusting a cached copy.
//
// This is deliberately strict. Row numbers are stable only because records are archived instead
// of deleted - but the retention purge does delete rows, and every row below a deleted one moves
// up. An instance holding a copy of the tab from just before a purge would map an id to a row
// number that now belongs to a different record, and write over it. Re-reading costs one extra
// API call on operations that are rare (an admin changing a status, adding a note) and removes
// that failure mode entirely. Reads, which are the frequent case, still come from the cache.
const WRITE_FRESHNESS_MS = 0;

export type RecordValues = Record<string, CellValue>;

export type TableRecord = {
  // 1-based spreadsheet row number, including the header row. Stable for the life of the row:
  // records are archived, not deleted, and the only code that deletes rows (the retention purge)
  // clears the whole cache afterwards.
  rowNumber: number;
  values: RecordValues;
};

export type LoadedTable = {
  name: TableName;
  // Column names as they actually appear in row 1, in sheet order.
  header: string[];
  index: Map<string, number>;
  records: TableRecord[];
  loadedAt: number;
};

type CacheEntry = { table: LoadedTable; loadedAt: number };

type StoreCache = {
  tables: Map<TableName, CacheEntry>;
  // In-flight loads, so ten concurrent requests on a cold instance make one batchGet, not ten.
  pending: Map<TableName, Promise<LoadedTable>>;
};

declare global {
  var __synergySheetCache: StoreCache | undefined;
}

const cache: StoreCache = (globalThis.__synergySheetCache ??= { tables: new Map(), pending: new Map() });

// ── Loading ──────────────────────────────────────────────────────────────────

function buildTable(name: TableName, rows: CellValue[][]): LoadedTable {
  const definition = TABLES[name];
  const headerRow = rows[0] ?? [];
  // Trust the sheet's own header row, so a column that was moved or an extra column added by
  // hand does not shift every field by one.
  const header = headerRow.map((cell) => String(cell ?? "").trim());
  const index = new Map<string, number>();
  header.forEach((columnName, position) => {
    if (columnName && !index.has(columnName)) index.set(columnName, position);
  });

  const missing = definition.columns.filter((column) => !index.has(column));
  if (missing.length > 0) {
    // Not fatal: decoders fall back to defaults for absent columns. `npm run sheets:setup`
    // repairs the header.
    logger.warn("sheets.columns_missing", { table: name, missing });
  }

  const records: TableRecord[] = [];
  for (let position = 1; position < rows.length; position += 1) {
    const row = rows[position];
    if (!row || row.length === 0) continue;
    const values: RecordValues = {};
    let hasValue = false;
    for (const [columnName, columnIndex] of index) {
      const cell = row[columnIndex];
      if (cell !== undefined && cell !== null && cell !== "") hasValue = true;
      values[columnName] = cell ?? "";
    }
    // Skip blank rows left behind by a hand edit.
    if (!hasValue) continue;
    records.push({ rowNumber: position + 1, values });
  }

  return { name, header, index, records, loadedAt: Date.now() };
}

function isFresh(entry: CacheEntry | undefined, maxAgeMs: number): entry is CacheEntry {
  return entry !== undefined && Date.now() - entry.loadedAt <= maxAgeMs;
}

// Loads several tabs at once. Only the ones whose cache entry is older than `maxAgeMs` are
// fetched, and those are fetched together in a single batchGet.
export async function loadTables(names: TableName[], opts: { maxAgeMs?: number } = {}): Promise<Map<TableName, LoadedTable>> {
  const maxAgeMs = opts.maxAgeMs ?? CACHE_TTL_MS;
  const wanted = [...new Set(names)];
  const result = new Map<TableName, LoadedTable>();

  const toFetch: TableName[] = [];
  const toAwait: TableName[] = [];
  for (const name of wanted) {
    const entry = cache.tables.get(name);
    if (isFresh(entry, maxAgeMs)) {
      result.set(name, entry.table);
    } else if (cache.pending.has(name)) {
      toAwait.push(name);
    } else {
      toFetch.push(name);
    }
  }

  if (toFetch.length > 0) {
    const ranges = toFetch.map((name) => a1Range(name));
    const fetchPromise = batchGetValues(ranges).then((sets) => {
      const tables = new Map<TableName, LoadedTable>();
      toFetch.forEach((name, position) => {
        const table = buildTable(name, sets[position] ?? []);
        cache.tables.set(name, { table, loadedAt: table.loadedAt });
        tables.set(name, table);
      });
      return tables;
    });

    // Register each tab's share of the batch so a concurrent caller joins this fetch.
    for (const name of toFetch) {
      const pending = fetchPromise
        .then((tables) => {
          const table = tables.get(name);
          if (!table) throw new Error(`Google Sheets returned no data for the ${name} tab.`);
          return table;
        })
        .finally(() => {
          if (cache.pending.get(name) === pending) cache.pending.delete(name);
        });
      cache.pending.set(name, pending);
      toAwait.push(name);
    }
  }

  await Promise.all(
    toAwait.map(async (name) => {
      const pending = cache.pending.get(name);
      if (pending) {
        result.set(name, await pending);
        return;
      }
      // The fetch settled between the check above and here; the cache now holds it.
      const entry = cache.tables.get(name);
      if (entry) result.set(name, entry.table);
      else result.set(name, await loadTable(name, { maxAgeMs: 0 }));
    })
  );

  return result;
}

export async function loadTable(name: TableName, opts: { maxAgeMs?: number } = {}): Promise<LoadedTable> {
  const tables = await loadTables([name], opts);
  const table = tables.get(name);
  if (!table) throw new Error(`Could not load the ${name} tab.`);
  return table;
}

// Drops cached data so the next read goes to Google. Call after any change that moves rows.
export function invalidateTable(name?: TableName): void {
  if (name) {
    cache.tables.delete(name);
    cache.pending.delete(name);
    return;
  }
  cache.tables.clear();
  cache.pending.clear();
}

// ── Finding ──────────────────────────────────────────────────────────────────

export type FindOptions = {
  maxAgeMs?: number;
  // Re-read the tab from Google when nothing matched the cached copy, before concluding the
  // record does not exist. Needed wherever a false "not found" would be wrong rather than stale:
  // a session created on another instance, an email being claimed for the first time.
  refreshOnMiss?: boolean;
};

export async function findRecord(
  name: TableName,
  predicate: (values: RecordValues) => boolean,
  opts: FindOptions = {}
): Promise<TableRecord | null> {
  const table = await loadTable(name, { maxAgeMs: opts.maxAgeMs });
  const found = table.records.find((record) => predicate(record.values));
  if (found || !opts.refreshOnMiss || table.loadedAt >= Date.now() - 50) return found ?? null;
  const fresh = await loadTable(name, { maxAgeMs: 0 });
  return fresh.records.find((record) => predicate(record.values)) ?? null;
}

export async function findRecords(
  name: TableName,
  predicate: (values: RecordValues) => boolean,
  opts: { maxAgeMs?: number } = {}
): Promise<TableRecord[]> {
  const table = await loadTable(name, { maxAgeMs: opts.maxAgeMs });
  return table.records.filter((record) => predicate(record.values));
}

export async function findById(name: TableName, id: string, opts: FindOptions = {}): Promise<TableRecord | null> {
  if (!id) return null;
  return findRecord(name, (values) => String(values.id ?? "") === id, opts);
}

export async function allRecords(name: TableName, opts: { maxAgeMs?: number } = {}): Promise<TableRecord[]> {
  return (await loadTable(name, opts)).records;
}

// ── Writing ──────────────────────────────────────────────────────────────────

function toRow(table: LoadedTable, values: RecordValues): CellValue[] {
  const row: CellValue[] = new Array(table.header.length).fill("");
  for (const [columnName, columnIndex] of table.index) {
    const value = values[columnName];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.length > MAX_CELL_LENGTH) {
      logger.warn("sheets.cell_truncated", { table: table.name, column: columnName, length: value.length });
      row[columnIndex] = value.slice(0, MAX_CELL_LENGTH);
    } else {
      row[columnIndex] = value;
    }
  }
  return row;
}

// Appends records and returns them with the row numbers Google assigned. The append is never
// retried by the transport (a retried append could write the row twice); a caller that needs the
// row to be unique reconciles afterwards with `reconcileDuplicate`.
export async function appendRecords(name: TableName, records: RecordValues[]): Promise<TableRecord[]> {
  if (records.length === 0) return [];
  const table = await loadTable(name, { maxAgeMs: WRITE_FRESHNESS_MS });
  const rows = records.map((values) => toRow(table, values));

  const result = await appendValues(a1Range(name), rows);
  const appended: TableRecord[] = records.map((values, position) => ({
    rowNumber: result.firstRow + position,
    values: { ...values },
  }));

  // Keep the cached copy usable: the request that just wrote must be able to read the record
  // back without another round trip.
  const entry = cache.tables.get(name);
  if (entry) {
    entry.table.records.push(...appended.map((record) => ({ rowNumber: record.rowNumber, values: { ...record.values } })));
    entry.table.records.sort((a, b) => a.rowNumber - b.rowNumber);
  }

  return appended;
}

export async function appendRecord(name: TableName, values: RecordValues): Promise<TableRecord> {
  const [record] = await appendRecords(name, [values]);
  return record;
}

// Groups the changed columns into the fewest contiguous A1 ranges, so an update writes only the
// cells it means to. Rewriting the whole row instead would clobber a column another admin
// changed a moment earlier on a different instance.
function rangesForPatch(table: LoadedTable, rowNumber: number, patch: RecordValues): ValueUpdate[] {
  const positions = Object.keys(patch)
    .map((columnName) => ({ columnName, columnIndex: table.index.get(columnName) }))
    .filter((item): item is { columnName: string; columnIndex: number } => item.columnIndex !== undefined)
    .sort((a, b) => a.columnIndex - b.columnIndex);
  if (positions.length === 0) return [];

  const updates: ValueUpdate[] = [];
  let groupStart = 0;
  for (let i = 1; i <= positions.length; i += 1) {
    const breaks = i === positions.length || positions[i].columnIndex !== positions[i - 1].columnIndex + 1;
    if (!breaks) continue;

    const group = positions.slice(groupStart, i);
    const values: CellValue[] = group.map(({ columnName }) => {
      const value = patch[columnName];
      if (value === undefined || value === null) return "";
      return typeof value === "string" && value.length > MAX_CELL_LENGTH ? value.slice(0, MAX_CELL_LENGTH) : value;
    });
    const first = columnLetter(group[0].columnIndex);
    const last = columnLetter(group[group.length - 1].columnIndex);
    updates.push({ range: `${quoteTitle(table.name)}!${first}${rowNumber}:${last}${rowNumber}`, values: [values] });
    groupStart = i;
  }
  return updates;
}

function applyPatchToCache(name: TableName, rowNumber: number, patch: RecordValues): void {
  const entry = cache.tables.get(name);
  if (!entry) return;
  const record = entry.table.records.find((item) => item.rowNumber === rowNumber);
  if (record) Object.assign(record.values, patch);
}

// Updates the given columns of one record, addressed by id rather than by row number so a stale
// row number can never write over a different record. Returns false when the record is gone.
export async function updateRecord(name: TableName, id: string, patch: RecordValues): Promise<boolean> {
  if (Object.keys(patch).length === 0) return true;
  const record = await findById(name, id, { maxAgeMs: WRITE_FRESHNESS_MS, refreshOnMiss: true });
  if (!record) {
    logger.warn("sheets.update_missing_record", { table: name });
    return false;
  }
  const table = await loadTable(name, { maxAgeMs: WRITE_FRESHNESS_MS });
  const updates = rangesForPatch(table, record.rowNumber, patch);
  if (updates.length === 0) return true;

  if (updates.length === 1) await updateValues(updates[0].range, updates[0].values);
  else await batchUpdateValues(updates);

  applyPatchToCache(name, record.rowNumber, patch);
  return true;
}

// Updates several records across one or more tabs in a single Google API call.
export async function updateRecordsBatch(
  changes: { table: TableName; id: string; patch: RecordValues }[]
): Promise<void> {
  if (changes.length === 0) return;
  const tableNames = [...new Set(changes.map((change) => change.table))];
  const tables = await loadTables(tableNames, { maxAgeMs: WRITE_FRESHNESS_MS });

  const updates: ValueUpdate[] = [];
  const applied: { table: TableName; rowNumber: number; patch: RecordValues }[] = [];
  for (const change of changes) {
    const table = tables.get(change.table);
    if (!table) continue;
    const record = table.records.find((item) => String(item.values.id ?? "") === change.id);
    if (!record) {
      logger.warn("sheets.update_missing_record", { table: change.table });
      continue;
    }
    updates.push(...rangesForPatch(table, record.rowNumber, change.patch));
    applied.push({ table: change.table, rowNumber: record.rowNumber, patch: change.patch });
  }

  if (updates.length === 0) return;
  await batchUpdateValues(updates);
  for (const change of applied) applyPatchToCache(change.table, change.rowNumber, change.patch);
}

// ── Uniqueness ───────────────────────────────────────────────────────────────

// Google Sheets has no unique index. A caller that must not create two rows for the same key
// takes the in-process lock for that key, appends, then calls this: it re-reads the tab from
// Google and reports whether an earlier row already holds the key.
//
// The row appended first always wins, so two instances racing agree on the same winner without
// talking to each other. The loser's row is not deleted - deleting would shift every row below
// it - it is marked and hidden.
export async function reconcileDuplicate(
  name: TableName,
  ownRecord: TableRecord,
  keyOf: (values: RecordValues) => string | null
): Promise<{ isDuplicate: boolean; winner: TableRecord }> {
  const ownKey = keyOf(ownRecord.values);
  if (!ownKey) return { isDuplicate: false, winner: ownRecord };

  const fresh = await loadTable(name, { maxAgeMs: 0 });
  const matches = fresh.records.filter((record) => keyOf(record.values) === ownKey && !String(record.values.supersededBy ?? ""));
  if (matches.length <= 1) return { isDuplicate: false, winner: ownRecord };

  // Earliest row number wins: Sheets appends in the order it accepted the writes.
  const winner = matches.reduce((best, record) => (record.rowNumber < best.rowNumber ? record : best));
  if (winner.rowNumber === ownRecord.rowNumber) return { isDuplicate: false, winner: ownRecord };

  logger.warn("sheets.duplicate_reconciled", { table: name, keptRow: winner.rowNumber, supersededRow: ownRecord.rowNumber });
  return { isDuplicate: true, winner };
}

// ── Deletion (retention purge only) ──────────────────────────────────────────

export type RowDeletion = { table: TableName; rowNumbers: number[] };

// Row numbers below a deleted row shift up, so every cached tab is dropped afterwards.
export function noteRowsDeleted(): void {
  invalidateTable();
}
