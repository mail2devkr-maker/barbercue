import { z } from "zod";
import { straightLineKm } from "./customer-dashboard";
import { upiVpaSchema } from "./upi";

// FastQue Home - home beauty services. Shared contract: API paths, states, validation and the pure
// rules (price, ETA window, state machine, request understanding). The server decides everything;
// the client only uses these to display and to validate early.

export const HOME_TAGLINE = "Your Favourite Salon, At Your Doorstep";
export const HOME_PATHS = {
  root: "home",
  /** Owner: dashboard/salons/:salonId/home/... */
  owner: "home",
  /** Admin: admin/home/... */
  admin: "admin/home",
  /** Header carrying a guest's booking access token. */
  guestHeader: "X-Home-Access",
} as const;

export const HOME_TIME_ZONE = "Asia/Kolkata";
export const HOME_TERMS_VERSION = "2026-11";

// ---------- Feature flags ----------
export const HOME_FLAG_NAMES = [
  "FASTQUE_HOME_ENABLED",
  "SALON_HOME_SERVICES_ENABLED",
  "FREELANCER_HOME_SERVICES_ENABLED",
  "HOME_INSTANT_BOOKING_ENABLED",
  "HOME_SCHEDULED_BOOKING_ENABLED",
  "HOME_LIVE_TRACKING_ENABLED",
  "HOME_AI_DISPATCH_ENABLED",
  "HOME_MEMBERSHIPS_ENABLED",
  "HOME_MONETIZATION_ENABLED",
] as const;
export type HomeFlagName = (typeof HOME_FLAG_NAMES)[number];
export type HomeFlags = Record<HomeFlagName, boolean>;

// ---------- Labels ----------
export type HomeProviderKind = "SALON_MANAGED" | "INDEPENDENT_PROFESSIONAL";
export function homeProviderLabel(kind: HomeProviderKind, salonName?: string | null): string {
  return kind === "SALON_MANAGED" ? `Salon Professional – Associated with ${salonName ?? "salon"}` : "Independent FastQue Professional";
}

export const HomeErrorCode = {
  DISABLED: "HOME_DISABLED",
  NOT_FOUND: "HOME_NOT_FOUND",
  FORBIDDEN: "HOME_FORBIDDEN",
  INVALID_STATE: "HOME_INVALID_STATE",
  VALIDATION: "HOME_VALIDATION_FAILED",
  NOT_SERVICEABLE: "HOME_NOT_SERVICEABLE",
  UNAVAILABLE: "HOME_SLOT_UNAVAILABLE",
  CAPACITY: "HOME_SALON_CAPACITY",
  HOLD_EXPIRED: "HOME_HOLD_EXPIRED",
  INVITATION_CLOSED: "HOME_INVITATION_CLOSED",
  CODE_INVALID: "HOME_CODE_INVALID",
  CODE_EXPIRED: "HOME_CODE_EXPIRED",
  RATE_LIMITED: "HOME_RATE_LIMITED",
  PRICE_CHANGED: "HOME_PRICE_CHANGED",
  GUEST_VERIFICATION_REQUIRED: "HOME_GUEST_VERIFICATION_REQUIRED",
} as const;
export type HomeErrorCode = (typeof HomeErrorCode)[keyof typeof HomeErrorCode];

// ---------- Booking state machine ----------
export const HOME_BOOKING_STATUSES = [
  "DRAFT", "REQUESTED", "AWAITING_ASSIGNMENT", "INVITED", "ACCEPTED", "CONFIRMED", "PREPARING", "ON_THE_WAY", "ARRIVED",
  "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "PAYMENT_PENDING", "PAYMENT_CONFIRMED", "CLOSED", "NO_PROFESSIONAL", "EXPIRED",
  "RESCHEDULE_REQUESTED", "REPLACEMENT_REQUESTED", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_PROFESSIONAL",
  "CANCELLED_BY_SALON", "CANCELLED_BY_PLATFORM", "CUSTOMER_NO_SHOW", "PROFESSIONAL_NO_SHOW", "ADDRESS_ISSUE", "INTERRUPTED",
] as const;
export type HomeBookingStatus = (typeof HOME_BOOKING_STATUSES)[number];
export type HomeParty = "CUSTOMER" | "PROFESSIONAL" | "PROVIDER" | "ADMIN" | "SYSTEM";

type Rule = Partial<Record<HomeBookingStatus, readonly HomeParty[]>>;
const CUST: readonly HomeParty[] = ["CUSTOMER", "ADMIN"];
const PRO: readonly HomeParty[] = ["PROFESSIONAL", "ADMIN"];
const SYS: readonly HomeParty[] = ["SYSTEM"];
const CANCELS: Rule = {
  CANCELLED_BY_CUSTOMER: CUST,
  CANCELLED_BY_SALON: ["PROVIDER"],
  CANCELLED_BY_PLATFORM: ["ADMIN"],
};
const PRE_VISIT: Rule = {
  ...CANCELS,
  CANCELLED_BY_PROFESSIONAL: ["PROFESSIONAL"],
  RESCHEDULE_REQUESTED: ["CUSTOMER", "PROVIDER", "ADMIN"],
  REPLACEMENT_REQUESTED: ["PROFESSIONAL", "PROVIDER", "ADMIN", "SYSTEM"],
  PROFESSIONAL_NO_SHOW: ["CUSTOMER", "ADMIN", "SYSTEM"],
};

