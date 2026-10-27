import type { AdminShopScheduleState } from '@barbercue/shared';
import {
  addZonedCalendarDays,
  utcToZonedDateStr,
  zonedDateToDayOfWeek,
  zonedWallTimeToUtc,
} from '../../common/timezone/timezone';

/**
 * Scheduled open/closed status from a shop's configured weekly hours, in the shop's own time zone.
 * Pure: no I/O. "Scheduled open" means the configured hours say so — it is never presented as proof
 * that the shop is physically open.
 *
 * Supported: closed days, overnight hours (close at or before open, e.g. 18:00–02:00 runs past
 * midnight; equal times mean open 24 hours). Not supported because FastQue does not record them yet:
 * holiday exceptions and effective-dated schedule history.
 */

export interface WeeklyHours {
  dayOfWeek: number;
  openTime: string; // "HH:MM"
  closeTime: string;
  isClosed: boolean;
}

export interface ScheduleStatus {
  state: AdminShopScheduleState;
  todayLabel: string | null;
  openedAt: Date | null; // start of the current open interval
  closesAt: Date | null; // end of the current open interval
  opensAt: Date | null; // next opening within 24 hours (when not open now)
}

interface Interval {
  start: Date;
  end: Date;
}

const UNKNOWN: ScheduleStatus = {
  state: 'UNKNOWN',
  todayLabel: null,
  openedAt: null,
  closesAt: null,
  opensAt: null,
};

function minutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
}

function intervalFor(
  date: string,
  entry: WeeklyHours | undefined,
  timeZone: string,
): Interval | null {
  if (!entry || entry.isClosed) return null;
  const open = minutesOf(entry.openTime);
  const close = minutesOf(entry.closeTime);
  if (open === null || close === null) return null;
  const start = zonedWallTimeToUtc(date, entry.openTime, timeZone);
  const overnight = close <= open;
  const end = zonedWallTimeToUtc(
    overnight ? addZonedCalendarDays(date, 1) : date,
    entry.closeTime === '24:00' ? '23:59' : entry.closeTime,
    timeZone,
  );
  if (!start || !end) return null;
  // "24:00" is stored by some clients for midnight; treat it as the end of the day.
  return {
    start,
    end: entry.closeTime === '24:00' ? new Date(end.getTime() + 60_000) : end,
  };
}

export function scheduleStatusAt(
  hours: readonly WeeklyHours[],
  timeZone: string | null,
  at: Date,
): ScheduleStatus {
  if (!timeZone || hours.length === 0) return UNKNOWN;
  const today = utcToZonedDateStr(at, timeZone);
  const byDay = (date: string) =>
    hours.find((h) => h.dayOfWeek === zonedDateToDayOfWeek(date));
  const todayEntry = byDay(today);
  if (!todayEntry) return UNKNOWN;

  const yesterday = addZonedCalendarDays(today, -1);
  const tomorrow = addZonedCalendarDays(today, 1);
  const intervals = [yesterday, today, tomorrow]
    .map((date) => intervalFor(date, byDay(date), timeZone))
    .filter((i): i is Interval => i !== null);

  const open = intervals.find((i) => i.start <= at && at < i.end);
  const horizon = at.getTime() + 24 * 3_600_000;
  const next = intervals
    .filter((i) => i.start > at && i.start.getTime() <= horizon)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

  const todayLabel = todayEntry.isClosed
    ? 'Closed'
    : `${todayEntry.openTime}–${todayEntry.closeTime}${
        (minutesOf(todayEntry.closeTime) ?? 0) <=
        (minutesOf(todayEntry.openTime) ?? 0)
          ? ' (overnight)'
          : ''
      }`;

  return {
    state: open ? 'OPEN' : 'CLOSED',
    todayLabel,
    openedAt: open?.start ?? null,
    closesAt: open?.end ?? null,
    opensAt: open ? null : (next?.start ?? null),
  };
}
