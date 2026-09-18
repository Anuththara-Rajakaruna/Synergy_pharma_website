// The storage primitives underneath the careers services: schema bootstrap, row addressing,
// partial updates, duplicate reconciliation, row deletion, and the Drive client.
//
// full-workflow.test.ts proves the portal works; this file proves the layer it stands on behaves
// the way the services assume - particularly the parts that replace something MongoDB used to do
// for free (unique indexes, stable row identity, TTL deletion).

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { installGoogleStub, type GoogleStub } from "../support/google-stub";

const installed = installGoogleStub();
const stub: GoogleStub = installed.stub;

type Store = typeof import("@/lib/sheets-db/table");
type Bootstrap = typeof import("@/lib/sheets-db/bootstrap");
type Drive = typeof import("@/lib/google/drive");
type Settings = typeof import("@/lib/sheets-db/repositories/settings");

let store: Store;
let bootstrap: Bootstrap;
let drive: Drive;
let settings: Settings;
let newId: (at?: Date) => string;

before(async () => {
  [store, bootstrap, drive, settings] = await Promise.all([
    import("@/lib/sheets-db/table"),
    import("@/lib/sheets-db/bootstrap"),
    import("@/lib/google/drive"),
    import("@/lib/sheets-db/repositories/settings"),
  ]);
  ({ newId } = await import("@/lib/careers/server/ids"));
});

beforeEach(async () => {
  stub.reset();
  await bootstrap.ensureSchema();
});

describe("schema bootstrap", () => {
  it("creates every tab with a frozen header row, and is safe to re-run", async () => {
    assert.ok(stub.sheetTitles().includes("Applications"));
    assert.equal(stub.sheetTitles().filter((t) => t !== "Sheet1").length, 12, "all twelve tabs");

    const report = await bootstrap.inspectSchema();
    assert.deepEqual(
      report.problems.filter((p) => p.level === "error"),
      [],
      "a freshly created spreadsheet reports no errors"
    );

    const second = await bootstrap.ensureSchema();
    assert.equal(second.createdTables.length, 0, "re-running creates nothing");
    assert.equal(second.repairedTables.length, 0, "and repairs nothing");
  });

  it("adds a column a later release introduced without disturbing existing data", async () => {
    const id = newId();
    await store.appendRecord("Jobs", { id, slug: "alpha", title: "Alpha" });

    // Simulate a spreadsheet created by an older release: drop the last column from the header.
    const { getValues, updateValues, a1Range, quoteTitle, columnLetter } = await import("@/lib/google/sheets");
    const header = (await getValues(a1Range("Jobs", { firstRow: 1, lastRow: 1 })))[0] ?? [];
    const shortened = header.slice(0, -1);
    await updateValues(`${quoteTitle("Jobs")}!A1:${columnLetter(header.length - 1)}1`, [[...shortened, ""]]);
    store.invalidateTable();

    const repaired = await bootstrap.ensureSchema();
    assert.ok(repaired.repairedTables.includes("Jobs"), "the missing column is reported as repaired");

    const rows = stub.rowsOf("Jobs");
    assert.equal(rows.length, 1, "the existing row survived");
    assert.equal(rows[0].slug, "alpha", "and its values are unmoved");
  });
});

