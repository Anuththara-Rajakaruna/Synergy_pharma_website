// An in-memory stand-in for the Google Sheets and Google Drive REST APIs.
//
// It exists so the whole careers portal can be exercised end to end - submit an application,
// upload a CV, read it back from the admin portal, change a status, run maintenance - without a
// Google Cloud project, and deterministically in CI.
//
// It implements exactly the surface src/lib/google/{sheets,drive,auth}.ts calls, and it
// implements it the way Google does in the places the application depends on:
//
//   * values.append inserts after the last row that holds data and reports the range it wrote,
//     which is how the store learns a new record's row number;
//   * reads omit trailing empty cells, so rows come back ragged and every decoder has to cope;
//   * deleteDimension shifts every row below it up;
//   * a resumable upload is two calls, the second to an opaque session URI that carries its own
//     authorisation.
//
// It is not a general-purpose emulator: unknown requests fail loudly rather than silently
// returning something plausible, so a call the application makes that this file does not model
// shows up as a test failure instead of a false pass.

import { generateKeyPairSync, randomUUID } from "node:crypto";

export type CellValue = string | number | boolean;

type Sheet = {
  sheetId: number;
  title: string;
  index: number;
  rows: CellValue[][];
  frozenRowCount: number;
  columnCount: number;
};

type DriveEntry = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  description: string;
  createdTime: string;
  modifiedTime: string;
  trashed: boolean;
  content: Buffer | null;
};

export const FOLDER_MIME = "application/vnd.google-apps.folder";

// ── A1 notation ──────────────────────────────────────────────────────────────

