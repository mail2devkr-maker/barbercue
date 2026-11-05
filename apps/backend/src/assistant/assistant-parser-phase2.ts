import { AssistantActionId } from '@barbercue/shared';
import {
  daySpecIn,
  everyDay,
  timesIn,
  tokenIn,
  weekdaysIn,
  type DaySpec,
} from './assistant-when';

/**
 * Phase 2 intents (issue #362): opening hours, Live Queue operations, the shop's appointment
 * schedule, customers, renames/durations, and customer self-service. Runs BEFORE the Phase 1 rules
 * so "10 se 8 baje" or "5 baje se 6 baje" is read as time, never as a price.
 */
export type Phase2Intent =
  | { action: typeof AssistantActionId.HOURS_VIEW }
  | {
      action: typeof AssistantActionId.HOURS_SET;
      days: number[] | 'all';
      open: string | null;
      close: string | null;
      closed: boolean;
    }
  | { action: typeof AssistantActionId.QUEUE_CALL_NEXT }
  | {
      action: typeof AssistantActionId.QUEUE_MARK_ARRIVED;
      token: number | null;
    }
  | { action: typeof AssistantActionId.QUEUE_NO_SHOW; token: number | null }
  | { action: typeof AssistantActionId.QUEUE_CANCEL; token: number | null }
  | { action: typeof AssistantActionId.QUEUE_COMPLETE; token: number | null }
  | {
      action: typeof AssistantActionId.QUEUE_ADD_WALK_IN;
      name: string | null;
      phoneMentioned: boolean;
    }
  | { action: typeof AssistantActionId.SCHEDULE_VIEW; day: DaySpec | null }
  | {
      action: typeof AssistantActionId.BOOKING_CANCEL_BY_SHOP;
      day: DaySpec | null;
      time: string | null;
    }
  | {
      action: typeof AssistantActionId.BOOKING_RESCHEDULE_BY_SHOP;
      day: DaySpec | null;
      from: string | null;
      to: string | null;
    }
  | { action: typeof AssistantActionId.CUSTOMERS_FIND; query: string | null }
  | {
      action: typeof AssistantActionId.STAFF_RENAME;
      target: string;
      newName: string | null;
    }
  | {
      action: typeof AssistantActionId.SERVICE_RENAME;
      target: string;
      newName: string | null;
    }
  | {
      action: typeof AssistantActionId.SERVICE_SET_DURATION;
      minutes: number | null;
    }
  | { action: typeof AssistantActionId.MY_BOOKINGS }
  | { action: typeof AssistantActionId.MY_BOOKING_CANCEL }
  | {
      action: typeof AssistantActionId.MY_BOOKING_RESCHEDULE;
      day: DaySpec | null;
      time: string | null;
    }
  | { action: typeof AssistantActionId.MY_QUEUE_STATUS }
  | { action: typeof AssistantActionId.MY_QUEUE_LEAVE }
  | {
      action: typeof AssistantActionId.BOOK_APPOINTMENT;
      day: DaySpec | null;
      time: string | null;
    };

const W = (words: string) => new RegExp(`(?:^|\\s)(?:${words})(?=\\s|$)`, 'u');

const HOURS = W(
  'hours|timing|timings|time table|opening|khulta|khulti|khulega|khulegi|khulna|band hota|samay|समय|टाइमिंग|खुलता|खुलती|खुलेगा',
);
const CLOSED = W('closed|close|band|chutti|holiday|off|बंद|छुट्टी');
const SHOW = W(
  'show|list|dikhao|dikha|batao|bata|kab|when|what|kya|दिखाओ|बताओ|कब',
);
const QUEUE = W('queue|line|kataar|katar|कतार|क्यू|token|टोकन');
const NEXT = W('next|agla|agle|अगला|अगले');
const CALL = W('call|bulao|bulaao|bula|बुलाओ|बुला');
const ARRIVED = W(
  'arrived|aa gaya|aa gayi|aagaya|pahunch|pahuch|aaya|आ गया|आ गई|पहुंच',
);
const NO_SHOW = W(
  'no show|noshow|no-show|nahi aaya|nahin aaya|nahi aayi|नहीं आया',
);
const CANCEL = W('cancel|radd|hatao|hata do|nikalo|रद्द|हटाओ|कैंसल');
const COMPLETE = W(
  'complete|completed|done|ho gaya|khatam|finish|finished|पूरा|हो गया|खत्म',
);
const WALK_IN = W(
  'walk in|walkin|walk-in|queue mein add|queue me add|line mein add|queue mein daalo|queue me daalo',
);
const APPOINTMENT = W(
  'appointment|appointments|booking|bookings|schedule|अपॉइंटमेंट|बुकिंग',
);
const RESCHEDULE = W(
  'reschedule|shift|move|badlo|badal|change time|time change|aage|peeche|बदलो|बदल',
);
const CUSTOMERS = W('customer|customers|client|clients|grahak|ग्राहक');
const MINE = W('my|mera|meri|mere|mujhe|main|मेरा|मेरी|मेरे|मुझे');
const LEAVE = W(
  'leave|chhod|chhodo|chod|nikal|nikalo|hata|hatao|hatana|remove|छोड़|हटा|हटाओ|निकालो',
);
// "How many customers are in the line" asks about the queue, not the customer directory.
const HOW_MANY = W('kitne|kitna|kitni|how many|कितने|कितना|कितनी');
const STATUS = W(
  'status|kitna|kitne|kab|position|number|wait|intezar|स्थिति|कितना|कब',
);
const BOOK = W(
  'book|booking karo|book karo|appointment chahiye|appointment lena|बुक',
);
const NAME = W('naam|name|rename|नाम');
const STAFF = W('staff|barber|stylist|स्टाफ');
const SERVICE = W('service|सर्विस|सेवा');
const DURATION = /(\d{1,3})\s*(?:min|mins|minute|minutes|मिनट)(?=\s|$)/u;

