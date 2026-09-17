// Display formatting shared by server components and client components. Pure functions only.
//
// Dates are shown in Sri Lanka time. Month names come from a fixed table instead of
// Intl's "short" month so the server (Node ICU) and every browser render identical text,
// which keeps hydration stable ("Sep" vs "Sept" differs between ICU versions).

import { CAREERS_TIME_ZONE } from "@/lib/careers/constants";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
const DAY_MS = 24 * 60 * 60 * 1000;
const EMPTY = "—";

type DateParts = { year: number; month: number; day: number; hour: number; minute: number };

let partsFormatter: Intl.DateTimeFormat | null = null;

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function colomboParts(date: Date): DateParts {
  partsFormatter ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: CAREERS_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });
  const parts: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number.parseInt(part.value, 10);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    // Some engines still report midnight as 24 even with hourCycle h23.
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
  };
}

// Days since the epoch for the calendar date as seen in Sri Lanka.
function colomboDayNumber(date: Date): number {
  const { year, month, day } = colomboParts(date);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

// "17 Sept 2026" or, with time, "17 Sept 2026, 14:05". Missing or invalid values → "—".
export function formatDate(iso: string | null, opts: { withTime?: boolean } = {}): string {
  const date = toDate(iso);
  if (!date) return EMPTY;
  const { year, month, day, hour, minute } = colomboParts(date);
  const text = `${day} ${MONTHS[month - 1]} ${year}`;
  if (!opts.withTime) return text;
  return `${text}, ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// "Today", "Yesterday", "3 days ago", "2 weeks ago"; older (or future) dates fall back to formatDate.
export function formatRelativeDays(iso: string, now: Date = new Date()): string {
  const date = toDate(iso);
  if (!date) return EMPTY;
  const days = colomboDayNumber(now) - colomboDayNumber(date);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return `${days} days ago`;
  if (days >= 7 && days < 35) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  return formatDate(iso);
}

// "532 B", "84 KB", "1.2 MB". Missing or invalid sizes → "—".
export function formatFileSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return EMPTY;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${units[unit]}`;
}

const URGENT_WITHIN_MS = 7 * DAY_MS;

// "Apply by 30 Sept 2026", marked urgent when fewer than 7 days remain. Null when there is no
// deadline. A deadline that has already passed is reported (urgent) for admin views; public
// pages never list such jobs.
export function deadlineLabel(iso: string | null, now: Date = new Date()): { text: string; urgent: boolean } | null {
  const deadline = toDate(iso);
  if (!deadline) return null;
  const remaining = deadline.getTime() - now.getTime();
  const date = formatDate(iso);
  if (remaining < 0) return { text: `Deadline passed ${date}`, urgent: true };
  return { text: `Apply by ${date}`, urgent: remaining < URGENT_WITHIN_MS };
}
