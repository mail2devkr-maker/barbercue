import type { ConnectIntent } from '@barbercue/shared';

/**
 * Deterministic intent rules (spec section 6): critical paths (complaints, refunds, safety,
 * cancellations, lateness) are decided by rules, never by a model, so they behave the same every
 * time and cost nothing. Covers English, Hindi (Devanagari) and Hinglish. A model may refine only
 * a GENERAL result, and only for drafting language.
 */
export interface IntentResult {
  intent: ConnectIntent;
  confidence: number;
  /** Minutes late, when the customer said a number ("10 min late", "aadha ghanta"). */
  delayMinutes?: number;
  /** "4 pm", "17:30" as written: used to look up slots, never trusted as a booking time. */
  timeMentions: string[];
  matched: string | null;
}

type Rule = [ConnectIntent, RegExp, number];

// Order matters: the first match wins, so safety and complaints come before everything else.
const RULES: Rule[] = [
  [
    'EMERGENCY',
    /\b(emergency|unsafe|not safe|harass\w*|assault\w*|threat\w*|police|ambulance|bleeding|injur\w*|burn(ed|t)? my|allergic reaction|molest\w*)\b|आपातकाल|ख़तरा|खतरा|पुलिस|चोट|जल गया|madad karo|bachao/i,
    0.95,
  ],
  [
    'COMPLAINT',
    /\b(complain\w*|complaint|terrible|worst|horrible|rude|unprofessional|disgusting|ruined|bad service|very bad|not happy|unhappy|disappointed|pathetic|cheat\w*|scam|fraud)\b|शिकायत|बेकार|बहुत बुरा|घटिया|bakwas|bekar|ghatiya|bahut bura|kharab service/i,
    0.9,
  ],
  [
    'REFUND',
    /\b(refund\w*|money back|return (my|the) money|charged (me )?(twice|extra|wrong)|double charged|chargeback)\b|रिफंड|पैसे वापस|paise wapas|paisa wapas/i,
    0.92,
  ],
  [
    'HUMAN_REQUEST',
    /\b(talk|speak|chat) (to|with) (a |the )?(human|person|someone|owner|manager|staff|real)\b|\b(human|real person|call me)\b|insaan se|kisi se baat|मालिक से बात|इंसान/i,
    0.9,
  ],
  [
    'CANCELLATION_REQUEST',
    /\b(cancel\w*|call off|won'?t be (able to )?(come|make it)|can'?t (come|make it))\b|रद्द|कैंसल|cancel kar|nahi aa paunga|nahi aa paungi|nahi aa sakta|nahi aa sakti/i,
    0.9,
  ],
  [
    'LATE_ARRIVAL',
    /\b(running late|be late|i'?m late|i am late|delayed|stuck in traffic|traffic|few minutes late|\d+\s*(min|mins|minutes)\s*late|late by)\b|देर|लेट|late ho|der ho|der se|traffic me/i,
    0.88,
  ],
  [
    'APPOINTMENT_MODIFICATION',
    /\b(reschedul\w*|change (my |the )?(appointment|booking|time|slot|date)|move (my |the )?(appointment|booking)|another (time|slot|day)|different time|postpone|prepone|shift (my |the )?(appointment|booking|time))\b|समय बदल|टाइम बदल|time change|time badal|appointment badal|slot badal/i,
    0.88,
  ],
  [
    'ON_THE_WAY',
    /\b(on my way|on the way|leaving now|coming now|omw|heading (there|over))\b|रास्ते में|aa raha hu|aa rahi hu|nikal gaya|nikal gayi|raste me/i,
    0.9,
  ],
  [
    'ARRIVED',
    /\b(i'?ve arrived|i have arrived|i am here|i'?m here|reached|at the (salon|shop|door|gate)|outside)\b|पहुँच गया|पहुंच गया|पहुँच गई|pahunch gaya|pahunch gayi|aa gaya|aa gayi/i,
    0.88,
  ],
  [
    'WAITING_TIME',
    /\b(how long|wait(ing)? time|how much (more )?time|when (is|will be) my turn|my turn|queue position|how many (people|ahead)|kitna (time|samay|der)|kitni der|kab (tak|aayega) (mera|number))\b|कितना समय|कितनी देर|मेरा नंबर|mera number|kitne log/i,
    0.9,
  ],
  [
    'PRICING',
    /\b(price|prices|cost|costs|how much|rate|rates|charges?|fee|fees|total|kitna (paisa|lagega|hoga|charge)|kitne ka|kitne paise)\b|कीमत|दाम|कितने का|कितना लगेगा|रेट/i,
    0.86,
  ],
  [
    'ADDITIONAL_SERVICE',
    /\b(add (another|a|one more)? ?service|also (want|get|do)|one more service|add (a )?(beard|facial|massage|colou?r|wash|spa|shave|trim))\b|aur ek service|ek aur service|bhi karwana|साथ में/i,
    0.85,
  ],
  [
    'HAIRSTYLE_CONSULTATION',
    /\b(hair ?style|haircut style|look like|reference (photo|picture|image)|this style|suggest (a )?(style|look|cut)|bridal|makeup look|nail art|colou?r shade|which style)\b|हेयरस्टाइल|स्टाइल|style dikha|aisa style/i,
    0.8,
  ],
  [
    'PRODUCT_INQUIRY',
    /\b(product|shampoo|conditioner|serum|wax|gel|cream|oil|which brand|do you sell)\b|प्रोडक्ट|शैम्पू/i,
    0.75,
  ],
  [
    'HOME_SERVICE',
    /\b(home (service|visit)|at home|come to my (home|house|place)|doorstep)\b|घर पर|ghar par|ghar pe/i,
    0.8,
  ],
  [
    'PAYMENT',
    /\b(pay(ment)?|upi|gpay|paytm|phonepe|card|cash|invoice|bill|receipt)\b|पेमेंट|भुगतान|बिल/i,
    0.78,
  ],
  [
    'LOCATION',
    /\b(where (is|are) (you|the salon|the shop)|address|location|directions?|how (do i|to) (get|reach)|find (the|your) (salon|shop)|park(ing)?|landmark|map)\b|पता|पार्किंग|kahan (hai|ho)|rasta|location bhejo/i,
    0.86,
  ],
  [
    'OPENING_HOURS',
    /\b(open(ing)? (hours|time)|are you open|what time (do you|does the salon) (open|close)|closing time|timings?|open today|open tomorrow|close at)\b|कब खुल|कब बंद|khula hai|kab khulega|kab band/i,
    0.86,
  ],
  [
    'BOOKING_INQUIRY',
    /\b(book(ing)?|appointment|slot|available|availability|free slot|any slot|can i come|stylist available|request (a )?(particular|specific) stylist)\b|बुकिंग|अपॉइंटमेंट|slot milega|booking karni/i,
    0.75,
  ],
];

const NUM_WORDS: Record<string, number> = {
  five: 5,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  'half an hour': 30,
  'an hour': 60,
  'one hour': 60,
  aadha: 30,
  'aadha ghanta': 30,
  'ek ghanta': 60,
  'आधा घंटा': 30,
  'एक घंटा': 60,
};

export function extractDelayMinutes(text: string): number | undefined {
  const t = text.toLowerCase();
  const m = t.match(/(\d{1,3})\s*(min|mins|minute|minutes|मिनट|minat)/);
  if (m) return Number(m[1]);
  const h = t.match(/(\d{1,2})\s*(hour|hours|hr|hrs|घंटे|ghante|ghanta)/);
  if (h) return Number(h[1]) * 60;
  for (const [w, n] of Object.entries(NUM_WORDS)) if (t.includes(w)) return n;
  return undefined;
}

export function extractTimes(text: string): string[] {
  const out: string[] =
    text.match(/\b(\d{1,2}(:\d{2})?\s?(am|pm|baje)|\d{1,2}:\d{2})\b/gi) ?? [];
  return [...new Set(out.map((s) => s.trim()))].slice(0, 4);
}

export function detectIntent(text: string): IntentResult {
  const t = (text ?? '').slice(0, 2000);
  for (const [intent, re, confidence] of RULES) {
    const m = t.match(re);
    if (m) {
      return {
        intent,
        confidence,
        delayMinutes:
          intent === 'LATE_ARRIVAL' ? extractDelayMinutes(t) : undefined,
        timeMentions: extractTimes(t),
        matched: m[0].slice(0, 40),
      };
    }
  }
  return {
    intent: 'GENERAL',
    confidence: 0.4,
    timeMentions: extractTimes(t),
    matched: null,
  };
}

// ---------- Sentiment (section 14): an advisory signal only ----------
const NEG =
  /\b(bad|worst|terrible|horrible|rude|angry|upset|annoyed|waiting (so|too) long|still waiting|no one (is )?(answering|replying)|ignored|unprofessional|disappointed|overcharg\w*|expensive|not happy|unhappy)\b|बुरा|गुस्सा|नाराज़|बेकार|ghatiya|bekar|naraz|gussa/i;
const POS =
  /\b(thanks?|thank you|great|awesome|amazing|loved|love it|perfect|excellent|happy|nice|good job|wonderful)\b|धन्यवाद|शुक्रिया|बढ़िया|shukriya|dhanyavaad|badhiya|mast/i;

export type SentimentSignal = {
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'ATTENTION';
  reason: string | null;
};

export function sentimentOf(
  texts: string[],
  intent: ConnectIntent | null,
  unansweredCustomerMessages: number,
): SentimentSignal {
  const joined = texts.join(' \n ').slice(0, 4000);
  if (intent === 'EMERGENCY')
    return { sentiment: 'ATTENTION', reason: 'Possible safety concern' };
  if (intent === 'COMPLAINT' || intent === 'REFUND')
    return {
      sentiment: 'ATTENTION',
      reason: intent === 'REFUND' ? 'Refund or payment dispute' : 'Complaint',
    };
  if (unansweredCustomerMessages >= 3)
    return { sentiment: 'ATTENTION', reason: 'Repeated unanswered questions' };
  if (
    /waiting (so|too) long|still waiting|how much longer|abhi tak|kab tak/i.test(
      joined,
    )
  )
    return { sentiment: 'NEGATIVE', reason: 'Excessive waiting' };
  if (/expensive|overcharg|too much (money|price)|mehenga|महंगा/i.test(joined))
    return { sentiment: 'NEGATIVE', reason: 'Pricing disagreement' };
  if (intent === 'CANCELLATION_REQUEST')
    return { sentiment: 'NEGATIVE', reason: 'Potential cancellation' };
  if (NEG.test(joined))
    return {
      sentiment: 'NEGATIVE',
      reason: 'Negative words in recent messages',
    };
  if (POS.test(joined)) return { sentiment: 'POSITIVE', reason: null };
  return { sentiment: 'NEUTRAL', reason: null };
}
