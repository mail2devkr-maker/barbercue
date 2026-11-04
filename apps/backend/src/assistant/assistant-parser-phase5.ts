import { AssistantActionId } from '@barbercue/shared';
import { daySpecIn, type DaySpec } from './assistant-when';

/**
 * Batch 5 intents (issue #362): create and edit offers (as drafts / by owner), the shop's public
 * profile, a customer writing a review, and anyone setting their app language. The handler checks
 * every value against FastQue's own validation before anything is previewed.
 */
export type Phase5Intent =
  | {
      action: typeof AssistantActionId.OFFERS_CREATE;
      title: string | null;
      discountType: 'PERCENT' | 'FLAT' | null;
      discountValue: number | null;
      days: number | null;
      until: DaySpec | null;
    }
  | {
      action: typeof AssistantActionId.OFFERS_EDIT;
      discountType: 'PERCENT' | 'FLAT' | null;
      discountValue: number | null;
      until: DaySpec | null;
      days: number | null;
    }
  | { action: typeof AssistantActionId.SALON_PROFILE_VIEW }
  | {
      action: typeof AssistantActionId.SALON_PROFILE_SET;
      field: 'description' | 'phone' | 'email' | 'addressLine';
      value: string | null;
    }
  | {
      action: typeof AssistantActionId.REVIEW_WRITE;
      rating: number | null;
      comment: string | null;
    }
  | { action: typeof AssistantActionId.LANGUAGE_SET; language: 'EN' | 'HI' };

const W = (words: string) => new RegExp(`(?:^|\\s)(?:${words})(?=\\s|$)`, 'u');

const OFFER = W('offer|offers|deal|discount|ऑफर|छूट');
const CREATE = W('banao|bana do|create|new|naya|nayi|add|shuru karo|बनाओ|नया');
const EDIT = W('karo|kar do|badlo|change|badhao|extend|update|set|बदलो|बढ़ाओ');
const SHOP = W('dukaan|dukan|shop|salon|profile|दुकान|सैलून');
const DESCRIPTION = W('description|about|bio|parichay|विवरण');
const PHONE_WORD = W('phone|number|mobile|contact|फोन|नंबर');
const EMAIL_WORD = W('email|mail|ईमेल');
const ADDRESS = W('address|pata|पता');
const SHOW = W('show|dikhao|dikha|batao|kya hai|details|दिखाओ|बताओ');
const REVIEW = W('review|rating|star|stars|feedback|रिव्यू|स्टार');
const LANGUAGE = W('language|bhasha|bhaasha|zubaan|भाषा');

const FLAT =
  /(?:₹\s*|rs\.?\s*|rupees?\s*|rupaye\s*)(\d{1,6})|(\d{1,6})\s*(?:₹|rs|rupees?|rupaye|रुपये)(?=\s|$)/u;
const PERCENT = /(\d{1,3})\s*(?:%|percent|pratishat|प्रतिशत)/u;
const DAYS = /(\d{1,3})\s*(?:din|days?|दिन)(?=\s|$)/u;

/** "Diwali offer banao" → "Diwali"; quoted text wins. Never the discount or validity words. */
function offerTitle(raw: string, text: string): string | null {
  const quoted = raw.match(/["“']([^"”']{2,120})["”']/u)?.[1];
  if (quoted) return quoted.trim();
  const before = text.split(OFFER)[0]?.trim() ?? '';
  const words = before
    .split(' ')
    .filter(
      (w) =>
        w &&
        !/^\d/.test(w) &&
        ![
          'ek',
          'a',
          'naya',
          'nayi',
          'new',
          'banao',
          'create',
          'ka',
          'ki',
          'ke',
        ].includes(w),
    );
  const t = words.join(' ').trim();
  if (!t || t.length < 2 || t.length > 120) return null;
  return t.replace(
    /(^|\s)(\p{Ll})/gu,
    (_m, s: string, c: string) => s + c.toLocaleUpperCase('en-US'),
  );
}

function discount(text: string): {
  discountType: 'PERCENT' | 'FLAT' | null;
  discountValue: number | null;
} {
  const pct = text.match(PERCENT);
  if (pct) return { discountType: 'PERCENT', discountValue: Number(pct[1]) };
  const flat = text.match(FLAT);
  if (flat)
    return { discountType: 'FLAT', discountValue: Number(flat[1] ?? flat[2]) };
  return { discountType: null, discountValue: null };
}

function afterColon(raw: string): string | null {
  const i = raw.indexOf(':');
  const v = i >= 0 ? raw.slice(i + 1).trim() : '';
  return v || null;
}

export function parsePhase5(
  text: string,
  raw: string,
  surface: 'shop' | 'customer' | 'admin' | 'employee',
  year: number,
): Phase5Intent | null {
  if (LANGUAGE.test(text)) {
    if (/(?:^|\s)(?:hindi|हिंदी|हिन्दी)(?=\s|$)/u.test(text))
      return { action: AssistantActionId.LANGUAGE_SET, language: 'HI' };
    if (/(?:^|\s)(?:english|angrezi|अंग्रेज़ी|अंग्रेजी)(?=\s|$)/u.test(text))
      return { action: AssistantActionId.LANGUAGE_SET, language: 'EN' };
  }

  if (surface === 'customer') {
    if (REVIEW.test(text)) {
      const stars =
        text.match(/(?:^|\s)([1-5])\s*(?:star|stars|स्टार)(?=\s|$)/u) ??
        text.match(/(?:rating|review)\s+([1-5])(?=\s|$)/u);
      return {
        action: AssistantActionId.REVIEW_WRITE,
        rating: stars ? Number(stars[1]) : null,
        comment: afterColon(raw),
      };
    }
    return null;
  }
  if (surface !== 'shop') return null;

  if (OFFER.test(text)) {
    const until =
      /(?:^|\s)tak(?=\s|$)|(?:^|\s)till(?=\s|$)|(?:^|\s)until(?=\s|$)|तक/u.test(
        text,
      )
        ? daySpecIn(text, year)
        : null;
    const days = text.match(DAYS) ? Number(text.match(DAYS)![1]) : null;
    if (CREATE.test(text)) {
      return {
        action: AssistantActionId.OFFERS_CREATE,
        title: offerTitle(raw, text),
        ...discount(text),
        days,
        until,
      };
    }
    const d = discount(text);
    if (EDIT.test(text) && (d.discountValue !== null || until || days)) {
      return { action: AssistantActionId.OFFERS_EDIT, ...d, until, days };
    }
    return null;
  }

  if (
    SHOP.test(text) &&
    (DESCRIPTION.test(text) ||
      PHONE_WORD.test(text) ||
      EMAIL_WORD.test(text) ||
      ADDRESS.test(text))
  ) {
    const field = DESCRIPTION.test(text)
      ? 'description'
      : EMAIL_WORD.test(text)
        ? 'email'
        : ADDRESS.test(text)
          ? 'addressLine'
          : 'phone';
    let value = afterColon(raw);
    if (!value && field === 'phone')
      value =
        raw
          .match(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/u)?.[0]
          ?.replace(/[\s-]/g, '') ?? null;
    if (!value && field === 'email')
      value = raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/u)?.[0] ?? null;
    if (!value && SHOW.test(text))
      return { action: AssistantActionId.SALON_PROFILE_VIEW };
    return { action: AssistantActionId.SALON_PROFILE_SET, field, value };
  }
  if (
    SHOP.test(text) &&
    W('profile|details|jaankari|जानकारी').test(text) &&
    SHOW.test(text)
  )
    return { action: AssistantActionId.SALON_PROFILE_VIEW };
  return null;
}
