import {
  addZonedCalendarDays,
  utcToZonedDateStr,
  zonedDateToDayOfWeek,
  zonedWallTimeToUtc,
} from '../common/timezone/timezone';

/**
 * Reporting periods for the Assistant (owner directive, 5 Nov 2026): "this week", "pichhle 7 din",
 * "is mahine", "last month", "1 se 15 november", ... in English, Hinglish and Hindi (Devanagari is
 * romanized before parsing). A period is resolved to whole calendar days IN THE SHOP'S TIMEZONE,
 * weeks run Monday-Sunday, and the end is exclusive. Pure: no clock or database inside parsePeriod.
 */
export type PeriodSpec =
  | {
      kind:
        | 'today'
        | 'yesterday'
        | 'thisWeek'
        | 'lastWeek'
        | 'thisMonth'
        | 'lastMonth';
    }
  | { kind: 'lastDays'; days: number }
  | { kind: 'range'; from: string; to: string };

export interface ResolvedPeriod {
  spec: PeriodSpec;
  /** Inclusive first and last shop-local calendar days, YYYY-MM-DD. */
  fromDay: string;
  toDay: string;
  /** UTC instants: [start, end). */
  start: Date;
  end: Date;
  label: string;
}

const W = (words: string) => new RegExp(`(?:^|\\s)(?:${words})(?=\\s|$)`, 'u');

const PAST = W(
  'hui|hue|huyi|hua|thi|tha|the|aaye|aayi|aaya|aye|gaye|gayi|gaya|happened|was|were|did',
);
const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  janvari: 1,
  janwari: 1,
  feb: 2,
  february: 2,
  farvari: 2,
  farwari: 2,
  mar: 3,
  march: 3,
  march_: 3,
  apr: 4,
  april: 4,
  aprail: 4,
  may: 5,
  mai: 5,
  jun: 6,
  june: 6,
  joon: 6,
  jul: 7,
  july: 7,
  julai: 7,
  aug: 8,
  august: 8,
  agast: 8,
  sep: 9,
  sept: 9,
  september: 9,
  sitambar: 9,
  oct: 10,
  october: 10,
  aktubar: 10,
  oktobar: 10,
  nov: 11,
  november: 11,
  navambar: 11,
  novembar: 11,
  dec: 12,
  december: 12,
  disambar: 12,
  disembar: 12,
};
const MONTH_RE = Object.keys(MONTHS)
  .filter((m) => !m.endsWith('_'))
  .sort((a, b) => b.length - a.length)
  .join('|');
const TO = '(?:to|se|till|until|tak|-|–|and)';

const pad = (n: number) => String(n).padStart(2, '0');
const validDay = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
};