/** Every allowed status change and who may make it. Anything not listed is rejected by the server. */
export const HOME_TRANSITIONS: Record<HomeBookingStatus, Rule> = {
  DRAFT: { REQUESTED: ["CUSTOMER", "SYSTEM"], EXPIRED: SYS, CANCELLED_BY_CUSTOMER: CUST },
  REQUESTED: { ...CANCELS, AWAITING_ASSIGNMENT: SYS, INVITED: ["SYSTEM", "ADMIN", "PROVIDER"], ACCEPTED: ["PROVIDER", "ADMIN", "PROFESSIONAL"], NO_PROFESSIONAL: SYS, EXPIRED: SYS },
  AWAITING_ASSIGNMENT: { ...CANCELS, INVITED: ["SYSTEM", "ADMIN", "PROVIDER"], ACCEPTED: ["PROVIDER", "ADMIN", "PROFESSIONAL"], NO_PROFESSIONAL: SYS, EXPIRED: SYS },
  INVITED: { ...CANCELS, ACCEPTED: ["PROFESSIONAL", "PROVIDER", "ADMIN"], INVITED: SYS, AWAITING_ASSIGNMENT: SYS, NO_PROFESSIONAL: SYS, EXPIRED: SYS },
  ACCEPTED: { CONFIRMED: SYS, ...CANCELS },
  CONFIRMED: { ...PRE_VISIT, PREPARING: PRO, ON_THE_WAY: PRO },
  PREPARING: { ...PRE_VISIT, ON_THE_WAY: PRO },
  ON_THE_WAY: { ...PRE_VISIT, ARRIVED: PRO, ADDRESS_ISSUE: PRO },
  ARRIVED: { ...CANCELS, CHECKED_IN: PRO, ADDRESS_ISSUE: PRO, CUSTOMER_NO_SHOW: PRO, INTERRUPTED: ["PROFESSIONAL", "CUSTOMER", "ADMIN"] },
  CHECKED_IN: { IN_PROGRESS: PRO, INTERRUPTED: ["PROFESSIONAL", "CUSTOMER", "ADMIN"] },
  IN_PROGRESS: { COMPLETED: PRO, INTERRUPTED: ["PROFESSIONAL", "CUSTOMER", "ADMIN"] },
  COMPLETED: { PAYMENT_PENDING: SYS },
  PAYMENT_PENDING: { PAYMENT_CONFIRMED: ["PROFESSIONAL", "PROVIDER", "ADMIN"] },
  PAYMENT_CONFIRMED: { CLOSED: ["CUSTOMER", "SYSTEM", "ADMIN"], PAYMENT_PENDING: ["ADMIN", "PROVIDER"] },
  CLOSED: {},
  NO_PROFESSIONAL: { INVITED: ["SYSTEM", "ADMIN"], ACCEPTED: ["ADMIN"], EXPIRED: SYS, RESCHEDULE_REQUESTED: ["CUSTOMER"], CONFIRMED: SYS, ...CANCELS },
  EXPIRED: {},
  RESCHEDULE_REQUESTED: { CONFIRMED: ["SYSTEM", "PROFESSIONAL", "PROVIDER", "CUSTOMER", "ADMIN"], ...CANCELS, CANCELLED_BY_PROFESSIONAL: ["PROFESSIONAL"] },
  REPLACEMENT_REQUESTED: { CONFIRMED: ["CUSTOMER", "SYSTEM"], INVITED: ["SYSTEM", "ADMIN", "PROVIDER"], ACCEPTED: ["ADMIN", "PROVIDER", "PROFESSIONAL"], NO_PROFESSIONAL: SYS, ...CANCELS },
  ADDRESS_ISSUE: { ON_THE_WAY: PRO, ARRIVED: PRO, CUSTOMER_NO_SHOW: PRO, ...CANCELS },
  INTERRUPTED: { IN_PROGRESS: PRO, COMPLETED: ["ADMIN"], CANCELLED_BY_PLATFORM: ["ADMIN"], CANCELLED_BY_CUSTOMER: CUST },
  CANCELLED_BY_CUSTOMER: {},
  CANCELLED_BY_PROFESSIONAL: {},
  CANCELLED_BY_SALON: {},
  CANCELLED_BY_PLATFORM: {},
  CUSTOMER_NO_SHOW: {},
  PROFESSIONAL_NO_SHOW: {},
};

export function homeTransitionAllowed(from: HomeBookingStatus, to: HomeBookingStatus, party: HomeParty): boolean {
  return !!HOME_TRANSITIONS[from][to]?.includes(party);
}

export const HOME_TERMINAL: readonly HomeBookingStatus[] = [
  "CLOSED", "EXPIRED", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_PROFESSIONAL", "CANCELLED_BY_SALON", "CANCELLED_BY_PLATFORM",
  "CUSTOMER_NO_SHOW", "PROFESSIONAL_NO_SHOW",
];
/** Statuses in which the assigned professional may see the address and the customer may see the professional. */
export const HOME_ASSIGNED_ACTIVE: readonly HomeBookingStatus[] = [
  "CONFIRMED", "PREPARING", "ON_THE_WAY", "ARRIVED", "CHECKED_IN", "IN_PROGRESS", "RESCHEDULE_REQUESTED", "ADDRESS_ISSUE", "INTERRUPTED",
];
/** Statuses in which a live location may be shared and viewed. */
export const HOME_TRACKABLE: readonly HomeBookingStatus[] = ["ON_THE_WAY", "ADDRESS_ISSUE"];
export const HOME_SERVED: readonly HomeBookingStatus[] = ["COMPLETED", "PAYMENT_PENDING", "PAYMENT_CONFIRMED", "CLOSED"];
export const HOME_SEARCHING: readonly HomeBookingStatus[] = ["REQUESTED", "AWAITING_ASSIGNMENT", "INVITED"];