function after(text: string, words: RegExp): string {
  const m = words.exec(text);
  return m ? text.slice(m.index + m[0].length).trim() : '';
}

function walkInName(text: string): string | null {
  const cleaned = text
    .replace(WALK_IN, ' ')
    .replace(/\d+/g, ' ')
    .split(' ')
    .filter(
      (w) =>
        w &&
        ![
          'add',
          'karo',
          'kar',
          'do',
          'ko',
          'customer',
          'naya',
          'new',
          'a',
          'the',
          'to',
          'in',
          'mein',
          'me',
          'queue',
          'line',
          'walk',
          'in',
          'with',
          'phone',
          'mobile',
        ].includes(w),
    )
    .join(' ')
    .trim();
  if (!cleaned || cleaned.length > 60) return null;
  return cleaned.replace(
    /(^|\s)(\p{Ll})/gu,
    (_m, s: string, c: string) => s + c.toLocaleUpperCase('en-US'),
  );
}

function renameParts(text: string): { target: string; newName: string | null } {
  // "rename X to Y", "change name of X to Y", "X ka naam Y karo/rakho"
  const en = text.match(
    /(?:rename|change (?:the )?name of)\s+(.+?)\s+to\s+(.+)$/u,
  );
  if (en) return { target: en[1], newName: tidy(en[2]) };
  const hi = text.match(
    /^(.+?)\s+(?:ka|ki|ke|का|की|के)\s+(?:naam|name|नाम)\s+(.+?)\s+(?:karo|kar do|rakho|rakh do|करो|रखो)$/u,
  );
  if (hi) return { target: hi[1], newName: tidy(hi[2]) };
  return { target: text, newName: null };
}

function tidy(name: string): string | null {
  const n = name
    .replace(/(?:^|\s)(?:staff|service|सर्विस|स्टाफ)(?=\s|$)/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n || n.length > 120) return null;
  return n.replace(
    /(^|\s)(\p{Ll})/gu,
    (_m, s: string, c: string) => s + c.toLocaleUpperCase('en-US'),
  );
}

