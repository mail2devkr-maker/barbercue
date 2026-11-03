import { AssistantActionId } from '@barbercue/shared';
import { daySpecIn, timesIn, tokenIn, type DaySpec } from './assistant-when';

/**
 * Batch 4 intents (issue #362): seat a queue customer with a barber and chair, start their service,
 * book an in-shop appointment for a walk-up caller, and correct a mistaken no-show. Runs before the
 * other shop rules. The barber, chair, service and booking are never guessed here - the handler
 * resolves them against the shop's live data and asks when anything is missing or ambiguous.
 */
export type Phase4Intent =
  | { action: typeof AssistantActionId.QUEUE_ASSIGN; token: number | null }
  | { action: typeof AssistantActionId.QUEUE_START; token: number | null }
  | {
      action: typeof AssistantActionId.BOOKING_IN_SHOP;
      name: string | null;
      phone: string | null;
      consent: boolean;
      day: DaySpec | null;
      time: string | null;
    }
  | {
      action: typeof AssistantActionId.BOOKING_CORRECT_COMPLETED;
      day: DaySpec | null;
      time: string | null;
    };

const W = (words: string) => new RegExp(`(?:^|\\s)(?:${words})(?=\\s|$)`, 'u');

const ASSIGN = W(
  'assign|baithao|bithao|bitha do|baitha do|seat|allot|de do|bhejo|बैठाओ|असाइन',
);
const START = W('start|shuru|chalu karo|begin|शुरू');
const QUEUE_WORD = W('token|queue|line|टोकन|कतार');
const APPOINTMENT = W('appointment|booking|अपॉइंटमेंट|बुकिंग');
const BOOK = W('book|book karo|banao|bana do|create|fix karo|lagao|बुक');
const MISTAKE = W(
  'galat|galti|wrong|mistake|by mistake|correct|sahi karo|ठीक करो|गलत',
);
const COMPLETED = W(
  'completed|complete|served|ho gaya tha|aaya tha|aa gaya tha|पूरा',
);
const NO_SHOW = W('no show|noshow|no-show');
const CONSENT = W(
  'agreed|agree|consent|manzoor|haan bola|ijazat|permission|sahmati|सहमति|मंज़ूर',
);

const PHONE = /(?:\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5})(?!\d)/u;

/** The guest's name: "for Amit", "Amit ke liye", "Amit ka ...". Never a service or time word. */
function guestName(text: string): string | null {
  const m =
    text.match(
      /(?:^|\s)(?:for|naam|name)\s+(\p{L}[\p{L}\p{M}]{1,30})(?=\s|$)/u,
    ) ??
    text.match(
      /(?:^|\s)(\p{L}[\p{L}\p{M}]{1,30})\s+(?:ke liye|ka|ki|ke|के लिए|का|की)(?=\s|$)/u,
    );
  const n = m?.[1];
  if (
    !n ||
    /^(kal|aaj|parso|today|tomorrow|shaam|subah|raat|appointment|booking|ek|naya|new)$/u.test(
      n,
    )
  )
    return null;
  return n.replace(/^(\p{Ll})/u, (c) => c.toLocaleUpperCase('en-US'));
}

export function parsePhase4(
  text: string,
  raw: string,
  year: number,
): Phase4Intent | null {
  const token = tokenIn(text);
  if (token !== null || QUEUE_WORD.test(text)) {
    if (ASSIGN.test(text) && !START.test(text))
      return { action: AssistantActionId.QUEUE_ASSIGN, token };
    if (START.test(text) && !APPOINTMENT.test(text))
      return { action: AssistantActionId.QUEUE_START, token };
  }
  if (
    APPOINTMENT.test(text) &&
    NO_SHOW.test(text) &&
    (MISTAKE.test(text) || COMPLETED.test(text))
  ) {
    return {
      action: AssistantActionId.BOOKING_CORRECT_COMPLETED,
      day: daySpecIn(text, year),
      time: timesIn(text)[0] ?? null,
    };
  }
  if (APPOINTMENT.test(text) && BOOK.test(text)) {
    const m = raw.match(PHONE);
    return {
      action: AssistantActionId.BOOKING_IN_SHOP,
      name: guestName(text),
      phone: m ? `+91${m[1].replace(/[\s-]/g, '')}` : null,
      consent: CONSENT.test(text),
      day: daySpecIn(text, year),
      time: timesIn(text)[0] ?? null,
    };
  }
  return null;
}
