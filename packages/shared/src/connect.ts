import { z } from "zod";

/**
 * FastQue Connect: booking-linked, participant-verified conversations (docs/connect/).
 * Shared by the API, the website and the app. Prices, availability and permissions are always
 * decided by the server; nothing here is a source of truth for them.
 */

// ---------- Feature switches (backend env; everything off unless exactly "true") ----------
export const CONNECT_FLAG_NAMES = [
  "FASTQUE_CONNECT_ENABLED",
  "CONNECT_AI_ENABLED",
  "CONNECT_AI_LLM_ENABLED",
  "CONNECT_BOOKING_ACTIONS_ENABLED",
  "CONNECT_QUEUE_MESSAGES_ENABLED",
  "CONNECT_QUOTATIONS_ENABLED",
  "CONNECT_TRANSLATION_ENABLED",
  "CONNECT_LOCATION_SHARING_ENABLED",
  "CONNECT_FOLLOWUPS_ENABLED",
] as const;
export type ConnectFlagName = (typeof CONNECT_FLAG_NAMES)[number];
export type ConnectFlags = Record<ConnectFlagName, boolean>;

// ---------- Intents (section 6) ----------
export const CONNECT_INTENTS = [
  "BOOKING_INQUIRY",
  "APPOINTMENT_MODIFICATION",
  "CANCELLATION_REQUEST",
  "WAITING_TIME",
  "LATE_ARRIVAL",
  "ADDITIONAL_SERVICE",
  "PRICING",
  "HAIRSTYLE_CONSULTATION",
  "PRODUCT_INQUIRY",
  "HOME_SERVICE",
  "PAYMENT",
  "REFUND",
  "COMPLAINT",
  "GENERAL",
  "EMERGENCY",
  // Not in the spec's list but needed for routing: the customer asks for a person.
  "HUMAN_REQUEST",
  "LOCATION",
  "OPENING_HOURS",
  "ON_THE_WAY",
  "ARRIVED",
] as const;
export type ConnectIntent = (typeof CONNECT_INTENTS)[number];

/** Intents the AI may answer by itself, from verified data only, when a salon turns AUTO on. */
export const CONNECT_LOW_RISK_INTENTS: readonly ConnectIntent[] = [
  "WAITING_TIME",
  "PRICING",
  "LOCATION",
  "OPENING_HOURS",
  "BOOKING_INQUIRY",
];

/** Always handed to a person (section 5, Mode C). */
export const CONNECT_ESCALATE_INTENTS: readonly ConnectIntent[] = [
  "COMPLAINT",
  "REFUND",
  "PAYMENT",
  "EMERGENCY",
  "HUMAN_REQUEST",
];

export const CONNECT_INTENT_LABEL: Record<ConnectIntent, string> = {
  BOOKING_INQUIRY: "Booking inquiry",
  APPOINTMENT_MODIFICATION: "Appointment change",
  CANCELLATION_REQUEST: "Cancellation request",
  WAITING_TIME: "Waiting time",
  LATE_ARRIVAL: "Running late",
  ADDITIONAL_SERVICE: "Add a service",
  PRICING: "Pricing",
  HAIRSTYLE_CONSULTATION: "Style consultation",
  PRODUCT_INQUIRY: "Product inquiry",
  HOME_SERVICE: "Home service",
  PAYMENT: "Payment",
  REFUND: "Refund",
  COMPLAINT: "Complaint",
  GENERAL: "General",
  EMERGENCY: "Emergency or safety",
  HUMAN_REQUEST: "Wants a person",
  LOCATION: "Directions or parking",
  OPENING_HOURS: "Opening hours",
  ON_THE_WAY: "On the way",
  ARRIVED: "Arrived",
};

// ---------- Customer quick templates (section 3) ----------
export const CONNECT_TEMPLATES = [
  { key: "on_my_way", text: "I am on my way." },
  { key: "arrived", text: "I have arrived." },
  { key: "running_late", text: "I am running late." },
  { key: "wait_time", text: "How long is the waiting time?" },
  { key: "change_appointment", text: "Can I change my appointment?" },
  { key: "request_stylist", text: "Can I request a particular stylist?" },
  { key: "add_service", text: "Can I add another service?" },
  { key: "total_price", text: "What will be the total price?" },
  { key: "share_style", text: "Can I share my preferred hairstyle?" },
  { key: "parking", text: "Where can I park?" },
  { key: "find_salon", text: "I need help finding the salon." },
] as const;