export function columnIndexOf(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

export function columnLetterOf(index: number): string {
  let value = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return letters;
}

export type ParsedRange = {
  title: string;
  firstRow: number | null;
  lastRow: number | null;
  firstColumn: number | null;
  lastColumn: number | null;
};

// Accepts "Title", "'Title'", "'Title'!A1:X1", "Title!A:D" and "Title!1:1".
export function parseA1(range: string): ParsedRange {
  const bang = findUnquotedBang(range);
  const rawTitle = bang === -1 ? range : range.slice(0, bang);
  const title = rawTitle.startsWith("'") && rawTitle.endsWith("'") ? rawTitle.slice(1, -1).replace(/''/g, "'") : rawTitle;
  if (bang === -1) return { title, firstRow: null, lastRow: null, firstColumn: null, lastColumn: null };

  const body = range.slice(bang + 1);
  const [start, end = start] = body.split(":");
  const startParts = /^([A-Za-z]*)(\d*)$/.exec(start);
  const endParts = /^([A-Za-z]*)(\d*)$/.exec(end);
  if (!startParts || !endParts) throw new Error(`google-stub: cannot parse A1 range "${range}"`);

  return {
    title,
    firstColumn: startParts[1] ? columnIndexOf(startParts[1]) : null,
    lastColumn: endParts[1] ? columnIndexOf(endParts[1]) : null,
    firstRow: startParts[2] ? Number.parseInt(startParts[2], 10) : null,
    lastRow: endParts[2] ? Number.parseInt(endParts[2], 10) : null,
  };
}

// A sheet title may itself contain "!", so only a "!" outside the quotes separates the title.
function findUnquotedBang(range: string): number {
  let quoted = false;
  for (let i = 0; i < range.length; i += 1) {
    if (range[i] === "'") quoted = !quoted;
    else if (range[i] === "!" && !quoted) return i;
  }
  return -1;
}

function quote(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

// ── The fake ─────────────────────────────────────────────────────────────────

export type GoogleStubOptions = {
  spreadsheetId?: string;
  rootFolderId?: string;
  spreadsheetTitle?: string;
};

export class GoogleStub {
  readonly spreadsheetId: string;
  readonly rootFolderId: string;
  private spreadsheetTitle: string;
  private sheets = new Map<string, Sheet>();
  private nextSheetId = 1;
  private files = new Map<string, DriveEntry>();
  private uploadSessions = new Map<string, { metadata: Record<string, unknown> }>();

  // Test hooks.
  requests: { method: string; url: string }[] = [];
  // Set to make the next matching call fail, so error paths can be exercised.
  failures: { match: RegExp; status: number; body?: unknown; times?: number }[] = [];

  constructor(options: GoogleStubOptions = {}) {
    this.spreadsheetId = options.spreadsheetId ?? "stub-spreadsheet-id";
    this.rootFolderId = options.rootFolderId ?? "stub-root-folder";
    this.spreadsheetTitle = options.spreadsheetTitle ?? "Synergy Careers (test)";
    // Every new spreadsheet starts with one tab, exactly as Google creates it.
    this.addSheet("Sheet1");
    this.files.set(this.rootFolderId, {
      id: this.rootFolderId,
      name: "Careers (test)",
      mimeType: FOLDER_MIME,
      parents: [],
      appProperties: {},
      description: "",
      createdTime: new Date(0).toISOString(),
      modifiedTime: new Date(0).toISOString(),
      trashed: false,
      content: null,
    });
  }

  // ── Introspection for assertions ───────────────────────────────────────────

  sheetTitles(): string[] {
    return [...this.sheets.values()].sort((a, b) => a.index - b.index).map((sheet) => sheet.title);
  }

  // Data rows (row 1 is the header) as objects keyed by column name.
  rowsOf(title: string): Record<string, CellValue>[] {
    const sheet = this.sheets.get(title);
    if (!sheet) return [];
    const header = (sheet.rows[0] ?? []).map((cell) => String(cell ?? ""));
    return sheet.rows
      .slice(1)
      .filter((row) => row.some((cell) => cell !== "" && cell !== undefined && cell !== null))
      .map((row) => {
        const record: Record<string, CellValue> = {};
        header.forEach((name, index) => {
          if (name) record[name] = row[index] ?? "";
        });
        return record;
      });
  }

  driveFiles(): DriveEntry[] {
    return [...this.files.values()].filter((file) => file.id !== this.rootFolderId && !file.trashed);
  }

  folderNamed(name: string): DriveEntry | undefined {
    return [...this.files.values()].find((file) => file.mimeType === FOLDER_MIME && file.name === name && !file.trashed);
  }

  filesIn(folderId: string): DriveEntry[] {
    return [...this.files.values()].filter((file) => file.parents.includes(folderId) && !file.trashed);
  }

  // Empties the spreadsheet and the Drive folder, as if a fresh pair had been created.
  //
  // The application's own caches have to go with them. It caches loaded tabs and the ids of the
  // subfolders it created, both of which outlive this object because they hang off globalThis -
  // so resetting only the fake backend would leave the application addressing rows and folders
  // that no longer exist. (Neither cache is a problem in production: tabs are re-read on a short
  // TTL, and the Drive folders are never deleted.)
  reset(): void {
    this.sheets.clear();
    this.nextSheetId = 1;
    this.addSheet("Sheet1");
    const root = this.files.get(this.rootFolderId)!;
    this.files.clear();
    this.files.set(this.rootFolderId, root);
    this.uploadSessions.clear();
    this.requests = [];
    this.failures = [];
    resetApplicationCaches();
  }

  // ── Spreadsheet internals ──────────────────────────────────────────────────

  private addSheet(title: string, columnCount = 26, frozenRowCount = 0): Sheet {
    const sheet: Sheet = { sheetId: this.nextSheetId++, title, index: this.sheets.size, rows: [], frozenRowCount, columnCount };
    this.sheets.set(title, sheet);
    return sheet;
  }

  private sheetOrThrow(title: string): Sheet {
    const sheet = this.sheets.get(title);
    if (!sheet) {
      throw new StubHttpError(400, {
        error: { code: 400, status: "INVALID_ARGUMENT", message: `Unable to parse range: ${title}` },
      });
    }
    return sheet;
  }

  // Google trims trailing empty cells from every row and trailing empty rows from the result.
  private readRange(range: ParsedRange): CellValue[][] {
    const sheet = this.sheetOrThrow(range.title);
    const firstRow = (range.firstRow ?? 1) - 1;
    const lastRow = range.lastRow === null ? sheet.rows.length : range.lastRow;
    const firstColumn = range.firstColumn ?? 0;

    const out: CellValue[][] = [];
    for (let r = firstRow; r < Math.min(lastRow, sheet.rows.length); r += 1) {
      const row = sheet.rows[r] ?? [];
      const lastColumn = range.lastColumn === null ? row.length : range.lastColumn + 1;
      const slice = row.slice(firstColumn, lastColumn).map((cell) => cell ?? "");
      while (slice.length > 0 && (slice[slice.length - 1] === "" || slice[slice.length - 1] === undefined)) slice.pop();
      out.push(slice);
    }
    while (out.length > 0 && out[out.length - 1].length === 0) out.pop();
    return out;
  }

  private writeRange(range: ParsedRange, values: CellValue[][]): { updatedRows: number; updatedRange: string } {
    const sheet = this.sheetOrThrow(range.title);
    const firstRow = (range.firstRow ?? 1) - 1;
    const firstColumn = range.firstColumn ?? 0;

    values.forEach((row, rowOffset) => {
      const target = firstRow + rowOffset;
      while (sheet.rows.length <= target) sheet.rows.push([]);
      const existing = sheet.rows[target];
      row.forEach((cell, columnOffset) => {
        const column = firstColumn + columnOffset;
        while (existing.length <= column) existing.push("");
        existing[column] = cell ?? "";
      });
      sheet.columnCount = Math.max(sheet.columnCount, existing.length);
    });

    const lastRow = firstRow + values.length;
    const width = Math.max(...values.map((row) => row.length), 1);
    return {
      updatedRows: values.length,
      updatedRange: `${quote(sheet.title)}!${columnLetterOf(firstColumn)}${firstRow + 1}:${columnLetterOf(firstColumn + width - 1)}${lastRow}`,
    };
  }

  // values.append: find the last row holding data, then insert below it.
  private appendRows(range: ParsedRange, values: CellValue[][]): { updatedRange: string; updatedRows: number } {
    const sheet = this.sheetOrThrow(range.title);
    let lastUsed = 0;
    for (let r = sheet.rows.length - 1; r >= 0; r -= 1) {
      if ((sheet.rows[r] ?? []).some((cell) => cell !== "" && cell !== undefined && cell !== null)) {
        lastUsed = r + 1;
        break;
      }
    }
    return this.writeRange({ ...range, firstRow: lastUsed + 1, firstColumn: range.firstColumn ?? 0 }, values);
  }

  // ── Request handling ───────────────────────────────────────────────────────

  private checkFailure(url: string): void {
    for (const failure of this.failures) {
      if (!failure.match.test(url)) continue;
      if (failure.times !== undefined) {
        if (failure.times <= 0) continue;
        failure.times -= 1;
      }
      throw new StubHttpError(failure.status, failure.body ?? { error: { code: failure.status, status: "UNAVAILABLE", message: "stub failure" } });
    }
  }

  async handle(input: string, init: RequestInit = {}): Promise<Response> {
    const url = input;
    const method = (init.method ?? "GET").toUpperCase();
    this.requests.push({ method, url });

    try {
      this.checkFailure(url);
      if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "stub-access-token", expires_in: 3600 });
      if (url.startsWith("https://sheets.googleapis.com/")) return await this.handleSheets(url, method, init);
      if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files")) return await this.handleUploadStart(url, init);
      if (url.startsWith("https://stub.upload/")) return await this.handleUploadBytes(url, init);
      if (url.startsWith("https://www.googleapis.com/drive/v3/files")) return await this.handleDrive(url, method, init);
    } catch (err) {
      if (err instanceof StubHttpError) return json(err.body, err.status);
      throw err;
    }
    throw new Error(`google-stub: unhandled request ${method} ${url}`);
  }

  private async handleSheets(url: string, method: string, init: RequestInit): Promise<Response> {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(`/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}`, "");
    if (!parsed.pathname.includes(encodeURIComponent(this.spreadsheetId))) {
      throw new StubHttpError(404, { error: { code: 404, status: "NOT_FOUND", message: "Requested entity was not found." } });
    }
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (path === "" && method === "GET") {
      return json({
        spreadsheetId: this.spreadsheetId,
        properties: { title: this.spreadsheetTitle },
        sheets: [...this.sheets.values()]
          .sort((a, b) => a.index - b.index)
          .map((sheet) => ({
            properties: {
              sheetId: sheet.sheetId,
              title: sheet.title,
              index: sheet.index,
              gridProperties: {
                rowCount: Math.max(1000, sheet.rows.length),
                columnCount: sheet.columnCount,
                frozenRowCount: sheet.frozenRowCount,
              },
            },
          })),
      });
    }

    if (path === "/values:batchGet" && method === "GET") {
      const ranges = parsed.searchParams.getAll("ranges");
      return json({
        spreadsheetId: this.spreadsheetId,
        valueRanges: ranges.map((range) => {
          const values = this.readRange(parseA1(range));
          return { range, majorDimension: "ROWS", ...(values.length ? { values } : {}) };
        }),
      });
    }

    if (path.endsWith(":append") && method === "POST") {
      const range = decodeURIComponent(path.slice("/values/".length, -":append".length));
      const values = (body.values as CellValue[][]) ?? [];
      const result = this.appendRows(parseA1(range), values);
      return json({ spreadsheetId: this.spreadsheetId, updates: { updatedRange: result.updatedRange, updatedRows: result.updatedRows } });
    }

    if (path === "/values:batchUpdate" && method === "POST") {
      const data = (body.data as { range: string; values: CellValue[][] }[]) ?? [];
      let updatedCells = 0;
      for (const entry of data) {
        this.writeRange(parseA1(entry.range), entry.values);
        updatedCells += entry.values.reduce((sum, row) => sum + row.length, 0);
      }
      return json({ spreadsheetId: this.spreadsheetId, totalUpdatedCells: updatedCells });
    }

    if (path.startsWith("/values/") && method === "PUT") {
      const range = decodeURIComponent(path.slice("/values/".length));
      const result = this.writeRange(parseA1(range), (body.values as CellValue[][]) ?? []);
      return json({ spreadsheetId: this.spreadsheetId, updatedRange: result.updatedRange, updatedRows: result.updatedRows });
    }

    if (path === ":batchUpdate" && method === "POST") {
      const requests = (body.requests as Record<string, never>[]) ?? [];
      const replies: unknown[] = [];
      for (const request of requests) replies.push(this.applyStructuralRequest(request));
      return json({ spreadsheetId: this.spreadsheetId, replies });
    }

    throw new Error(`google-stub: unhandled Sheets request ${method} ${path}`);
  }

  private applyStructuralRequest(request: Record<string, never>): unknown {
    if ("addSheet" in request) {
      const properties = (request.addSheet as { properties?: { title?: string; gridProperties?: { columnCount?: number; frozenRowCount?: number } } })
        .properties;
      const title = properties?.title ?? `Sheet${this.sheets.size + 1}`;
      if (this.sheets.has(title)) {
        throw new StubHttpError(400, {
          error: { code: 400, status: "INVALID_ARGUMENT", message: `A sheet with the name "${title}" already exists.` },
        });
      }
      const sheet = this.addSheet(title, properties?.gridProperties?.columnCount ?? 26, properties?.gridProperties?.frozenRowCount ?? 0);
      return { addSheet: { properties: { sheetId: sheet.sheetId, title: sheet.title, index: sheet.index } } };
    }

    if ("deleteDimension" in request) {
      const range = (request.deleteDimension as { range: { sheetId: number; dimension: string; startIndex: number; endIndex: number } }).range;
      const sheet = [...this.sheets.values()].find((item) => item.sheetId === range.sheetId);
      if (!sheet) throw new StubHttpError(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "No sheet with that id." } });
      if (range.dimension !== "ROWS") throw new Error("google-stub: only ROWS deletion is modelled");
      sheet.rows.splice(range.startIndex, range.endIndex - range.startIndex);
      return {};
    }

    if ("updateSheetProperties" in request) {
      const update = request.updateSheetProperties as {
        properties: { sheetId: number; gridProperties?: { columnCount?: number; frozenRowCount?: number } };
      };
      const sheet = [...this.sheets.values()].find((item) => item.sheetId === update.properties.sheetId);
      if (sheet) {
        if (update.properties.gridProperties?.columnCount !== undefined) sheet.columnCount = update.properties.gridProperties.columnCount;
        if (update.properties.gridProperties?.frozenRowCount !== undefined) sheet.frozenRowCount = update.properties.gridProperties.frozenRowCount;
      }
      return {};
    }

    // Formatting has no observable effect on stored values.
    if ("repeatCell" in request) return {};

    throw new Error(`google-stub: unhandled structural request ${Object.keys(request).join(",")}`);
  }

  // ── Drive ──────────────────────────────────────────────────────────────────

  private async handleUploadStart(url: string, init: RequestInit): Promise<Response> {
    const metadata = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const sessionId = randomUUID();
    this.uploadSessions.set(sessionId, { metadata });
    const response = new Response(null, { status: 200 });
    response.headers.set("location", `https://stub.upload/${sessionId}`);
    return response;
  }

  private async handleUploadBytes(url: string, init: RequestInit): Promise<Response> {
    const sessionId = url.slice("https://stub.upload/".length);
    const session = this.uploadSessions.get(sessionId);
    if (!session) throw new StubHttpError(404, { error: { code: 404, status: "NOT_FOUND", message: "Upload session not found." } });
    this.uploadSessions.delete(sessionId);

    const metadata = session.metadata;
    const content = await toBuffer(init.body);
    const file = this.createFile({
      name: String(metadata.name ?? "file"),
      mimeType: String(metadata.mimeType ?? "application/octet-stream"),
      parents: (metadata.parents as string[]) ?? [],
      appProperties: (metadata.appProperties as Record<string, string>) ?? {},
      description: String(metadata.description ?? ""),
      content,
    });
    return json(this.toFileResource(file));
  }

  private createFile(input: {
    name: string;
    mimeType: string;
    parents: string[];
    appProperties: Record<string, string>;
    description: string;
    content: Buffer | null;
  }): DriveEntry {
    const now = new Date().toISOString();
    const file: DriveEntry = {
      id: `file-${randomUUID()}`,
      name: input.name,
      mimeType: input.mimeType,
      parents: input.parents,
      appProperties: input.appProperties,
      description: input.description,
      createdTime: now,
      modifiedTime: now,
      trashed: false,
      content: input.content,
    };
    this.files.set(file.id, file);
    return file;
  }

  private toFileResource(file: DriveEntry): Record<string, unknown> {
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      ...(file.content ? { size: String(file.content.byteLength) } : {}),
      createdTime: file.createdTime,
      modifiedTime: file.modifiedTime,
      parents: file.parents,
      appProperties: file.appProperties,
      trashed: file.trashed,
      capabilities: { canAddChildren: file.mimeType === FOLDER_MIME },
    };
  }

  private async handleDrive(url: string, method: string, init: RequestInit): Promise<Response> {
    const parsed = new URL(url);
    const rest = parsed.pathname.slice("/drive/v3/files".length);
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    // files.list
    if (rest === "" && method === "GET") {
      const query = parsed.searchParams.get("q") ?? "";
      const matched = [...this.files.values()].filter((file) => matchesDriveQuery(file, query));
      matched.sort((a, b) => (a.createdTime < b.createdTime ? 1 : -1));
      return json({ files: matched.map((file) => this.toFileResource(file)) });
    }

    // files.create (folders)
    if (rest === "" && method === "POST") {
      const file = this.createFile({
        name: String(body.name ?? "untitled"),
        mimeType: String(body.mimeType ?? "application/octet-stream"),
        parents: (body.parents as string[]) ?? [],
        appProperties: (body.appProperties as Record<string, string>) ?? {},
        description: String(body.description ?? ""),
        content: null,
      });
      return json(this.toFileResource(file));
    }

    const copyMatch = /^\/([^/]+)\/copy$/.exec(rest);
    if (copyMatch && method === "POST") {
      const source = this.files.get(decodeURIComponent(copyMatch[1]));
      if (!source || source.trashed) throw new StubHttpError(404, { error: { code: 404, status: "NOT_FOUND", message: "File not found." } });
      const copy = this.createFile({
        name: String(body.name ?? source.name),
        mimeType: source.mimeType,
        parents: (body.parents as string[]) ?? source.parents,
        appProperties: (body.appProperties as Record<string, string>) ?? {},
        description: String(body.description ?? ""),
        content: source.content ? Buffer.from(source.content) : null,
      });
      return json(this.toFileResource(copy));
    }

    const idMatch = /^\/([^/]+)$/.exec(rest);
    if (!idMatch) throw new Error(`google-stub: unhandled Drive request ${method} ${rest}`);
    const fileId = decodeURIComponent(idMatch[1]);
    const file = this.files.get(fileId);

    if (method === "GET") {
      if (!file || file.trashed) throw new StubHttpError(404, { error: { code: 404, status: "NOT_FOUND", message: "File not found." } });
      if (parsed.searchParams.get("alt") === "media") {
        const content = file.content ?? Buffer.alloc(0);
        const response = new Response(new Uint8Array(content), { status: 200 });
        response.headers.set("content-type", file.mimeType);
        response.headers.set("content-length", String(content.byteLength));
        return response;
      }
      return json(this.toFileResource(file));
    }

    if (method === "PATCH") {
      if (!file || file.trashed) throw new StubHttpError(404, { error: { code: 404, status: "NOT_FOUND", message: "File not found." } });
      if (body.name !== undefined) file.name = String(body.name);
      if (body.appProperties !== undefined) file.appProperties = body.appProperties as Record<string, string>;
      if (body.description !== undefined) file.description = String(body.description);
      const add = (parsed.searchParams.get("addParents") ?? "").split(",").filter(Boolean);
      const remove = new Set((parsed.searchParams.get("removeParents") ?? "").split(",").filter(Boolean));
      file.parents = [...new Set([...file.parents.filter((parent) => !remove.has(parent)), ...add])];
      file.modifiedTime = new Date().toISOString();
      return json(this.toFileResource(file));
    }

    if (method === "DELETE") {
      // Drive's files.delete is a permanent delete, not a move to the bin.
      if (!file) throw new StubHttpError(404, { error: { code: 404, status: "NOT_FOUND", message: "File not found." } });
      this.files.delete(fileId);
      return new Response(null, { status: 204 });
    }

    throw new Error(`google-stub: unhandled Drive request ${method} ${rest}`);
  }
}

