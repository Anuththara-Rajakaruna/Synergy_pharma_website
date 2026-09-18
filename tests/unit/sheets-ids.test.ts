import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applicationReference, idTimestamp, isObjectIdString, isRecordId, newId, talentReference } from "@/lib/careers/server/ids";

// Record ids keep MongoDB's ObjectId shape on purpose: 24 lower-case hex characters with a
// 4-byte big-endian seconds timestamp at the front. Route parameters, saved bookmarks and the
// candidate-facing reference (APP-7F3A9C21) all depend on it, so the shape is part of the
// public contract and is asserted here rather than assumed.

const HEX24 = /^[a-f0-9]{24}$/;

describe("newId", () => {
  it("produces 24 lower-case hex characters", () => {
    for (let i = 0; i < 50; i += 1) {
      const id = newId();
      assert.match(id, HEX24, id);
      assert.equal(id.length, 24);
      assert.equal(id, id.toLowerCase());
    }
  });

  it("encodes the creation time in the first four bytes", () => {
    const at = new Date("2026-09-18T07:15:30.500Z");
    const id = newId(at);
    const seconds = Number.parseInt(id.slice(0, 8), 16);
    assert.equal(seconds, Math.floor(at.getTime() / 1000));
    // The sub-second part is dropped, so the encoded time is the start of that second.
    assert.equal(idTimestamp(id)?.toISOString(), "2026-09-18T07:15:30.000Z");
    assert.equal(newId(new Date(0)).slice(0, 8), "00000000");
  });

  it("sorts by creation time, which is what keeps rows written in the same second ordered", () => {
    const times = [
      new Date("2025-01-01T00:00:00.000Z"),
      new Date("2025-06-30T12:00:00.000Z"),
      new Date("2026-09-18T07:15:30.000Z"),
      new Date("2027-01-01T00:00:00.000Z"),
    ];
    const ids = times.map((at) => newId(at));
    assert.deepEqual([...ids].sort(), ids, ids.join(" "));
    assert.ok(ids[0] < ids[1] && ids[1] < ids[2] && ids[2] < ids[3]);
  });

  it("is unique across a burst within the same second", () => {
    const at = new Date("2026-09-18T07:15:30.000Z");
    const ids = new Set(Array.from({ length: 2000 }, () => newId(at)));
    assert.equal(ids.size, 2000);
    // Every id in the burst shares the timestamp prefix; only the random part differs.
    const prefixes = new Set([...ids].map((id) => id.slice(0, 8)));
    assert.equal(prefixes.size, 1);
  });
});

describe("isRecordId", () => {
  it("accepts a freshly minted id", () => {
    assert.equal(isRecordId(newId()), true);
    assert.equal(isRecordId("66e9a1b2c3d4e5f601234567"), true);
    assert.equal(isRecordId("000000000000000000000000"), true);
  });

  it("rejects anything that is not exactly 24 lower-case hex characters", () => {
    const rejected: unknown[] = [
      "",
      " ",
      "66e9a1b2c3d4e5f60123456", // 23
      "66e9a1b2c3d4e5f6012345678", // 25
      "66E9A1B2C3D4E5F601234567", // upper case
      "66e9a1b2c3d4e5f60123456g", // not hex
      " 66e9a1b2c3d4e5f601234567",
      "66e9a1b2c3d4e5f601234567 ",
      "66e9a1b2-c3d4-e5f6-0123-4567",
      "../../etc/passwd",
      "not-an-id",
      null,
      undefined,
      42,
      true,
      {},
      [],
      ["66e9a1b2c3d4e5f601234567"],
    ];
    for (const value of rejected) {
      assert.equal(isRecordId(value), false, JSON.stringify(value ?? null));
    }
  });

  it("is also exported under its previous name", () => {
    assert.equal(isObjectIdString, isRecordId);
  });
});

describe("idTimestamp", () => {
  it("returns the encoded creation time", () => {
    const at = new Date("2026-02-28T09:30:00.000Z");
    assert.deepEqual(idTimestamp(newId(at)), at);
  });

  it("returns null for anything that is not an id", () => {
    for (const value of ["", "not-an-id", "66E9A1B2C3D4E5F601234567", "66e9a1b2c3d4e5f60123456"]) {
      assert.equal(idTimestamp(value), null, value);
    }
  });
});

describe("references", () => {
  it("derives the candidate-facing reference from the last eight characters of the id", () => {
    const id = "66e9a1b2c3d4e5f67f3a9c21";
    assert.equal(applicationReference(id), "APP-7F3A9C21");
    assert.equal(talentReference(id), "TP-7F3A9C21");
    assert.match(applicationReference(newId()), /^APP-[0-9A-F]{8}$/);
    assert.match(talentReference(newId()), /^TP-[0-9A-F]{8}$/);
  });

  it("is stable for the same id and different for different ids", () => {
    const id = newId();
    assert.equal(applicationReference(id), applicationReference(id));
    assert.notEqual(applicationReference(id), applicationReference(newId()));
    // The two record kinds are told apart by their prefix, never by the suffix.
    assert.equal(applicationReference(id).slice(4), talentReference(id).slice(3));
  });
});