/** The period a sentence asks about, or null when it names none. */
export function parsePeriod(text: string, year: number): PeriodSpec | null {
  // Sentence punctuation never separates a period from its words ("last month?").
  const t = text.toLowerCase().replace(/[?!,;"'।]/gu, ' ');

  // Custom ISO range: 2026-11-01 to 2026-11-15
  // (the text normaliser turns "-" into spaces, so a date may arrive as "2026 11 01")
  const iso = t.match(
    new RegExp(
      `(\\d{4})[-\\s/](\\d{2})[-\\s/](\\d{2})\\s*${TO}?\\s*(\\d{4})[-\\s/](\\d{2})[-\\s/](\\d{2})`,
      'u',
    ),
  );
  if (iso) {
    const [a, b] = [
      `${iso[1]}-${iso[2]}-${iso[3]}`,
      `${iso[4]}-${iso[5]}-${iso[6]}`,
    ];
    if (
      validDay(+iso[1], +iso[2], +iso[3]) &&
      validDay(+iso[4], +iso[5], +iso[6])
    )
      return a <= b
        ? { kind: 'range', from: a, to: b }
        : { kind: 'range', from: b, to: a };
  }
  // Custom range with month names: "1 se 15 november", "1 nov to 15 nov", "28 oct - 3 nov"
  const named = t.match(
    new RegExp(
      `(\\d{1,2})\\s*(?:(${MONTH_RE})\\s*${TO}?|${TO})\\s*(\\d{1,2})\\s*(${MONTH_RE})(?:\\s+(\\d{4}))?`,
      'u',
    ),
  );
  if (named) {
    const y = named[5] ? +named[5] : year;
    const m2 = MONTHS[named[4]];
    const m1 = named[2] ? MONTHS[named[2]] : m2;
    const y1 = m1 > m2 ? y - 1 : y; // "28 dec - 3 jan"
    const [d1, d2] = [+named[1], +named[3]];
    if (validDay(y1, m1, d1) && validDay(y, m2, d2)) {
      const a = `${y1}-${pad(m1)}-${pad(d1)}`;
      const b = `${y}-${pad(m2)}-${pad(d2)}`;
      return a <= b
        ? { kind: 'range', from: a, to: b }
        : { kind: 'range', from: b, to: a };
    }
  }

  const lastN = t.match(
    /(?:last|past|pichhle|pichle|pichhla|pichla|pichhli|previous|bite|beete)\s+(\d{1,3})\s*(?:days|day|din|dino|dinon)/u,
  );
  if (lastN) {
    const days = Math.min(366, Math.max(1, +lastN[1]));
    return { kind: 'lastDays', days };
  }
  if (
    W(
      'last week|previous week|pichhle hafte|pichle hafte|pichhla hafta|pichla hafta|pichhle week|pichle week|pichhla week|last hafte|pichhle saptah',
    ).test(t)
  )
    return { kind: 'lastWeek' };
  if (
    W(
      'this week|is hafte|iss hafte|is week|iss week|is saptah|current week|ye hafta|yeh hafta|is hafta',
    ).test(t)
  )
    return { kind: 'thisWeek' };
  if (
    W(
      'last month|previous month|pichhle mahine|pichle mahine|pichhla mahina|pichla mahina|pichhle month|pichle month|last mahine',
    ).test(t)
  )
    return { kind: 'lastMonth' };
  if (
    W(
      'this month|is mahine|iss mahine|is month|iss month|current month|ye mahina|yeh mahina|is mahina',
    ).test(t)
  )
    return { kind: 'thisMonth' };
  if (
    W('yesterday|beeta kal|bita kal|kal raat').test(t) ||
    (W('kal').test(t) && PAST.test(t))
  )
    return { kind: 'yesterday' };
  if (W('today|aaj|aj').test(t)) return { kind: 'today' };
  return null;
}

/** Whole shop-local days for a period, as UTC instants. */
export function resolvePeriod(
  spec: PeriodSpec,
  timeZone: string,
  now = new Date(),
): ResolvedPeriod {
  const today = utcToZonedDateStr(now, timeZone);
  const dow = zonedDateToDayOfWeek(today); // 0 = Sunday
  const monday = addZonedCalendarDays(today, -((dow + 6) % 7));
  const [y, m] = today.split('-').map(Number);
  const firstOfMonth = `${y}-${pad(m)}-01`;
  const prevMonthFirst = m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`;
  let fromDay: string;
  let toDay: string;
  let label: string;
  switch (spec.kind) {
    case 'today':
      [fromDay, toDay, label] = [today, today, 'Today'];
      break;
    case 'yesterday': {
      const d = addZonedCalendarDays(today, -1);
      [fromDay, toDay, label] = [d, d, 'Yesterday'];
      break;
    }
    case 'thisWeek':
      [fromDay, toDay, label] = [monday, today, 'This week'];
      break;
    case 'lastWeek':
      [fromDay, toDay, label] = [
        addZonedCalendarDays(monday, -7),
        addZonedCalendarDays(monday, -1),
        'Last week',
      ];
      break;
    case 'thisMonth':
      [fromDay, toDay, label] = [firstOfMonth, today, 'This month'];
      break;
    case 'lastMonth':
      [fromDay, toDay, label] = [
        prevMonthFirst,
        addZonedCalendarDays(firstOfMonth, -1),
        'Last month',
      ];
      break;
    case 'lastDays':
      [fromDay, toDay, label] = [
        addZonedCalendarDays(today, -(spec.days - 1)),
        today,
        `Last ${spec.days} days`,
      ];
      break;
    case 'range':
      [fromDay, toDay, label] = [spec.from, spec.to, 'Selected dates'];
      break;
  }
  const start =
    zonedWallTimeToUtc(fromDay, '00:00', timeZone) ??
    new Date(`${fromDay}T00:00:00Z`);
  const endDay = addZonedCalendarDays(toDay, 1);
  const end =
    zonedWallTimeToUtc(endDay, '00:00', timeZone) ??
    new Date(`${endDay}T00:00:00Z`);
  return {
    spec,
    fromDay,
    toDay,
    start,
    end,
    label: `${label} (${dayText(fromDay)}${fromDay === toDay ? '' : ` – ${dayText(toDay)}`})`,
  };
}

export function dayText(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
