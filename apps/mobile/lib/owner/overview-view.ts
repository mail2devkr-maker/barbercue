import type { OwnerRevenueDto, RevenuePointDto } from '@barbercue/shared';

export type RevenueRange = 'daily' | 'weekly' | 'monthly';

export function greetingFor(hour: number): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Hour (0-23) in the shop's own timezone; falls back to the device clock if the zone is unusable. */
export function shopHour(timeZone: string | null | undefined, now: Date = new Date()): number {
  try {
    const text = now.toLocaleTimeString('en-GB', { timeZone: timeZone ?? undefined, hour: '2-digit', hour12: false });
    const hour = Number.parseInt(text, 10);
    return Number.isFinite(hour) ? hour % 24 : now.getHours();
  } catch {
    return now.getHours();
  }
}

export interface RevenueBar {
  key: string;
  label: string;
  value: number;
  /** 0-100, relative to the largest bar; a non-zero value is never drawn shorter than 4%. */
  heightPercent: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-12" -> "12 Oct" without any timezone arithmetic (the date is already the shop's own). */
export function shortDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  const monthIndex = Number(month) - 1;
  if (!month || !day || monthIndex < 0 || monthIndex > 11) return isoDate;
  return `${Number(day)} ${MONTHS[monthIndex]}`;
}

export function revenueSeries(revenue: OwnerRevenueDto, range: RevenueRange): RevenuePointDto[] {
  return range === 'daily' ? revenue.daily : range === 'weekly' ? revenue.weekly : revenue.monthly;
}

export function revenueBars(points: readonly RevenuePointDto[]): RevenueBar[] {
  const max = points.reduce((m, p) => Math.max(m, p.amount), 0);
  return points.map((p) => ({
    key: p.date,
    label: shortDate(p.date),
    value: p.amount,
    heightPercent: max <= 0 ? 0 : p.amount <= 0 ? 0 : Math.max(4, Math.round((p.amount / max) * 100)),
  }));
}

/** Show a label under every Nth bar so a 30-day chart stays readable on a phone. */
export function labelEvery(count: number): number {
  if (count <= 8) return 1;
  if (count <= 16) return 2;
  return Math.ceil(count / 6);
}
