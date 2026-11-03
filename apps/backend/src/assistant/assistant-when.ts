/**
 * Days and clock times as people say them in English, Hindi and Hinglish. Pure helpers: they turn
 * words into a day offset / weekday and "HH:mm" strings. Converting to an instant always uses the
 * shop's own time zone on the server, and every write shows the exact date and time in its preview.
 */

export type DaySpec =
  | { kind: 'offset'; days: number }
  | { kind: 'weekday'; dow: number }
  | { kind: 'date'; iso: string };

const WEEKDAYS: Array<[number, RegExp]> = [
  [0, /(?:^|\s)(?:sunday|sun|ravivar|itvaar|itwar|रविवार|इतवार)(?=\s|$)/u],
  [1, /(?:^|\s)(?:monday|mon|somvar|somwar|सोमवार)(?=\s|$)/u],
  [2, /(?:^|\s)(?:tuesday|tue|tues|mangalvar|mangalwar|मंगलवार)(?=\s|$)/u],
  [3, /(?:^|\s)(?:wednesday|wed|budhvar|budhwar|बुधवार)(?=\s|$)/u],
  [
    4,
    /(?:^|\s)(?:thursday|thu|thurs|guruvar|guruwar|brihaspativar|गुरुवार|बृहस्पतिवार)(?=\s|$)/u,
  ],
  [5, /(?:^|\s)(?:friday|fri|shukravar|shukrawar|शुक्रवार)(?=\s|$)/u],
  [6, /(?:^|\s)(?:saturday|sat|shanivar|shaniwar|शनिवार)(?=\s|$)/u],
];

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

/** Every weekday named in the text, in week order. */
export function weekdaysIn(text: string): number[] {
  return WEEKDAYS.filter(([, re]) => re.test(text)).map(([d]) => d);
}

export function everyDay(text: string): boolean {
  return /(?:^|\s)(?:every day|everyday|daily|all days|har din|roz|rozana|सभी दिन|हर दिन|रोज़|रोज)(?=\s|$)/u.test(
    text,
  );
}

export function daySpecIn(text: string, year: number): DaySpec | null {
  if (/(?:^|\s)(?:day after tomorrow|parso|parson|परसों)(?=\s|$)/u.test(text))
    return { kind: 'offset', days: 2 };
  if (/(?:^|\s)(?:tomorrow|kal|कल)(?=\s|$)/u.test(text))
    return { kind: 'offset', days: 1 };
  if (/(?:^|\s)(?:today|aaj|आज)(?=\s|$)/u.test(text))
    return { kind: 'offset', days: 0 };
  const dm = text.match(
    /(?:^|\s)(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?=\s|$)/u,
  );
  if (dm) {
    const iso = `${year}-${String(MONTHS.indexOf(dm[2]) + 1).padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
    return { kind: 'date', iso };
  }
  const wd = weekdaysIn(text);
  return wd.length === 1 ? { kind: 'weekday', dow: wd[0] } : null;
}

/** ISO date for a DaySpec, given the shop-local "today" (YYYY-MM-DD) and its weekday. */
export function resolveDay(
  spec: DaySpec,
  todayIso: string,
  todayDow: number,
): string {
  if (spec.kind === 'date') return spec.iso;
  const days =
    spec.kind === 'offset' ? spec.days : (spec.dow - todayDow + 7) % 7;
  const [y, m, d] = todayIso.split('-').map(Number);
  const r = new Date(Date.UTC(y, m - 1, d + days));
  return `${r.getUTCFullYear()}-${String(r.getUTCMonth() + 1).padStart(2, '0')}-${String(r.getUTCDate()).padStart(2, '0')}`;
}

const MORNING = /(?:^|\s)(?:morning|subah|sube|सुबह)(?=\s|$)/u;
const EVENING =
  /(?:^|\s)(?:evening|shaam|sham|raat|night|dopahar|afternoon|शाम|रात|दोपहर)(?=\s|$)/u;

/**
 * Clock times in order of appearance, as "HH:mm". A time needs a marker (am/pm, baje, a colon) unless
 * `bareHours` is set (opening hours: "10 se 8"). Without am/pm, 1–7 is read as afternoon/evening
 * unless "subah"/"morning" is said — salons rarely open at 2 a.m. — and the preview shows the result.
 */
export function timesIn(text: string, bareHours = false): string[] {
  const out: string[] = [];
  const morning = MORNING.test(text);
  const evening = EVENING.test(text);
  const re =
    /(?:^|\s)(\d{1,2})(?:[:.](\d{2}))?\s*(am|a\.m|pm|p\.m|baje|bje|बजे)?(?=\s|$)/gu;
  for (const m of text.matchAll(re)) {
    const marker = m[3] ?? '';
    const hasColon = m[2] !== undefined;
    if (!marker && !hasColon && !bareHours) continue;
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h > 23 || min > 59) continue;
    if (marker.startsWith('p') && h < 12) h += 12;
    else if (marker.startsWith('a') && h === 12) h = 0;
    else if (
      !marker.startsWith('a') &&
      !marker.startsWith('p') &&
      h >= 1 &&
      h <= 7 &&
      !morning
    )
      h += 12;
    // "raat 8 baje" / "shaam 8": an evening word moves any hour said without am/pm to the evening.
    else if (!/^[ap]/.test(marker) && evening && h < 12 && h >= 1) h += 12;
    // Opening hours: "10 se 8" closes at 20:00 - a bare closing hour not after the opening hour is p.m.
    if (bareHours && !/^[ap]/.test(marker) && out.length && h < 12) {
      const prev = out[out.length - 1];
      if (
        `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` <= prev
      )
        h += 12;
    }
    out.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return out;
}

export function tokenIn(text: string): number | null {
  const m =
    text.match(/(?:token|tokan|टोकन|number|no|#)\s*(\d{1,4})(?=\s|$)/u) ??
    text.match(/#(\d{1,4})/u);
  return m ? Number(m[1]) : null;
}

export const DAY_LABEL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
