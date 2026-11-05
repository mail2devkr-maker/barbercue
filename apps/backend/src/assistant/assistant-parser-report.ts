import { AssistantActionId } from '@barbercue/shared';
import { parsePeriod, type PeriodSpec } from './assistant-period';

/**
 * Period reports (owner directive, 5 Nov 2026): bookings and queue activity for a period the owner
 * names - "this week's bookings", "pichhle 7 din mein kitni bookings hui", "is mahine kitne customers
 * queue mein aaye", "booking cancellations for this month", "1 se 15 november ki bookings".
 *
 * Both intents are READS. A sentence phrased as a change ("cancel karo", "book karo", "add") is never
 * a report, so a report cannot shadow a write. The live queue ("queue mein abhi kitne hain") stays the
 * live-status read; only a question about a period (or "aaj ... aaye", past tense) is queue history.
 */
export type ReportStatus =
  'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'PENDING_PAYMENT';

export type ReportIntent =
  | {
      action: typeof AssistantActionId.BOOKINGS_REPORT;
      period: PeriodSpec;
      status: ReportStatus | null;
      page: number;
    }
  | {
      action: typeof AssistantActionId.QUEUE_HISTORY;
      period: PeriodSpec;
      page: number;
    };

const W = (words: string) => new RegExp(`(?:^|\\s)(?:${words})(?=\\s|$)`, 'u');

const BOOKINGS = W('bookings|booking|appointments|appointment|bookingss');
const QUEUE = W(
  'queue|line|kataar|katar|walk ins|walk in|walkins|walkin|token|tokens',
);
const CANCELLED = W(
  'cancellations|cancellation|cancelled|canceled|cancel hui|cancel hue|cancel huyi|radd',
);
const COMPLETED = W(
  'completed|complete hui|complete hue|done|served|poori|puri',
);
const NO_SHOW = W('no show|no shows|noshow|nahi aaye|nahin aaye');
const UPCOMING = W('confirmed|upcoming|aane wali|aane wale');
// Phrased as a change: never a report.
const CHANGE = W(
  'karo|kar do|kardo|kar dijiye|kijiye|karein|karna hai|book karo|cancel karo|add|jodo|hatao|delete|reschedule|badlo|change|set|move',
);
const NOW = W('abhi|now|right now|currently|is waqt|filhal');
const PAST = W(
  'aaye|aayi|aaya|aye|aai|hue|hui|huyi|hua|came|joined|served|visited|the|thi|tha|were|was|happened|did',
);
const PAGE = /(?:^|\s)page\s+(\d{1,3})(?=\s|$)/u;
// One specific appointment ("aaj 5 baje wala appointment no show") is about a booking, not a report.
const ONE_BOOKING =
  /(?:\d{1,2}\s*(?:baje|bje|am|pm)|\d{1,2}:\d{2}|(?:^|\s)(?:wala|wali|wale|token|number)(?=\s|$))/u;
// Where bookings came from is the booking-sources read.
const SOURCES = W(
  'kahan se|kaha se|where|come from|came from|source|sources|channel|channels',
);

export function parseReport(text: string, year: number): ReportIntent | null {
  if (CHANGE.test(text) || ONE_BOOKING.test(text) || SOURCES.test(text))
    return null;
  const period = parsePeriod(text, year);
  if (!period) return null;
  const pageMatch = text.match(PAGE);
  const page = pageMatch ? Math.max(1, Math.min(100, +pageMatch[1])) : 1;

  // Cancellation figures without the word "booking" stay the cancellations analytics read.
  if (BOOKINGS.test(text)) {
    // Today's appointment list stays the existing schedule read; a count or status for today is a report.
    if (
      period.kind === 'today' &&
      !/(?:kitni|kitne|how many|count|total)/u.test(text)
    )
      return null;
    const status: ReportStatus | null = CANCELLED.test(text)
      ? 'CANCELLED'
      : NO_SHOW.test(text)
        ? 'NO_SHOW'
        : COMPLETED.test(text)
          ? 'COMPLETED'
          : UPCOMING.test(text)
            ? 'CONFIRMED'
            : null;
    return { action: AssistantActionId.BOOKINGS_REPORT, period, status, page };
  }
  if (QUEUE.test(text)) {
    // "queue mein abhi kitne hain" / "aaj queue mein kitne hain" ask about the LIVE queue.
    if (NOW.test(text)) return null;
    if (period.kind === 'today' && !PAST.test(text)) return null;
    return { action: AssistantActionId.QUEUE_HISTORY, period, page };
  }
  return null;
}

/** "aur last month?", "pichhle hafte ka?", "aur dikhao", "page 2": a follow-up to the previous report. */
export function parseReportFollowUp(
  text: string,
  previous: ReportIntent,
  previousPage: number,
  year: number,
): ReportIntent | null {
  text = text.toLowerCase().replace(/[?!,;"'।]/gu, ' ');
  if (CHANGE.test(text)) return null;
  if (BOOKINGS.test(text) || QUEUE.test(text)) return null; // a full new question, parsed on its own
  const more = W(
    'aur dikhao|more|show more|next|next page|aage|aage dikhao|baaki|baki',
  ).test(text);
  const pageMatch = text.match(PAGE);
  const period = parsePeriod(text, year);
  if (!period && !more && !pageMatch) return null;
  const page = pageMatch
    ? Math.max(1, Math.min(100, +pageMatch[1]))
    : more
      ? previousPage + 1
      : 1;
  return { ...previous, period: period ?? previous.period, page };
}
