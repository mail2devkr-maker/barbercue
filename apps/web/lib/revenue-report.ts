import type { DailyServiceValueDto, RecordedPaymentDto, RecordedPaymentListDto } from "@barbercue/shared";

// Owner revenue report: date ranges, daily/weekly/monthly buckets and CSV export (requirements #1, #2, #4, #17).
//
// What is real here, and what is not:
//  - COLLECTED / REFUNDED come from the payments the shop recorded (GET .../payments). They are the only
//    figures that may be called revenue.
//  - ESTIMATED comes from completed services at their listed prices (GET .../analytics, "estimated service
//    value"). It is shown separately and is never added to collections.
//  - Everything is bucketed on the SHOP's calendar (its timezone), the same calendar the server uses for
//    the daily rows, so daily, weekly and monthly views always agree with each other.
// Customer-wise revenue, discounts and refunds per service need new server fields (see the contract issue);
// this module does not invent them.

export const MAX_REPORT_DAYS = 366;

export type Granularity = "day" | "week" | "month";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function toUtcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtcMs(toUtcMs(date) + days * 86_400_000);
}

/** Whole calendar days from `from` to `to`, inclusive (same day = 1). */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000) + 1;
}

/** The Monday on or before `date` (weeks start on Monday everywhere in this report). */
export function weekStart(date: string): string {
  const dow = new Date(toUtcMs(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** The instant at which `date` (YYYY-MM-DD) starts on the shop's wall clock. */
export function zonedDayStart(date: string, timeZone: string): Date {
  const wall = toUtcMs(date);
  let guess = wall;
  for (let i = 0; i < 3; i += 1) guess = wall - offsetMinutes(guess, timeZone) * 60_000;
  return new Date(guess);
}

/** Today's date on the shop's calendar. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

/** The shop-local calendar date of an instant. */
export function dateInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));
}

/** Instants for GET analytics: `from` inclusive = start of the first day, `to` exclusive = start of the day AFTER the last day. */
export function analyticsInstants(from: string, to: string, timeZone: string): { from: string; to: string } {
  return { from: zonedDayStart(from, timeZone).toISOString(), to: zonedDayStart(addDays(to, 1), timeZone).toISOString() };
}

export type RangeError = "MISSING" | "INVALID_DATE" | "ORDER" | "TOO_LONG";

export function validateRange(from: string, to: string): RangeError | null {
  if (!from || !to) return "MISSING";
  if (!isIsoDate(from) || !isIsoDate(to)) return "INVALID_DATE";
  if (from > to) return "ORDER";
  if (inclusiveDays(from, to) > MAX_REPORT_DAYS) return "TOO_LONG";
  return null;
}

export const RANGE_ERROR_TEXT: Record<RangeError, string> = {
  MISSING: "Choose a start date and an end date.",
  INVALID_DATE: "Enter real dates in the form day/month/year.",
  ORDER: "The start date must be on or before the end date.",
  TOO_LONG: `Choose a range of at most ${MAX_REPORT_DAYS} days.`,
};

export type PresetId = "today" | "last7" | "last30" | "thisMonth" | "lastMonth";

export function presetRange(preset: PresetId, today: string): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "thisMonth":
      return { from: monthStart(today), to: today };
    case "lastMonth": {
      const firstOfThis = monthStart(today);
      const lastOfPrev = addDays(firstOfThis, -1);
      return { from: monthStart(lastOfPrev), to: lastOfPrev };
    }
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface DayRow {
  date: string;
  collected: number;
  refunded: number;
  estimated: number;
  completedServices: number;
}

/**
 * One row for EVERY day in the range (missing days are zero, so charts and buckets never skip a day).
 * `payments` null means the payment rows could not be fully loaded: collected/refunded are then null-safe
 * zeros and the caller must not present the daily collection figures (see `collectedKnown`).
 */
export function buildDayRows(
  from: string,
  to: string,
  timeZone: string,
  estimatedDaily: ReadonlyArray<DailyServiceValueDto>,
  payments: ReadonlyArray<RecordedPaymentDto> | null,
): DayRow[] {
  const rows = new Map<string, DayRow>();
  for (let d = from; d <= to; d = addDays(d, 1)) rows.set(d, { date: d, collected: 0, refunded: 0, estimated: 0, completedServices: 0 });
  for (const day of estimatedDaily) {
    const row = rows.get(day.date);
    if (row) {
      row.estimated = round2(row.estimated + day.estimatedServiceValue);
      row.completedServices += day.completedCount;
    }
  }
  for (const p of payments ?? []) {
    const row = rows.get(dateInZone(p.recordedAt, timeZone));
    if (!row) continue;
    if (p.kind === "REFUND") row.refunded = round2(row.refunded + p.amount);
    else row.collected = round2(row.collected + p.amount);
  }
  return [...rows.values()];
}

