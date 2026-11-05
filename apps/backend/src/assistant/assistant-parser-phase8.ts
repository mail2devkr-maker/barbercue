import { AssistantActionId } from '@barbercue/shared';
import { parsePeriod } from './assistant-period';

const periodNamed = (t: string) => {
  const p = parsePeriod(t, new Date().getUTCFullYear());
  return !!p && p.kind !== 'today';
};

/**
 * Phase 8 (issue #368): the conversation basics the owner's QA found missing.
 *
 *  - HELP: greetings and "what can you do / how can you help / tum kya kar sakte ho". The answer is
 *    built on the server from what THIS user may actually do on THIS screen (assistant.service).
 *  - NAVIGATE: "Bookings kholo", "services page kholo", "dashboard pe jao". The server maps a fixed
 *    page key to a route of the authorized shop; the client opens it on the MAIN screen.
 *  - BACK: "go back / wapas jao". Before this, "wapas jao" parsed as RESTORE A SERVICE (a write).
 *
 * Runs before every other phase, on the sentence and on its romanized reading. None of these
 * intents changes data, and navigation grants nothing: each page still checks its own access.
 */
export type NavPage =
  | 'dashboard'
  | 'queue'
  | 'bookings'
  | 'schedule'
  | 'staff'
  | 'team'
  | 'services'
  | 'chairs'
  | 'settings'
  | 'hours'
  | 'offers'
  | 'reviews'
  | 'invoices'
  | 'revenue'
  | 'customers'
  | 'analytics'
  | 'cancellations'
  | 'inventory'
  | 'notifications'
  | 'payments'
  | 'photos'
  | 'marketing'
  | 'bookingSources'
  | 'paymentQr'
  | 'location'
  | 'verification'
  | 'contacts';

export type AdminNavPage =
  | 'adminHome'
  | 'liveQueue'
  | 'allBookings'
  | 'onboarding'
  | 'shopStatus'
  | 'verification'
  | 'shopDeletions'
  | 'employees'
  | 'crm'
  | 'commandCenter'
  | 'customers'
  | 'salonStaff'
  | 'inventory'
  | 'adminUsers'
  | 'locationProposals';

export type Phase8Intent =
  | { action: typeof AssistantActionId.HELP; greeting: boolean }
  | {
      action: typeof AssistantActionId.ADMIN_NAVIGATE;
      page: AdminNavPage | null;
    }
  | { action: typeof AssistantActionId.NAVIGATE; page: NavPage | null }
  | { action: typeof AssistantActionId.NAVIGATE_BACK };

const W = (words: string) => new RegExp(`(?:^|\\s)(?:${words})(?=\\s|$)`, 'u');

const HELP = W(
  [
    'what can you do',
    'what can u do',
    'what all can you do',
    'what do you do',
    'what can i ask',
    'what can i say',
    'what should i say',
    'how can you help',
    'how can u help',
    'how could you help',
    'how do you help',
    'can you help',
    'help me',
    'what are you',
    'who are you',
    'what is this',
    'your features',
    'kya kya kar',
    'kya kar sakte',
    'kya kar sakti',
    'kya kar sakta',
    'kya karte ho',
    'kya karti ho',
    'kya kar paoge',
    'kaise help',
    'kaise madad',
    'kya madad',
    'madad karo',
    'madad kar',
    'help karo',
    'help kar',
    'help chahiye',
    'tum kaun',
    'aap kaun',
    'kya pooch',
    'kya puch',
    'kya bol',
  ].join('|'),
);
const HELP_ALONE =
  /^(?:help|madad|options|menu|features|commands|what now|kya karu|kya karun|kya karoon)$/u;
const GREETING =
  /^(?:hi|hello|hey|hii|helo|namaste|namaskar|नमस्ते|नमस्कार|good morning|good afternoon|good evening|kaise ho|how are you|hello assistant|hi assistant)(?: (?:ji|sir|assistant|fastque))?$/u;

const BACK =
  /^(?:(?:please |plz )?(?:go back|back|go to previous page|previous page|pichla page|pichhla page|pichle page|peeche jao|peeche chalo|wapas jao|wapas chalo|vapas jao|vapas chalo|wapas le chalo|back jao|back karo|wapas)(?: jao| please| karo)?)$/u;

// A navigation verb. "dikhao" alone is a READ ("staff dikhao"); with "page/screen" it navigates.
const OPEN = W(
  'kholo|khol do|kholiye|open|open karo|open kar do|go to|goto|take me to|le chalo|le jao|pe jao|par jao|mein jao|pe chalo|par chalo|navigate|jao|chalo|switch to',
);
const PAGE_WORD = W('page|screen|tab|section|pe|par');
const SHOWISH = W('dikhao|dikha do|show|batao');
// Words that make the sentence a change or a time-bound question, never navigation.
const NOT_NAV = W(
  'add|jodo|naya|new|price|rate|daam|cancel|band|delete|hatao|remove|archive|restore|badha|badhao|ghata|ghatao|kam|increase|decrease|set|change|badlo|rename|call|bulao|monday|tuesday|wednesday|thursday|friday|saturday|sunday|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar|ravivar|kal|parso|tomorrow|yesterday',
);

