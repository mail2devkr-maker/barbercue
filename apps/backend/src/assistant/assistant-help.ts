import {
  AssistantActionId,
  type AssistantCapabilitiesDto,
  type AssistantTurnDto,
} from '@barbercue/shared';
import { ASSISTANT_ACTIONS } from './actions/catalog';
import type { Access } from './actions/kit';
import { normalizeText } from './assistant-parser';
import { romanize } from './assistant-transliterate';

/**
 * Issue #368. Two answers the owner's QA found broken:
 *
 *  - "What can you do?" now gets a real answer, built from the actions THIS user may run on THIS
 *    screen right now (role, surface and the release gate: with writes off, only look-ups are
 *    offered, and the answer says so). Nothing is invented.
 *  - "Not understood" no longer repeats the same six chips. It names what it heard (so a speech
 *    recognition mistake is visible), picks suggestions about the topic the sentence was about
 *    ("chairs", "queue"...), and always offers "What can you do?".
 */

type Cap = AssistantCapabilitiesDto['actions'][number];
type Surface = 'shop' | 'customer' | 'admin' | 'employee';

const SURFACE_ACCESS: Record<Surface, Access[]> = {
  shop: ['OWNER_OR_ADMIN', 'STAFF_OR_ADMIN', 'OWNER_ONLY'],
  customer: ['SELF'],
  admin: ['PLATFORM'],
  employee: ['EMPLOYEE'],
};

// Topic of an action, from its id prefix; the label is what the help answer says.
const TOPIC_OF_PREFIX: Record<string, string> = {
  queue: 'queue',
  schedule: 'bookings',
  bookings: 'bookings',
  customers: 'customers',
  services: 'services',
  staff: 'staff',
  chairs: 'chairs',
  insights: 'sales',
  revenue: 'sales',
  analytics: 'sales',
  invoices: 'sales',
  hours: 'hours',
  offers: 'offers',
  reviews: 'reviews',
  me: 'your bookings',
  admin: 'platform',
  employee: 'your field work',
};
const TOPIC_LABEL: Record<string, string> = {
  queue: 'the live queue',
  bookings: 'bookings and appointments',
  customers: 'customers',
  services: 'services and prices',
  staff: 'staff',
  chairs: 'chairs (free or busy right now)',
  sales: "today's sales and reports",
  hours: 'opening hours',
  offers: 'offers',
  reviews: 'reviews',
  'your bookings': 'your bookings and queue',
  platform: 'platform figures',
  'your field work': 'your leads, visits and follow-ups',
};
// Words that tell us which topic a not-understood sentence was about.
const TOPIC_WORDS: Array<[string, RegExp]> = [
  ['chairs', /(?:^|\s)(?:chair|chairs|kursi|kursiyan|कुर्सी)(?=\s|$)/u],
  ['queue', /(?:^|\s)(?:queue|line|waiting|kataar|कतार)(?=\s|$)/u],
  [
    'bookings',
    /(?:^|\s)(?:booking|bookings|appointment|appointments|schedule)(?=\s|$)/u,
  ],
  [
    'services',
    /(?:^|\s)(?:service|services|haircut|shave|price|rate)(?=\s|$)/u,
  ],
  ['staff', /(?:^|\s)(?:staff|barber|barbers|stylist|employee|team)(?=\s|$)/u],
  [
    'sales',
    /(?:^|\s)(?:revenue|sales|kamai|earning|earnings|income|collection)(?=\s|$)/u,
  ],
  ['hours', /(?:^|\s)(?:hours|timing|timings|open|band|closed)(?=\s|$)/u],
];

// Order and short spoken names of the topics in the help answer.
const ORDER = [
  'queue',
  'bookings',
  'chairs',
  'services',
  'staff',
  'sales',
  'customers',
  'hours',
  'offers',
  'reviews',
];
const rank = (t: string) =>
  ORDER.includes(t) ? ORDER.indexOf(t) : ORDER.length;
const SHORT_LABEL: Record<string, string> = {
  queue: 'the live queue',
  bookings: 'bookings',
  chairs: 'free chairs',
  services: 'services and prices',
  staff: 'staff',
  sales: 'sales',
  customers: 'customers',
  hours: 'shop timings',
  offers: 'offers',
  reviews: 'reviews',
  'your bookings': 'your bookings and queue',
  platform: 'platform figures',
  'your field work': 'your leads and visits',
};

function topicOf(id: string): string | null {
  return TOPIC_OF_PREFIX[id.split('.')[0]] ?? null;
}

