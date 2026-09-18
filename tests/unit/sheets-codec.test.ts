import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_CELL_LENGTH,
  decodeBoolean,
  decodeDate,
  decodeDateOr,
  decodeEnum,
  decodeEnumOrNull,
  decodeInteger,
  decodeJson,
  decodeMultiline,
  decodeNumber,
  decodeStringList,
  decodeText,
  decodeTextOrNull,
  encodeBoolean,
  encodeDate,
  encodeJson,
  encodeNumber,
  encodeText,
} from "@/lib/sheets-db/codec";

// The spreadsheet is a document HR can open and edit by hand, so the rules under test are:
//   * a value written and read back is the value that went in (round trip), and
//   * a decoder never throws, whatever a human typed into the cell.

const LF = String.fromCharCode(10);

describe("codec round trips", () => {
  it("round-trips text, including leading formula characters and newlines", () => {
    for (const value of ["Nimal Perera", "=SUM(A1:A2)", "+94 77 123 4567", "0771234567", "  padded  ", "Ω ශ්‍රී 🇱🇰"]) {
      assert.equal(decodeMultiline(encodeText(value)), value, value);
    }
    const multiline = `Dear hiring team,${LF}${LF}I would like to apply.`;
    assert.equal(decodeMultiline(encodeText(multiline)), multiline);
  });

  it("round-trips dates as ISO strings", () => {
    const now = new Date("2026-02-28T09:30:15.123Z");
    assert.equal(encodeDate(now), "2026-02-28T09:30:15.123Z");
    assert.deepEqual(decodeDate(encodeDate(now)), now);
    assert.equal(encodeDate(null), "");
    assert.equal(encodeDate(undefined), "");
    assert.equal(encodeDate(new Date("not a date")), "", "an invalid date is stored as an empty cell");
    assert.equal(decodeDate(encodeDate(null)), null);
  });

  it("round-trips booleans", () => {
    assert.equal(encodeBoolean(true), "TRUE");
    assert.equal(encodeBoolean(false), "FALSE");
    assert.equal(encodeBoolean(null), "FALSE");
    assert.equal(decodeBoolean(encodeBoolean(true)), true);
    assert.equal(decodeBoolean(encodeBoolean(false)), false);
  });

  it("round-trips numbers", () => {
    assert.equal(encodeNumber(4096), 4096);
    assert.equal(encodeNumber(0), 0);
    assert.equal(encodeNumber(null), "");
    assert.equal(encodeNumber(Number.NaN), "");
    assert.equal(encodeNumber(Number.POSITIVE_INFINITY), "");
    assert.equal(decodeNumber(encodeNumber(4096)), 4096);
    assert.equal(decodeNumber(encodeNumber(null)), null);
  });

  it("round-trips lists and nested objects as JSON in one cell", () => {
    const list = ["Review batch records", "Approve releases"];
    assert.equal(encodeJson(list), JSON.stringify(list));
    assert.deepEqual(decodeStringList(encodeJson(list)), list);
    assert.deepEqual(decodeJson<string[]>(encodeJson(list), []), list);

    const meta = { changedFields: ["title"], count: 2, nested: { ok: true } };
    assert.deepEqual(decodeJson<Record<string, unknown>>(encodeJson(meta), {}), meta);

    // An empty list is an empty cell, and reads back as an empty list.
    assert.equal(encodeJson([]), "");
    assert.deepEqual(decodeStringList(encodeJson([])), []);
    assert.equal(encodeJson(null), "");
    assert.equal(encodeJson(undefined), "");
  });
});

describe("encodeText", () => {
  it("turns null and undefined into an empty cell", () => {
    assert.equal(encodeText(null), "");
    assert.equal(encodeText(undefined), "");
    assert.equal(encodeText(""), "");
  });

  it("truncates to the given limit, and to the Sheets cell ceiling by default", () => {
    assert.equal(encodeText("abcdef", 3), "abc");
    assert.equal(encodeText("abc", 3), "abc");
    assert.equal(encodeText("x".repeat(MAX_CELL_LENGTH + 10)).length, MAX_CELL_LENGTH);
    assert.equal(MAX_CELL_LENGTH, 50_000, "Google Sheets rejects any cell longer than 50,000 characters");
  });
});

describe("encodeJson", () => {
  it("returns an empty cell rather than a broken value it could not serialise", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.equal(encodeJson(circular), "");
    assert.equal(encodeJson(Array.from({ length: 20_000 }, () => "a long tag value")), "", "a value too long for a cell is dropped");
  });
});

