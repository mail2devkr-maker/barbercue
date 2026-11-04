import { AssistantActionId } from '@barbercue/shared';
import { parsePhase2, type Phase2Intent } from './assistant-parser-phase2';
import { parsePhase3, type Phase3Intent } from './assistant-parser-phase3';
import { parsePhase4, type Phase4Intent } from './assistant-parser-phase4';
import { parsePhase5, type Phase5Intent } from './assistant-parser-phase5';
import { parsePhase7, type Phase7Intent } from './assistant-parser-phase7';
import { parsePhase8, type Phase8Intent } from './assistant-parser-phase8';
import { romanize } from './assistant-transliterate';
import {
  parseAdminReads,
  parsePhase6,
  type AdminReadIntent,
  type Phase6Intent,
} from './assistant-parser-phase6';

/**
 * Deterministic English / Hindi / Hinglish interpreter for the Action Assistant (issue #362).
 *
 * It only decides WHICH allowlisted action the words ask for and pulls out numbers and new names.
 * It never decides who the caller is, which shop, or which existing service/staff row: those come
 * from the session and are resolved against the shop's own records on the server. Text it cannot
 * place returns null rather than a guess. A model-backed interpreter can later sit behind the same
 * shape, but nothing it says can widen what the executor allows.
 */
export type ParsedIntent =
  | { action: typeof AssistantActionId.STAFF_LIST }
  | {
      action: typeof AssistantActionId.STAFF_ADD;
      name: string | null;
      phone: string | null;
    }
  | { action: typeof AssistantActionId.STAFF_SET_STATUS; active: boolean }
  | { action: typeof AssistantActionId.SERVICE_LIST }
  | {
      action: typeof AssistantActionId.SERVICE_ADD;
      name: string | null;
      price: number | null;
      durationMinutes: number | null;
    }
  | {
      action: typeof AssistantActionId.SERVICE_SET_PRICE;
      to: number | null;
      from: number | null;
      percent: number | null;
      delta: number | null;
      direction: 'up' | 'down' | null;
    }
  | { action: typeof AssistantActionId.SERVICE_ARCHIVE }
  | { action: typeof AssistantActionId.SERVICE_RESTORE }
  | { action: typeof AssistantActionId.QUEUE_STATUS }
  | {
      action: typeof AssistantActionId.TODAY_INSIGHTS;
      topic: 'summary' | 'revenue';
    }
  | {
      action: typeof AssistantActionId.SALON_SEARCH;
      serviceQuery: string | null;
      city: string | null;
    }
  | { action: 'unreleased'; feature: 'inventory' | 'onboarding' }
  | Phase2Intent
  | Phase3Intent
  | Phase4Intent
  | Phase5Intent
  | Phase6Intent
  | AdminReadIntent
  | Phase7Intent
  | Phase8Intent;

