import {
  DASHBOARD_PATHS,
  formatZonedDateTime,
  type OwnerBookingDetailDto,
  type SalonStaffDto,
} from '@barbercue/shared';

/** Column key for bookings with neither an assigned nor a preferred barber. */
export const UNASSIGNED_COLUMN = '__none__';

export function bookingsForDatePath(salonId: string, date: string, cursor?: string): string {
  const params = new URLSearchParams({ date, limit: '50' });
  if (cursor) params.set('cursor', cursor);
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${DASHBOARD_PATHS.bookings}?${params.toString()}`;
}

/** Today's calendar date (YYYY-MM-DD) in the SHOP's time zone, never the phone's. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  if (!year || !month || !day) throw new Error('Could not format the shop date.');
  return `${year}-${month}-${day}`;
}

/** Calendar arithmetic on a YYYY-MM-DD string (no time zone involved, so no DST surprises). */
export function addDays(date: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + delta));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function formatDateHeading(date: string, locale?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  // Noon UTC rendered in UTC: the calendar date shown is exactly the date asked for, in any zone.
  const instant = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(instant);
}

export function formatClock(iso: string, timeZone: string, locale?: string): string {
  return formatZonedDateTime(iso, timeZone, locale, { hour: 'numeric', minute: '2-digit' });
}

export interface ScheduleColumn {
  key: string;
  label: string | null; // null = the "No preference" column (the screen supplies its translated label)
  bookings: OwnerBookingDetailDto[];
}

/**
 * Groups a day's bookings by barber. A booking sits under its ASSIGNED barber (set only at check-in)
 * and otherwise under the customer's PREFERRED barber — never presenting a preference as an
 * assignment (`isPreferredOnly` lets the screen say so). Barbers with nothing booked are omitted;
 * every booking appears exactly once, ordered by start time.
 */
export function groupBookingsByBarber(
  bookings: readonly OwnerBookingDetailDto[],
  staff: readonly SalonStaffDto[],
): ScheduleColumn[] {
  const byKey = new Map<string, OwnerBookingDetailDto[]>();
  for (const booking of bookings) {
    const key = booking.assignedStaffId ?? booking.preferredStaffId ?? UNASSIGNED_COLUMN;
    const list = byKey.get(key) ?? [];
    list.push(booking);
    byKey.set(key, list);
  }
  const sorted = (list: OwnerBookingDetailDto[]) =>
    [...list].sort((a, b) => a.slotStart.localeCompare(b.slotStart) || a.id.localeCompare(b.id));
  const columns: ScheduleColumn[] = [];
  for (const member of staff) {
    const list = byKey.get(member.id);
    if (list) columns.push({ key: member.id, label: member.displayName, bookings: sorted(list) });
    byKey.delete(member.id);
  }
  // A booking tied to a barber who is no longer in the staff list must not vanish: show it under
  // the name the booking itself carries.
  for (const [key, list] of byKey) {
    if (key === UNASSIGNED_COLUMN) continue;
    const first = list[0];
    columns.push({ key, label: first.assignedStaffName ?? first.preferredStaffName ?? '—', bookings: sorted(list) });
  }
  const none = byKey.get(UNASSIGNED_COLUMN);
  if (none) columns.push({ key: UNASSIGNED_COLUMN, label: null, bookings: sorted(none) });
  return columns;
}

export function isPreferredOnly(booking: Pick<OwnerBookingDetailDto, 'assignedStaffId' | 'preferredStaffId'>): boolean {
  return !booking.assignedStaffId && !!booking.preferredStaffId;
}
