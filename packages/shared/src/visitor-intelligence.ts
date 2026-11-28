import { z } from "zod";
import { Role } from "./enums";
import { normalizeServiceText, resolveServiceNameGroup } from "./catalog/service-name-matching";

// =============================================================================================
// FastQue Visitor Intelligence (docs/visitor-intelligence/). First-party, consent-aware analytics.
// Everything here is shared by the backend (ingestion, aggregation, RBAC) and the web app (tracker,
// admin dashboards) so a rule exists exactly once.
// =============================================================================================

export const VI_PATHS = {
  root: "visitor-intel",
  collect: "collect",
  consent: "consent",
  config: "config",
  me: "me",
  overview: "overview",
  drilldown: "drilldown",
  live: "live",
  visitors: "visitors",
  sessions: "sessions",
  geo: "geo",
  opportunities: "opportunities",
  search: "search",
  journey: "journey",
  funnels: "funnels",
  sources: "sources",
  conversions: "conversions",
  campaigns: "campaigns",
  insights: "insights",
  ask: "ask",
  segments: "segments",
  alerts: "alerts",
  reports: "reports",
  settings: "settings",
  integrations: "integrations",
  privacy: "privacy",
  staffRoles: "staff-roles",
  salon: "salon",
  demo: "demo",
} as const;

// ---------- Vocabulary ----------

export const VI_EVENT_TYPES = [
  "page_view",
  "engagement",
  "search",
  "search_results",
  "location_set",
  "salon_view",
  "price_compare",
  "service_select",
  "product_view",
  "add_to_cart",
  "sign_up_start",
  "sign_up",
  "login",
  "booking_start",
  "booking_payment",
  "booking_confirmed",
  "booking_failed",
  "queue_join",
  "home_service_view",
  "home_booking_confirmed",
  "stylist_view",
  "checkout_start",
  "purchase",
  "payment_failed",
  "job_view",
  "job_apply",
  "staffing_request",
  "partner_registration_start",
  "partner_registration",
  "loyalty_join",
  "near_me",
  "page_error",
] as const;
export type ViEventType = (typeof VI_EVENT_TYPES)[number];

/** Events that are "essential" in the sense of DPDP / ePrivacy: none. Every event needs analytics consent. */
export const VI_MODULES = [
  "SALON_BOOKING",
  "LIVE_QUEUE",
  "HOME_SERVICES",
  "FREELANCE_STYLIST",
  "MARKETPLACE",
  "JOBS",
  "INSTANT_HIRING",
  "PARTNER",
  "LOYALTY",
  "CONTENT",
] as const;
export type ViModule = (typeof VI_MODULES)[number];

export const VI_MODULE_LABELS: Record<ViModule, string> = {
  SALON_BOOKING: "Salon booking",
  LIVE_QUEUE: "Live queue",
  HOME_SERVICES: "Home services",
  FREELANCE_STYLIST: "Freelance stylists",
  MARKETPLACE: "Marketplace",
  JOBS: "Jobs",
  INSTANT_HIRING: "Instant hiring",
  PARTNER: "Partner registration",
  LOYALTY: "Loyalty & subscriptions",
  CONTENT: "Content & SEO pages",
};

export const VI_SEARCH_KINDS = ["SERVICE", "SALON", "PRODUCT", "HOME_SERVICE", "STYLIST", "JOB", "STAFFING"] as const;
export type ViSearchKind = (typeof VI_SEARCH_KINDS)[number];

export const VI_CHANNELS = [
  "GOOGLE_ORGANIC",
  "GOOGLE_ADS",
  "BING_ORGANIC",
  "FACEBOOK",
  "INSTAGRAM",
  "META_ADS",
  "WHATSAPP",
  "YOUTUBE",
  "INFLUENCER",
  "SALON_QR",
  "REFERRAL_LINK",
  "EMAIL",
  "SMS",
  "FIELD_SALES",
  "REFERRAL",
  "DIRECT",
  "UNKNOWN",
] as const;
export type ViChannel = (typeof VI_CHANNELS)[number];

export const VI_CHANNEL_LABELS: Record<ViChannel, string> = {
  GOOGLE_ORGANIC: "Google Organic",
  GOOGLE_ADS: "Google Ads",
  BING_ORGANIC: "Bing Organic",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  META_ADS: "Meta Ads",
  WHATSAPP: "WhatsApp",
  YOUTUBE: "YouTube",
  INFLUENCER: "Influencers",
  SALON_QR: "Salon / campaign QR",
  REFERRAL_LINK: "Referral links",
  EMAIL: "Email",
  SMS: "SMS",
  FIELD_SALES: "Field sales",
  REFERRAL: "Other referrals",
  DIRECT: "Direct",
  UNKNOWN: "Unknown",
};