const PAGES: Array<[NavPage, RegExp]> = [
  ['bookingSources', W('booking sources|booking source|sources')],
  [
    'dashboard',
    W(
      'dashboard|home|homepage|home page|overview|main page|main screen|mukhya',
    ),
  ],
  ['queue', W('live queue|queue|line|kataar|katar|कतार')],
  ['schedule', W('schedule|calendar')],
  ['bookings', W('bookings|booking|appointments|appointment')],
  ['team', W('team')],
  ['staff', W('staff|barbers|barber|stylists|stylist|employees|karigar')],
  ['services', W('services|service|menu|rate list|price list')],
  ['chairs', W('chairs|chair|kursi|kursiyan')],
  ['hours', W('hours|timings|timing|opening hours|shop timings')],
  ['offers', W('offers|offer|deals|deal')],
  ['reviews', W('reviews|review|ratings|rating')],
  ['invoices', W('invoices|invoice|bills|bill')],
  ['revenue', W('revenue|sales|earnings|kamai')],
  ['customers', W('customers|customer|clients|client')],
  ['analytics', W('analytics|reports|report')],
  ['cancellations', W('cancellations')],
  ['inventory', W('inventory|stock')],
  ['notifications', W('notifications|notification')],
  ['paymentQr', W('payment qr|qr code|qr|upi qr|upi')],
  ['payments', W('payments|payment')],
  ['photos', W('photos|photo|gallery')],
  ['marketing', W('marketing')],
  ['location', W('location|address|map|shop location|shop address')],
  ['verification', W('verification|verify|kyc|documents|document')],
  ['contacts', W('contacts|contact list|contact')],
  ['settings', W('settings|setting')],
];

export function pageIn(text: string): NavPage | null {
  for (const [page, re] of PAGES) if (re.test(text)) return page;
  return null;
}

export function parsePhase8(
  text: string,
  surface: 'shop' | 'customer' | 'admin' | 'employee',
): Phase8Intent | null {
  const t = text.replace(/\?/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (GREETING.test(t))
    return { action: AssistantActionId.HELP, greeting: true };
  if (HELP.test(t) || HELP_ALONE.test(t))
    return { action: AssistantActionId.HELP, greeting: false };

  if (surface === 'admin') return parseAdminNav(t);
  if (surface !== 'shop') return null;
  if (BACK.test(t)) return { action: AssistantActionId.NAVIGATE_BACK };
  if (/\d/u.test(t) || NOT_NAV.test(t)) return null;
  const page = pageIn(t);
  const verb =
    OPEN.test(t) || (SHOWISH.test(t) && W('page|screen|tab').test(t));
  if (!verb) return null;
  // "Pichhle mahine ki booking kholo": the period report, which opens Bookings filtered to that period.
  if (page === 'bookings' && periodNamed(t)) return null;
  if (page) return { action: AssistantActionId.NAVIGATE, page };
  // "wo page kholo": a navigation request without a page we know -> ask which one.
  if (PAGE_WORD.test(t) && W('page|screen|tab|section').test(t))
    return { action: AssistantActionId.NAVIGATE, page: null };
  return null;
}

// Admin screens (issue #362 follow-up): the same "X kholo / open X" phrasing opens a fixed admin page.
// Order matters: more specific phrases first ("live queue" before "queue", "all bookings" before "bookings").
const ADMIN_PAGES: Array<[AdminNavPage, RegExp]> = [
  [
    'liveQueue',
    W(
      'live queue monitoring|live queue|queue monitoring|queue monitor|live line',
    ),
  ],
  ['allBookings', W('all bookings|bookings|booking list|appointments')],
  ['onboarding', W('new shop onboarding|shop onboarding|onboarding|new shops')],
  [
    'shopDeletions',
    W('shop deletions|deletion requests|deletions|trash|recovery trash'),
  ],
  ['locationProposals', W('location proposals|location proposal')],
  [
    'shopStatus',
    W('shop status|shops status|open shops|closed shops|shops|shop list'),
  ],
  ['verification', W('verification queue|verifications|verification|kyc')],
  ['employees', W('employees|employee|field executives')],
  ['crm', W('crm|leads|follow ups|follow-ups')],
  ['commandCenter', W('command center|executive overview|business overview')],
  ['customers', W('customers|customer analytics')],
  ['salonStaff', W('salon staff|staff analytics|barbers|staff')],
  ['inventory', W('inventory|catalog|product catalog')],
  ['adminUsers', W('admin users|admin access|access management')],
  ['adminHome', W('dashboard|home|overview|platform operations|main page')],
];

// "kitni shops open hain" asks a question (it is answered by the admin reads), it is not "open X".
const ADMIN_QUESTION = W(
  'kitni|kitne|kitna|how many|how much|kya|kaun|kaunsi|kaunse|which|what|kab|when|hain|hai',
);

function parseAdminNav(t: string): Phase8Intent | null {
  if (BACK.test(t)) return { action: AssistantActionId.NAVIGATE_BACK };
  if (/\d/u.test(t) || NOT_NAV.test(t) || ADMIN_QUESTION.test(t)) return null;
  const verb =
    OPEN.test(t) || (SHOWISH.test(t) && W('page|screen|tab').test(t));
  if (!verb) return null;
  for (const [page, re] of ADMIN_PAGES)
    if (re.test(t)) return { action: AssistantActionId.ADMIN_NAVIGATE, page };
  if (W('page|screen|tab|section').test(t))
    return { action: AssistantActionId.ADMIN_NAVIGATE, page: null };
  return null;
}