/** Actions this user can run on this screen now (reads only while writes are off). */
export function usable(caps: Cap[], surface: Surface): Cap[] {
  const allowed = SURFACE_ACCESS[surface];
  return caps.filter((c) => {
    if (c.state !== 'SUPPORTED') return false;
    if (
      c.id === AssistantActionId.HELP ||
      c.id === AssistantActionId.NAVIGATE_BACK
    )
      return false;
    const def = ASSISTANT_ACTIONS[c.id];
    return !!def && allowed.includes(def.access);
  });
}

function byTopic(caps: Cap[]): Map<string, Cap[]> {
  const m = new Map<string, Cap[]>();
  for (const c of caps) {
    const t = topicOf(c.id);
    if (!t) continue;
    m.set(t, [...(m.get(t) ?? []), c]);
  }
  return m;
}

const example = (c: Cap) => ({ label: c.examples[0], text: c.examples[0] });
const HELP_OPTION = { label: 'What can you do?', text: 'What can you do?' };

export function helpTurn(
  caps: Cap[],
  surface: Surface,
  writesOn: boolean,
  greeting: boolean,
): Partial<AssistantTurnDto> {
  const mine = usable(caps, surface);
  const topics = byTopic(mine);
  const canNavigate = mine.some((c) => c.id === AssistantActionId.NAVIGATE);
  if (topics.size === 0 && !canNavigate) {
    return {
      status: 'DONE',
      message: 'There is nothing I can do for your account on this screen yet.',
    };
  }
  // The message is SPOKEN in a voice conversation, so it names the main topics only; the full list
  // with examples is shown on screen as items.
  const ordered = [...topics.entries()].sort(([a], [b]) => rank(a) - rank(b));
  const shortLabels = ordered.map(([t]) => SHORT_LABEL[t] ?? t);
  const head = shortLabels.slice(0, 5);
  const list =
    shortLabels.length > 5
      ? `${head.join(', ')} and more`
      : head.length > 1
        ? `${head.slice(0, -1).join(', ')} and ${head[head.length - 1]}`
        : head[0];
  const parts = [
    greeting
      ? 'Namaste! I am your FastQue Assistant.'
      : 'I am your FastQue Assistant.',
    list ? `Ask me about ${list}.` : '',
    canNavigate ? 'I can open any page too: say "Bookings kholo".' : '',
    writesOn
      ? 'Changes always need your confirmation on screen.'
      : 'Changes are switched off for now, so I only look things up.',
  ].filter(Boolean);
  const options = ordered.map(([, cs]) => example(cs[0])).slice(0, 5);
  if (canNavigate)
    options.push({ label: 'Bookings kholo', text: 'Bookings kholo' });
  return {
    status: 'DONE',
    message: parts.join(' '),
    result: {
      summary: 'What I can do',
      items: ordered.map(([t, cs]) => ({
        title: TOPIC_LABEL[t] ?? t,
        detail: cs
          .slice(0, 3)
          .map((c) => `"${c.examples[0]}"`)
          .join(' · '),
      })),
    },
    options,
  };
}

export function notUnderstoodTurn(
  caps: Cap[],
  surface: Surface,
  said: string,
): Partial<AssistantTurnDto> {
  const mine = usable(caps, surface);
  const topics = byTopic(mine);
  const heard = said.trim().replace(/\s+/g, ' ').slice(0, 80);
  const text = romanize(normalizeText(said));
  const topic = TOPIC_WORDS.find(
    ([t, re]) => topics.has(t) && re.test(text),
  )?.[0];
  if (topic) {
    const options = (topics.get(topic) ?? []).slice(0, 4).map(example);
    return {
      status: 'UNSUPPORTED',
      message: `I heard "${heard}". I can help with ${TOPIC_LABEL[topic]}, but I'm not sure what you want. Did you mean one of these?`,
      options: [...options, HELP_OPTION],
    };
  }
  // No topic: a few different areas, varied by the sentence, so the same chips do not repeat.
  const firsts = [...topics.values()].map((cs) => example(cs[0]));
  let h = 0;
  for (const ch of heard) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const start = firsts.length ? h % firsts.length : 0;
  const picks = [...firsts.slice(start), ...firsts.slice(0, start)].slice(0, 4);
  return {
    status: 'UNSUPPORTED',
    message: `I heard "${heard}" but didn't understand it as something I can do. You can ask "What can you do?", or try one of these.`,
    options: [HELP_OPTION, ...picks],
  };
}