export const VI_CAMPAIGN_KINDS = [
  "UTM_LINK",
  "SALON_QR",
  "EMPLOYEE_QR",
  "INFLUENCER",
  "SOCIETY_QR",
  "CITY_QR",
  "PAMPHLET_QR",
  "ONLINE_AD",
  "REFERRAL",
] as const;
export type ViCampaignKind = (typeof VI_CAMPAIGN_KINDS)[number];

export const VI_CAMPAIGN_KIND_LABELS: Record<ViCampaignKind, string> = {
  UTM_LINK: "UTM link",
  SALON_QR: "Salon QR",
  EMPLOYEE_QR: "Sales employee QR",
  INFLUENCER: "Influencer",
  SOCIETY_QR: "Society QR",
  CITY_QR: "City QR",
  PAMPHLET_QR: "Pamphlet QR",
  ONLINE_AD: "Online ad",
  REFERRAL: "Referral",
};

export const VI_DEVICE_CATEGORIES = ["mobile", "tablet", "desktop", "unknown"] as const;
export type ViDeviceCategory = (typeof VI_DEVICE_CATEGORIES)[number];

export const VI_GEO_SOURCES = ["CDN_HEADER", "OFFLINE_DB", "BROWSER_PERMISSION", "USER_SELECTED", "NONE"] as const;
export type ViGeoSource = (typeof VI_GEO_SOURCES)[number];

export const VI_GEO_SOURCE_LABELS: Record<ViGeoSource, string> = {
  CDN_HEADER: "Approximate (network / CDN)",
  OFFLINE_DB: "Approximate (IP database)",
  BROWSER_PERMISSION: "Precise (browser permission)",
  USER_SELECTED: "Chosen by the visitor",
  NONE: "Unknown",
};

// ---------- Ingestion contract ----------

const shortText = (max: number) => z.string().trim().max(max);
const optShort = (max: number) => shortText(max).optional().nullable();

/** Only these property keys are ever kept from a client event; everything else is dropped server-side. */
export const VI_ALLOWED_PROP_KEYS = [
  "query",
  "searchKind",
  "location",
  "resultCount",
  "priceMin",
  "priceMax",
  "distanceKm",
  "gender",
  "minRating",
  "preferredTime",
  "serviceName",
  "serviceId",
  "productId",
  "quantity",
  "step",
  "reason",
  "errorCode",
  "engagedMs",
  "scrollDepth",
  "title",
  "value",
  "currency",
  "lat",
  "lng",
  "accuracyM",
  "city",
  "method",
] as const;

const propValue = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]);

export const viEventInputSchema = z.object({
  /** Client-generated UUID: the dedupe key across retries and browser vs server copies. */
  id: z.string().uuid(),
  type: z.enum(VI_EVENT_TYPES),
  ts: z.number().int().positive(),
  path: shortText(300),
  module: z.enum(VI_MODULES).optional(),
  entityType: optShort(40),
  entityId: optShort(80),
  salonId: optShort(80),
  props: z.record(propValue).optional(),
});
export type ViEventInput = z.infer<typeof viEventInputSchema>;

export const viCollectSchema = z.object({
  visitorId: z.string().uuid(),
  sessionId: z.string().uuid(),
  consent: z.object({ analytics: z.boolean(), marketing: z.boolean().default(false) }),
  context: z.object({
    landingPath: optShort(300),
    referrer: optShort(500),
    utmSource: optShort(120),
    utmMedium: optShort(120),
    utmCampaign: optShort(160),
    utmContent: optShort(160),
    utmTerm: optShort(160),
    campaignCode: optShort(40),
    gclid: optShort(200),
    fbclid: optShort(200),
    language: optShort(20),
    timezone: optShort(60),
    screenWidth: z.number().int().min(0).max(20000).optional().nullable(),
  }),
  events: z.array(viEventInputSchema).min(1).max(50),
});
export type ViCollectInput = z.infer<typeof viCollectSchema>;

export const viConsentSchema = z.object({
  visitorId: z.string().uuid(),
  analytics: z.boolean(),
  marketing: z.boolean(),
  preciseLocation: z.boolean().optional(),
  policyVersion: shortText(20),
  source: z.enum(["BANNER", "PREFERENCES"]).default("BANNER"),
});
export type ViConsentInput = z.infer<typeof viConsentSchema>;

export const VI_CONSENT_POLICY_VERSION = "2026-11";
export const VI_CONSENT_STORAGE_KEY = "fastque_consent_v1";

// ---------- Redaction: nothing sensitive typed into a search box is ever stored ----------

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
// 10+ digit runs (phones, cards, Aadhaar with or without separators), PAN, UPI handles, OTP-like strings.
const LONG_DIGITS_RE = /(?:\+?\d[\s-]?){8,}/g;
const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/gi;
const UPI_RE = /\b[\w.-]{2,}@[a-z]{2,}\b/gi;
const SECRET_WORD_RE = /\b(password|passcode|pwd|otp|pin|cvv|card\s*number)\b.*$/gi;

