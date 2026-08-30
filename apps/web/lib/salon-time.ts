// Centralized salon-timezone-aware date/time helpers for the customer/owner frontend — mirrors
// apps/backend/src/common/timezone/timezone.ts's approach (Intl.DateTimeFormat + formatToParts,
// never a fixed offset) so a date/time rendered here always agrees with what the backend computed
// it to be, regardless of the viewer's own browser/device timezone. Every booking-context date or
// time in the UI must go through one of these, never a bare `new Date(iso).toLocaleString()` (that
// silently uses the viewer's local timezone, which caused a real defect: a customer in one
// timezone selecting a date could have it round-trip as a different calendar day).

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = partsCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  partsCache.set(timeZone, formatter);
  return formatter;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function zonedParts(iso: string, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** YYYY-MM-DD of the given instant, as observed in `timeZone` — the salon's own calendar day. */
export function zonedDateStr(iso: string, timeZone: string): string {
  const p = zonedParts(iso, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Today's date (YYYY-MM-DD) as observed in `timeZone` right now — never the viewer's own "today". */
export function todayInZone(timeZone: string): string {
  return zonedDateStr(new Date().toISOString(), timeZone);
}

/** 0 (Sunday) – 6 (Saturday), from a YYYY-MM-DD string — timezone-agnostic once you have the string. */
export function zonedDayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Adds calendar days to a YYYY-MM-DD string via UTC-anchored arithmetic (no local-timezone
 * midnight-rollover risk) — the correct way to generate "the next N calendar days" from a zoned
 * date string without ever touching the viewer's own local Date components. */
export function addZonedDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/** Minutes elapsed since `gridStartHour:00` on the instant's zoned calendar day — used for
 * pixel-position math on the owner day-scheduler grid. */
export function minutesFromZonedHour(iso: string, timeZone: string, gridStartHour: number): number {
  const p = zonedParts(iso, timeZone);
  return (p.hour - gridStartHour) * 60 + p.minute;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Sep" — short weekday label for a date string, purely from its calendar components (no zone
 * re-derivation needed since a YYYY-MM-DD string is already the zoned calendar day). */
export function zonedWeekdayLabel(dateStr: string): string {
  return WEEKDAY_NAMES[zonedDayOfWeek(dateStr)];
}

/** "Sep 1" from a YYYY-MM-DD string. */
export function zonedDayLabel(dateStr: string): string {
  const [, month, day] = dateStr.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${day}`;
}

function hourLabel(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour}:${String(minute).padStart(2, "0")} ${period}`;
}

/** "8:15 PM" — the instant's wall-clock time in `timeZone`, regardless of the viewer's own zone. */
export function formatZonedTime(iso: string, timeZone: string): string {
  const p = zonedParts(iso, timeZone);
  return hourLabel(p.hour, p.minute);
}

/** "Sep 1, 8:15 PM" — the instant's wall-clock date+time in `timeZone`. */
export function formatZonedDateTime(iso: string, timeZone: string): string {
  const p = zonedParts(iso, timeZone);
  const dateStr = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return `${zonedWeekdayLabel(dateStr)}, ${zonedDayLabel(dateStr)}, ${hourLabel(p.hour, p.minute)}`;
}

/** "Sep 1" — the instant's wall-clock date only, in `timeZone`. */
export function formatZonedDate(iso: string, timeZone: string): string {
  return zonedDayLabel(zonedDateStr(iso, timeZone));
}