describe("decoders tolerate anything a human typed", () => {
  it("decodeText trims, decodeMultiline does not", () => {
    assert.equal(decodeText("  Colombo  "), "Colombo");
    assert.equal(decodeMultiline("  Colombo  "), "  Colombo  ");
    assert.equal(decodeText(undefined), "");
    assert.equal(decodeText(""), "");
    assert.equal(decodeText(42), "42", "a numeric cell becomes text");
    assert.equal(decodeText(true), "TRUE");
    assert.equal(decodeMultiline(undefined), "");
  });

  it("decodeTextOrNull treats an empty cell as absent", () => {
    assert.equal(decodeTextOrNull(""), null);
    assert.equal(decodeTextOrNull("   "), null);
    assert.equal(decodeTextOrNull(undefined), null);
    assert.equal(decodeTextOrNull("203.0.113.5"), "203.0.113.5");
  });

  it("decodeDate returns null for an empty or unparseable cell", () => {
    assert.equal(decodeDate(""), null);
    assert.equal(decodeDate(undefined), null);
    assert.equal(decodeDate("   "), null);
    assert.equal(decodeDate("not a date"), null);
    assert.equal(decodeDate("2026-02-28T09:30:15.123Z")?.toISOString(), "2026-02-28T09:30:15.123Z");
    // A date typed by hand in the sheet still parses.
    assert.equal(decodeDate("2026-02-28")?.toISOString(), "2026-02-28T00:00:00.000Z");
  });

  it("decodeDateOr falls back instead of producing an Invalid Date", () => {
    const fallback = new Date("2020-01-01T00:00:00.000Z");
    assert.deepEqual(decodeDateOr("", fallback), fallback);
    assert.deepEqual(decodeDateOr("rubbish", fallback), fallback);
    assert.deepEqual(decodeDateOr(undefined, fallback), fallback);
    assert.equal(decodeDateOr("2026-02-28T09:30:15.123Z", fallback).toISOString(), "2026-02-28T09:30:15.123Z");
  });

  it("decodeBoolean accepts checkboxes, numbers and hand-typed yes/no", () => {
    for (const value of [true, 1, "TRUE", "true", "True", "yes", "Y", "1", "x", "✓", " true "]) {
      assert.equal(decodeBoolean(value), true, JSON.stringify(value));
    }
    for (const value of [false, 0, "FALSE", "false", "no", "n", "", "   ", "maybe", undefined]) {
      assert.equal(decodeBoolean(value), false, JSON.stringify(value ?? null));
    }
  });

  it("decodeNumber and decodeInteger fall back on anything that is not a number", () => {
    assert.equal(decodeNumber(12), 12);
    assert.equal(decodeNumber("12"), 12);
    assert.equal(decodeNumber(" 12.5 "), 12.5);
    assert.equal(decodeNumber(""), null);
    assert.equal(decodeNumber("twelve"), null);
    assert.equal(decodeNumber("twelve", 7), 7);
    assert.equal(decodeNumber(undefined, 7), 7);

    assert.equal(decodeInteger("3", 0), 3);
    assert.equal(decodeInteger("3.9", 0), 3, "truncated, not rounded");
    assert.equal(decodeInteger("-3.9", 0), -3);
    assert.equal(decodeInteger("", 5), 5);
    assert.equal(decodeInteger("not a number", 5), 5);
  });

  it("decodeJson falls back on malformed JSON instead of throwing", () => {
    assert.deepEqual(decodeJson<string[]>("[\"a\", \"b\"]", []), ["a", "b"]);
    assert.deepEqual(decodeJson<string[]>("[broken", ["fallback"]), ["fallback"]);
    assert.deepEqual(decodeJson<string[]>("", ["fallback"]), ["fallback"]);
    assert.deepEqual(decodeJson<string[]>(undefined, []), []);
    assert.deepEqual(decodeJson<Record<string, unknown>>("null", { a: 1 }), { a: 1 }, "a literal null uses the fallback");
  });

  it("decodeStringList accepts a JSON array or a hand-typed separated list", () => {
    assert.deepEqual(decodeStringList("[\"gmp\",\"qa\"]"), ["gmp", "qa"]);
    assert.deepEqual(decodeStringList("gmp, qa"), ["gmp", "qa"]);
    assert.deepEqual(decodeStringList("gmp; qa"), ["gmp", "qa"]);
    assert.deepEqual(decodeStringList(`gmp${LF}qa`), ["gmp", "qa"]);
    assert.deepEqual(decodeStringList("gmp,, ,qa"), ["gmp", "qa"], "empty entries are dropped");
    assert.deepEqual(decodeStringList(""), []);
    assert.deepEqual(decodeStringList(undefined), []);
    assert.deepEqual(decodeStringList("[broken"), []);
    assert.deepEqual(decodeStringList("[1, 2, \"qa\"]"), ["qa"], "non-string members are dropped");
    assert.deepEqual(decodeStringList("[\"  spaced  \"]"), ["spaced"]);
  });

  it("decodeEnum restricts a cell to known values, case-insensitively", () => {
    const statuses = ["submitted", "under_review", "shortlisted"] as const;
    assert.equal(decodeEnum(" shortlisted ", statuses, "submitted"), "shortlisted");
    assert.equal(decodeEnum("SHORTLISTED", statuses, "submitted"), "shortlisted", "a hand-typed status is matched case-insensitively");
    assert.equal(decodeEnum("hired", statuses, "submitted"), "submitted", "an unknown value never escapes into an API response");
    assert.equal(decodeEnum("", statuses, "submitted"), "submitted");
    assert.equal(decodeEnum(undefined, statuses, "submitted"), "submitted");
  });

  it("decodeEnumOrNull distinguishes an empty cell from an unknown value", () => {
    const kinds = ["cv", "supporting"] as const;
    assert.equal(decodeEnumOrNull("cv", kinds), "cv");
    assert.equal(decodeEnumOrNull("CV", kinds), "cv");
    assert.equal(decodeEnumOrNull("", kinds), null);
    assert.equal(decodeEnumOrNull(undefined, kinds), null);
    assert.equal(decodeEnumOrNull("photo", kinds), null);
  });
});

describe("empty cells", () => {
  it("every decoder answers for an absent cell the way the record type expects", () => {
    assert.equal(decodeText(undefined), "");
    assert.equal(decodeMultiline(undefined), "");
    assert.equal(decodeTextOrNull(undefined), null);
    assert.equal(decodeDate(undefined), null);
    assert.equal(decodeBoolean(undefined), false);
    assert.equal(decodeNumber(undefined), null);
    assert.equal(decodeInteger(undefined, 0), 0);
    assert.deepEqual(decodeStringList(undefined), []);
    assert.deepEqual(decodeJson<Record<string, unknown>>(undefined, {}), {});
  });
});