/** Returns the text with personal or secret data removed, plus whether anything was removed. */
export function redactSensitiveText(text: string): { text: string; redacted: boolean } {
  const original = text.normalize("NFKC");
  const cleaned = original
    .replace(SECRET_WORD_RE, " ")
    .replace(EMAIL_RE, " ")
    .replace(UPI_RE, " ")
    .replace(PAN_RE, " ")
    .replace(LONG_DIGITS_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return { text: cleaned, redacted: cleaned !== original.replace(/\s+/g, " ").trim().slice(0, 120) };
}

/** Drops any key that is not allow-listed and redacts free text. Never trusts client money values. */
export function sanitizeViProps(props: Record<string, unknown> | undefined | null): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!props) return out;
  for (const key of VI_ALLOWED_PROP_KEYS) {
    const v = props[key];
    if (v === undefined) continue;
    if (typeof v === "string") out[key] = redactSensitiveText(v).text;
    else if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "boolean" || v === null) out[key] = v;
  }
  // Coordinates are only meaningful with the visitor's explicit permission; never more precise than ~100 m.
  if (typeof out.lat === "number") out.lat = Math.round(out.lat * 1000) / 1000;
  if (typeof out.lng === "number") out.lng = Math.round(out.lng * 1000) / 1000;
  return out;
}

// ---------- Search normalisation (reuses the /search service-name groups) ----------

/** Extra synonyms for analytics only; the booking search keeps its own stricter groups. */
const VI_EXTRA_SYNONYMS: ReadonlyArray<{ category: string; label: string; phrases: readonly string[] }> = [
  { category: "bridal-makeup", label: "Bridal makeup", phrases: ["bridal makeup", "wedding makeup", "bride makeup", "bridal make up", "dulhan makeup", "bridal package"] },
  { category: "facial", label: "Facial", phrases: ["face treatment", "face cleanup treatment", "facial treatment"] },
  { category: "beard-trim", label: "Beard trim", phrases: ["beard grooming", "beard styling", "beard shape", "beard set"] },
  { category: "haircut", label: "Haircut", phrases: ["hair trimming", "hair trim", "hair cutting", "kids haircut"] },
];

export interface ViNormalizedSearch {
  /** Redacted, trimmed original keyword as typed (kept for reporting). */
  original: string;
  /** Lowercase, punctuation-free form used for grouping. */
  normalized: string;
  /** Canonical service category id, or null when it is not a known service. */
  category: string | null;
  categoryLabel: string | null;
  redacted: boolean;
}

export function normalizeViSearch(query: string): ViNormalizedSearch {
  const { text, redacted } = redactSensitiveText(query);
  const normalized = normalizeServiceText(text);
  const extra = VI_EXTRA_SYNONYMS.find((s) => s.phrases.some((p) => normalized.includes(p)));
  if (extra) return { original: text, normalized, category: extra.category, categoryLabel: extra.label, redacted };
  const group = normalized.length >= 2 ? resolveServiceNameGroup(normalized) : undefined;
  return { original: text, normalized, category: group?.id ?? null, categoryLabel: group?.label ?? null, redacted };
}

// ---------- Traffic-source classification ----------

export interface ViSourceInput {
  utmSource?: string | null;
  utmMedium?: string | null;
  referrerDomain?: string | null;
  gclid?: boolean;
  fbclid?: boolean;
  campaignKind?: ViCampaignKind | null;
}

const has = (v: string | null | undefined, re: RegExp) => !!v && re.test(v);