export const HOME_STATUS_LABEL: Record<HomeBookingStatus, { en: string; hi: string }> = {
  DRAFT: { en: "Verify your phone to send the request", hi: "अनुरोध भेजने के लिए फ़ोन सत्यापित करें" },
  REQUESTED: { en: "Booking requested", hi: "बुकिंग का अनुरोध भेजा गया" },
  AWAITING_ASSIGNMENT: { en: "Waiting for the salon to assign a professional", hi: "सैलून द्वारा प्रोफेशनल चुने जाने की प्रतीक्षा" },
  INVITED: { en: "Waiting for a professional to accept (not confirmed yet)", hi: "प्रोफेशनल की स्वीकृति की प्रतीक्षा (अभी पक्का नहीं)" },
  ACCEPTED: { en: "Professional accepted", hi: "प्रोफेशनल ने स्वीकार किया" },
  CONFIRMED: { en: "Confirmed", hi: "बुकिंग पक्की" },
  PREPARING: { en: "Professional is getting ready", hi: "प्रोफेशनल तैयारी कर रहे हैं" },
  ON_THE_WAY: { en: "On the way", hi: "रास्ते में हैं" },
  ARRIVED: { en: "Arrived", hi: "पहुँच गए" },
  CHECKED_IN: { en: "Start code verified", hi: "स्टार्ट कोड सत्यापित" },
  IN_PROGRESS: { en: "Service in progress", hi: "सेवा चल रही है" },
  COMPLETED: { en: "Service completed", hi: "सेवा पूरी हुई" },
  PAYMENT_PENDING: { en: "Service completed – payment pending", hi: "सेवा पूरी – भुगतान बाकी" },
  PAYMENT_CONFIRMED: { en: "Payment recorded by the provider", hi: "प्रदाता ने भुगतान दर्ज किया" },
  CLOSED: { en: "Closed", hi: "समाप्त" },
  NO_PROFESSIONAL: { en: "No professional available", hi: "कोई प्रोफेशनल उपलब्ध नहीं" },
  EXPIRED: { en: "Expired", hi: "समय समाप्त" },
  RESCHEDULE_REQUESTED: { en: "Reschedule requested", hi: "समय बदलने का अनुरोध" },
  REPLACEMENT_REQUESTED: { en: "Replacement needs your approval", hi: "दूसरे प्रोफेशनल के लिए आपकी स्वीकृति चाहिए" },
  CANCELLED_BY_CUSTOMER: { en: "Cancelled by you", hi: "आपने रद्द किया" },
  CANCELLED_BY_PROFESSIONAL: { en: "Cancelled by the professional", hi: "प्रोफेशनल ने रद्द किया" },
  CANCELLED_BY_SALON: { en: "Cancelled by the salon", hi: "सैलून ने रद्द किया" },
  CANCELLED_BY_PLATFORM: { en: "Cancelled by FastQue", hi: "FastQue ने रद्द किया" },
  CUSTOMER_NO_SHOW: { en: "Customer was not available", hi: "ग्राहक उपलब्ध नहीं थे" },
  PROFESSIONAL_NO_SHOW: { en: "Professional did not arrive", hi: "प्रोफेशनल नहीं पहुँचे" },
  ADDRESS_ISSUE: { en: "Problem finding the address", hi: "पता मिलने में समस्या" },
  INTERRUPTED: { en: "Service interrupted", hi: "सेवा रोकी गई" },
};

// ---------- Pricing (paise) ----------
export interface HomePriceItemInput {
  name: string;
  servicePaise: number;
  productPaise: number;
  disposablePaise: number;
  equipmentPaise: number;
  quantity: number;
}
export interface HomePriceInput {
  items: HomePriceItemInput[];
  travelPaise: number;
  areaSurchargePaise: number;
  upliftPct: number;
  weekend: boolean;
  weekendPct: number;
  peak: boolean;
  peakPct: number;
  groupDiscountPct: number;
  groupDiscountMin: number;
  promo?: { code: string; percentOff: number | null; amountOffPaise: number | null } | null;
  campaignDiscountPct?: number;
  packageDiscountPaise?: number;
}
export interface HomePriceLine {
  code: string;
  label: string;
  paise: number;
}
export interface HomePrice {
  lines: HomePriceLine[];
  servicePaise: number;
  productPaise: number;
  travelPaise: number;
  discountPaise: number;
  totalPaise: number;
}

const pct = (paise: number, percent: number) => Math.round((paise * percent) / 100);

/** The one place a home price is computed. Every mandatory charge is its own visible line. */
export function computeHomePrice(input: HomePriceInput): HomePrice {
  const lines: HomePriceLine[] = [];
  let service = 0;
  let product = 0;
  let persons = 0;
  for (const item of input.items) {
    const unit = item.servicePaise + pct(item.servicePaise, input.upliftPct);
    const line = unit * item.quantity;
    service += line;
    persons += item.quantity;
    lines.push({ code: "SERVICE", label: item.quantity > 1 ? `${item.name} × ${item.quantity}` : item.name, paise: line });
    const prod = item.productPaise * item.quantity;
    const disp = item.disposablePaise * item.quantity;
    const equip = item.equipmentPaise * item.quantity;
    if (prod) lines.push({ code: "PRODUCT", label: `Products – ${item.name}`, paise: prod });
    if (disp) lines.push({ code: "DISPOSABLE", label: `Disposable materials – ${item.name}`, paise: disp });
    if (equip) lines.push({ code: "EQUIPMENT", label: `Equipment – ${item.name}`, paise: equip });
    product += prod + disp + equip;
  }
  const surcharges: HomePriceLine[] = [];
  if (input.weekend && input.weekendPct > 0) surcharges.push({ code: "WEEKEND", label: "Weekend charge", paise: pct(service, input.weekendPct) });
  if (input.peak && input.peakPct > 0) surcharges.push({ code: "PEAK", label: "Peak-time charge", paise: pct(service, input.peakPct) });
  const extra = surcharges.reduce((s, l) => s + l.paise, 0);
  lines.push(...surcharges);
  const travel = input.travelPaise + input.areaSurchargePaise;
  if (travel > 0) lines.push({ code: "TRAVEL", label: "Travel charge", paise: travel });
  const gross = service + extra;
  let discount = 0;
  const addDiscount = (code: string, label: string, amount: number) => {
    const value = Math.min(Math.max(0, amount), gross - discount);
    if (value <= 0) return;
    discount += value;
    lines.push({ code, label, paise: -value });
  };
  if (input.packageDiscountPaise) addDiscount("PACKAGE", "Package saving", input.packageDiscountPaise);
  if (input.campaignDiscountPct) addDiscount("CAMPAIGN", "Society group discount", pct(gross, input.campaignDiscountPct));
  else if (input.groupDiscountPct > 0 && persons >= input.groupDiscountMin) addDiscount("GROUP", "Group discount", pct(gross, input.groupDiscountPct));
  if (input.promo) addDiscount("PROMO", `Offer ${input.promo.code}`, input.promo.percentOff ? pct(gross, input.promo.percentOff) : (input.promo.amountOffPaise ?? 0));
  const total = gross + product + travel - discount;
  return { lines, servicePaise: gross, productPaise: product, travelPaise: travel, discountPaise: discount, totalPaise: total };
}