// ---------- Languages (section 12) ----------
export const CONNECT_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी (Hindi)" },
  { code: "hinglish", label: "Hinglish" },
  { code: "bn", label: "বাংলা (Bengali)" },
  { code: "ta", label: "தமிழ் (Tamil)" },
  { code: "te", label: "తెలుగు (Telugu)" },
  { code: "mr", label: "मराठी (Marathi)" },
  { code: "gu", label: "ગુજરાતી (Gujarati)" },
  { code: "pa", label: "ਪੰਜਾਬੀ (Punjabi)" },
  { code: "or", label: "ଓଡ଼ିଆ (Odia)" },
  { code: "kn", label: "ಕನ್ನಡ (Kannada)" },
  { code: "ml", label: "മലയാളം (Malayalam)" },
] as const;
export type ConnectLanguage = (typeof CONNECT_LANGUAGES)[number]["code"];
export const CONNECT_LANGUAGE_CODES = CONNECT_LANGUAGES.map((l) => l.code) as unknown as readonly [ConnectLanguage, ...ConnectLanguage[]];

/** Script-based detection. Latin text with common Hindi words is Hinglish. Returns null when unsure. */
export function detectConnectLanguage(text: string): ConnectLanguage | null {
  const t = text.trim();
  if (!t) return null;
  const ranges: [RegExp, ConnectLanguage][] = [
    [/[ঀ-৿]/, "bn"],
    [/[஀-௿]/, "ta"],
    [/[ఀ-౿]/, "te"],
    [/[઀-૿]/, "gu"],
    [/[਀-੿]/, "pa"],
    [/[଀-୿]/, "or"],
    [/[ಀ-೿]/, "kn"],
    [/[ഀ-ൿ]/, "ml"],
  ];
  for (const [re, code] of ranges) if (re.test(t)) return code;
  if (/[ऀ-ॿ]/.test(t)) {
    // Marathi and Hindi share Devanagari; a few frequent Marathi-only words decide.
    return /(आहे|नाही|आणि|मला|तुम्ही|कधी)/.test(t) ? "mr" : "hi";
  }
  if (/[a-z]/i.test(t)) {
    return /\b(kya|hai|hain|kitna|kitne|kab|mujhe|aap|nahi|haan|kal|abhi|bhai|ji|chahiye|kar|raha|rahi|der|baje)\b/i.test(t) ? "hinglish" : "en";
  }
  return null;
}

// ---------- Entitlements (section 27). Tier → features. No prices anywhere. ----------
export const CONNECT_FEATURES = [
  "MESSAGING",
  "BOOKING_UPDATES",
  "ATTACHMENTS",
  "AI_SUGGESTIONS",
  "TRANSLATION",
  "ADVANCED_TEMPLATES",
  "AUTOMATED_REMINDERS",
  "ANALYTICS",
  "AI_AUTO_REPLY",
  "RETENTION",
  "SENTIMENT",
  "QUOTATIONS",
  "CRM_INTEGRATION",
] as const;
export type ConnectFeature = (typeof CONNECT_FEATURES)[number];
export type ConnectTier = "BASIC" | "PROFESSIONAL" | "PREMIUM";
export const CONNECT_DEFAULT_TIER_FEATURES: Record<ConnectTier, ConnectFeature[]> = {
  BASIC: ["MESSAGING", "BOOKING_UPDATES", "ATTACHMENTS"],
  PROFESSIONAL: ["MESSAGING", "BOOKING_UPDATES", "ATTACHMENTS", "AI_SUGGESTIONS", "TRANSLATION", "ADVANCED_TEMPLATES", "AUTOMATED_REMINDERS", "ANALYTICS"],
  PREMIUM: [...CONNECT_FEATURES],
};

// ---------- Platform configuration (section 19/21). Admin-editable; these are defaults. ----------
export interface ConnectPlatformConfigDto {
  lifecycle: {
    activeDaysAfterCompletion: number;
    cancelledWindowDays: number;
    completedChatAllowed: boolean;
  };
  limits: {
    maxMessageChars: number;
    messagesPerMinute: number;
    maxAttachmentBytes: number;
    maxVoiceBytes: number;
    retentionDays: number;
  };
  ai: {
    salonAiAllowed: boolean;
    monthlyBudgetUsdPerSalon: number;
    confidenceThreshold: number;
  };
  notifications: {
    unreadThrottleMinutes: number;
    queuePositionStep: number;
    queueWaitIncreaseMinutes: number;
  };
  moderation: {
    blockLinksFromCustomers: boolean;
    autoHideReportedAfter: number;
  };
  escalation: {
    negativeSentimentToSupport: boolean;
    complaintSlaHours: number;
  };
  entitlements: {
    /** Tier every salon gets until a subscription assigns another one. */
    defaultTier: ConnectTier;
    tiers: Record<ConnectTier, ConnectFeature[]>;
  };
  quotas: {
    aiRepliesPerSalonPerDay: number;
    translationsPerSalonPerDay: number;
  };
}

