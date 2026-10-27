import { DASHBOARD_PATHS } from '@barbercue/shared';

export type RevenueGranularity = 'day' | 'week' | 'month';
export type RevenuePreset = '7d' | '30d' | 'this-month';
export type RevenueSource =
  | 'FASTQUE_WEB'
  | 'FASTQUE_APP'
  | 'WALK_IN'
  | 'IN_SHOP'
  | 'FACEBOOK'
  | 'INSTAGRAM'
  | 'CHATGPT'
  | 'OTHER'
  | 'UNKNOWN';

export interface RevenueReportQuery {
  from: string;
  to: string;
  groupBy: RevenueGranularity;
  source: RevenueSource | '';
}

export const REVENUE_SOURCES: readonly RevenueSource[] = [
  'FASTQUE_WEB', 'FASTQUE_APP', 'WALK_IN', 'IN_SHOP', 'FACEBOOK', 'INSTAGRAM', 'CHATGPT', 'OTHER', 'UNKNOWN',
];

export function ownerRevenueTimezonePath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${DASHBOARD_PATHS.timezone}`;
}

export function ownerRevenueReportPath(salonId: string, query: RevenueReportQuery): string {
  const params = new URLSearchParams({ from: query.from, to: query.to, groupBy: query.groupBy });
  if (query.source) params.set('source', query.source);
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/revenue/report?${params.toString()}`;
}

export function dateKeyInTimezone(timeZone: string, instant = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: 'year' | 'month' | 'day') => parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) throw new Error('Could not determine the current date in the shop timezone.');
  return `${year}-${month}-${day}`;
}

function shiftDate(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function revenuePresetRange(preset: RevenuePreset, today: string): Pick<RevenueReportQuery, 'from' | 'to'> {
  if (preset === '7d') return { from: shiftDate(today, -6), to: today };
  if (preset === '30d') return { from: shiftDate(today, -29), to: today };
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateRevenueRange(from: string, to: string): string | null {
  if (!isValidDateKey(from) || !isValidDateKey(to)) return 'Enter valid dates in YYYY-MM-DD format.';
  if (from > to) return 'The end date must be on or after the start date.';
  const elapsedDays = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;
  if (elapsedDays > 365) return 'Choose a date range of 366 days or fewer.';
  return null;
}