// ---------- ETA ----------
export type HomeEtaConfidence = "HIGH" | "MEDIUM" | "LOW";
export interface HomeEtaInput {
  now: Date;
  availableFrom: Date;
  prepMinutes: number;
  travelMinutes: number;
  /** ROAD = a routing provider answered; ESTIMATE = conservative fallback; UNKNOWN = not even coordinates. */
  travelSource: "ROAD" | "ROAD_TRAFFIC" | "ESTIMATE" | "UNKNOWN";
  accessBufferMinutes: number;
  serviceMinutes: number;
  cleanupMinutes: number;
  /** True when prep/travel are already inside an existing commitment and must not be added again. */
  alreadyPreparing?: boolean;
  historySamples?: number;
  locationAgeMinutes?: number | null;
}
export interface HomeEta {
  departure: Date;
  arrival: Date;
  windowFrom: Date;
  windowTo: Date;
  completion: Date;
  confidence: HomeEtaConfidence;
  approximate: boolean;
}

const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const ceil5 = (n: number) => Math.ceil(n / 5) * 5;

/** Arrival = max(now, available) + prep + travel + access buffer, shown as a window (never an exact promise). */
export function computeHomeEta(i: HomeEtaInput): HomeEta {
  const base = i.availableFrom > i.now ? i.availableFrom : i.now;
  const departure = addMin(base, i.alreadyPreparing ? 0 : i.prepMinutes);
  const arrival = addMin(departure, i.travelMinutes + i.accessBufferMinutes);
  const stale = i.locationAgeMinutes != null && i.locationAgeMinutes > 5;
  let confidence: HomeEtaConfidence = "LOW";
  if ((i.travelSource === "ROAD" || i.travelSource === "ROAD_TRAFFIC") && !stale) confidence = (i.historySamples ?? 0) >= 10 ? "HIGH" : "MEDIUM";
  const spread = confidence === "HIGH" ? 5 : confidence === "MEDIUM" ? 10 : 15;
  const lead = Math.max(0, (arrival.getTime() - i.now.getTime()) / 60_000);
  const fromMin = Math.max(0, Math.floor(lead / 5) * 5);
  const toMin = Math.max(fromMin + 5, ceil5(lead + spread));
  return {
    departure,
    arrival,
    windowFrom: addMin(i.now, fromMin),
    windowTo: addMin(i.now, toMin),
    completion: addMin(arrival, i.serviceMinutes + i.cleanupMinutes),
    confidence,
    approximate: i.travelSource === "ESTIMATE" || i.travelSource === "UNKNOWN",
  };
}

export const HOME_TRAVEL_MODES = ["WALK", "BICYCLE", "TWO_WHEELER", "CAR", "PUBLIC_TRANSPORT"] as const;
export type HomeTravelMode = (typeof HOME_TRAVEL_MODES)[number];
const CONSERVATIVE_KMH: Record<HomeTravelMode, number> = { WALK: 4, BICYCLE: 10, TWO_WHEELER: 18, CAR: 15, PUBLIC_TRANSPORT: 11 };

/** Conservative travel minutes without a routing provider. Deliberately pessimistic. */
export function conservativeTravelMinutes(
  from: { lat: number | null; lng: number | null; postalCode?: string | null },
  to: { lat: number | null; lng: number | null; postalCode?: string | null },
  mode: HomeTravelMode,
): { minutes: number; source: "ESTIMATE" | "UNKNOWN" } {
  if (from.lat != null && from.lng != null && to.lat != null && to.lng != null) {
    const km = straightLineKm({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }) * 1.5; // circuity allowance
    const fixed = mode === "PUBLIC_TRANSPORT" ? 15 : 5;
    return { minutes: Math.max(5, Math.ceil((km / CONSERVATIVE_KMH[mode]) * 60) + fixed), source: "ESTIMATE" };
  }
  return { minutes: from.postalCode && from.postalCode === to.postalCode ? 30 : 60, source: "UNKNOWN" };
}

// ---------- Validation ----------
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const paise = z.number().int().min(0).max(10_000_000);
const text = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => z.string().trim().max(max).optional();
export const homePincode = z.string().regex(/^[1-9]\d{5}$/, "Enter a 6-digit PIN code");
export const homePhone = z.string().trim().regex(/^\+91[6-9]\d{9}$/, "Enter a valid Indian mobile number, for example +919812345678");
const lat = z.number().min(-90).max(90).nullish();
const lng = z.number().min(-180).max(180).nullish();
const urlOrPath = z.string().trim().max(500).regex(/^(https:\/\/|\/)/);

export const homeAddressSchema = z
  .object({
    label: z.enum(["HOME", "WORK", "OTHER"]).default("HOME"),
    house: text(120),
    building: opt(160),
    street: opt(200),
    locality: text(120),
    landmark: opt(160),
    city: text(80),
    state: text(80),
    postalCode: homePincode,
    lat,
    lng,
    accessNotes: opt(300),
    contactName: opt(120),
    contactPhone: homePhone.optional(),
  })
  .strict();
export type HomeAddressInput = z.infer<typeof homeAddressSchema>;

export const homeAreaSchema = z
  .object({
    kind: z.enum(["RADIUS", "PINCODE", "LOCALITY", "CITY", "SOCIETY"]),
    value: text(120),
    radiusKm: z.number().min(0.5).max(50).nullish(),
    excluded: z.boolean().default(false),
    surchargePaise: paise.default(0),
    minOrderPaise: paise.default(0),
  })
  .strict()
  .refine((a) => a.kind !== "RADIUS" || (!!a.radiusKm && !a.excluded), "A radius area needs a distance in km");
export type HomeAreaInput = z.infer<typeof homeAreaSchema>;
export const homeAreasSchema = z.object({ areas: z.array(homeAreaSchema).max(200) }).strict();

