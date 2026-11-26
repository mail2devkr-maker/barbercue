import { z } from 'zod';

/**
 * FastQue Growth AI — customer acquisition (advisory mode, first vertical slice).
 *
 * Keyword intelligence → active salon matching → campaign proposal → admin approval → measurement
 * of completed bookings. Nothing here spends money, publishes an ad or sends a message. Every number
 * carries where it came from (`DataSource`); mock and AI-written values are labelled, never shown as
 * real data. Money is integer paise; Google Ads bids are micros of the account currency.
 */

// ---------- Roles and permissions ----------

export const GROWTH_ROLES = ['ADMIN', 'MARKETING_MANAGER', 'ANALYST', 'READ_ONLY'] as const;
export type GrowthRole = (typeof GROWTH_ROLES)[number];

export const GROWTH_PERMISSIONS = ['view', 'research', 'draft', 'approve', 'settings'] as const;
export type GrowthPermission = (typeof GROWTH_PERMISSIONS)[number];

/** What each Growth role may do. `settings` (roles, emergency pause, exclusions) is ADMIN only. */
export const GROWTH_ROLE_PERMISSIONS: Record<GrowthRole, readonly GrowthPermission[]> = {
  ADMIN: ['view', 'research', 'draft', 'approve', 'settings'],
  MARKETING_MANAGER: ['view', 'research', 'draft', 'approve'],
  ANALYST: ['view', 'research'],
  READ_ONLY: ['view'],
};

export const GROWTH_ROLE_LABEL: Record<GrowthRole, string> = {
  ADMIN: 'Admin',
  MARKETING_MANAGER: 'Marketing Manager',
  ANALYST: 'Analyst',
  READ_ONLY: 'Read-Only',
};

// ---------- Data provenance ----------

