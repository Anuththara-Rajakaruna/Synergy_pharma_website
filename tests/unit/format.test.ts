import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deadlineLabel, formatDate, formatFileSize, formatRelativeDays } from "@/lib/careers/format";

const DAY = 24 * 60 * 60 * 1000;

describe("formatDate", () => {
  it("formats dates in Sri Lanka time with a fixed month table", () => {
    assert.equal(formatDate("2026-09-17T08:35:00.000Z"), "17 Sept 2026");
    assert.equal(formatDate("2026-06-01T00:00:00.000Z"), "1 Jun 2026");
    assert.equal(formatDate("2026-03-05T12:00:00.000Z"), "5 Mar 2026");
  });

  it("includes a 24-hour time when requested", () => {
    assert.equal(formatDate("2026-09-17T08:35:00.000Z", { withTime: true }), "17 Sept 2026, 14:05");
    assert.equal(formatDate("2026-09-16T18:30:00.000Z", { withTime: true }), "17 Sept 2026, 00:00");
    assert.equal(formatDate("2026-09-17T18:29:00.000Z", { withTime: true }), "17 Sept 2026, 23:59");
  });

  it("uses the Colombo calendar day around midnight and year boundaries", () => {
    assert.equal(formatDate("2026-12-31T18:29:59.999Z"), "31 Dec 2026");
    assert.equal(formatDate("2026-12-31T18:30:00.000Z"), "1 Jan 2027");
  });

  it("returns an em dash for missing or invalid values", () => {
    assert.equal(formatDate(null), "—");
    assert.equal(formatDate(""), "—");
    assert.equal(formatDate("not a date"), "—");
  });
});

describe("formatRelativeDays", () => {
  const now = new Date("2026-09-17T06:00:00.000Z"); // 11:30 in Colombo

  it("describes recent days by Colombo calendar day", () => {
    assert.equal(formatRelativeDays("2026-09-16T18:30:00.000Z", now), "Today");
    assert.equal(formatRelativeDays("2026-09-16T18:29:59.000Z", now), "Yesterday");
    assert.equal(formatRelativeDays("2026-09-14T06:00:00.000Z", now), "3 days ago");
    assert.equal(formatRelativeDays("2026-09-11T06:00:00.000Z", now), "6 days ago");
  });

  it("switches to weeks from 7 days and to a date from 35 days", () => {
    assert.equal(formatRelativeDays("2026-09-10T06:00:00.000Z", now), "1 week ago");
    assert.equal(formatRelativeDays("2026-08-27T06:00:00.000Z", now), "3 weeks ago");
    assert.equal(formatRelativeDays(new Date(now.getTime() - 34 * DAY).toISOString(), now), "4 weeks ago");
    assert.equal(formatRelativeDays(new Date(now.getTime() - 35 * DAY).toISOString(), now), "13 Aug 2026");
  });

  it("falls back to the date for future values and an em dash for invalid ones", () => {
    assert.equal(formatRelativeDays("2026-09-20T06:00:00.000Z", now), "20 Sept 2026");
    assert.equal(formatRelativeDays("nonsense", now), "—");
  });
});

describe("formatFileSize", () => {
  it("uses B, KB, MB and GB with one decimal below 10", () => {
    assert.equal(formatFileSize(0), "0 B");
    assert.equal(formatFileSize(532), "532 B");
    assert.equal(formatFileSize(1023), "1023 B");
    assert.equal(formatFileSize(1024), "1 KB");
    assert.equal(formatFileSize(1536), "1.5 KB");
    assert.equal(formatFileSize(84 * 1024), "84 KB");
    assert.equal(formatFileSize(1.2 * 1024 * 1024), "1.2 MB");
    assert.equal(formatFileSize(10 * 1024 * 1024), "10 MB");
    assert.equal(formatFileSize(3 * 1024 * 1024 * 1024), "3 GB");
  });

  it("returns an em dash for null, negative and non-finite sizes", () => {
    assert.equal(formatFileSize(null), "—");
    assert.equal(formatFileSize(-1), "—");
    assert.equal(formatFileSize(Number.NaN), "—");
    assert.equal(formatFileSize(Number.POSITIVE_INFINITY), "—");
  });
});

describe("deadlineLabel", () => {
  const now = new Date("2026-09-17T06:00:00.000Z");

  it("returns null without a deadline", () => {
    assert.equal(deadlineLabel(null, now), null);
    assert.equal(deadlineLabel("invalid", now), null);
  });

  it("labels future deadlines and marks them urgent under 7 days", () => {
    assert.deepEqual(deadlineLabel("2026-09-30T18:29:59.999Z", now), { text: "Apply by 30 Sept 2026", urgent: false });
    assert.deepEqual(deadlineLabel("2026-09-20T18:29:59.999Z", now), { text: "Apply by 20 Sept 2026", urgent: true });
    assert.deepEqual(deadlineLabel(new Date(now.getTime() + 7 * DAY).toISOString(), now), { text: "Apply by 24 Sept 2026", urgent: false });
    assert.equal(deadlineLabel(new Date(now.getTime() + 7 * DAY - 1).toISOString(), now)?.urgent, true);
  });

  it("reports passed deadlines as urgent for admin views", () => {
    assert.deepEqual(deadlineLabel("2026-09-01T18:29:59.999Z", now), { text: "Deadline passed 1 Sept 2026", urgent: true });
  });
});