export const homeVariantSchema = z.object({ code: z.string().regex(/^[a-z0-9-]{1,40}$/), name: text(80), pricePaise: paise, durationMinutes: z.number().int().min(5).max(600) }).strict();
export const homeOfferingSchema = z
  .object({
    serviceCode: text(60),
    salonServiceId: z.string().max(60).nullish(),
    title: opt(120),
    pricePaise: paise.refine((v) => v > 0, "Price is required"),
    productPaise: paise.default(0),
    disposablePaise: paise.default(0),
    equipmentPaise: paise.default(0),
    durationMinutes: z.number().int().min(5).max(600),
    variants: z.array(homeVariantSchema).max(8).default([]),
    active: z.boolean().default(true),
    products: z.array(z.object({ productId: z.string().max(60), quantity: z.number().positive().max(1000) }).strict()).max(10).default([]),
  })
  .strict();
export type HomeOfferingInput = z.infer<typeof homeOfferingSchema>;

export const homeProviderSettingsSchema = z
  .object({
    displayName: text(120).optional(),
    bio: opt(1000),
    category: opt(60),
    city: text(80).optional(),
    locality: opt(120),
    baseLat: lat,
    baseLng: lng,
    languages: z.array(text(40)).max(12).optional(),
    equipment: z.array(text(60)).max(30).optional(),
    productsCarried: z.array(text(80)).max(40).optional(),
    travelMode: z.enum(HOME_TRAVEL_MODES).optional(),
    maxTravelMinutes: z.number().int().min(10).max(180).optional(),
    instantEnabled: z.boolean().optional(),
    scheduledEnabled: z.boolean().optional(),
    paused: z.boolean().optional(),
    autoDispatch: z.boolean().optional(),
    minOrderPaise: paise.optional(),
    travelFeePaise: paise.optional(),
    weekendSurchargePct: z.number().int().min(0).max(50).optional(),
    peakSurchargePct: z.number().int().min(0).max(50).optional(),
    peakStart: hhmm.nullish(),
    peakEnd: hhmm.nullish(),
    groupDiscountPct: z.number().int().min(0).max(50).optional(),
    groupDiscountMin: z.number().int().min(2).max(20).optional(),
    upiVpa: upiVpaSchema.nullish(),
    invoiceIssuer: opt(160),
    minStaffInSalon: z.number().int().min(0).max(50).optional(),
    maxHomeStaff: z.number().int().min(0).max(50).optional(),
    queueWaitingLimit: z.number().int().min(0).max(50).optional(),
    manualApproval: z.boolean().optional(),
    blockWeekends: z.boolean().optional(),
    blockedStart: hhmm.nullish(),
    blockedEnd: hhmm.nullish(),
    emergencyName: opt(120),
    emergencyPhone: homePhone.optional(),
    compensation: z
      .object({
        model: z.enum(["FIXED_SALARY", "FIXED_PER_VISIT", "PERCENT"]),
        fixedPaise: paise.default(0),
        percent: z.number().min(0).max(100).default(0),
        travelAllowancePaise: paise.default(0),
        overtimePerHourPaise: paise.default(0),
        incentivePaise: paise.default(0),
      })
      .strict()
      .optional(),
  })
  .strict();
export type HomeProviderSettingsInput = z.infer<typeof homeProviderSettingsSchema>;

export const homeProviderTermsSchema = z.object({ acceptTerms: z.literal(true), publicProfileConsent: z.literal(true), adult: z.boolean().optional() }).strict();

export const homeFreelancerRegisterSchema = homeProviderSettingsSchema
  .extend({
    displayName: text(120),
    city: text(80),
    category: text(60),
    yearsExperience: z.number().int().min(0).max(60).optional(),
    skills: z.array(text(60)).max(30).default([]),
    adult: z.literal(true, { errorMap: () => ({ message: "Independent professionals must be 18 or older" }) }),
    channelConsent: z.literal(true, { errorMap: () => ({ message: "Your consent to join FastQue Home is required" }) }),
  })
  .strict();
export type HomeFreelancerRegisterInput = z.infer<typeof homeFreelancerRegisterSchema>;

export const homeProfessionalSchema = z
  .object({
    displayName: text(120).optional(),
    bio: opt(1000),
    photoUrl: urlOrPath.nullish(),
    yearsExperience: z.number().int().min(0).max(60).nullish(),
    skills: z.array(text(60)).max(30).optional(),
    languages: z.array(text(40)).max(12).optional(),
    portfolioUrls: z.array(urlOrPath).max(20).optional(),
    maxPerDay: z.number().int().min(1).max(20).optional(),
    priceUpliftPct: z.number().int().min(0).max(100).optional(),
    trustedContact: homePhone.nullish(),
    dedicated: z.boolean().optional(),
    active: z.boolean().optional(),
    serviceCodes: z.array(text(60)).max(60).optional(),
    schedule: z
      .array(z.object({ dayOfWeek: z.number().int().min(0).max(6), startTime: hhmm, endTime: hhmm }).strict().refine((s) => s.startTime < s.endTime, "Start must be before end"))
      .max(7)
      .optional(),
  })
  .strict();
export type HomeProfessionalInput = z.infer<typeof homeProfessionalSchema>;

export const homeTimeOffSchema = z
  .object({ kind: z.enum(["BREAK", "TIME_OFF"]), startAt: z.string().datetime(), endAt: z.string().datetime(), note: opt(200) })
  .strict();

const itemSchema = z
  .object({
    offeringId: z.string().uuid().optional(),
    serviceCode: z.string().max(60).optional(),
    variantCode: z.string().max(40).optional(),
    quantity: z.number().int().min(1).max(10).default(1),
    personName: opt(80),
  })
  .strict()
  .refine((i) => i.offeringId || i.serviceCode, "Choose a service");

export const homeSearchSchema = z
  .object({
    pincode: homePincode.optional(),
    locality: z.string().trim().max(120).optional(),
    city: z.string().trim().max(80).optional(),
    society: z.string().trim().max(120).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    service: z.string().max(60).optional(),
    q: z.string().trim().max(80).optional(),
    group: z.string().max(30).optional(),
    kind: z.enum(["SALON_MANAGED", "INDEPENDENT_PROFESSIONAL"]).optional(),
    maxPricePaise: z.coerce.number().int().min(0).optional(),
    language: z.string().max(40).optional(),
    when: z.string().datetime().optional(),
    instant: z.coerce.boolean().optional(),
    sort: z.enum(["RECOMMENDED", "FASTEST", "PRICE", "RATING"]).default("RECOMMENDED"),
    page: z.coerce.number().int().min(1).max(200).default(1),
  })
  .strict();