/** Deterministic, documented channel rules (first match wins). The site's own domain counts as no referrer. */
export function classifyViChannel(i: ViSourceInput): ViChannel {
  const src = (i.utmSource ?? "").toLowerCase();
  const med = (i.utmMedium ?? "").toLowerCase();
  const ref = (i.referrerDomain ?? "").toLowerCase();
  const paid = /^(cpc|ppc|paid|paidsocial|paid_social|display|ads?)$/.test(med);

  if (i.campaignKind === "SALON_QR" || i.campaignKind === "SOCIETY_QR" || i.campaignKind === "CITY_QR" || i.campaignKind === "PAMPHLET_QR") return "SALON_QR";
  if (i.campaignKind === "EMPLOYEE_QR") return "FIELD_SALES";
  if (i.campaignKind === "INFLUENCER") return "INFLUENCER";
  if (i.campaignKind === "REFERRAL") return "REFERRAL_LINK";
  if (i.gclid || (paid && /google/.test(src))) return "GOOGLE_ADS";
  if (i.fbclid && paid) return "META_ADS";
  if (paid && /(facebook|instagram|meta|fb|ig)/.test(src)) return "META_ADS";
  if (/^(qr|offline|print)$/.test(med) || /qr/.test(src)) return "SALON_QR";
  if (/(field|sales_exec|employee)/.test(src) || med === "field") return "FIELD_SALES";
  if (/influencer|creator/.test(med) || /influencer/.test(src)) return "INFLUENCER";
  if (med === "referral_link" || src === "referral" || src === "refer") return "REFERRAL_LINK";
  if (med === "email" || /newsletter|mailchimp|sendgrid/.test(src)) return "EMAIL";
  if (med === "sms" || src === "sms") return "SMS";
  if (/whatsapp|wa$/.test(src) || has(ref, /(^|\.)whatsapp\.com$|^wa\.me$/)) return "WHATSAPP";
  if (/instagram|^ig$/.test(src) || has(ref, /(^|\.)instagram\.com$/)) return "INSTAGRAM";
  if (/facebook|^fb$/.test(src) || i.fbclid || has(ref, /(^|\.)(facebook\.com|fb\.com|fb\.me)$/)) return "FACEBOOK";
  if (/youtube/.test(src) || has(ref, /(^|\.)(youtube\.com|youtu\.be)$/)) return "YOUTUBE";
  if (/google/.test(src) || has(ref, /(^|\.)google\.[a-z.]+$/)) return "GOOGLE_ORGANIC";
  if (/bing/.test(src) || has(ref, /(^|\.)bing\.com$/)) return "BING_ORGANIC";
  if (src) return "REFERRAL";
  if (ref) return "REFERRAL";
  return "DIRECT";
}

/** Hostname of a referrer URL without "www.", or null for none/invalid/own site. */
export function referrerDomain(referrer: string | null | undefined, ownHosts: readonly string[] = []): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || ownHosts.some((h) => host === h || host.endsWith(`.${h}`))) return null;
    return host.slice(0, 120);
  } catch {
    return null;
  }
}

// ---------- User agent (coarse; never stored raw) ----------

export interface ViUserAgentInfo {
  device: ViDeviceCategory;
  browser: string;
  os: string;
  bot: boolean;
}

export const VI_BOT_UA_RE =
  /bot|crawler|spider|crawling|headlesschrome|lighthouse|google-inspectiontool|facebookexternalhit|slurp|bingpreview|uptimerobot|monitor|curl|wget|python-requests|axios|node-fetch|go-http-client|phantomjs|puppeteer|playwright/i;

export function parseViUserAgent(ua: string | null | undefined, screenWidth?: number | null): ViUserAgentInfo {
  const s = ua ?? "";
  const bot = !s || VI_BOT_UA_RE.test(s);
  const os = /windows/i.test(s) ? "Windows" : /android/i.test(s) ? "Android" : /iphone|ipad|ipod/i.test(s) ? "iOS" : /mac os x|macintosh/i.test(s) ? "macOS" : /linux/i.test(s) ? "Linux" : "Other";
  const browser = /edg\//i.test(s) ? "Edge" : /opr\/|opera/i.test(s) ? "Opera" : /samsungbrowser/i.test(s) ? "Samsung Internet" : /chrome|crios/i.test(s) ? "Chrome" : /firefox|fxios/i.test(s) ? "Firefox" : /safari/i.test(s) ? "Safari" : "Other";
  let device: ViDeviceCategory = /ipad|tablet/i.test(s) ? "tablet" : /mobi|iphone|android/i.test(s) ? "mobile" : s ? "desktop" : "unknown";
  if (device === "desktop" && screenWidth && screenWidth < 768) device = "mobile";
  return { device, browser, os, bot };
}

// ---------- Periods ----------

export const VI_PERIODS = ["today", "yesterday", "7d", "30d", "90d", "month", "quarter", "year", "custom"] as const;
export type ViPeriod = (typeof VI_PERIODS)[number];
export const VI_PERIOD_LABELS: Record<ViPeriod, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  month: "This month",
  quarter: "This quarter",
  year: "This year",
  custom: "Custom range",
};

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 86_400_000;

/** Start of the IST calendar day containing `t`, as a UTC instant. */
export function istDayStart(t: Date): Date {
  const shifted = t.getTime() + IST_OFFSET_MS;
  return new Date(shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - IST_OFFSET_MS);
}