export const CONNECT_DEFAULT_CONFIG: ConnectPlatformConfigDto = {
  lifecycle: { activeDaysAfterCompletion: 7, cancelledWindowDays: 3, completedChatAllowed: true },
  limits: { maxMessageChars: 2000, messagesPerMinute: 20, maxAttachmentBytes: 8 * 1024 * 1024, maxVoiceBytes: 4 * 1024 * 1024, retentionDays: 365 },
  ai: { salonAiAllowed: true, monthlyBudgetUsdPerSalon: 2, confidenceThreshold: 0.75 },
  notifications: { unreadThrottleMinutes: 5, queuePositionStep: 2, queueWaitIncreaseMinutes: 15 },
  moderation: { blockLinksFromCustomers: false, autoHideReportedAfter: 3 },
  escalation: { negativeSentimentToSupport: false, complaintSlaHours: 48 },
  entitlements: { defaultTier: "PREMIUM", tiers: CONNECT_DEFAULT_TIER_FEATURES },
  quotas: { aiRepliesPerSalonPerDay: 500, translationsPerSalonPerDay: 500 },
};

// ---------- Input schemas ----------
const text = (max: number) => z.string().trim().min(1).max(max);
export const connectSendSchema = z
  .object({
    clientMessageId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
    body: z.string().trim().max(4000).optional(),
    replyToId: z.string().uuid().optional(),
    attachmentIds: z.array(z.string().uuid()).max(5).optional(),
    templateKey: z.string().max(40).optional(),
    /** The newest message the sender had seen; a stale salon reply is refused (collision check). */
    lastSeenSeq: z.number().int().min(0).optional(),
    /** Salon staff sending an AI draft they reviewed. */
    fromSuggestionId: z.string().uuid().optional(),
  })
  .refine((v) => !!v.body || (v.attachmentIds?.length ?? 0) > 0, { message: "Type a message or attach a file." });
export type ConnectSendInput = z.infer<typeof connectSendSchema>;