export interface BucketRow extends DayRow {
  label: string;
}

/** Sums day rows into day, Monday-based week or calendar-month buckets (key = first day of the bucket). */
export function bucketRows(rows: ReadonlyArray<DayRow>, granularity: Granularity): BucketRow[] {
  if (granularity === "day") return rows.map((r) => ({ ...r, label: r.date }));
  const buckets = new Map<string, BucketRow>();
  for (const r of rows) {
    const key = granularity === "week" ? weekStart(r.date) : monthStart(r.date);
    const b = buckets.get(key) ?? { date: key, label: key, collected: 0, refunded: 0, estimated: 0, completedServices: 0 };
    b.collected = round2(b.collected + r.collected);
    b.refunded = round2(b.refunded + r.refunded);
    b.estimated = round2(b.estimated + r.estimated);
    b.completedServices += r.completedServices;
    buckets.set(key, b);
  }
  return [...buckets.values()];
}

export function netCollected(row: Pick<DayRow, "collected" | "refunded">): number {
  return round2(row.collected - row.refunded);
}

// ---------- CSV ----------

/**
 * One CSV cell. Quotes when needed and neutralises spreadsheet formulas: a value that would be read as a
 * formula (starts with = + - @ or a tab/CR) is prefixed with an apostrophe, so a customer or service name
 * can never run code when the owner opens the export in Excel.
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const lines = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  // Leading BOM so Excel reads UTF-8 (rupee sign, Hindi names) correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ---------- Labels, filters and export rows ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(date: string, withYear = false): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

/** Human label for a bucket start date: "12 Oct", "Week of 12 Oct" or "Oct 2026". */
export function periodLabel(date: string, granularity: Granularity): string {
  if (granularity === "month") return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
  if (granularity === "week") return `Week of ${shortDate(date)}`;
  return shortDate(date);
}

/** Case-insensitive "contains" filter on a name; an empty search keeps everything. */
export function filterByName<T extends { name?: string; displayName?: string }>(rows: ReadonlyArray<T>, search: string): T[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((r) => (r.name ?? r.displayName ?? "").toLowerCase().includes(needle));
}

export const PERIOD_CSV_HEADERS = ["Period start", "Collected", "Refunded", "Net collected", "Estimated service value", "Completed services"] as const;

/** One CSV row per bucket. Collected/refunded are recorded payments; estimated is listed-price value and is a separate column. */
export function periodCsvRows(rows: ReadonlyArray<DayRow>, granularity: Granularity): Array<Array<string | number>> {
  return bucketRows(rows, granularity).map((b) => [b.date, b.collected, b.refunded, netCollected(b), b.estimated, b.completedServices]);
}

export const PAYMENT_CSV_HEADERS = ["Recorded at (shop date)", "Invoice", "Customer", "Type", "Method", "Reference", "Amount", "Recorded by"] as const;

export function paymentCsvRows(payments: ReadonlyArray<RecordedPaymentDto>, timeZone: string): Array<Array<string | number | null>> {
  return payments.map((p) => [dateInZone(p.recordedAt, timeZone), p.invoiceNumber, p.customerName, p.kind === "REFUND" ? "Refund" : "Payment", p.method, p.reference, p.kind === "REFUND" ? -p.amount : p.amount, p.recordedBy]);
}

export function reportFileName(prefix: string, from: string, to: string): string {
  return `${prefix}-${from}-to-${to}.csv`;
}

// ---------- Loading every payment page ----------

export const PAYMENT_PAGE_CAP = 30; // 30 pages x 100 rows

export interface LoadedPayments {
  /** The first page: its `totals` and `byMethod` cover the WHOLE range and are the figures to show. */
  first: RecordedPaymentListDto;
  items: RecordedPaymentDto[];
  /** False when the page cap was reached or a later page failed: daily figures and the payment export are then incomplete and must say so. */
  complete: boolean;
}

/**
 * Reads payment pages until the server says there are no more (or the cap is hit). A failure on the FIRST
 * page is thrown (nothing to show); a failure on a later page keeps what was loaded and reports it as
 * incomplete instead of presenting partial rows as the whole picture.
 */
export async function loadAllPayments(fetchPage: (cursor?: string) => Promise<RecordedPaymentListDto>, maxPages: number = PAYMENT_PAGE_CAP): Promise<LoadedPayments> {
  const first = await fetchPage();
  const items = [...first.items];
  let cursor = first.nextCursor;
  let pages = 1;
  while (cursor) {
    if (pages >= maxPages) return { first, items, complete: false };
    try {
      const next = await fetchPage(cursor);
      items.push(...next.items);
      cursor = next.nextCursor;
      pages += 1;
    } catch {
      return { first, items, complete: false };
    }
  }
  return { first, items, complete: true };
}