/** "YYYY-MM-DD" of the IST calendar day containing `t`. */
export function istDateKey(t: Date): string {
  return new Date(t.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export interface ViRange {
  from: Date;
  to: Date; // exclusive
  previousFrom: Date;
  previousTo: Date;
}

/** Resolves a period (IST calendar) to [from, to) and the previous equivalent period of equal length. */
export function resolveViRange(period: ViPeriod, now: Date, custom?: { from?: string; to?: string }): ViRange {
  const today = istDayStart(now);
  let from: Date;
  let to: Date = new Date(today.getTime() + DAY_MS);
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  switch (period) {
    case "today": from = today; break;
    case "yesterday": from = new Date(today.getTime() - DAY_MS); to = today; break;
    case "7d": from = new Date(today.getTime() - 6 * DAY_MS); break;
    case "30d": from = new Date(today.getTime() - 29 * DAY_MS); break;
    case "90d": from = new Date(today.getTime() - 89 * DAY_MS); break;
    case "month": from = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS); break;
    case "quarter": from = new Date(Date.UTC(ist.getUTCFullYear(), Math.floor(ist.getUTCMonth() / 3) * 3, 1) - IST_OFFSET_MS); break;
    case "year": from = new Date(Date.UTC(ist.getUTCFullYear(), 0, 1) - IST_OFFSET_MS); break;
    case "custom": {
      const f = custom?.from && /^\d{4}-\d{2}-\d{2}$/.test(custom.from) ? new Date(`${custom.from}T00:00:00+05:30`) : new Date(today.getTime() - 29 * DAY_MS);
      const t = custom?.to && /^\d{4}-\d{2}-\d{2}$/.test(custom.to) ? new Date(new Date(`${custom.to}T00:00:00+05:30`).getTime() + DAY_MS) : to;
      from = f;
      to = t > f ? t : new Date(f.getTime() + DAY_MS);
      // Cap at 2 years so one request can never scan unbounded history.
      if (to.getTime() - from.getTime() > 731 * DAY_MS) from = new Date(to.getTime() - 731 * DAY_MS);
      break;
    }
  }
  const len = to.getTime() - from.getTime();
  return { from, to, previousFrom: new Date(from.getTime() - len), previousTo: from };
}

export const viFiltersSchema = z.object({
  period: z.enum(VI_PERIODS).default("7d"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  country: shortText(80).optional(),
  state: shortText(80).optional(),
  city: shortText(80).optional(),
  channel: z.enum(VI_CHANNELS).optional(),
  device: z.enum(VI_DEVICE_CATEGORIES).optional(),
  visitorType: z.enum(["new", "returning", "registered", "anonymous"]).optional(),
  module: z.enum(VI_MODULES).optional(),
  campaignId: z.string().uuid().optional(),
  salonId: shortText(80).optional(),
});
export type ViFilters = z.infer<typeof viFiltersSchema>;

export const viPageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: shortText(120).optional(),
  sort: shortText(40).optional(),
});

// ---------- Market opportunity ----------

export type ViOpportunityLevel = "HIGH" | "MEDIUM" | "LOW";

/**
 * Demand per active salon, documented so the score is explainable:
 *   demand = searches + 0.3 × visitors;  pressure = demand / max(1, activeSalons)
 *   HIGH   when demand ≥ 50 and pressure ≥ 25 (or no salons at all with demand ≥ 20)
 *   MEDIUM when demand ≥ 15 and pressure ≥ 8
 *   LOW    otherwise. Score (0-100) = round(100 × (1 − e^(−pressure/30))).
 */
export function scoreViOpportunity(m: { visitors: number; searches: number; activeSalons: number; zeroResultSearches?: number }) {
  const demand = m.searches + 0.3 * m.visitors + 0.5 * (m.zeroResultSearches ?? 0);
  const pressure = demand / Math.max(1, m.activeSalons);
  const level: ViOpportunityLevel =
    (demand >= 50 && pressure >= 25) || (m.activeSalons === 0 && demand >= 20) ? "HIGH" : demand >= 15 && pressure >= 8 ? "MEDIUM" : "LOW";
  return { demand: Math.round(demand), pressure: Math.round(pressure * 10) / 10, level, score: Math.round(100 * (1 - Math.exp(-pressure / 30))) };
}

// ---------- Access control ----------

/** Additional internal responsibilities layered on the existing admin roles (table vi_staff_roles). */
export const VI_STAFF_ROLES = ["MARKETING_HEAD", "SALES_HEAD", "OPERATIONS_HEAD", "SUPPORT"] as const;
export type ViStaffRole = (typeof VI_STAFF_ROLES)[number];

export const VI_CAPABILITIES = [
  "overview",
  "live",
  "history",
  "pii",
  "timeline",
  "geo",
  "search",
  "journey",
  "sources",
  "conversions",
  "campaigns",
  "manageCampaigns",
  "segments",
  "manageSegments",
  "insights",
  "decideInsights",
  "ask",
  "reports",
  "export",
  "assignOpportunity",
  "alerts",
  "manageAlerts",
  "settings",
  "integrations",
  "privacy",
  "staffRoles",
] as const;
export type ViCapability = (typeof VI_CAPABILITIES)[number];

const ALL: readonly ViCapability[] = VI_CAPABILITIES;
const READ_ALL: readonly ViCapability[] = ["overview", "live", "history", "timeline", "geo", "search", "journey", "sources", "conversions", "campaigns", "segments", "insights", "ask", "reports", "alerts"];