export const connectEditSchema = z.object({ body: text(4000) });
export const connectReactSchema = z.object({ emoji: z.string().trim().min(1).max(16) });
export const connectReadSchema = z.object({ seq: z.number().int().min(0) });
export const connectPrefsSchema = z.object({
  muted: z.boolean().optional(),
  archived: z.boolean().optional(),
  blocked: z.boolean().optional(),
});
export const connectUserPrefsSchema = z.object({
  showOnline: z.boolean().optional(),
  showLastActive: z.boolean().optional(),
  notificationPreviews: z.boolean().optional(),
  preferredLanguage: z.enum(CONNECT_LANGUAGE_CODES).nullable().optional(),
  promotionalMessages: z.boolean().optional(),
});
export const connectReportSchema = z.object({
  messageId: z.string().uuid().optional(),
  reason: z.enum(["SPAM", "ABUSE", "HARASSMENT", "FRAUD", "INAPPROPRIATE", "OTHER"]),
  details: z.string().trim().max(1000).optional(),
});
export const connectComplaintSchema = z.object({
  category: z.enum(["SERVICE_QUALITY", "WAITING_TIME", "PRICING", "STAFF_BEHAVIOUR", "PAYMENT_REFUND", "SAFETY", "OTHER"]),
  details: text(2000),
});
export const connectAssignSchema = z.object({ userId: z.string().nullable() });
export const connectConversationPatchSchema = z.object({
  priority: z.enum(["NORMAL", "HIGH", "URGENT"]).optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(10).optional(),
  resolved: z.boolean().optional(),
});
export const connectNoteSchema = z.object({ body: text(2000) });
export const connectSavedReplySchema = z.object({ title: text(80), body: text(1000) });
export const connectStaffGrantSchema = z.object({ userId: z.string().min(1), role: z.enum(["MANAGER", "RECEPTIONIST", "STYLIST"]).nullable() });
export const connectSalonSettingsSchema = z.object({
  aiMode: z.enum(["OFF", "SUGGEST", "AUTO"]).optional(),
  autoReplyIntents: z.array(z.enum(CONNECT_INTENTS as unknown as [ConnectIntent, ...ConnectIntent[]])).max(20).optional(),
  translationEnabled: z.boolean().optional(),
  followUpsEnabled: z.boolean().optional(),
  faq: z.array(z.object({ q: text(200), a: text(800) })).max(40).optional(),
  parkingInfo: z.string().trim().max(500).nullable().optional(),
  directions: z.string().trim().max(500).nullable().optional(),
  aftercare: z.string().trim().max(800).nullable().optional(),
});
export const connectActionRequestSchema = z.object({
  kind: z.enum(["RESCHEDULE", "CANCEL", "ADD_SERVICE", "REMOVE_SERVICE", "CHANGE_STYLIST", "LATE_ARRIVAL", "JOIN_QUEUE_SLOT", "ADD_FAMILY_MEMBER"]),
  /** RESCHEDULE: the day to look at (YYYY-MM-DD, salon time). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** LATE_ARRIVAL: minutes late, as the customer said. */
  delayMinutes: z.number().int().min(1).max(240).optional(),
  note: z.string().trim().max(300).optional(),
});
export const connectActionDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "DECLINE", "CANCEL"]),
  /** RESCHEDULE: one of the offered slot starts. */
  optionSlotStart: z.string().datetime().optional(),
  note: z.string().trim().max(300).optional(),
});
const quoteLine = z.object({
  name: text(120),
  description: z.string().trim().max(300).optional(),
  serviceId: z.string().optional(),
  quantity: z.number().int().min(1).max(20),
  unitPaise: z.number().int().min(0).max(100_000_000),
  durationMinutes: z.number().int().min(0).max(1440),
});
export const connectQuotationSchema = z.object({
  title: text(120),
  items: z.array(quoteLine).min(1).max(30),
  discountPaise: z.number().int().min(0).max(100_000_000).default(0),
  taxPercent: z.number().min(0).max(28).default(0),
  validDays: z.number().int().min(1).max(90).default(7),
  terms: z.string().trim().max(1000).optional(),
});
export type ConnectQuotationInput = z.infer<typeof connectQuotationSchema>;
export const connectQuotationDecisionSchema = z.object({
  decision: z.enum(["ACCEPT", "DECLINE", "REQUEST_CHANGES", "WITHDRAW"]),
  version: z.number().int().min(1),
  note: z.string().trim().max(500).optional(),
});
export const connectLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().int().min(0).max(10_000).optional(),
  minutes: z.number().int().min(5).max(120).default(30),
  consent: z.literal(true),
});
export const connectTranslateSchema = z.object({ target: z.enum(CONNECT_LANGUAGE_CODES) });
export const connectAdminAccessSchema = z.object({
  purpose: z.enum(["SUPPORT_TICKET", "ABUSE_REPORT", "LEGAL_REQUEST", "SAFETY"]),
  reference: text(120),
  justification: text(500),
});
export const connectInboxQuerySchema = z.object({
  folder: z
    .enum(["all", "unread", "new", "upcoming", "queue", "home", "awaiting_customer", "awaiting_salon", "urgent", "ai", "complaints", "completed", "archived", "mine"])
    .default("all"),
  q: z.string().trim().max(80).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cursor: z.string().max(80).optional(),
});

// ---------- DTOs ----------
export type ConnectSide = "CUSTOMER" | "SALON";
export interface ConnectBookingCardDto {
  kind: "SALON_BOOKING" | "LIVE_QUEUE" | "HOME_SERVICE";
  reference: string;
  salonName: string;
  stylist: string | null;
  services: { name: string; durationMinutes: number | null; pricePaise: number | null }[];
  startsAt: string | null;
  status: string;
  statusLabel: string;
  queuePosition: number | null;
  estimatedWaitMinutes: number | null;
  durationMinutes: number | null;
  totalPaise: number | null;
  paymentStatus: string | null;
  updatedAt: string;
}
export interface ConnectAttachmentDto {
  id: string;
  mimeType: string;
  sizeBytes: number;
  fileName: string | null;
  url: string;
  scanStatus: string;
}
export interface ConnectMessageDto {
  id: string;
  seq: number;
  sender: "CUSTOMER" | "SALON" | "AI" | "SYSTEM";
  mine: boolean;
  senderName: string | null;
  kind: string;
  body: string | null;
  language: string | null;
  intent: string | null;
  replyTo: { id: string; seq: number; body: string | null } | null;
  aiGenerated: boolean;
  meta: Record<string, unknown> | null;
  edited: boolean;
  deleted: boolean;
  reactions: { emoji: string; count: number; mine: boolean }[];
  attachments: ConnectAttachmentDto[];
  createdAt: string;
  status: "sent" | "delivered" | "read" | null;
}
export interface ConnectConversationSummaryDto {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: number;
  status: string;
  priority: string;
  awaiting: string;
  aiHandled: boolean;
  hasOpenComplaint: boolean;
  sentiment: string | null;
  tags: string[];
  assignedToUserId: string | null;
  muted: boolean;
  archived: boolean;
}
