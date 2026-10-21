import { CrmErrorCode, CrmFollowUpChannel, CrmFollowUpStatus, CrmLeadSource, CrmLeadStatus, CrmVisitOutcome } from "@barbercue/shared";
import { searchTerm } from "./inventory";

// Platform admin CRM analytics (requirement #29) on Codex's docs/contracts/ADMIN_CRM_ANALYTICS_V1.md (PR #262):
//   GET admin/crm/analytics?from&to[&employeeId]                  aggregate-only totals, per employee, per territory
//   GET admin/crm/{leads|visits|follow-ups}/page?...&cursor       the existing CRM rows, paged with a signed cursor
// All of it is PLATFORM_ADMIN only. Dates are UTC instants and every interval is [from, to): the upper bound is NOT included.
// The screen therefore works in whole UTC days and never in the browser's local time.

export const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ALL = "ALL";

/** "YYYY-MM-DD" of an instant in UTC. */
export function utcDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Milliseconds of 00:00 UTC on a real calendar day written "YYYY-MM-DD", else null (no 31 Feb, no year before 2000). */
function parseDay(day: string): number | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2999) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d ? ms : null;
}

export interface AnalyticsRange {
  /** Inclusive start instant, 00:00 UTC of the first day. */
  from: string;
  /** Exclusive end instant, 00:00 UTC of the day AFTER the last chosen day. */
  to: string;
  /** Number of whole days chosen, both ends included. */
  days: number;
}

export type RangeResult = { ok: true; range: AnalyticsRange } | { ok: false; problem: string };

/** Whole UTC days (both included) as the instants the server expects: `[from, to)`, at most 366 days. */
export function analyticsRange(fromDay: string, toDay: string): RangeResult {
  const f = parseDay(fromDay);
  if (f === null) return { ok: false, problem: "Choose a valid start date." };
  const t = parseDay(toDay);
  if (t === null) return { ok: false, problem: "Choose a valid end date." };
  if (t < f) return { ok: false, problem: "The end date must be on or after the start date." };
  const days = Math.round((t - f) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) return { ok: false, problem: `Choose ${MAX_RANGE_DAYS} days or fewer. You chose ${days}.` };
  return { ok: true, range: { from: new Date(f).toISOString(), to: new Date(t + DAY_MS).toISOString(), days } };
}

export const RANGE_PRESETS = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "month", label: "This month" },
  { id: "lastMonth", label: "Last month" },
] as const;
export type RangePresetId = (typeof RANGE_PRESETS)[number]["id"];

/** A preset as inclusive UTC days, counted from `now` (so "last 7 days" ends today, UTC). */
export function presetDays(id: RangePresetId, now: Date): { from: string; to: string } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  switch (id) {
    case "7d":
      return { from: day(today - 6 * DAY_MS), to: day(today) };
    case "90d":
      return { from: day(today - 89 * DAY_MS), to: day(today) };
    case "month":
      return { from: day(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: day(today) };
    case "lastMonth": {
      const first = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
      const last = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - DAY_MS;
      return { from: day(first), to: day(last) };
    }
    default:
      return { from: day(today - 29 * DAY_MS), to: day(today) };
  }
}

export function isEmployeeId(value: string): boolean {
  return UUID.test(value);
}

/** Query for the analytics route. The employee is sent only when it is a real id; "all" sends none. */
export function analyticsQuery(range: AnalyticsRange, employeeId: string): string {
  const q = new URLSearchParams({ from: range.from, to: range.to });
  if (employeeId !== ALL && isEmployeeId(employeeId)) q.set("employeeId", employeeId);
  return q.toString();
}

export type DetailKind = "leads" | "visits" | "follow-ups";

export interface DetailFilter {
  search: string;
  /** Lead status, or follow-up status. */
  status: string;
  source: string;
  outcome: string;
  channel: string;
}

export const EMPTY_DETAIL_FILTER: DetailFilter = { search: "", status: ALL, source: ALL, outcome: ALL, channel: ALL };

const ENUMS = {
  leadStatus: Object.values(CrmLeadStatus) as string[],
  source: Object.values(CrmLeadSource) as string[],
  outcome: Object.values(CrmVisitOutcome) as string[],
  followUpStatus: Object.values(CrmFollowUpStatus) as string[],
  channel: Object.values(CrmFollowUpChannel) as string[],
};

export const LEAD_STATUSES = ENUMS.leadStatus;
export const LEAD_SOURCES = ENUMS.source;
export const VISIT_OUTCOMES = ENUMS.outcome;
export const FOLLOW_UP_STATUSES = ENUMS.followUpStatus;
export const FOLLOW_UP_CHANNELS = ENUMS.channel;

function only(value: string, allowed: readonly string[]): string | undefined {
  return value !== ALL && allowed.includes(value) ? value : undefined;
}

