import { normNum } from './connect-knowledge.service';

/**
 * AI safety rails (spec sections 5, 20, 24).
 *
 * 1. Prompt injection: customer text is only ever passed to a model as quoted JSON data, never
 *    inside instructions. Obvious attack phrases are flagged (and logged), and the model is told
 *    the data may contain them. A flagged message is never auto-answered.
 * 2. Hallucination: a model draft is accepted only if every number in it already appears in the
 *    verified facts or the customer's own words, and it names no price, discount or offer that is
 *    not in the facts. Otherwise the deterministic draft (or a hand-off to a person) is used.
 */
const INJECTION = [
  /ignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts?|rules)/i,
  /disregard (all |the )?(instructions|rules|system)/i,
  /(you are|act as|pretend to be) (now )?(a |an )?(different|new|unrestricted|dan|developer mode)/i,
  /\b(system prompt|system message|jailbreak|developer mode|do anything now)\b/i,
  /reveal (your|the) (instructions|prompt|rules|system)/i,
  /\b(give|offer|apply) (me )?(a )?(100|[5-9]\d) ?% (discount|off)\b/i,
  /<\/?(system|assistant|instructions?)>/i,
  /\bset (the )?price to\b/i,
  /\b(cancel|delete|refund) (all|every|other) (bookings?|orders?|customers?)\b/i,
];

export function detectInjection(text: string): boolean {
  return INJECTION.some((re) => re.test(text));
}

/** Strips control characters and markup-looking tags before text is placed into model input. */
export function sanitizeForModel(text: string, max = 1500): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- stripping control characters is the point
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/<\/?[a-z][^>]{0,40}>/gi, ' ')
      .slice(0, max)
  );
}

export interface DraftCheck {
  ok: boolean;
  reason: string | null;
}

export function checkDraft(draft: string, allowed: Set<string>): DraftCheck {
  if (!draft.trim()) return { ok: false, reason: 'empty' };
  if (draft.length > 1200) return { ok: false, reason: 'too_long' };
  for (const n of draft.match(/\d+(?:[.,:]\d+)*/g) ?? []) {
    if (!allowed.has(normNum(n)))
      return { ok: false, reason: `unverified_number:${n}` };
  }
  if (
    /\b(guarantee(d)?|100% (safe|result)|cure|medical(ly)?|permanent result)\b/i.test(
      draft,
    )
  )
    return { ok: false, reason: 'unsupported_claim' };
  if (
    /\b(i (have|'ve) (cancelled|rescheduled|refunded|changed|booked)|your booking (has been|is now) (cancelled|moved|changed))\b/i.test(
      draft,
    )
  )
    return { ok: false, reason: 'claims_action' };
  if (/https?:\/\//i.test(draft) && !/google\.com\/maps/.test(draft))
    return { ok: false, reason: 'external_link' };
  return { ok: true, reason: null };
}