export type HomeSearchQuery = z.infer<typeof homeSearchSchema>;

export const homeQuoteSchema = z
  .object({
    addressId: z.string().uuid().optional(),
    address: homeAddressSchema.optional(),
    items: z.array(itemSchema).min(1).max(12),
    mode: z.enum(["INSTANT", "SCHEDULED"]),
    preference: z.enum(["SPECIFIC_PROFESSIONAL", "SPECIFIC_PROVIDER", "FASTEST"]),
    professionalId: z.string().uuid().optional(),
    providerId: z.string().uuid().optional(),
    startAt: z.string().datetime().optional(),
    promoCode: z.string().trim().toUpperCase().max(30).optional(),
    packageId: z.string().uuid().optional(),
  })
  .strict()
  .refine((q) => q.addressId || q.address, "Choose an address")
  .refine((q) => q.mode === "INSTANT" || q.startAt, "Choose a date and time")
  .refine((q) => q.preference !== "SPECIFIC_PROFESSIONAL" || q.professionalId, "Choose a professional")
  .refine((q) => q.preference !== "SPECIFIC_PROVIDER" || q.providerId, "Choose a salon or professional");
export type HomeQuoteInput = z.infer<typeof homeQuoteSchema>;

export const homeBookingSchema = z
  .object({
    quote: homeQuoteSchema,
    /** The total the customer saw; a different server total is refused instead of silently charged. */
    expectedTotalPaise: paise,
    holdId: z.string().uuid().optional(),
    paymentMethod: z.enum(["CASH", "DIRECT_UPI", "OTHER_OFFLINE"]),
    allowAlternatives: z.boolean().default(false),
    notes: opt(500),
    productPreference: z.enum(["PROFESSIONAL", "CUSTOMER"]).default("PROFESSIONAL"),
    forChild: z.boolean().default(false),
    guardianConfirmed: z.boolean().default(false),
    acceptPolicies: z.literal(true),
    groupKey: z.string().uuid().optional(),
    guest: z.object({ name: text(120), phone: homePhone }).strict().optional(),
  })
  .strict()
  .refine((b) => !b.forChild || b.guardianConfirmed, "A parent or guardian must confirm they will be present");
export type HomeBookingInput = z.infer<typeof homeBookingSchema>;

export const homeHoldSchema = z.object({ quote: homeQuoteSchema }).strict();
export const homeReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export const homeRescheduleSchema = z.object({ startAt: z.string().datetime(), reason: opt(300) }).strict();
export const homeReviewSchema = z
  .object({
    overall: z.number().int().min(1).max(5),
    quality: z.number().int().min(1).max(5),
    behaviour: z.number().int().min(1).max(5),
    punctuality: z.number().int().min(1).max(5),
    hygiene: z.number().int().min(1).max(5),
    transparency: z.number().int().min(1).max(5),
    comment: opt(1000),
  })
  .strict();
export const homeFeedbackSchema = z
  .object({
    communication: z.number().int().min(1).max(5),
    addressAccuracy: z.number().int().min(1).max(5),
    conditions: z.number().int().min(1).max(5),
    payment: z.number().int().min(1).max(5),
    safetyConcern: z.boolean().default(false),
    note: opt(500),
  })
  .strict();
export const homePaymentSchema = z
  .object({ method: z.enum(["CASH", "DIRECT_UPI", "OTHER_OFFLINE"]), amountPaise: z.number().int().positive().max(10_000_000), tipPaise: paise.default(0), reference: opt(80) })
  .strict();
export const homeAdjustmentSchema = z
  .object({ description: text(200), offeringId: z.string().uuid().optional(), amountPaise: z.number().int().positive().max(5_000_000).optional(), minutes: z.number().int().min(0).max(240).default(0) })
  .strict()
  .refine((a) => a.offeringId || a.amountPaise, "Choose a service or enter an amount");
export const HOME_TICKET_CATEGORIES = [
  "PROFESSIONAL_DELAYED", "PROFESSIONAL_DID_NOT_ARRIVE", "INCORRECT_PROFESSIONAL", "SERVICE_QUALITY", "HYGIENE", "PRICING_DISPUTE",
  "PAYMENT", "PRODUCT", "SAFETY", "CANCELLATION", "RESCHEDULING", "REPLACEMENT", "REFUND",
] as const;
export const homeTicketSchema = z.object({ category: z.enum(HOME_TICKET_CATEGORIES), message: z.string().trim().min(5).max(2000) }).strict();
export const HOME_INCIDENT_KINDS = [
  "UNSAFE_LOCATION", "HARASSMENT", "INJURY", "PRODUCT_REACTION", "THEFT", "WRONG_PERSON_ARRIVED", "NON_PAYMENT", "OTHER",
] as const;
export const homeIncidentSchema = z.object({ kind: z.enum(HOME_INCIDENT_KINDS), description: z.string().trim().min(5).max(2000) }).strict();

export const HOME_HYGIENE_CHECKLIST = {
  BEFORE: [
    { id: "sanitized-tools", en: "Tools sanitized", hi: "औज़ार साफ़ किए गए" },
    { id: "clean-equipment", en: "Equipment clean", hi: "उपकरण साफ़ हैं" },
    { id: "disposables", en: "Fresh disposable materials", hi: "नई डिस्पोज़ेबल सामग्री" },
    { id: "product-expiry", en: "Products within expiry", hi: "उत्पाद की वैधता जाँची" },
    { id: "protective", en: "Protective materials ready", hi: "सुरक्षा सामग्री तैयार" },
    { id: "clean-area", en: "Service area clean", hi: "सेवा की जगह साफ़" },
  ],
  AFTER: [
    { id: "waste", en: "Waste collected", hi: "कचरा समेटा" },
    { id: "cleanup", en: "Area cleaned after service", hi: "सेवा के बाद सफ़ाई" },
  ],
} as const;
export const homeHygieneSchema = z.object({ stage: z.enum(["BEFORE", "AFTER"]), answers: z.record(z.string().max(40), z.boolean()) }).strict();

