export const INDIA_TIME_ZONE = 'Asia/Kolkata';

interface SalonTimeZoneSource {
  timezone?: string | null;
  countryCode?: string | null;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function partsFor(date: Date, timeZone: string): ZonedParts {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (
      part.type === 'year' ||
      part.type === 'month' ||
      part.type === 'day' ||
      part.type === 'hour' ||
      part.type === 'minute' ||
      part.type === 'second'
    ) {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
  };
}

export function isValidTimeZone(
  value: string | null | undefined,
): value is string {
  if (!value?.trim()) return false;
  try {
    formatterFor(value.trim()).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * The salon's explicit IANA zone is authoritative. India is the sole safe country fallback:
 * every Indian shop uses Asia/Kolkata and the pre-global product already stored its wall times
 * that way. Multi-zone countries remain unknown rather than being guessed from country/city.
 */
export function resolveSalonTimeZone(
  source: SalonTimeZoneSource,
): string | null {
  const explicit = source.timezone?.trim();
  if (isValidTimeZone(explicit)) return explicit;
  return source.countryCode?.toUpperCase() === 'IN' ? INDIA_TIME_ZONE : null;
}

export function zonedDateToDayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function utcToZonedDateStr(date: Date, timeZone: string): string {
  const parts = partsFor(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function zonedHourOf(date: Date, timeZone: string): number {
  return partsFor(date, timeZone).hour;
}

/**
 * Converts an IANA-zone wall time to an instant without a fixed-offset assumption. The iterative
 * correction uses Intl's offset at the candidate instant, so DST changes are respected. A local
 * time that does not exist (for example 01:30 during a spring-forward gap) returns null instead
 * of silently moving the booking to a different wall-clock time.
 *
 * The symmetric case — a local time that occurs *twice*, during a fall-back (e.g. 01:30 on the
 * November date America/New_York's clocks repeat an hour) — is deterministic but not flagged: the
 * loop starts from the naive UTC-as-local interpretation and converges on whichever occurrence
 * that starting point's offset lands on first, which is always the earlier (pre-transition, e.g.
 * DST/summer) instant for every zone, not the later (post-transition, standard) one. This is a
 * real, confirmed asymmetry with the spring-forward case above (which explicitly detects its
 * ambiguity and returns null); it stays unflagged here deliberately rather than guessing which of
 * the two valid instants a caller "meant." In practice this never affects a real booking/schedule
 * in this codebase — every wall time run through this function is a barbershop operating hour,
 * slot boundary, or day boundary, and no salon opens/closes/generates a queue-token day-reset
 * inside a 1-3am fall-back window — but a caller working outside that domain should not assume
 * this is a full disambiguation. See timezone.spec.ts's "pins down the deterministic (but
 * unflagged) instant chosen during a DST fall-back" test for the exact, tested behavior.
 */
export function zonedWallTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): Date | null {
  if (!isValidTimeZone(timeZone)) return null;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }

  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desiredAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = partsFor(new Date(candidate), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
    );
    const correction = desiredAsUtc - observedAsUtc;
    if (correction === 0) break;
    candidate += correction;
  }

  const result = new Date(candidate);
  const actual = partsFor(result, timeZone);
  if (
    actual.year !== year ||
    actual.month !== month ||
    actual.day !== day ||
    actual.hour !== hour ||
    actual.minute !== minute
  ) {
    return null;
  }
  return result;
}

export function addZonedCalendarDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, '0')}-${String(result.getUTCDate()).padStart(2, '0')}`;
}

export function zonedDayBounds(
  reference: Date,
  timeZone: string,
): { date: string; start: Date; end: Date } | null {
  const date = utcToZonedDateStr(reference, timeZone);
  const start = zonedWallTimeToUtc(date, '00:00', timeZone);
  const end = zonedWallTimeToUtc(
    addZonedCalendarDays(date, 1),
    '00:00',
    timeZone,
  );
  return start && end ? { date, start, end } : null;
}

export function isOpenAt(
  hours: {
    dayOfWeek: number;
    isClosed: boolean;
    openTime: string;
    closeTime: string;
  }[],
  timeZone: string | null,
  now = new Date(),
): boolean | null {
  if (!timeZone || hours.length === 0) return null;
  const local = partsFor(now, timeZone);
  const date = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
  const today = hours.find(
    (entry) => entry.dayOfWeek === zonedDateToDayOfWeek(date),
  );
  if (!today) return null;
  if (today.isClosed) return false;
  const [openHour, openMinute] = today.openTime.split(':').map(Number);
  const [closeHour, closeMinute] = today.closeTime.split(':').map(Number);
  const minutesNow = local.hour * 60 + local.minute;
  return (
    minutesNow >= openHour * 60 + openMinute &&
    minutesNow < closeHour * 60 + closeMinute
  );
}
