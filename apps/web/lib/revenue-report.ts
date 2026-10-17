import type { BookingAttributionSource, OwnerRevenueReportDto } from "@barbercue/shared";
import { sourceLabel } from "./booking-sources";

// Owner revenue report UI helpers (requirements #1, #2, #4, #17), integrated with the server report
// `GET dashboard/salons/:salonId/revenue/report` (+ `.csv`) from Codex PR #226.
//
// The server is the single source of truth for every financial figure: estimates, invoiced value, discounts, recorded
// collections, refunds and the by-service/staff/customer breakdowns. This file only holds what a browser must own:
// reading the shop calendar for dates, validating the range before a request, labels, and building the query. It does
// no summing, bucketing or currency arithmetic, so the page can never disagree with the exported CSV.

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

export function addDays(date: string, days: number): string {
  return new Date(toUtcMs(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to`, inclusive (same day = 1). */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000) + 1;
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Today's date on the shop's calendar (never the browser's). */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

export type RangeError = "MISSING" | "INVALID_DATE" | "ORDER" | "TOO_LONG";

/** The same rules the server enforces (valid days, start not after end, at most 366 days), checked before a request. */
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
      const lastOfPrev = addDays(monthStart(today), -1);
      return { from: monthStart(lastOfPrev), to: lastOfPrev };
    }
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** Human label for a server period key: "12 Oct", "Week of 12 Oct" or "Oct 2026". */
export function periodLabel(period: string, granularity: Granularity): string {
  if (granularity === "month") return `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
  if (granularity === "week") return `Week of ${shortDate(period)}`;
  return shortDate(period);
}

const FILTER_SOURCES: ReadonlyArray<BookingAttributionSource> = [
  "FASTQUE_APP",
  "FASTQUE_WEB",
  "WALK_IN",
  "IN_SHOP",
  "FACEBOOK",
  "INSTAGRAM",
  "CHATGPT",
  "OTHER",
  "UNKNOWN",
];

/**
 * Source filter choices: how the booking reached the shop. Direct sources come from the surface that created the
 * booking; Facebook, Instagram, ChatGPT and Other appear only for bookings made with a campaign code the owner created.
 */
export const SOURCE_FILTERS: ReadonlyArray<{ value: BookingAttributionSource | ""; label: string }> = [
  { value: "", label: "All sources" },
  ...FILTER_SOURCES.map((value) => ({ value, label: sourceLabel(value) })),
];

export function isKnownSource(value: string): value is BookingAttributionSource {
  return FILTER_SOURCES.some((s) => s === value);
}

export interface ReportQuery {
  from: string;
  to: string;
  groupBy: Granularity;
  source: BookingAttributionSource | "";
}

/** Query string for both the JSON report and the CSV export, so the two can never use different filters. */
export function reportQueryString(q: ReportQuery): string {
  const params = new URLSearchParams({ from: q.from, to: q.to, groupBy: q.groupBy });
  if (q.source) params.set("source", q.source);
  return params.toString();
}

export function csvFallbackName(q: Pick<ReportQuery, "from" | "to">): string {
  return `fastque-revenue-${q.from}-${q.to}.csv`;
}

/** Case-insensitive "contains" filter on a row label; an empty search keeps everything. */
export function filterByLabel<T extends { label: string }>(rows: ReadonlyArray<T>, search: string): T[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((r) => r.label.toLowerCase().includes(needle));
}

/** Highest recorded collections first, then highest estimated value; stable for ties. */
export function sortByValue<T extends { netRecordedCollections: number; estimatedServiceValue: number }>(rows: ReadonlyArray<T>): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.netRecordedCollections - a.row.netRecordedCollections || b.row.estimatedServiceValue - a.row.estimatedServiceValue || a.index - b.index)
    .map((x) => x.row);
}

/** True when the report has nothing in it at all (no visits, invoices or cash), so the page shows an honest empty state. */
export function isEmptyReport(report: Pick<OwnerRevenueReportDto, "totals">): boolean {
  const t = report.totals;
  return t.completedVisits === 0 && t.invoiceCount === 0 && t.recordedCollections === 0 && t.refunds === 0 && t.estimatedServiceValue === 0;
}

const SEMANTICS_TEXT: Record<string, Record<string, string>> = {
  estimateBasis: {
    BOOKING_PRICE_SNAPSHOT_AND_CURRENT_QUEUE_SERVICE_PRICE:
      "Estimated value uses the price saved on each booking. A Live Queue visit with no saved price uses the service's current listed price, so it is an estimate.",
  },
  cashSource: {
    SHOP_RECORDED_INVOICE_PAYMENT_LEDGER: "Collections and refunds are only the payments your shop recorded against invoices. A completed service, an invoice or a displayed QR is not cash.",
  },
  serviceCashAllocation: {
    PRO_RATA_BY_INVOICE_LINE_TOTAL: "Money recorded against an invoice is shared across its services in proportion to each line's total. The invoice stays the record of the payment.",
  },
  externalAttribution: {
    NOT_CAPTURED_BY_EXISTING_SOURCE_FIELDS: "The source filter covers the app, the website, the Live Queue and in-shop appointments. Facebook, Instagram or other campaigns are not captured yet.",
    CAMPAIGN_TOKEN_WHEN_PRESENT_LEGACY_SOURCE_PROJECTION_OTHERWISE:
      "Facebook, Instagram, ChatGPT and Other appear only for bookings made with a campaign code you created. That shows a campaign link was used, not where the customer really came from. Other bookings use the source recorded when they were made.",
  },
};

/** Plain-language lines for the report's `dataSemantics`; an unknown value is shown verbatim rather than hidden. */
export function describeSemantics(semantics: OwnerRevenueReportDto["dataSemantics"]): string[] {
  return (Object.keys(semantics) as Array<keyof typeof semantics>).map((key) => {
    const value = String(semantics[key]);
    return SEMANTICS_TEXT[key]?.[value] ?? `${key}: ${value}`;
  });
}