/** Where a number came from. Only FIRST_PARTY and GOOGLE_ADS are real data. */
export const DATA_SOURCES = ['FIRST_PARTY', 'GOOGLE_ADS', 'MOCK', 'AI_GENERATED', 'TEMPLATE', 'ASSUMPTION', 'UNAVAILABLE'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export const DATA_SOURCE_LABEL: Record<DataSource, string> = {
  FIRST_PARTY: 'FastQue data',
  GOOGLE_ADS: 'Google Ads Keyword Planner',
  MOCK: 'MOCK — not real data',
  AI_GENERATED: 'AI draft — needs review',
  TEMPLATE: 'Template text',
  ASSUMPTION: 'Configured assumption',
  UNAVAILABLE: 'Unavailable',
};

export const KEYWORD_PROVIDERS = ['none', 'mock', 'google_ads'] as const;
export type KeywordProviderName = (typeof KEYWORD_PROVIDERS)[number];

// ---------- Services the agent can target ----------

/**
 * Searchable service groups and the words used to find a salon's matching services. Matching is a
 * case-insensitive "contains" on the service name or category; the seed keywords go to Keyword Planner.
 */
export const GROWTH_SERVICES = {
  haircut: {
    label: 'Haircut',
    terms: ['haircut', 'hair cut', 'hair-cut'],
    seeds: ['haircut', 'salon near me', 'men haircut', 'hair salon'],
  },
  beard: {
    label: 'Beard trim / shave',
    terms: ['beard', 'shave', 'trim'],
    seeds: ['beard trim', 'shave near me', 'beard styling'],
  },
  facial: {
    label: 'Facial',
    terms: ['facial', 'clean up', 'cleanup'],
    seeds: ['facial near me', 'facial salon', 'cleanup facial'],
  },
  hair_colour: {
    label: 'Hair colour',
    terms: ['colour', 'color', 'highlight'],
    seeds: ['hair colour salon', 'hair color near me', 'highlights salon'],
  },
} as const;
export type GrowthServiceKey = keyof typeof GROWTH_SERVICES;
export const GROWTH_SERVICE_KEYS = Object.keys(GROWTH_SERVICES) as GrowthServiceKey[];

// ---------- Proposal lifecycle ----------

/**
 * RESEARCH is the keyword run itself. In advisory mode a proposal can reach APPROVED (a person may set
 * it up by hand in Google Ads) but never PUBLISHED: no publish route exists in this slice.
 */
export const PROPOSAL_STATUSES = ['DRAFT', 'REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const LIFECYCLE_STEPS = ['RESEARCH', 'DRAFT', 'REVIEW', 'APPROVE', 'PUBLISH', 'MONITOR'] as const;

export const PROPOSAL_ACTIONS = ['submit', 'approve', 'send_back', 'reject', 'archive'] as const;
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

/** from-status → action → to-status. Anything not listed is refused by the server. */
export const PROPOSAL_TRANSITIONS: Record<ProposalStatus, Partial<Record<ProposalAction, ProposalStatus>>> = {
  DRAFT: { submit: 'REVIEW', archive: 'ARCHIVED' },
  REVIEW: { approve: 'APPROVED', send_back: 'DRAFT', reject: 'REJECTED' },
  APPROVED: { archive: 'ARCHIVED' },
  REJECTED: { archive: 'ARCHIVED' },
  ARCHIVED: {},
};
export const ACTION_PERMISSION: Record<ProposalAction, GrowthPermission> = {
  submit: 'draft',
  archive: 'draft',
  approve: 'approve',
  send_back: 'approve',
  reject: 'approve',
};

export function nextStatus(from: ProposalStatus, action: ProposalAction): ProposalStatus | null {
  return PROPOSAL_TRANSITIONS[from]?.[action] ?? null;
}

// ---------- Money (deterministic, integer) ----------

/** Google Ads micros (1 unit = 1,000,000 micros) → paise (1 unit = 100 paise). */
export const microsToPaise = (micros: number | null | undefined): number | null =>
  micros == null ? null : Math.round(micros / 10_000);
export const inrToPaise = (inr: number): number => Math.round(inr * 100);
export const paiseToInr = (paise: number): number => paise / 100;

// ---------- Opportunity scoring ----------

export const COMPETITION_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] as const;
export type CompetitionLevel = (typeof COMPETITION_LEVELS)[number];
export const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW', 'NO_SUPPLY', 'INSUFFICIENT_DATA'] as const;
export type OpportunityPriority = (typeof PRIORITIES)[number];
export const CHANNELS = ['GOOGLE_SEARCH', 'LOCAL_SEO', 'OFFLINE_QR', 'NONE'] as const;
export type RecommendedChannel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<RecommendedChannel, string> = {
  GOOGLE_SEARCH: 'Google Search ads',
  LOCAL_SEO: 'Local SEO page',
  OFFLINE_QR: 'Offline / QR',
  NONE: 'None — add salons first',
};

export interface OpportunityInput {
  avgMonthlySearches: number | null;
  competition: CompetitionLevel;
  highBidMicros: number | null;
  matchingSalons: number;
  dailyBudgetPaise: number;
}

/** Deterministic priority. No supply always wins: never advertise what no active salon can serve. */
export function opportunityPriority(o: OpportunityInput): OpportunityPriority {
  if (o.matchingSalons <= 0) return 'NO_SUPPLY';
  if (o.avgMonthlySearches == null) return 'INSUFFICIENT_DATA';
  let score = o.avgMonthlySearches >= 1000 ? 3 : o.avgMonthlySearches >= 200 ? 2 : o.avgMonthlySearches >= 30 ? 1 : 0;
  if (o.competition === 'LOW') score += 1;
  if (o.competition === 'HIGH') score -= 1;
  if (o.matchingSalons >= 5) score += 1;
  return score >= 4 ? 'HIGH' : score >= 2 ? 'MEDIUM' : 'LOW';
}

/** Deterministic channel. Google Search only when there is demand and the budget buys ~10 top-of-page clicks a day. */
export function recommendedChannel(o: OpportunityInput): RecommendedChannel {
  if (o.matchingSalons <= 0) return 'NONE';
  if (o.avgMonthlySearches == null) return 'LOCAL_SEO';
  if (o.avgMonthlySearches < 30) return 'OFFLINE_QR';
  const highBidPaise = microsToPaise(o.highBidMicros);
  if (highBidPaise != null && highBidPaise * 10 > o.dailyBudgetPaise && o.competition === 'HIGH') return 'LOCAL_SEO';
  return 'GOOGLE_SEARCH';
}

export const PRIORITY_RANK: Record<OpportunityPriority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, INSUFFICIENT_DATA: 3, NO_SUPPLY: 4 };

// ---------- Financial preview ----------

export interface Sourced<T> {
  value: T | null;
  source: DataSource;
  note?: string;
}

export interface FinancialPreviewInput {
  dailyBudgetPaise: number;
  durationDays: number;
  lowBidMicros: number | null;
  highBidMicros: number | null;
  bidSource: DataSource;
  /** Average completed service value at the matched salons (FastQue data) or null. */
  avgServiceValuePaise: number | null;
  avgServiceValueSource: DataSource;
  /** What one completed booking is worth to FastQue, from configuration; null when not configured. */
  contributionPerBookingPaise: number | null;
}

export interface FinancialPreview {
  dailyBudgetPaise: number;
  durationDays: number;
  totalBudgetPaise: number;
  clicksPerDay: Sourced<{ min: number; max: number }>;
  avgServiceValuePaise: Sourced<number>;
  breakEvenBookingsPerDay: Sourced<number>;
  maxAcquisitionCostPaise: Sourced<number>;
  expectedBookings: Sourced<number>;
  realSpendPaise: 0;
}