export function parsePhase2(
  text: string,
  surface: 'shop' | 'customer',
  year: number,
): Phase2Intent | null {
  const customer =
    surface === 'customer' ||
    (MINE.test(text) && !STAFF.test(text) && !CUSTOMERS.test(text));

  // ---- customer self-service
  if (customer) {
    if (QUEUE.test(text) && LEAVE.test(text))
      return { action: AssistantActionId.MY_QUEUE_LEAVE };
    if (
      QUEUE.test(text) &&
      (STATUS.test(text) || SHOW.test(text) || MINE.test(text))
    )
      return { action: AssistantActionId.MY_QUEUE_STATUS };
    if (APPOINTMENT.test(text) || BOOK.test(text)) {
      if (CANCEL.test(text))
        return { action: AssistantActionId.MY_BOOKING_CANCEL };
      const times = timesIn(text);
      // "book ..." is a new appointment; a time said about MY existing appointment moves it.
      if (BOOK.test(text)) {
        return {
          action: AssistantActionId.BOOK_APPOINTMENT,
          day: daySpecIn(text, year),
          time: times[0] ?? null,
        };
      }
      if (RESCHEDULE.test(text) || (times.length && MINE.test(text))) {
        return {
          action: AssistantActionId.MY_BOOKING_RESCHEDULE,
          day: daySpecIn(text, year),
          time: times[times.length - 1] ?? null,
        };
      }
      if (times.length && !SHOW.test(text)) {
        return {
          action: AssistantActionId.BOOK_APPOINTMENT,
          day: daySpecIn(text, year),
          time: times[0] ?? null,
        };
      }
      return { action: AssistantActionId.MY_BOOKINGS };
    }
    if (surface === 'customer') return null;
  }

  // ---- opening hours
  if (
    HOURS.test(text) ||
    (CLOSED.test(text) &&
      (weekdaysIn(text).length || everyDay(text)) &&
      !APPOINTMENT.test(text) &&
      !QUEUE.test(text))
  ) {
    const days = everyDay(text) ? 'all' : weekdaysIn(text);
    const times = timesIn(text, true);
    const closed = CLOSED.test(text) && times.length < 2;
    if ((days === 'all' || days.length) && (closed || times.length >= 2)) {
      return {
        action: AssistantActionId.HOURS_SET,
        days,
        open: times[0] ?? null,
        close: times[1] ?? null,
        closed,
      };
    }
    if (SHOW.test(text) || HOURS.test(text))
      return { action: AssistantActionId.HOURS_VIEW };
  }

  // ---- renames and durations (explicit "naam"/"rename" or a duration with no price)
  if (NAME.test(text) && (STAFF.test(text) || SERVICE.test(text))) {
    const { target, newName } = renameParts(text);
    return STAFF.test(text)
      ? { action: AssistantActionId.STAFF_RENAME, target, newName }
      : { action: AssistantActionId.SERVICE_RENAME, target, newName };
  }
  if (
    DURATION.test(text) &&
    !/(?:₹|rs|rupees|rupaye|price|daam|rate|add|jodo|naya|new)/u.test(text)
  ) {
    return {
      action: AssistantActionId.SERVICE_SET_DURATION,
      minutes: Number(text.match(DURATION)![1]),
    };
  }

  // ---- Live Queue operations (shop side)
  if (WALK_IN.test(text)) {
    return {
      action: AssistantActionId.QUEUE_ADD_WALK_IN,
      name: walkInName(text),
      phoneMentioned: /\d{10}/.test(text.replace(/\s/g, '')),
    };
  }
  const token = tokenIn(text);
  if (
    NEXT.test(text) &&
    (CALL.test(text) || QUEUE.test(text) || CUSTOMERS.test(text))
  )
    return { action: AssistantActionId.QUEUE_CALL_NEXT };
  if (token !== null || (QUEUE.test(text) && !SHOW.test(text))) {
    if (NO_SHOW.test(text))
      return { action: AssistantActionId.QUEUE_NO_SHOW, token };
    if (ARRIVED.test(text))
      return { action: AssistantActionId.QUEUE_MARK_ARRIVED, token };
    if (COMPLETE.test(text))
      return { action: AssistantActionId.QUEUE_COMPLETE, token };
    if (CANCEL.test(text))
      return { action: AssistantActionId.QUEUE_CANCEL, token };
    if (CALL.test(text) && token !== null)
      return { action: AssistantActionId.QUEUE_CALL_NEXT };
  }

  // ---- appointment schedule (shop side)
  if (APPOINTMENT.test(text)) {
    const times = timesIn(text);
    if (CANCEL.test(text))
      return {
        action: AssistantActionId.BOOKING_CANCEL_BY_SHOP,
        day: daySpecIn(text, year),
        time: times[0] ?? null,
      };
    if (RESCHEDULE.test(text) || times.length >= 2) {
      // "7 baje wala ... 8 baje kar do": a later hour said without am/pm stays in the same half of the day.
      if (
        times.length >= 2 &&
        !/(?:^|\s)(?:am|pm|a\.m|p\.m|subah|morning)(?=\s|$)/u.test(text)
      ) {
        const [fh] = times[0].split(':').map(Number);
        const [th, tm] = times[times.length - 1].split(':').map(Number);
        if (fh >= 12 && th < 12)
          times[times.length - 1] =
            `${String(th + 12).padStart(2, '0')}:${String(tm).padStart(2, '0')}`;
      }
      return {
        action: AssistantActionId.BOOKING_RESCHEDULE_BY_SHOP,
        day: daySpecIn(text, year),
        from: times.length >= 2 ? times[0] : null,
        to: times[times.length - 1] ?? null,
      };
    }
    return {
      action: AssistantActionId.SCHEDULE_VIEW,
      day: daySpecIn(text, year),
    };
  }

  // ---- customers directory (a head-count of the waiting line is a queue question instead)
  if (CUSTOMERS.test(text) && !(QUEUE.test(text) && HOW_MANY.test(text))) {
    const query = after(text, CUSTOMERS)
      .replace(SHOW, ' ')
      .replace(
        /(?:^|\s)(?:ka|ki|ke|history|find|search|dhundo|khojo|naam|named)(?=\s|$)/gu,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim();
    return {
      action: AssistantActionId.CUSTOMERS_FIND,
      query: query.length >= 2 ? query : null,
    };
  }
  return null;
}