/** Capabilities granted per platform role / VI staff role. The backend enforces these on every route. */
export const VI_ROLE_CAPABILITIES: Record<string, readonly ViCapability[]> = {
  [Role.PLATFORM_ADMIN]: ALL,
  // Co-founders see everything (including PII) and run campaigns, but integrations, staff roles and privacy erasure stay super-admin.
  [Role.CO_FOUNDER]: [...READ_ALL, "pii", "manageCampaigns", "manageSegments", "decideInsights", "export", "assignOpportunity", "manageAlerts", "settings"],
  // Read-only analysts: aggregates and pseudonymous activity, never contact details.
  [Role.PLATFORM_VIEWER]: READ_ALL,
  [Role.SALES_ADMIN]: ["overview", "live", "geo", "search", "insights", "ask", "reports", "export", "assignOpportunity", "alerts"],
  MARKETING_HEAD: ["overview", "live", "geo", "search", "journey", "sources", "conversions", "campaigns", "manageCampaigns", "segments", "manageSegments", "insights", "decideInsights", "ask", "reports", "export", "alerts"],
  SALES_HEAD: ["overview", "live", "geo", "search", "insights", "decideInsights", "ask", "reports", "export", "assignOpportunity", "alerts"],
  OPERATIONS_HEAD: ["overview", "live", "journey", "conversions", "search", "geo", "insights", "ask", "reports", "alerts"],
  SUPPORT: ["live", "history", "timeline"],
  // Territory-scoped: only the cities of their employee profile.
  [Role.FIELD_EXECUTIVE]: ["overview", "geo", "search"],
  // Salon-scoped: only their own salons' aggregates.
  [Role.SALON_OWNER]: [],
};

export type ViScope =
  | { kind: "platform" }
  | { kind: "territory"; cities: string[] }
  | { kind: "salon"; salonIds: string[] };

export function viCapabilitiesFor(roles: readonly string[]): Set<ViCapability> {
  const caps = new Set<ViCapability>();
  for (const r of roles) for (const c of VI_ROLE_CAPABILITIES[r] ?? []) caps.add(c);
  return caps;
}

export interface ViMeDto {
  capabilities: ViCapability[];
  scope: ViScope;
  staffRoles: ViStaffRole[];
  activityWindowMinutes: number;
  trackingEnabled: boolean;
  /** Synthetic dev-only demo visitors currently loaded (shown as a warning on every tab). */
  demoVisitors: number;
}

// ---------- Admin input schemas ----------

export const viCampaignInputSchema = z.object({
  name: shortText(120).min(2),
  kind: z.enum(VI_CAMPAIGN_KINDS),
  landingPath: shortText(300).regex(/^\/[^\s]*$/, "Must be a site path starting with /").default("/"),
  utmSource: optShort(120),
  utmMedium: optShort(120),
  utmCampaign: optShort(160),
  utmContent: optShort(160),
  utmTerm: optShort(160),
  salonId: optShort(80),
  employeeProfileId: z.string().uuid().optional().nullable(),
  city: optShort(80),
  budgetInr: z.number().nonnegative().max(1_00_00_00_000).optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  googleAdsCampaignId: optShort(60),
  metaCampaignId: optShort(60),
  notes: optShort(500),
});
export type ViCampaignInput = z.infer<typeof viCampaignInputSchema>;

export const viCampaignExpenseLinkSchema = z.object({ financeExpenseId: z.string().uuid() });