// ── Drive query matching ─────────────────────────────────────────────────────

// Handles the clause forms src/lib/google/drive.ts builds: "<id>' in parents",
// "trashed = false", "name = '...'" and "mimeType = '...'", joined with " and ".
export function matchesDriveQuery(file: DriveEntry, query: string): boolean {
  if (!query) return !file.trashed;
  for (const clause of splitClauses(query)) {
    const parents = /^'((?:[^'\\]|\\.)*)'\s+in\s+parents$/.exec(clause);
    if (parents) {
      if (!file.parents.includes(unescapeValue(parents[1]))) return false;
      continue;
    }
    const trashed = /^trashed\s*=\s*(true|false)$/.exec(clause);
    if (trashed) {
      if (file.trashed !== (trashed[1] === "true")) return false;
      continue;
    }
    const equality = /^(name|mimeType)\s*=\s*'((?:[^'\\]|\\.)*)'$/.exec(clause);
    if (equality) {
      const value = unescapeValue(equality[2]);
      if ((equality[1] === "name" ? file.name : file.mimeType) !== value) return false;
      continue;
    }
    throw new Error(`google-stub: unsupported Drive query clause "${clause}"`);
  }
  return true;
}

function splitClauses(query: string): string[] {
  const clauses: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < query.length; i += 1) {
    const char = query[i];
    if (char === "\\" && quoted) {
      current += char + (query[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (char === "'") quoted = !quoted;
    if (!quoted && query.startsWith(" and ", i)) {
      clauses.push(current.trim());
      current = "";
      i += 4;
      continue;
    }
    current += char;
  }
  if (current.trim()) clauses.push(current.trim());
  return clauses;
}

function unescapeValue(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

// ── Plumbing ─────────────────────────────────────────────────────────────────

class StubHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super(`stub http ${status}`);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function toBuffer(body: BodyInit | null | undefined): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  return Buffer.from(await new Response(body).arrayBuffer());
}

// ── Installation ─────────────────────────────────────────────────────────────

// The caches the application keeps on globalThis: loaded spreadsheet tabs, the Drive subfolder
// ids it has resolved, and the OAuth access token. Cleared by GoogleStub.reset() and by
// installGoogleStub() so a suite never inherits state from an earlier one.
type CacheGlobals = {
  __synergySheetCache?: { tables: Map<unknown, unknown>; pending: Map<unknown, unknown> };
  __synergyDriveFolders?: Record<string, string | undefined>;
  __synergyGoogleAuth?: { token: unknown; pending: unknown; fingerprint: unknown };
  __synergySheetLocks?: Map<unknown, unknown>;
  __synergyAuditBuffer?: { queued: unknown[]; timer: ReturnType<typeof setTimeout> | null; flushing: unknown };
  __synergyRateLimiter?: { windows: Map<unknown, unknown>; lastSweepAt: number };
};

export function resetApplicationCaches(): void {
  const globals = globalThis as unknown as CacheGlobals;
  globals.__synergySheetCache?.tables.clear();
  globals.__synergySheetCache?.pending.clear();
  if (globals.__synergyDriveFolders) {
    for (const key of Object.keys(globals.__synergyDriveFolders)) delete globals.__synergyDriveFolders[key];
  }
  globals.__synergySheetLocks?.clear();
  if (globals.__synergyAuditBuffer) {
    if (globals.__synergyAuditBuffer.timer) clearTimeout(globals.__synergyAuditBuffer.timer);
    globals.__synergyAuditBuffer.queued = [];
    globals.__synergyAuditBuffer.timer = null;
  }
  globals.__synergyRateLimiter?.windows.clear();
}

const GOOGLE_HOSTS = /^https:\/\/(oauth2\.googleapis\.com|sheets\.googleapis\.com|www\.googleapis\.com|stub\.upload)\//;

export type InstalledStub = { stub: GoogleStub; restore: () => void };

// Replaces global fetch for Google hosts only; everything else (the app's own routes during an
// end-to-end run) still goes out normally.
export function installGoogleStub(options: GoogleStubOptions = {}): InstalledStub {
  const stub = new GoogleStub(options);
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!GOOGLE_HOSTS.test(url)) return original(input as RequestInfo, init);
    // A Request object carries its own method/body.
    if (typeof input !== "string" && !(input instanceof URL)) {
      const request = input as Request;
      return stub.handle(url, { method: request.method, body: Buffer.from(await request.arrayBuffer()) });
    }
    return stub.handle(url, init ?? {});
  }) as typeof fetch;

  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||= "stub@synergy-test.iam.gserviceaccount.com";
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||= stub.spreadsheetId;
  process.env.GOOGLE_DRIVE_FOLDER_ID ||= stub.rootFolderId;
  if (!process.env.GOOGLE_PRIVATE_KEY) process.env.GOOGLE_PRIVATE_KEY = testPrivateKey();

  return {
    stub,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

// A throwaway RSA key, generated in this process and never written anywhere. The application
// really does sign a JWT assertion with it (which is the point - the signing path is exercised
// rather than stubbed out); the stub's token endpoint then hands back a token without checking
// the signature, because verifying it would only be testing node:crypto against itself.
let cachedTestKey: string | null = null;

export function testPrivateKey(): string {
  if (cachedTestKey) return cachedTestKey;
  // 2048 bits: large enough to be a realistic signing cost, small enough not to slow the suite.
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  cachedTestKey = privateKey;
  return cachedTestKey;
}