export function financialPreview(i: FinancialPreviewInput): FinancialPreview {
  const low = microsToPaise(i.lowBidMicros);
  const high = microsToPaise(i.highBidMicros);
  const clicks: Sourced<{ min: number; max: number }> =
    low && high && low > 0 && high > 0
      ? {
          value: { min: Math.floor(i.dailyBudgetPaise / high), max: Math.floor(i.dailyBudgetPaise / low) },
          source: i.bidSource,
          note: 'Budget ÷ top-of-page bid (80th and 20th percentile). Real cost per click is set by the auction.',
        }
      : { value: null, source: 'UNAVAILABLE', note: 'No bid data for these keywords.' };
  const contribution = i.contributionPerBookingPaise;
  return {
    dailyBudgetPaise: i.dailyBudgetPaise,
    durationDays: i.durationDays,
    totalBudgetPaise: i.dailyBudgetPaise * i.durationDays,
    clicksPerDay: clicks,
    avgServiceValuePaise:
      i.avgServiceValuePaise != null
        ? { value: i.avgServiceValuePaise, source: i.avgServiceValueSource }
        : { value: null, source: 'UNAVAILABLE', note: 'Not enough completed bookings at the matched salons.' },
    breakEvenBookingsPerDay:
      contribution && contribution > 0
        ? { value: Math.ceil(i.dailyBudgetPaise / contribution), source: 'ASSUMPTION', note: 'Daily budget ÷ configured contribution per completed booking.' }
        : { value: null, source: 'UNAVAILABLE', note: 'Set GROWTH_AI_CONTRIBUTION_PER_BOOKING_INR to see break-even.' },
    maxAcquisitionCostPaise:
      contribution && contribution > 0
        ? { value: contribution, source: 'ASSUMPTION', note: 'A booking costing more than its contribution loses money.' }
        : { value: null, source: 'UNAVAILABLE' },
    expectedBookings: {
      value: null,
      source: 'UNAVAILABLE',
      note: 'FastQue has no measured click-to-booking rate yet; it is not guessed.',
    },
    realSpendPaise: 0,
  };
}

// ---------- Ad copy ----------

/** Google Ads responsive search ads: headlines up to 30 characters, descriptions up to 90. */
export const AD_LIMITS = { headline: 30, description: 90, maxHeadlines: 15, maxDescriptions: 4, minHeadlines: 3, minDescriptions: 2 } as const;

/** Claims the slice cannot back up (no verified offers yet), plus links and contact details. */
const UNVERIFIED_CLAIM = /(₹|rs\.?\s?\d|\d+\s?%|\bfree\b|\bdiscount|\boffer|\bcheapest\b|\bbest\b|\b#1\b|\bguarantee|https?:|www\.|@|\+?\d{7,})/i;

export interface AdCopy {
  headlines: string[];
  descriptions: string[];
}

export function validateAdCopy(copy: AdCopy): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const check = (kind: 'headline' | 'description', text: string) => {
    const t = text.trim();
    if (!t) problems.push(`Empty ${kind}.`);
    if (t.length > AD_LIMITS[kind]) problems.push(`"${t}" is longer than ${AD_LIMITS[kind]} characters.`);
    if (UNVERIFIED_CLAIM.test(t)) problems.push(`"${t}" makes a claim, price, offer or contact detail FastQue has not verified.`);
  };
  copy.headlines.forEach((h) => check('headline', h));
  copy.descriptions.forEach((d) => check('description', d));
  if (copy.headlines.length < AD_LIMITS.minHeadlines || copy.headlines.length > AD_LIMITS.maxHeadlines)
    problems.push(`Needs ${AD_LIMITS.minHeadlines}–${AD_LIMITS.maxHeadlines} headlines.`);
  if (copy.descriptions.length < AD_LIMITS.minDescriptions || copy.descriptions.length > AD_LIMITS.maxDescriptions)
    problems.push(`Needs ${AD_LIMITS.minDescriptions}–${AD_LIMITS.maxDescriptions} descriptions.`);
  return { ok: problems.length === 0, problems };
}

/** Deterministic copy used when no model is configured (labelled TEMPLATE). */
export function templateAdCopy(serviceLabel: string, city: string): AdCopy {
  const fit = (max: number, ...options: string[]) => options.find((o) => o.length <= max) ?? null;
  const headlines = [
    fit(30, `${serviceLabel} in ${city}`, `${serviceLabel} Near You`),
    fit(30, `Book a ${serviceLabel} Online`, `Book a ${serviceLabel}`),
    'Skip the Salon Queue',
    'See Live Salon Queues',
    fit(30, `Verified Salons in ${city}`, 'Verified Salons Near You'),
    'Book on FastQue',
  ].filter((h): h is string => !!h);
  const descriptions = [
    fit(90, `Find verified salons in ${city}, see the live queue and book your ${serviceLabel.toLowerCase()} on FastQue.`, `Find verified salons, see the live queue and book on FastQue.`),
    'Join the queue from your phone and arrive when it is your turn. No waiting in line.',
  ].filter((d): d is string => !!d);
  return { headlines, descriptions };
}