export const viOpportunityAssignSchema = z.object({
  city: shortText(80).min(1),
  state: optShort(80),
  assigneeEmployeeId: z.string().uuid(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("HIGH"),
  dueAt: z.string().datetime().optional().nullable(),
  note: optShort(500),
});
export type ViOpportunityAssignInput = z.infer<typeof viOpportunityAssignSchema>;

export const VI_INSIGHT_STATUSES = ["NEW", "ACCEPTED", "REJECTED", "DISMISSED"] as const;
export const viInsightDecisionSchema = z.object({
  status: z.enum(["ACCEPTED", "REJECTED", "DISMISSED"]),
  note: optShort(300),
});
export const viInsightTaskSchema = z.object({
  assigneeEmployeeId: z.string().uuid(),
  dueAt: z.string().datetime().optional().nullable(),
});

export const viAskSchema = z.object({
  question: shortText(500).min(2),
  period: z.enum(VI_PERIODS).optional(),
});

export const VI_ALERT_KINDS = [
  "TRAFFIC_SPIKE",
  "TRAFFIC_DROP",
  "CONVERSION_DROP",
  "NEW_CITY_DEMAND",
  "ZERO_RESULT_SEARCHES",
  "CAMPAIGN_CAC",
  "PAYMENT_FAILURES",
  "ABANDONMENT_RISE",
  "PRODUCT_NO_INVENTORY",
  "BOT_ACTIVITY",
  "PAGE_ERRORS",
] as const;
export type ViAlertKind = (typeof VI_ALERT_KINDS)[number];
export const VI_ALERT_KIND_LABELS: Record<ViAlertKind, string> = {
  TRAFFIC_SPIKE: "Traffic spike",
  TRAFFIC_DROP: "Traffic drop",
  CONVERSION_DROP: "Conversion drop",
  NEW_CITY_DEMAND: "New city with demand",
  ZERO_RESULT_SEARCHES: "Frequent zero-result searches",
  CAMPAIGN_CAC: "Campaign CAC over threshold",
  PAYMENT_FAILURES: "Payment failures",
  ABANDONMENT_RISE: "Booking abandonment rise",
  PRODUCT_NO_INVENTORY: "Product searches without inventory",
  BOT_ACTIVITY: "Bot activity",
  PAGE_ERRORS: "Repeated page errors",
};

export const viAlertRuleInputSchema = z.object({
  kind: z.enum(VI_ALERT_KINDS),
  name: shortText(120).min(2),
  threshold: z.number().finite(),
  windowMinutes: z.number().int().min(15).max(10_080).default(60),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]).default("WARNING"),
  channels: z.array(z.enum(["IN_APP", "EMAIL", "WHATSAPP"])).min(1).default(["IN_APP"]),
  recipientUserIds: z.array(z.string().uuid()).max(50).default([]),
  cooldownMinutes: z.number().int().min(5).max(10_080).default(240),
  enabled: z.boolean().default(true),
});
export type ViAlertRuleInput = z.infer<typeof viAlertRuleInputSchema>;

export const VI_SEGMENT_KEYS = [
  "new_visitors",
  "returning_visitors",
  "registered_no_booking",
  "abandoned_booking",
  "abandoned_cart",
  "frequent_visitors",
  "high_value",
  "inactive",
  "home_service_interest",
  "marketplace_interest",
] as const;

export const viSegmentInputSchema = z.object({
  name: shortText(120).min(2),
  description: optShort(500),
  rule: z.object({
    base: z.enum(VI_SEGMENT_KEYS),
    city: optShort(80),
    serviceCategory: optShort(60),
    lookbackDays: z.number().int().min(1).max(730).default(30),
  }),
  frequencyCapPerWeek: z.number().int().min(0).max(21).default(2),
});
export type ViSegmentInput = z.infer<typeof viSegmentInputSchema>;

export const VI_REPORT_TYPES = ["activity", "geo", "search", "campaigns", "conversion", "revenue", "segments", "salons", "territories", "insights"] as const;
export type ViReportType = (typeof VI_REPORT_TYPES)[number];
export const VI_REPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ViReportFormat = (typeof VI_REPORT_FORMATS)[number];

export const viReportScheduleInputSchema = z.object({
  reportType: z.enum(VI_REPORT_TYPES),
  format: z.enum(VI_REPORT_FORMATS),
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  recipientUserIds: z.array(z.string().uuid()).min(1).max(20),
  period: z.enum(VI_PERIODS).default("7d"),
});

export const VI_INTEGRATION_PROVIDERS = ["GA4", "SEARCH_CONSOLE", "GOOGLE_ADS", "META"] as const;
export type ViIntegrationProvider = (typeof VI_INTEGRATION_PROVIDERS)[number];

/** Which fields each integration needs. `secret: true` fields are encrypted at rest and never returned. */
export const VI_INTEGRATION_FIELDS: Record<ViIntegrationProvider, ReadonlyArray<{ key: string; label: string; secret: boolean }>> = {
  GA4: [
    { key: "measurementId", label: "Measurement ID (G-…)", secret: false },
    { key: "apiSecret", label: "Measurement Protocol API secret", secret: true },
  ],
  SEARCH_CONSOLE: [
    { key: "siteUrl", label: "Property (e.g. sc-domain:fastque.com)", secret: false },
    { key: "serviceAccountJson", label: "Service account JSON key", secret: true },
  ],
  GOOGLE_ADS: [
    { key: "customerId", label: "Customer ID", secret: false },
    { key: "loginCustomerId", label: "Manager (login) customer ID", secret: false },
    { key: "developerToken", label: "Developer token", secret: true },
    { key: "oauthClientId", label: "OAuth client ID", secret: false },
    { key: "oauthClientSecret", label: "OAuth client secret", secret: true },
    { key: "refreshToken", label: "OAuth refresh token", secret: true },
  ],
  META: [
    { key: "pixelId", label: "Pixel ID", secret: false },
    { key: "accessToken", label: "Conversions API access token", secret: true },
    { key: "adAccountId", label: "Ad account ID (act_…)", secret: false },
    { key: "testEventCode", label: "Test event code (optional)", secret: false },
  ],
};

export const viIntegrationUpdateSchema = z.object({
  enabled: z.boolean(),
  values: z.record(z.string().max(20_000)).default({}),
});

