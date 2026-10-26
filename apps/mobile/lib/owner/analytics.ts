import {
  DASHBOARD_PATHS,
  type DailyServiceValueDto,
  type HourCountDto,
  type OwnerAnalyticsRange,
} from '@barbercue/shared';

/**
 * Owner analytics, mobile side. The numbers all come from the one existing backend contract the
 * website already uses (`GET dashboard/salons/:salonId/analytics?range=`, OwnerAnalyticsDto); this
 * module only turns them into things a native screen can draw. It never recomputes a business figure:
 * totals, service value and estimates are exactly what the server returned.
 */

/** `custom` exists in the contract but the website offers no UI for it, so neither does mobile. */
export const MOBILE_ANALYTICS_RANGES: readonly Exclude<OwnerAnalyticsRange, 'custom'>[] = ['today', '7d', '30d'];

export type AnalyticsView = 'overview' | 'value' | 'operations';
export const ANALYTICS_VIEWS: readonly AnalyticsView[] = ['overview', 'value', 'operations'];

export function analyticsPath(salonId: string, range: OwnerAnalyticsRange): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${DASHBOARD_PATHS.analytics}?range=${range}`;
}

export function timezonePath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${DASHBOARD_PATHS.timezone}`;
}

/** "12m", "<1m", "4.5m", "—" — identical to the website's wording for the same values. */
export function formatMinutes(value: number | null): string {
  if (value === null) return '—';
  if (value > 0 && value < 1) return '<1m';
  if (Number.isInteger(value)) return `${value}m`;
  return `${value.toFixed(1)}m`;
}

/** 0-23 in the salon's own wall clock -> "9 AM", "12 PM". Deterministic: no device locale or zone. */
export function formatHour(hour: number): string {
  const normalized = ((Math.trunc(hour) % 24) + 24) % 24;
  const suffix = normalized < 12 ? 'AM' : 'PM';
  const twelve = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${twelve} ${suffix}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-09" (already the salon's local date) -> "Oct 9". Never goes through the device timezone. */
export function formatDay(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return date;
  return `${MONTHS[month - 1]} ${Number(match[3])}`;
}

export function formatHourList(rows: readonly HourCountDto[]): string {
  return rows.map((row) => `${formatHour(row.hour)} (${row.count})`).join(', ');
}

export interface ColumnBar {
  key: string;
  label: string;
  /** 0..100, never below MIN_BAR_PERCENT for a non-zero value so a small day is still visible. */
  heightPercent: number;
  value: number;
  showLabel: boolean;
}

const MIN_BAR_PERCENT = 4;

/** Vertical bars for the daily service-value trend; labels thinned so they never overlap. */
export function columnChart(rows: readonly DailyServiceValueDto[], maxLabels = 6): ColumnBar[] {
  const max = Math.max(1, ...rows.map((row) => row.estimatedServiceValue));
  const every = Math.max(1, Math.ceil(rows.length / maxLabels));
  return rows.map((row, index) => ({
    key: row.date,
    label: formatDay(row.date),
    value: row.estimatedServiceValue,
    heightPercent: row.estimatedServiceValue <= 0 ? 0 : Math.max(MIN_BAR_PERCENT, (row.estimatedServiceValue / max) * 100),
    showLabel: index % every === 0 || index === rows.length - 1,
  }));
}

/** Width (percent) of each ranked bar relative to the largest value; empty input is empty output. */
export function rankedWidths(values: readonly number[]): number[] {
  const max = Math.max(1, ...values);
  return values.map((value) => (value <= 0 ? 0 : Math.max(3, (value / max) * 100)));
}

/** Left-hand share of a two-part split, 50 when both are zero (nothing to compare). */
export function splitPercent(left: number, right: number): number {
  const total = left + right;
  return total > 0 ? (left / total) * 100 : 50;
}

/** 0..1 heat for one hour of the peak-value grid. */
export function heatIntensity(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.min(1, value / max);
}