// ---------- Request schemas ----------

const geoTarget = z.string().regex(/^geoTargetConstants\/\d{1,12}$/, 'Use a Google Ads geo target constant, e.g. geoTargetConstants/1007751.');
const languageConstant = z.string().regex(/^languageConstants\/\d{1,6}$/);

export const growthKeywordRunSchema = z
  .object({
    cityId: z.string().uuid(),
    serviceKey: z.enum(GROWTH_SERVICE_KEYS as [GrowthServiceKey, ...GrowthServiceKey[]]),
    /** City-level Google Ads location. Neighbourhood volumes are never requested or invented. */
    geoTargetConstant: geoTarget.optional(),
    language: languageConstant.default('languageConstants/1000'),
    extraSeeds: z.array(z.string().trim().min(2).max(60).regex(/^[\p{L}\p{N} '&-]+$/u)).max(10).default([]),
    dailyBudgetInr: z.number().int().min(50).max(100_000).default(500),
  })
  .strict();
export type GrowthKeywordRunInput = z.infer<typeof growthKeywordRunSchema>;

export const growthProposalCreateSchema = z
  .object({
    keywordRunId: z.string().uuid(),
    ideaIds: z.array(z.string().uuid()).min(1).max(50),
    dailyBudgetInr: z.number().int().min(50).max(100_000),
    durationDays: z.number().int().min(1).max(90),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    name: z.string().trim().min(3).max(120).optional(),
  })
  .strict();
export type GrowthProposalCreateInput = z.infer<typeof growthProposalCreateSchema>;

export const growthTransitionSchema = z
  .object({
    action: z.enum(PROPOSAL_ACTIONS),
    note: z.string().trim().max(500).optional(),
    /** Required to approve a proposal built on MOCK data: the approver confirms the numbers are not real. */
    acknowledgeMock: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !['reject', 'send_back'].includes(v.action) || (v.note?.length ?? 0) >= 3, {
    message: 'Say why (at least 3 characters).',
    path: ['note'],
  });
export type GrowthTransitionInput = z.infer<typeof growthTransitionSchema>;

export const growthRoleGrantSchema = z.object({ userId: z.string().min(1).max(64), role: z.enum(GROWTH_ROLES) }).strict();
export const growthPauseSchema = z.object({ paused: z.boolean(), reason: z.string().trim().min(3).max(300).optional() }).strict();
export const growthExclusionSchema = z.object({ salonId: z.string().min(1).max(64), reason: z.string().trim().min(3).max(200) }).strict();

// ---------- DTOs ----------

export interface GrowthMeDto {
  permissions: GrowthPermission[];
  role: GrowthRole | null;
  paused: boolean;
  pausedReason: string | null;
  mode: 'ADVISORY';
  keywordProvider: { name: KeywordProviderName; configured: boolean; isMock: boolean; note: string };
  llm: { configured: boolean; provider: string; models: string[]; note: string };
}

export interface OpportunityRowDto {
  ideaId: string;
  keyword: string;
  location: string;
  searchDemand: Sourced<number>;
  monthly: Array<{ year: number; month: number; searches: number | null }>;
  competition: CompetitionLevel;
  competitionIndex: number | null;
  lowBidPaise: number | null;
  highBidPaise: number | null;
  recommendedChannel: RecommendedChannel;
  matchingSalons: number;
  priority: OpportunityPriority;
  isMock: boolean;
}

export interface MatchedSalonDto {
  salonId: string;
  name: string;
  locality: string | null;
  services: Array<{ name: string; pricePaise: number }>;
  completedLast30Days: number;
}

export interface MeasurementWindowDto {
  from: string;
  to: string;
  completedBookings: number;
  serviceValuePaise: number;
  newCustomers: number;
}

export interface MeasurementDto {
  proposalId: string;
  computedAt: string;
  salonCount: number;
  campaign: MeasurementWindowDto;
  baseline: MeasurementWindowDto;
  observedChange: { completedBookings: number; serviceValuePaise: number; newCustomers: number };
  firstPartyAttributed: Sourced<number>;
  platformAttributed: Sourced<number>;
  realSpendPaise: number;
  costPerCompletedBooking: Sourced<number>;
  caveats: string[];
}