export const viTrackingSettingsSchema = z.object({
  trackingEnabled: z.boolean(),
  samplingRate: z.number().min(0.01).max(1),
  activityWindowMinutes: z.number().int().min(1).max(120),
  rawEventRetentionDays: z.number().int().min(7).max(1095),
  sessionRetentionDays: z.number().int().min(30).max(1095),
  aggregateRetentionDays: z.number().int().min(90).max(3650),
  storeLocality: z.boolean(),
  aiProvider: z.enum(["none", "gemini", "ollama"]),
  aiSummariesEnabled: z.boolean(),
});
export type ViTrackingSettings = z.infer<typeof viTrackingSettingsSchema>;

export const VI_DEFAULT_SETTINGS: ViTrackingSettings = {
  trackingEnabled: true,
  samplingRate: 1,
  activityWindowMinutes: 5,
  rawEventRetentionDays: 180,
  sessionRetentionDays: 395,
  aggregateRetentionDays: 1825,
  storeLocality: false,
  aiProvider: "none",
  aiSummariesEnabled: false,
};

export const viPrivacyRequestSchema = z.object({
  type: z.enum(["ACCESS", "DELETE"]),
  visitorId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  note: optShort(300),
}).refine((v) => v.visitorId || v.userId, { message: "visitorId or userId is required" });

export const viStaffRoleInputSchema = z.object({ userId: z.string().uuid(), role: z.enum(VI_STAFF_ROLES) });

// ---------- Response DTOs ----------

export interface ViKpi {
  current: number | null;
  previous: number | null;
  /** Percent change vs the previous period; null when the previous value is 0 or unknown. */
  changePct: number | null;
}

export function viKpi(current: number | null, previous: number | null): ViKpi {
  const changePct = current == null || previous == null || previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;
  return { current, previous, changePct };
}

export interface ViSeriesPoint {
  date: string;
  visitors: number;
  sessions: number;
  pageViews: number;
  searches: number;
  bookings: number;
  purchases: number;
  revenuePaise: number;
}

export interface ViBreakdownRow {
  key: string;
  label: string;
  visitors: number;
  sessions: number;
  bookings: number;
  revenuePaise: number;
  conversionPct: number | null;
}

export interface ViOverviewDto {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  generatedAt: string;
  scope: ViScope["kind"];
  kpis: {
    uniqueVisitors: ViKpi;
    visits: ViKpi;
    activeNow: number;
    newVisitors: ViKpi;
    returningVisitors: ViKpi;
    anonymousVisitors: ViKpi;
    registeredVisitors: ViKpi;
    pageViews: ViKpi;
    avgEngagementSeconds: ViKpi;
    engagementRatePct: ViKpi;
    serviceSearches: ViKpi;
    salonProfileViews: ViKpi;
    productViews: ViKpi;
    registrations: ViKpi;
    bookings: ViKpi;
    purchases: ViKpi;
    visitorToBookingPct: ViKpi;
    visitorToPurchasePct: ViKpi;
    revenuePaise: ViKpi;
    revenuePerVisitorPaise: ViKpi;
  };
  series: ViSeriesPoint[];
  byChannel: ViBreakdownRow[];
  byDevice: ViBreakdownRow[];
  byCity: ViBreakdownRow[];
  funnel: ViFunnelStage[];
  dataNote: string | null;
}

export interface ViFunnelStage {
  key: string;
  label: string;
  sessions: number;
  conversionFromPrevPct: number | null;
  dropOffPct: number | null;
  medianSecondsFromPrev: number | null;
}

export interface ViLiveSessionDto {
  sessionId: string;
  visitorLabel: string;
  registered: boolean;
  identity: { name: string | null; userId: string } | null;
  country: string | null;
  state: string | null;
  city: string | null;
  locality: string | null;
  geoSource: ViGeoSource;
  geoConfidence: "low" | "medium" | "high";
  currentPath: string | null;
  previousPath: string | null;
  entryPath: string | null;
  searches: string[];
  salonsViewed: number;
  productsViewed: number;
  bookingStatus: "none" | "started" | "confirmed" | "failed";
  purchaseStatus: "none" | "cart" | "checkout" | "purchased";
  startedAt: string;
  lastActivityAt: string;
  durationSeconds: number;
  device: string;
  browser: string | null;
  os: string | null;
  channel: ViChannel;
  campaign: string | null;
  active: boolean;
}

export interface ViLiveDto {
  generatedAt: string;
  activityWindowMinutes: number;
  activeCount: number;
  inactiveCount: number;
  byCity: Array<{ city: string; count: number }>;
  byPath: Array<{ path: string; count: number }>;
  sessions: ViLiveSessionDto[];
}

export interface ViPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function viVisitorLabel(guestNumber: number): string {
  return `Guest #${guestNumber}`;
}