export function normalizeText(text: string): string {
  return (
    text
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      .replace(/[₹]/g, ' ₹ ')
      .replace(/[^\p{L}\p{M}\p{N}%₹+\s.:]/gu, ' ')
      // Keep a colon only inside a clock time (10:30); elsewhere it is punctuation.
      .replace(/(?<!\d):|:(?!\d)/g, ' ')
      .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const W = (words: string) => new RegExp(`(?:^|\\s)(?:${words})(?=\\s|$)`, 'u');

const STAFF = W('staff|barber|barbers|stylist|employee|स्टाफ|कर्मचारी|नाई');
const SERVICE = W('service|services|सर्विस|सेवा|सेवाएं|सेवाएँ');
const PRICE = W(
  'price|prices|rate|rates|daam|dam|keemat|kimat|cost|charge|कीमत|दाम|रेट',
);
const ADD = W(
  'add|jodo|jod|joro|daalo|dalo|add karo|naya|nayi|new|create|जोड़ो|जोड़ें|जोड़|जोडो|नया|नई',
);
const REMOVE = W(
  'remove|delete|hatao|hata|hatado|nikalo|nikal|archive|band|हटाओ|हटा|हटाएं|निकालो|बंद',
);
const DEACTIVATE = W('deactivate|disable|inactive|band|बंद|निष्क्रिय');
const ACTIVATE = W(
  'activate|enable|active|restore|wapas|vapas|chalu|चालू|वापस|सक्रिय',
);
const SHOW = W(
  'show|list|dikhao|dikha|batao|bata|dekho|kaun|what|which|how many|kitne|kitni|दिखाओ|दिखा|बताओ|बता|कौन|कितने|कितनी',
);
const QUEUE = W(
  'queue|line|waiting|wait|intezar|kataar|katar|कतार|क्यू|लाइन|प्रतीक्षा',
);
const SALES = W(
  'sales|sale|revenue|collection|income|kamai|earning|earnings|bikri|बिक्री|कमाई|सेल्स|आमदनी',
);
const SUMMARY = W('summary|overview|saaransh|सारांश|हाल');
const TODAY = W('today|aaj|आज');
const UP = W(
  'increase|raise|badha|badhao|badhado|badha do|up|zyada|बढ़ा|बढ़ाओ|बढ़ाएं|बढाओ',
);
const DOWN = W(
  'decrease|reduce|lower|cut|ghata|ghatao|kam|kam karo|घटा|घटाओ|कम',
);
const SEARCH = W(
  'find|search|dhoondo|dhundo|khojo|chahiye|near|nearby|पास|ढूंढो|खोजो|चाहिए',
);
const SALON = W('salon|salons|parlour|parlor|shop|shops|सैलून|पार्लर|दुकान');
const INVENTORY = W(
  'inventory|stock|bottles|bottle|product|products|स्टॉक|इन्वेंटरी',
);
const ONBOARDING = W('registration|onboarding|application|रजिस्ट्रेशन|आवेदन');

const NUMBER = /(?:₹\s*|rs\.?\s*|inr\s*)?(\d{1,7}(?:\.\d{1,2})?)(?!\d)/gu;

function numbers(text: string): number[] {
  return [...text.matchAll(NUMBER)].map((m) => Number(m[1]));
}

const PHONE = /(?:\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5})(?!\d)/u;

function phoneIn(raw: string): string | null {
  const m = raw.match(PHONE);
  return m ? `+91${m[1].replace(/[\s-]/g, '')}` : null;
}

// Filler and command words removed when a NEW name (staff or service) is taken from the sentence.
const NAME_NOISE = new Set(
  (
    'add karo kar do de dijiye please plz ko me mein mai main as a an the to staff barber stylist employee service ' +
    'naya nayi new create jodo jod daalo dalo for of in with price rate rs inr rupees rupaye rupee minute minutes min mins ' +
    'ka ki ke hai hain se and aur ek ₹ स्टाफ में को जोड़ो जोड़ें जोड़ नया नई सर्विस सेवा रुपये मिनट का की के और'
  ).split(' '),
);

function nameFrom(text: string): string | null {
  const words = text
    .replace(PHONE, ' ')
    .replace(/\d+(?:\.\d+)?/g, ' ')
    .split(' ')
    .filter((w) => w && !NAME_NOISE.has(w) && !/^\+/.test(w));
  const name = words.join(' ').trim();
  if (!name || name.length > 120) return null;
  return name.replace(
    /(^|\s)(\p{Ll})/gu,
    (_m, s: string, c: string) => s + c.toLocaleUpperCase('en-US'),
  );
}

function durationIn(text: string): number | null {
  const m = text.match(/(\d{1,3})\s*(?:min|mins|minute|minutes|मिनट)(?=\s|$)/u);
  return m ? Number(m[1]) : null;
}

export function parseAssistantText(
  raw: string,
  surface: 'shop' | 'customer' | 'admin' | 'employee' = 'shop',
  year = new Date().getUTCFullYear(),
): ParsedIntent | null {
  const text = normalizeText(raw);
  if (!text) return null;
  // Issue #368: hi-IN speech recognition writes English words in Devanagari ("चेयर्स अवेलेबल").
  // The romanized reading is tried only where the sentence as written matched nothing.
  const roman = romanize(text);
  const basics =
    parsePhase8(text, surface) ??
    (roman !== text ? parsePhase8(roman, surface) : null);
  if (basics) return basics;
  return (
    parseNormalized(text, raw, surface, year) ??
    (roman !== text ? parseNormalized(roman, roman, surface, year) : null)
  );
}

function parseNormalized(
  text: string,
  raw: string,
  surface: 'shop' | 'customer' | 'admin' | 'employee',
  year: number,
): ParsedIntent | null {
  if (INVENTORY.test(text) && !SERVICE.test(text))
    return { action: 'unreleased', feature: 'inventory' };
  if (ONBOARDING.test(text))
    return { action: 'unreleased', feature: 'onboarding' };

  const phase5 = parsePhase5(text, raw, surface, year);
  if (phase5) return phase5;
  // A field employee's screens only offer their own CRM; shop and customer phrases do not apply.
  if (surface === 'employee') return parsePhase6(text, raw, year);
  const phase7 = parsePhase7(text, surface);
  if (phase7) return phase7;
  if (surface === 'admin') {
    const adminRead = parseAdminReads(text);
    if (adminRead) return adminRead;
  }
  if (surface === 'shop') {
    const phase4 = parsePhase4(text, raw, year);
    if (phase4) return phase4;
  }
  const phase3 = parsePhase3(text, raw, surface, year);
  if (phase3) return phase3;
  // The platform admin screens only offer platform actions; shop and customer phrases do not apply.
  if (surface === 'admin') return null;

  const phase2 = parsePhase2(text, surface, year);
  if (phase2) return phase2;
  if (surface === 'customer') {
    // A customer can still search for salons; shop-management phrases are not theirs to run.
    const general = parsePhase1(text, raw);
    return general?.action === AssistantActionId.SALON_SEARCH ? general : null;
  }
  return parsePhase1(text, raw);
}

function parsePhase1(text: string, raw: string): ParsedIntent | null {
  const percentMatch = text.match(
    /(\d{1,3}(?:\.\d+)?)\s*(?:%|percent|pratishat|प्रतिशत)/u,
  );
  if (
    PRICE.test(text) ||
    percentMatch ||
    /(?:^|\s)(?:se|from)\s+(?:₹\s*)?\d/u.test(text)
  ) {
    if (
      !STAFF.test(text) &&
      !(ADD.test(text) && SERVICE.test(text) && !PRICE.test(text))
    ) {
      const direction = UP.test(text) ? 'up' : DOWN.test(text) ? 'down' : null;
      if (percentMatch) {
        return {
          action: AssistantActionId.SERVICE_SET_PRICE,
          to: null,
          from: null,
          percent: Number(percentMatch[1]),
          delta: null,
          direction,
        };
      }
      const nums = numbers(
        text.replace(/\d{1,3}\s*(?:min|mins|minute|minutes|मिनट)/gu, ' '),
      );
      const fromTo = text.match(
        /(?:₹\s*)?(\d{1,7}(?:\.\d{1,2})?)\s*(?:se|from|to|→|->|से)\s*(?:₹\s*)?(\d{1,7}(?:\.\d{1,2})?)/u,
      );
      if (fromTo) {
        return {
          action: AssistantActionId.SERVICE_SET_PRICE,
          from: Number(fromTo[1]),
          to: Number(fromTo[2]),
          percent: null,
          delta: null,
          direction: null,
        };
      }
      if (nums.length >= 1) {
        const value = nums[nums.length - 1];
        // "by 50" with a direction is a relative change; otherwise the number is the new price.
        if (direction && /(?:^|\s)(?:by|tak)\s+(?:₹\s*)?\d/u.test(text)) {
          return {
            action: AssistantActionId.SERVICE_SET_PRICE,
            to: null,
            from: null,
            percent: null,
            delta: value,
            direction,
          };
        }
        return {
          action: AssistantActionId.SERVICE_SET_PRICE,
          to: value,
          from: null,
          percent: null,
          delta: null,
          direction: null,
        };
      }
      return {
        action: AssistantActionId.SERVICE_SET_PRICE,
        to: null,
        from: null,
        percent: null,
        delta: null,
        direction,
      };
    }
  }

  if (STAFF.test(text)) {
    if (ADD.test(text) && !REMOVE.test(text)) {
      return {
        action: AssistantActionId.STAFF_ADD,
        name: nameFrom(text),
        phone: phoneIn(raw),
      };
    }
    if (DEACTIVATE.test(text) || REMOVE.test(text))
      return { action: AssistantActionId.STAFF_SET_STATUS, active: false };
    if (ACTIVATE.test(text))
      return { action: AssistantActionId.STAFF_SET_STATUS, active: true };
    return { action: AssistantActionId.STAFF_LIST };
  }

  if (QUEUE.test(text)) return { action: AssistantActionId.QUEUE_STATUS };
  if (SALES.test(text) || (SUMMARY.test(text) && TODAY.test(text))) {
    return {
      action: AssistantActionId.TODAY_INSIGHTS,
      topic: SALES.test(text) ? 'revenue' : 'summary',
    };
  }

  if (SALON.test(text) && (SEARCH.test(text) || SHOW.test(text))) {
    const city =
      text.match(/(?:^|\s)in\s+(\p{L}[\p{L}\p{M}]{2,})(?:\s|$)/u)?.[1] ?? null;
    const query = text
      .split(' ')
      .filter(
        (w) =>
          !SALON.test(w) &&
          !SEARCH.test(w) &&
          !SHOW.test(w) &&
          ![
            'a',
            'the',
            'for',
            'me',
            'mein',
            'mujhe',
            'ke',
            'liye',
            'in',
            'near',
            'koi',
            'ek',
            'wala',
            'wale',
          ].includes(w) &&
          w !== city,
      )
      .join(' ')
      .trim();
    return {
      action: AssistantActionId.SALON_SEARCH,
      serviceQuery: query.length >= 2 ? query : null,
      city,
    };
  }

  if (
    SERVICE.test(text) ||
    ADD.test(text) ||
    REMOVE.test(text) ||
    ACTIVATE.test(text)
  ) {
    if (ADD.test(text) && !REMOVE.test(text)) {
      const price =
        numbers(
          text.replace(/\d{1,3}\s*(?:min|mins|minute|minutes|मिनट)/gu, ' '),
        )[0] ?? null;
      return {
        action: AssistantActionId.SERVICE_ADD,
        name: nameFrom(text),
        price,
        durationMinutes: durationIn(text),
      };
    }
    if (REMOVE.test(text)) return { action: AssistantActionId.SERVICE_ARCHIVE };
    if (ACTIVATE.test(text))
      return { action: AssistantActionId.SERVICE_RESTORE };
    if (SHOW.test(text) || SERVICE.test(text))
      return { action: AssistantActionId.SERVICE_LIST };
  }

  return null;
}

/** Longest catalogue name contained in the sentence (whole words). Several equal matches → ambiguous. */
export function matchByName<T>(
  text: string,
  rows: T[],
  nameOf: (row: T) => string,
): T[] {
  const hay = ` ${normalizeText(text)} `;
  let best: T[] = [];
  let bestLen = 0;
  for (const row of rows) {
    const name = normalizeText(nameOf(row));
    if (!name) continue;
    let len = 0;
    if (hay.includes(` ${name} `)) len = name.length + 1000;
    else {
      // Every word of a multi-word name, or a single distinctive word (>= 4 letters) of it.
      const words = name.split(' ').filter((w) => w.length >= 4);
      const hit = words.filter((w) => hay.includes(` ${w} `));
      if (hit.length) len = hit.join(' ').length;
    }
    if (len > bestLen) {
      best = [row];
      bestLen = len;
    } else if (len && len === bestLen) best.push(row);
  }
  return best;
}
