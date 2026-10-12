import {
  addZonedCalendarDays,
  utcToZonedDateStr,
  zonedDateToDayOfWeek,
  zonedWallTimeToUtc,
} from '../common/timezone/timezone';

/** Half-open [start, end) UTC instants of one salon-local calendar day. Null when unresolvable. */
export function localDayWindow(
  dateStr: string,
  timeZone: string,
): { start: Date; end: Date } | null {
  const start = zonedWallTimeToUtc(dateStr, '00:00', timeZone);
  const end = zonedWallTimeToUtc(
    addZonedCalendarDays(dateStr, 1),
    '00:00',
    timeZone,
  );
  return start && end ? { start, end } : null;
}

/** [fromDate, toDateExclusive) as UTC instants, both given as salon-local YYYY-MM-DD strings. */
export function localRange(
  fromDate: string,
  toDateExclusive: string,
  timeZone: string,
): { start: Date; end: Date } | null {
  const start = zonedWallTimeToUtc(fromDate, '00:00', timeZone);
  const end = zonedWallTimeToUtc(toDateExclusive, '00:00', timeZone);
  return start && end ? { start, end } : null;
}

export function todayLocal(timeZone: string, now: Date = new Date()): string {
  return utcToZonedDateStr(now, timeZone);
}

/** Monday of the ISO week containing `dateStr` (weeks start on Monday). */
export function mondayOf(dateStr: string): string {
  const dow = zonedDateToDayOfWeek(dateStr); // 0 = Sunday
  return addZonedCalendarDays(dateStr, -((dow + 6) % 7));
}

export function firstOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

export function addMonths(dateStr: string, months: number): string {
  const [y, m] = dateStr.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** Whole calendar days from a to b (both YYYY-MM-DD), b >= a. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous <= 0) return null; // nothing to compare against: never a fabricated "+100%"
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