export const HOME_VERIFICATION_SCOPES = [
  "MOBILE", "IDENTITY", "EXPERIENCE", "TRAINING_CERTIFICATE", "REFERENCES", "SKILL_ASSESSMENT", "EQUIPMENT", "HYGIENE_TRAINING", "SERVICE_QUALIFICATION", "BACKGROUND_CHECK",
] as const;
export type HomeVerificationScope = (typeof HOME_VERIFICATION_SCOPES)[number];
/** A badge says exactly what was checked - never "safe" or "background verified" for a phone check. */
export const HOME_VERIFICATION_LABEL: Record<HomeVerificationScope, string> = {
  MOBILE: "Mobile number verified",
  IDENTITY: "Identity document checked",
  EXPERIENCE: "Experience checked",
  TRAINING_CERTIFICATE: "Training certificate checked",
  REFERENCES: "References checked",
  SKILL_ASSESSMENT: "Practical skill assessed",
  EQUIPMENT: "Equipment checked",
  HYGIENE_TRAINING: "Hygiene training completed",
  SERVICE_QUALIFICATION: "Service qualification checked",
  BACKGROUND_CHECK: "Background check completed",
};
export const homeVerificationSubmitSchema = z
  .object({ scope: z.enum(HOME_VERIFICATION_SCOPES), subject: z.string().trim().max(60).default(""), evidenceNote: opt(1000) })
  .strict();
export const homeVerificationReviewSchema = z
  .object({ status: z.enum(["UNDER_REVIEW", "VERIFIED", "REJECTED", "EXPIRED", "SUSPENDED"]), note: z.string().trim().min(3).max(1000), expiresAt: z.string().datetime().optional() })
  .strict();

export const homeCampaignSchema = z
  .object({
    societyId: z.string().uuid(),
    providerId: z.string().uuid(),
    offeringId: z.string().uuid(),
    title: text(160),
    minParticipants: z.number().int().min(2).max(50),
    maxParticipants: z.number().int().min(2).max(50),
    discountPct: z.number().int().min(0).max(60),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    joinBy: z.string().datetime(),
  })
  .strict()
  .refine((c) => c.minParticipants <= c.maxParticipants && c.joinBy < c.startsAt && c.startsAt < c.endsAt, "Check the dates and participant limits");