describe("row addressing", () => {
  it("assigns row numbers on append and reads them back", async () => {
    const first = await store.appendRecord("Jobs", { id: newId(), slug: "alpha" });
    const second = await store.appendRecord("Jobs", { id: newId(), slug: "beta" });
    assert.equal(first.rowNumber, 2, "row 1 is the header");
    assert.equal(second.rowNumber, 3);

    const found = await store.findById("Jobs", String(second.values.id));
    assert.equal(found?.values.slug, "beta");
  });

  it("writes only the columns named in a patch, including non-adjacent ones", async () => {
    const id = newId();
    await store.appendRecord("Jobs", { id, slug: "alpha", title: "Alpha", department: "QC", status: "draft" });

    // `title` and `updatedAt` sit at opposite ends of the row.
    await store.updateRecord("Jobs", id, { title: "Alpha renamed", updatedAt: "2026-01-01T00:00:00.000Z" });

    const row = stub.rowsOf("Jobs")[0];
    assert.equal(row.title, "Alpha renamed");
    assert.equal(row.updatedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(row.slug, "alpha", "untouched columns are preserved");
    assert.equal(row.department, "QC");
    assert.equal(row.status, "draft");
  });

  it("ignores blank rows left behind by a hand edit", async () => {
    await store.appendRecord("Jobs", { id: newId(), slug: "alpha" });
    const { updateValues, quoteTitle } = await import("@/lib/google/sheets");
    await updateValues(`${quoteTitle("Jobs")}!A5:B5`, [["", ""]]);
    store.invalidateTable();

    const table = await store.loadTable("Jobs", { maxAgeMs: 0 });
    assert.equal(table.records.length, 1, "an empty row is not a record");
  });
});

describe("uniqueness without a unique index", () => {
  it("lets the earliest row win and reports every later one as a duplicate", async () => {
    const key = (values: Record<string, unknown>) => `${String(values.jobId)}:${String(values.emailNormalized)}`;
    const first = await store.appendRecord("Applications", { id: newId(), jobId: "J1", emailNormalized: "a@example.com" });
    const second = await store.appendRecord("Applications", { id: newId(), jobId: "J1", emailNormalized: "a@example.com" });
    const other = await store.appendRecord("Applications", { id: newId(), jobId: "J1", emailNormalized: "b@example.com" });

    assert.equal((await store.reconcileDuplicate("Applications", first, key)).isDuplicate, false);
    assert.equal((await store.reconcileDuplicate("Applications", other, key)).isDuplicate, false, "a different key is not a duplicate");

    const verdict = await store.reconcileDuplicate("Applications", second, key);
    assert.equal(verdict.isDuplicate, true);
    assert.equal(verdict.winner.rowNumber, first.rowNumber, "the row written first wins");
  });

  it("does not count an already-superseded row as the winner", async () => {
    const key = (values: Record<string, unknown>) => String(values.emailNormalized || "") || null;
    const loser = await store.appendRecord("TalentPool", { id: newId(), emailNormalized: "a@example.com" });
    await store.updateRecord("TalentPool", String(loser.values.id), { supersededBy: "someone-else" });
    const fresh = await store.appendRecord("TalentPool", { id: newId(), emailNormalized: "a@example.com" });

    const verdict = await store.reconcileDuplicate("TalentPool", fresh, key);
    assert.equal(verdict.isDuplicate, false, "a superseded row does not block a new one");
  });
});

describe("deletion", () => {
  it("shifts rows up and drops the cache so nothing addresses a stale row number", async () => {
    for (const body of ["n1", "n2", "n3"]) {
      await store.appendRecord("Notes", { id: newId(), ownerType: "application", ownerId: "X", body });
    }
    const before = await store.loadTable("Notes", { maxAgeMs: 0 });
    assert.equal(before.records.length, 3);

    assert.equal(await bootstrap.deleteRows("Notes", [before.records[0].rowNumber]), 1);

    const after = await store.loadTable("Notes", { maxAgeMs: 0 });
    assert.equal(after.records.length, 2);
    assert.equal(after.records[0].values.body, "n2");
    assert.equal(after.records[0].rowNumber, 2, "the surviving rows moved up");
  });

  it("never deletes the header row", async () => {
    await store.appendRecord("Notes", { id: newId(), ownerType: "application", ownerId: "X", body: "n1" });
    assert.equal(await bootstrap.deleteRows("Notes", [1]), 0, "row 1 is refused");
    const table = await store.loadTable("Notes", { maxAgeMs: 0 });
    assert.ok(table.index.has("body"), "the header survived");
  });

  it("collapses consecutive deletions into one request", async () => {
    for (let i = 0; i < 6; i += 1) {
      await store.appendRecord("Notes", { id: newId(), ownerType: "application", ownerId: "X", body: `n${i}` });
    }
    const table = await store.loadTable("Notes", { maxAgeMs: 0 });
    const rows = table.records.slice(1, 5).map((r) => r.rowNumber);

    const before = stub.requests.filter((r) => r.url.includes(":batchUpdate")).length;
    assert.equal(await bootstrap.deleteRows("Notes", rows), 4);
    const after = stub.requests.filter((r) => r.url.includes(":batchUpdate")).length;
    assert.equal(after - before, 1, "four adjacent rows cost one API call");

    const remaining = await store.loadTable("Notes", { maxAgeMs: 0 });
    assert.deepEqual(remaining.records.map((r) => r.values.body), ["n0", "n5"]);
  });
});

describe("settings", () => {
  it("updates a key in place rather than appending a second row", async () => {
    assert.equal(await settings.getSetting("schema.version"), "2");
    await settings.setSetting("test.key", "one");
    await settings.setSetting("test.key", "two");
    assert.equal(await settings.getSetting("test.key"), "two");
    assert.equal(stub.rowsOf("Settings").filter((r) => r.key === "test.key").length, 1);
  });
});

describe("the Drive client", () => {
  it("uploads, finds by name, moves between folders, downloads and deletes permanently", async () => {
    const staging = await drive.ensureFolder(stub.rootFolderId, "_staging");
    const permanent = await drive.ensureFolder(stub.rootFolderId, "Applications");
    assert.notEqual(staging, permanent);
    assert.equal(await drive.ensureFolder(stub.rootFolderId, "_staging"), staging, "ensureFolder is idempotent");

    const pdf = Buffer.from("%PDF-1.7\nbody\n%%EOF\n", "latin1");
    const uploaded = await drive.uploadFile({
      name: "upload-1.pdf",
      parentId: staging,
      mimeType: "application/pdf",
      body: pdf,
      appProperties: { uploadId: "upload-1", kind: "cv" },
    });
    assert.equal(uploaded.size, String(pdf.byteLength));

    assert.equal((await drive.findFileByName(staging, "upload-1.pdf"))?.id, uploaded.id);
    assert.equal(await drive.findFileByName(permanent, "upload-1.pdf"), null, "scoped to the folder");

    const moved = await drive.updateFile(uploaded.id, {
      name: "APP-ABC - Jane Doe - CV.pdf",
      addParents: [permanent],
      removeParents: [staging],
    });
    assert.deepEqual(moved.parents, [permanent]);
    assert.equal(await drive.findFileByName(staging, "upload-1.pdf"), null, "no longer claimable from staging");

    const downloaded = await drive.downloadFileBuffer(uploaded.id);
    assert.ok(downloaded?.equals(pdf), "the bytes round-trip unchanged");

    await drive.deleteFile(uploaded.id);
    assert.equal(await drive.getFile(uploaded.id), null, "deleted outright, not moved to the bin");
  });

  it("escapes a file name that would otherwise break the Drive query", async () => {
    const folder = await drive.ensureFolder(stub.rootFolderId, "Applications");
    const awkward = "O'Brien's CV.pdf";
    await drive.uploadFile({ name: awkward, parentId: folder, mimeType: "application/pdf", body: Buffer.from("%PDF-\n%%EOF"), appProperties: {} });
    assert.ok(await drive.findFileByName(folder, awkward), "an apostrophe in the name is handled");
  });
});

describe("Google API failures", () => {
  it("retries a transient failure and gives up on a permanent one", async () => {
    await store.appendRecord("Jobs", { id: newId(), slug: "alpha" });

    store.invalidateTable();
    stub.failures = [{ match: /values:batchGet/, status: 503, times: 1 }];
    assert.equal((await store.loadTable("Jobs", { maxAgeMs: 0 })).records.length, 1, "one 503 is absorbed");
    stub.failures = [];

    store.invalidateTable();
    stub.failures = [{ match: /values:batchGet/, status: 403, body: { error: { code: 403, status: "PERMISSION_DENIED" } } }];
    await assert.rejects(() => store.loadTable("Jobs", { maxAgeMs: 0 }), (err: Error) => err.name === "GoogleConfigError");
    stub.failures = [];
  });

  it("names the storage-quota problem specifically, not as a generic permission error", async () => {
    const folder = await drive.ensureFolder(stub.rootFolderId, "Applications");
    stub.failures = [
      {
        match: /stub\.upload/,
        status: 403,
        body: { error: { code: 403, status: "PERMISSION_DENIED", errors: [{ reason: "storageQuotaExceeded" }] } },
      },
    ];
    await assert.rejects(
      () => drive.uploadFile({ name: "x.pdf", parentId: folder, mimeType: "application/pdf", body: Buffer.from("%PDF-\n%%EOF"), appProperties: {} }),
      (err: Error) => err.name === "GoogleConfigError" && /Shared Drive|storage quota/i.test(err.message)
    );
    stub.failures = [];
  });
});
