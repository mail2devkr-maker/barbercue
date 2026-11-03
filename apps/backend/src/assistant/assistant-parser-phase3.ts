import { AssistantActionId } from '@barbercue/shared';
import {
  daySpecIn,
  everyDay,
  timesIn,
  weekdaysIn,
  type DaySpec,
} from './assistant-when';

/**
 * Batch 3 intents (issue #362): chairs, staff weekly hours, appointment no-show, offers, reviews,
 * invoices, revenue report, notifications, customer queue join / favorites / invoices, and
 * read-only platform figures. Runs BEFORE Phase 2 so more specific phrases win ("appointment no
 * show" is a booking no-show, "queue mein lagao" joins rather than shows status).
 */
export type Phase3Intent =
  | { action: typeof AssistantActionId.CHAIRS_LIST }
  | { action: typeof AssistantActionId.CHAIRS_ADD; label: string | null }
  | {
      action: typeof AssistantActionId.CHAIRS_SET_STATUS;
      status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';
    }
  | { action: typeof AssistantActionId.STAFF_HOURS_VIEW }
  | {
      action: typeof AssistantActionId.STAFF_HOURS_SET;
      days: number[] | 'all';
      open: string | null;
      close: string | null;
      closed: boolean;
    }
  | {
      action: typeof AssistantActionId.BOOKING_NO_SHOW;
      day: DaySpec | null;
      time: string | null;
    }
  | { action: typeof AssistantActionId.OFFERS_LIST }
  | { action: typeof AssistantActionId.OFFERS_PAUSE }
  | { action: typeof AssistantActionId.OFFERS_PUBLISH }
  | { action: typeof AssistantActionId.REVIEWS_LIST }
  | { action: typeof AssistantActionId.REVIEWS_REPLY; reply: string | null }
  | { action: typeof AssistantActionId.INVOICES_LIST }
  | {
      action: typeof AssistantActionId.REVENUE_REPORT;
      range: 'today' | 'week' | 'month';
    }
  | { action: typeof AssistantActionId.NOTIFICATIONS_LIST }
  | { action: typeof AssistantActionId.NOTIFICATIONS_READ_ALL }
  | { action: typeof AssistantActionId.MY_QUEUE_JOIN }
  | { action: typeof AssistantActionId.MY_FAVORITES }
  | { action: typeof AssistantActionId.MY_FAVORITE_ADD }
  | { action: typeof AssistantActionId.MY_FAVORITE_REMOVE }
  | { action: typeof AssistantActionId.MY_INVOICES }
  | { action: typeof AssistantActionId.ADMIN_OVERVIEW }
  | { action: typeof AssistantActionId.ADMIN_SHOP_STATUS };

const W = (words: string) => new RegExp(`(?:^|\\s)(?:${words})(?=\\s|$)`, 'u');

const CHAIR = W('chair|chairs|kursi|kursiyan|कुर्सी|कुर्सियां');
const STAFF = W('staff|barber|stylist|स्टाफ|नाई');
const STAFF_HOURS = W(
  'off|chutti|weekly off|hours|timing|timings|shift|kaam|duty|छुट्टी|शिफ्ट',
);
const ADD = W('add|jodo|jod|naya|nayi|new|lagao|daalo|जोड़ो|नया|नई');
const REMOVE = W('remove|hatao|hata|hata do|nikalo|हटाओ|हटा');
const DEACTIVATE = W('deactivate|disable|inactive|band|बंद');
const MAINTENANCE = W('maintenance|repair|kharab|theek|ठीक|खराब');
const ACTIVATE = W('activate|enable|active|chalu|wapas|चालू|वापस');
const SHOW = W(
  'show|list|dikhao|dikha|batao|bata|kaun|kya|which|dikhaye|दिखाओ|बताओ',
);
const APPOINTMENT = W(
  'appointment|appointments|booking|bookings|अपॉइंटमेंट|बुकिंग',
);
const NO_SHOW = W(
  'no show|noshow|no-show|nahi aaya|nahin aaya|nahi aayi|नहीं आया',
);
const OFFER = W('offer|offers|deal|deals|discount|ऑफर|छूट');
const PAUSE = W('pause|stop|rok|roko|band|बंद|रोको');
const PUBLISH = W('publish|live|launch|chalu|start|shuru|चालू|शुरू');
const REVIEW = W('review|reviews|rating|ratings|feedback|समीक्षा|रिव्यू');
const REPLY = W('reply|jawab|javab|respond|answer|जवाब');
const INVOICE = W('invoice|invoices|bill|bills|बिल');
const REPORT = W(
  'report|week|weekly|month|monthly|hafta|hafte|mahina|mahine|हफ्ते|महीने|रिपोर्ट',
);
const MONEY = W(
  'sales|revenue|kamai|earning|earnings|collection|business|बिक्री|कमाई',
);
const MONTH = W('month|monthly|mahina|mahine|महीने|महीना');
const NOTIFICATION = W(
  'notification|notifications|alert|alerts|suchna|सूचना|नोटिफिकेशन',
);
const READ_ALL = W('read|padh|padha|padh liya|mark|clear|saaf|पढ़');
const QUEUE = W('queue|line|kataar|katar|कतार|क्यू');
const JOIN = W('join|lagao|lag jao|lagna|shamil|naam likho|मुझे लगाओ|शामिल');
const FAVORITE = W(
  'favorite|favorites|favourite|favourites|pasand|pasandida|saved|पसंदीदा|पसंद',
);
const SHOPS = W('shops|salons|dukanen|dukaanein|दुकानें|सैलून');
const OPEN_STATUS = W('open|khuli|khule|band|closed|status|खुली|बंद');
const OVERVIEW = W(
  'overview|summary|dashboard|kpi|kpis|business|platform|saaransh|सारांश',
);