export const homeSocietySchema = z.object({ name: text(160), locality: text(120), city: text(80), postalCode: homePincode, lat, lng }).strict();
export const homePromotionSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,30}$/),
    title: text(120),
    percentOff: z.number().int().min(1).max(80).nullish(),
    amountOffPaise: paise.nullish(),
    minOrderPaise: paise.default(0),
    maxUses: z.number().int().min(1).max(100000).nullish(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((p) => !!p.percentOff !== !!p.amountOffPaise, "Use either a percentage or an amount");
export const homePackageSchema = z
  .object({
    title: text(120),
    description: opt(1000),
    audience: z.enum(["MEN", "WOMEN", "COMBO", "FACIAL", "WEDDING", "FAMILY", "SENIOR", "PREMIUM", "GENERAL"]).default("GENERAL"),
    offeringIds: z.array(z.string().uuid()).min(1).max(8),
    pricePaise: paise,
    active: z.boolean().default(true),
  })
  .strict();
export const homeRecurringSchema = z
  .object({
    professionalId: z.string().uuid(),
    addressId: z.string().uuid(),
    items: z.array(itemSchema).min(1).max(6),
    intervalDays: z.number().int().min(7).max(90),
    firstStart: z.string().datetime(),
    paymentMethod: z.enum(["CASH", "DIRECT_UPI", "OTHER_OFFLINE"]),
  })
  .strict();
export const homeFeeRuleSchema = z
  .object({
    kind: z.enum(["COMMISSION", "FIXED_BOOKING"]),
    providerKind: z.enum(["SALON_MANAGED", "INDEPENDENT_PROFESSIONAL"]).nullish(),
    providerId: z.string().uuid().nullish(),
    percentBps: z.number().int().min(0).max(3000).default(0),
    fixedPaise: z.number().int().min(0).max(100_000).default(0),
    active: z.boolean().default(false),
    note: opt(300),
  })
  .strict();
export const homeFieldLeadSchema = z
  .object({
    kind: z.enum(["SALON", "PROFESSIONAL", "SOCIETY"]),
    name: text(160),
    phone: homePhone.optional(),
    city: text(80),
    locality: opt(120),
    consent: z.boolean().default(false),
    stage: z.enum(["IDENTIFIED", "CONTACTED", "CONSENTED", "REGISTERED", "TRAINING", "ASSESSMENT", "VERIFIED", "PUBLISHED", "ACTIVE", "DROPPED"]).default("IDENTIFIED"),
    nextStep: opt(300),
    nextAt: z.string().datetime().nullish(),
    providerId: z.string().uuid().nullish(),
    societyId: z.string().uuid().nullish(),
  })
  .strict();

// ---------- Operational settings (editable by admins; defaults are assumptions) ----------
export const homeSettingsSchema = z
  .object({
    instantAcceptSeconds: z.number().int().min(60).max(900),
    scheduledAcceptMinutes: z.number().int().min(5).max(720),
    parallelInvites: z.number().int().min(1).max(3),
    maxDispatchRounds: z.number().int().min(1).max(20),
    holdMinutes: z.number().int().min(3).max(20),
    accessBufferMinutes: z.number().int().min(0).max(30),
    maxInstantLeadMinutes: z.number().int().min(30).max(360),
    codeMinutes: z.number().int().min(2).max(30),
    codeAttempts: z.number().int().min(3).max(10),
    minScheduledLeadMinutes: z.number().int().min(30).max(1440),
    maxDaysAhead: z.number().int().min(1).max(60),
    requireCompletionCode: z.boolean(),
    autoCloseHours: z.number().int().min(1).max(336),
    supportPhone: z.string().trim().max(20),
    supportEmail: z.string().trim().max(120),
    cancellationPolicy: z.string().trim().max(2000),
    cancellationPolicyHi: z.string().trim().max(2000),
    reServicePolicy: z.string().trim().max(1000),
  })
  .strict();
export type HomeSettings = z.infer<typeof homeSettingsSchema>;
export const HOME_DEFAULT_SETTINGS: HomeSettings = {
  instantAcceptSeconds: 180,
  scheduledAcceptMinutes: 60,
  parallelInvites: 1,
  maxDispatchRounds: 6,
  holdMinutes: 8,
  accessBufferMinutes: 5,
  maxInstantLeadMinutes: 150,
  codeMinutes: 10,
  codeAttempts: 5,
  minScheduledLeadMinutes: 60,
  maxDaysAhead: 21,
  requireCompletionCode: false,
  autoCloseHours: 72,
  supportPhone: "",
  supportEmail: "support@fastque.com",
  cancellationPolicy:
    "Cancelling is free at every stage and FastQue charges no automatic penalty. Before acceptance the request is simply withdrawn. After a professional accepts or starts travelling, please cancel as early as you can. If the professional or salon cancels or does not arrive, you owe nothing. Unsafe conditions and emergencies are always excused.",
  cancellationPolicyHi:
    "किसी भी समय रद्द करना मुफ़्त है और FastQue कोई अपने-आप लगने वाला शुल्क नहीं लेता। प्रोफेशनल के स्वीकार करने या निकलने के बाद कृपया जल्दी रद्द करें। प्रोफेशनल या सैलून के रद्द करने या न आने पर आपको कुछ नहीं देना है। असुरक्षित स्थिति और आपातकाल में हमेशा छूट है।",
  reServicePolicy: "If something is not right, open a complaint from the booking. The provider decides on a correction or re-service; FastQue does not guarantee an outcome.",
};

// ---------- Understanding a typed request (deterministic, no AI service) ----------
export interface HomeIntent {
  serviceCodes: string[];
  mode: "INSTANT" | "SCHEDULED" | null;
  withinMinutes: number | null;
  maxPricePaise: number | null;
  dayOffset: number | null;
  weekday: number | null;
  partOfDay: "MORNING" | "AFTERNOON" | "EVENING" | null;
  providerKind: HomeProviderKind | null;
  wantsRegular: boolean;
  wantsCheapest: boolean;
  /** A stated comfort preference. Shown back to the customer; never a hidden ranking factor. */
  comfortPreference: "FEMALE" | "MALE" | null;
  understood: string[];
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAYS_HI = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];

export function parseHomeRequest(raw: string, services: ReadonlyArray<{ code: string; name: string; nameHi: string; synonyms: readonly string[] }>): HomeIntent {
  const q = ` ${raw.toLowerCase().replace(/[^\p{L}\p{M}\p{N}₹,.]+/gu, " ")} `;
  const understood: string[] = [];
  const codes: string[] = [];
  for (const s of services) {
    const names = [s.name, s.nameHi, ...s.synonyms].map((n) => n.toLowerCase().trim()).filter((n) => n.length > 2);
    if (names.some((n) => q.includes(` ${n} `) || q.includes(` ${n}s `))) codes.push(s.code);
  }
  if (codes.length) understood.push(`Services: ${codes.length}`);
  const within = /(?:within|in|under)\s+(\d{1,3})\s*(?:min|minutes)/.exec(q) ?? /(\d{1,3})\s*मिनट/.exec(q);
  const withinMinutes = within ? Number(within[1]) : null;
  const now = /\b(now|immediately|right away|asap)\b/.test(q) || /अभी|तुरंत/.test(q);
  const price = /(?:under|below|less than|within|से कम)\s*(?:₹|rs\.?|inr)?\s*([\d,]{3,7})(?!\s*(?:min|मिनट))/.exec(q) ?? /₹\s*([\d,]{3,7})/.exec(q);
  const maxPricePaise = price ? Number(price[1].replace(/,/g, "")) * 100 : null;
  let weekday: number | null = null;
  WEEKDAYS.forEach((d, i) => {
    if (q.includes(d)) weekday = i;
  });
  WEEKDAYS_HI.forEach((d, i) => {
    if (q.includes(d)) weekday = i;
  });
  const dayOffset = /\btomorrow\b/.test(q) || q.includes(" कल ") ? 1 : /\btoday\b/.test(q) || q.includes(" आज ") ? 0 : null;
  const partOfDay = /morning|सुबह/.test(q) ? "MORNING" : /afternoon|दोपहर/.test(q) ? "AFTERNOON" : /evening|शाम/.test(q) ? "EVENING" : null;
  const mode = withinMinutes != null || now ? "INSTANT" : dayOffset != null || weekday != null || partOfDay ? "SCHEDULED" : null;
  if (mode) understood.push(mode === "INSTANT" ? "As soon as possible" : "Later");
  if (maxPricePaise) understood.push(`Up to ₹${maxPricePaise / 100}`);
  const comfort = /\b(female|lady|woman|women)\b/.test(q) || /महिला/.test(q) ? "FEMALE" : /\b(male)\b/.test(q) || /पुरुष प्रोफेशनल/.test(q) ? "MALE" : null;
  return {
    serviceCodes: codes,
    mode,
    withinMinutes,
    maxPricePaise,
    dayOffset,
    weekday,
    partOfDay,
    providerKind: /\b(freelancer|independent)\b/.test(q) ? "INDEPENDENT_PROFESSIONAL" : /\bsalon\b/.test(q) ? "SALON_MANAGED" : null,
    wantsRegular: /\b(regular|usual|same)\b/.test(q) || /हमेशा वाले/.test(q),
    wantsCheapest: /\b(cheap|cheapest|affordable|lowest)\b/.test(q) || /सस्ता|सस्ते/.test(q),
    comfortPreference: comfort,
    understood,
  };
}

/** A home booking code: not guessable from another one, and never enough on its own to open a booking. */
export const HOME_CODE_PATTERN = /^FQH-[0-9A-F]{10}$/;