/**
 * Filters for one of the paged routes, as the server validates them. Only values the server knows are sent. The date range is the
 * same UTC `[from, to)` the totals use; for leads it filters the creation time, for visits the visit time, for follow-ups the due time.
 */
export function detailParams(kind: DetailKind, filter: DetailFilter, range: AnalyticsRange | null, employeeId: string): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {
    from: range?.from,
    to: range?.to,
    employeeId: employeeId !== ALL && isEmployeeId(employeeId) ? employeeId : undefined,
    q: searchTerm(filter.search) || undefined,
  };
  if (kind === "leads") {
    params.status = only(filter.status, ENUMS.leadStatus);
    params.source = only(filter.source, ENUMS.source);
  } else if (kind === "visits") {
    params.outcome = only(filter.outcome, ENUMS.outcome);
  } else {
    params.status = only(filter.status, ENUMS.followUpStatus);
    params.channel = only(filter.channel, ENUMS.channel);
  }
  return params;
}

export const DETAIL_PATHS: Record<DetailKind, string> = {
  leads: "admin/crm/leads/page",
  visits: "admin/crm/visits/page",
  "follow-ups": "admin/crm/follow-ups/page",
};

/** Words for the server's stable error codes on these routes (ADMIN_CRM_ANALYTICS_V1, "Stable errors"). */
export function adminCrmErrorText(code: string | undefined, message: string): string {
  switch (code) {
    case CrmErrorCode.ADMIN_DATE_RANGE_TOO_LARGE:
      return `Choose a range of ${MAX_RANGE_DAYS} days or fewer.`;
    case CrmErrorCode.ADMIN_CURSOR_UNAVAILABLE:
      return "Paging is not available on the server right now. Narrow the filters so fewer rows match, or try again later.";
    case CrmErrorCode.ADMIN_CURSOR_INVALID:
      return "This list changed while you were paging. It starts again from the first page.";
    case "VALIDATION_ERROR":
      return message && message !== "Request failed" ? message : "One of the filters is not valid.";
    default:
      return message;
  }
}

/** The words for a failed request: sign-in and permission failures say so, everything else uses the server's stable code. */
export function adminCrmFailureText(status: number | null, code: string | undefined, message: string, fallback: string): string {
  if (status === 401) return "Your session has ended. Sign in again to see CRM analytics.";
  if (status === 403) return "Only platform admins can see CRM analytics.";
  if (status === null) return fallback;
  return adminCrmErrorText(code, message);
}

export function pretty(value: string): string {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function countText(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-IN") : "—";
}

export function percentText(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
}

/** Conversion of the whole period from the two server totals (the same definition the server uses per employee), or null with no leads. */
export function totalConversion(onboardedFromPeriodLeads: number, leadsCreated: number): number | null {
  if (!Number.isFinite(onboardedFromPeriodLeads) || !Number.isFinite(leadsCreated) || leadsCreated <= 0) return null;
  return Math.round((onboardedFromPeriodLeads * 1000) / leadsCreated) / 10;
}

export function territoryLabel(territory: string | null | undefined): string {
  const t = (territory ?? "").trim();
  return t.length > 0 ? t : "No territory";
}

export type SortKey = "name" | "leads" | "visits" | "conversion" | "overdue";

export const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: "name", label: "Name (A to Z)" },
  { key: "leads", label: "Leads created" },
  { key: "visits", label: "Visits" },
  { key: "conversion", label: "Conversion" },
  { key: "overdue", label: "Overdue follow-ups" },
];

interface Sortable {
  leadsCreated: number;
  visits: number;
  conversionPercent: number;
  openFollowUpsOverdueInPeriod: number;
}

/** A sorted copy. "Name" is A to Z with an unnamed territory last; every other key is largest first, ties by name. */
export function sortRows<T extends Sortable>(rows: readonly T[], key: SortKey, nameOf: (row: T) => string | null): T[] {
  const num = (row: T): number => {
    const v = key === "leads" ? row.leadsCreated : key === "visits" ? row.visits : key === "conversion" ? row.conversionPercent : row.openFollowUpsOverdueInPeriod;
    return Number.isFinite(v) ? v : 0;
  };
  const byName = (a: T, b: T): number => {
    const x = nameOf(a);
    const y = nameOf(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return x.localeCompare(y, "en", { numeric: true, sensitivity: "base" });
  };
  return [...rows].sort((a, b) => (key === "name" ? byName(a, b) : num(b) - num(a) || byName(a, b)));
}

const UTC_FORMAT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

/** An instant in UTC, always labelled as such. */
export function utcText(iso: string | null | undefined): string {
  const ms = Date.parse(iso ?? "");
  return Number.isNaN(ms) ? "—" : `${UTC_FORMAT.format(new Date(ms))} UTC`;
}

const LOCAL_FORMAT = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function localText(iso: string | null | undefined): string {
  const ms = Date.parse(iso ?? "");
  return Number.isNaN(ms) ? "—" : LOCAL_FORMAT.format(new Date(ms));
}