function chairLabel(text: string): string | null {
  const words = text
    .split(' ')
    .filter(
      (w) =>
        w &&
        !CHAIR.test(w) &&
        !ADD.test(w) &&
        ![
          'karo',
          'kar',
          'do',
          'ek',
          'a',
          'the',
          'named',
          'naam',
          'ka',
          'ki',
          'ke',
        ].includes(w),
    );
  const label = words.join(' ').trim();
  if (!label || label.length > 60) return null;
  // "Chair 3" loses its first word above; a bare number is named the way the shop says it.
  if (/^\d{1,3}$/.test(label)) return `Chair ${label}`;
  return label.replace(
    /(^|\s)(\p{Ll})/gu,
    (_m, s: string, c: string) => s + c.toLocaleUpperCase('en-US'),
  );
}

function replyText(raw: string): string | null {
  // Keep the owner's own words (and their capitalisation): text after ':' or after reply/jawab.
  const colon = raw.indexOf(':');
  const tail =
    colon >= 0
      ? raw.slice(colon + 1)
      : raw.replace(
          /^.*?\b(?:reply|jawab|javab|respond)\b\s*(?:karo|kar do|do|with|:)?\s*/iu,
          '',
        );
  const t = tail.trim();
  return t.length >= 2 && t.length <= 1000 && t !== raw.trim() ? t : null;
}

export function parsePhase3(
  text: string,
  raw: string,
  surface: 'shop' | 'customer' | 'admin',
  year: number,
): Phase3Intent | null {
  if (NOTIFICATION.test(text)) {
    return READ_ALL.test(text)
      ? { action: AssistantActionId.NOTIFICATIONS_READ_ALL }
      : { action: AssistantActionId.NOTIFICATIONS_LIST };
  }

  if (surface === 'admin') {
    if (SHOPS.test(text) && OPEN_STATUS.test(text))
      return { action: AssistantActionId.ADMIN_SHOP_STATUS };
    if (OVERVIEW.test(text) || MONEY.test(text))
      return { action: AssistantActionId.ADMIN_OVERVIEW };
    return null;
  }

  if (surface === 'customer') {
    if (QUEUE.test(text) && JOIN.test(text))
      return { action: AssistantActionId.MY_QUEUE_JOIN };
    if (FAVORITE.test(text)) {
      if (REMOVE.test(text))
        return { action: AssistantActionId.MY_FAVORITE_REMOVE };
      if (
        ADD.test(text) ||
        /(?:^|\s)(?:save|karo|kar do|bana do|mein daalo)(?=\s|$)/u.test(text)
      ) {
        return SHOW.test(text)
          ? { action: AssistantActionId.MY_FAVORITES }
          : { action: AssistantActionId.MY_FAVORITE_ADD };
      }
      return { action: AssistantActionId.MY_FAVORITES };
    }
    if (INVOICE.test(text)) return { action: AssistantActionId.MY_INVOICES };
    return null;
  }

  // ---- shop surface
  if (CHAIR.test(text)) {
    if (MAINTENANCE.test(text))
      return {
        action: AssistantActionId.CHAIRS_SET_STATUS,
        status: 'MAINTENANCE',
      };
    if (ADD.test(text) && !REMOVE.test(text))
      return { action: AssistantActionId.CHAIRS_ADD, label: chairLabel(text) };
    if (DEACTIVATE.test(text) || REMOVE.test(text))
      return {
        action: AssistantActionId.CHAIRS_SET_STATUS,
        status: 'INACTIVE',
      };
    if (ACTIVATE.test(text))
      return { action: AssistantActionId.CHAIRS_SET_STATUS, status: 'ACTIVE' };
    return { action: AssistantActionId.CHAIRS_LIST };
  }

  if (STAFF.test(text) && STAFF_HOURS.test(text) && !ADD.test(text)) {
    const days = everyDay(text) ? 'all' : weekdaysIn(text);
    const times = timesIn(text, true);
    const closed =
      /(?:^|\s)(?:off|chutti|band|closed|छुट्टी|बंद)(?=\s|$)/u.test(text) &&
      times.length < 2;
    if ((days === 'all' || days.length) && (closed || times.length >= 2)) {
      return {
        action: AssistantActionId.STAFF_HOURS_SET,
        days,
        open: times[0] ?? null,
        close: times[1] ?? null,
        closed,
      };
    }
    return { action: AssistantActionId.STAFF_HOURS_VIEW };
  }

  if (APPOINTMENT.test(text) && NO_SHOW.test(text)) {
    return {
      action: AssistantActionId.BOOKING_NO_SHOW,
      day: daySpecIn(text, year),
      time: timesIn(text)[0] ?? null,
    };
  }

  if (OFFER.test(text) && !/(?:₹|price|daam|rate)/u.test(text)) {
    if (PAUSE.test(text)) return { action: AssistantActionId.OFFERS_PAUSE };
    if (PUBLISH.test(text)) return { action: AssistantActionId.OFFERS_PUBLISH };
    return { action: AssistantActionId.OFFERS_LIST };
  }

  if (REVIEW.test(text)) {
    return REPLY.test(text)
      ? { action: AssistantActionId.REVIEWS_REPLY, reply: replyText(raw) }
      : { action: AssistantActionId.REVIEWS_LIST };
  }

  if (INVOICE.test(text)) return { action: AssistantActionId.INVOICES_LIST };

  if (MONEY.test(text) && REPORT.test(text)) {
    return {
      action: AssistantActionId.REVENUE_REPORT,
      range: MONTH.test(text) ? 'month' : 'week',
    };
  }
  return null;
}
