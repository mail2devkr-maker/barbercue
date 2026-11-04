import { z } from "zod";

// FastQue Action Assistant (issue #362). The assistant never calls an API on its own: every turn is
// interpreted on the server into one allowlisted, typed action, authorized for the CALLER's session at
// execution time, and either answered (reads), previewed for confirmation (writes) or refused. The
// client only renders these DTOs and refreshes the screens named in `refresh`.

export const ASSISTANT_PATHS = {
  assistant: "assistant",
  turns: "turns",
  confirmations: "confirmations",
  capabilities: "capabilities",
  transcriptions: "transcriptions",
} as const;

export const ASSISTANT_LIMITS = {
  maxTextLength: 500,
  confirmationTtlSeconds: 120,
  // Local speech-to-text upload (only when a private Whisper server is configured).
  maxAudioBytes: 2_000_000,
  maxAudioSeconds: 30,
} as const;

/** Which screen family the assistant is opened from; it limits which phrases apply. */
export type AssistantSurface = "shop" | "customer" | "admin" | "employee";

export const assistantTurnSchema = z.object({
  text: z.string().trim().min(1).max(ASSISTANT_LIMITS.maxTextLength),
  // The screen the user is on. Only a hint: access is re-checked against the session for every action.
  salonId: z.string().trim().min(1).max(64).optional(),
  // How the text arrived, for the audit trail and the transcript bubble. Never changes what is allowed.
  inputMode: z.enum(["text", "voice"]).default("text"),
  // Which screen the drawer is on. Only picks between same-worded intents ("cancel my
  // appointment" vs a shop cancelling one); it never grants anything.
  surface: z.enum(["shop", "customer", "admin", "employee"]).default("shop"),
});
export type AssistantTurnInput = z.infer<typeof assistantTurnSchema>;

export const assistantConfirmationSchema = z.object({
  token: z.string().min(16).max(4096),
  decision: z.enum(["confirm", "cancel"]),
});
export type AssistantConfirmationInput = z.infer<typeof assistantConfirmationSchema>;

export const AssistantActionId = {
  STAFF_LIST: "staff.list",
  STAFF_ADD: "staff.add",
  STAFF_SET_STATUS: "staff.setStatus",
  SERVICE_LIST: "services.list",
  SERVICE_ADD: "services.add",
  SERVICE_SET_PRICE: "services.setPrice",
  SERVICE_ARCHIVE: "services.archive",
  SERVICE_RESTORE: "services.restore",
  QUEUE_STATUS: "queue.status",
  TODAY_INSIGHTS: "insights.today",
  SALON_SEARCH: "salons.search",
  // Phase 2 — shop
  STAFF_RENAME: "staff.rename",
  SERVICE_SET_DURATION: "services.setDuration",
  SERVICE_RENAME: "services.rename",
  HOURS_VIEW: "hours.view",
  HOURS_SET: "hours.set",
  QUEUE_CALL_NEXT: "queue.callNext",
  QUEUE_MARK_ARRIVED: "queue.markArrived",
  QUEUE_NO_SHOW: "queue.noShow",
  QUEUE_CANCEL: "queue.cancel",
  QUEUE_COMPLETE: "queue.complete",
  QUEUE_ADD_WALK_IN: "queue.addWalkIn",
  SCHEDULE_VIEW: "schedule.view",
  BOOKING_CANCEL_BY_SHOP: "bookings.cancelByShop",
  BOOKING_RESCHEDULE_BY_SHOP: "bookings.rescheduleByShop",
  CUSTOMERS_FIND: "customers.find",
  // Phase 2 — customer (self-service)
  MY_BOOKINGS: "me.bookings",
  MY_BOOKING_CANCEL: "me.cancelBooking",
  MY_BOOKING_RESCHEDULE: "me.rescheduleBooking",
  MY_QUEUE_STATUS: "me.queueStatus",
  MY_QUEUE_LEAVE: "me.leaveQueue",
  BOOK_APPOINTMENT: "me.book",
  // Batch 3 — shop
  CHAIRS_LIST: "chairs.list",
  CHAIRS_ADD: "chairs.add",
  CHAIRS_SET_STATUS: "chairs.setStatus",
  STAFF_HOURS_VIEW: "staffHours.view",
  STAFF_HOURS_SET: "staffHours.set",
  BOOKING_NO_SHOW: "bookings.noShow",
  OFFERS_LIST: "offers.list",
  OFFERS_PAUSE: "offers.pause",
  OFFERS_PUBLISH: "offers.publish",
  REVIEWS_LIST: "reviews.list",
  REVIEWS_REPLY: "reviews.reply",
  INVOICES_LIST: "invoices.list",
  REVENUE_REPORT: "revenue.report",
  // Batch 3 — everyone
  NOTIFICATIONS_LIST: "notifications.list",
  NOTIFICATIONS_READ_ALL: "notifications.readAll",
  // Batch 3 — customer
  MY_QUEUE_JOIN: "me.joinQueue",
  MY_FAVORITES: "me.favorites",
  MY_FAVORITE_ADD: "me.favoriteAdd",
  MY_FAVORITE_REMOVE: "me.favoriteRemove",
  MY_INVOICES: "me.invoices",
  // Batch 3 — platform (read-only)
  ADMIN_OVERVIEW: "admin.overview",
  ADMIN_SHOP_STATUS: "admin.shopStatus",
  // Batch 4 — shop operations that need an explicit choice or a stronger confirmation
  QUEUE_ASSIGN: "queue.assign",
  QUEUE_START: "queue.start",
  BOOKING_IN_SHOP: "bookings.inShop",
  BOOKING_CORRECT_COMPLETED: "bookings.correctCompleted",
  // Batch 5 — offers, shop profile, customer review, language
  OFFERS_CREATE: "offers.create",
  OFFERS_EDIT: "offers.edit",
  SALON_PROFILE_VIEW: "salon.profile",
  SALON_PROFILE_SET: "salon.setProfile",
  REVIEW_WRITE: "me.writeReview",
  LANGUAGE_SET: "me.language",
  // batch 6: a field employee's own CRM, read-only (EMPLOYEE-audience session)
  EMPLOYEE_DASHBOARD: "employee.dashboard",
  EMPLOYEE_LEADS: "employee.leads",
  EMPLOYEE_FOLLOW_UPS: "employee.followUps",
  EMPLOYEE_VISITS: "employee.visits",
  // batch 7: platform reads with the admin routes' own audiences (ADMIN session)
  ADMIN_VERIFICATION_QUEUE: "admin.verificationQueue",
  ADMIN_CRM_OVERVIEW: "admin.crmOverview",
  // batch 8: a field employee records their own work (confirmed writes, own leads only)
  EMPLOYEE_LOG_VISIT: "employee.logVisit",
  EMPLOYEE_CLOSE_FOLLOW_UP: "employee.closeFollowUp",
  // batch 9
  EMPLOYEE_SCHEDULE_FOLLOW_UP: "employee.scheduleFollowUp",
  REVIEW_EDIT: "me.editReview",
  ADMIN_SHOP_ACTIVITY: "admin.shopActivity",
  // batch 11: platform analytics KPIs only (no per-person rows)
  ADMIN_CUSTOMER_ANALYTICS: "admin.customerAnalytics",
  ADMIN_STAFF_ANALYTICS: "admin.staffAnalytics",
} as const;
export type AssistantActionId = (typeof AssistantActionId)[keyof typeof AssistantActionId];

export type AssistantTurnStatus =
  | "DONE" // read answered, or confirmed write applied by the server
  | "NEEDS_CONFIRMATION" // write previewed; nothing changed yet
  | "NEEDS_INPUT" // ambiguous or missing detail; options offered
  | "CANCELLED"
  | "DENIED" // the caller's role/shop may not do this
  | "UNAVAILABLE" // the feature exists in FastQue but is not released or switched on yet
  | "UNSUPPORTED" // not understood / not an assistant action yet
  | "FAILED"; // the server refused or errored; nothing was changed by the assistant

export interface AssistantPreviewRow {
  label: string;
  before: string | null;
  after: string | null;
}

export interface AssistantTurnDto {
  requestId: string;
  status: AssistantTurnStatus;
  action: { id: AssistantActionId; title: string; kind: "READ" | "WRITE" } | null;
  message: string;
  preview?: { rows: AssistantPreviewRow[]; warning?: string };
  confirmation?: { token: string; expiresAt: string };
  // Suggested follow-up texts (e.g. "which service?" choices), sent back as a new turn when tapped.
  options?: Array<{ label: string; text: string }>;
  result?: {
    summary: string;
    items?: Array<{ id?: string; title: string; detail?: string }>;
    changed?: Array<{ resource: AssistantResource; id: string }>;
  };
  // Screens whose data the server just changed; the client reloads them from the API.
  refresh?: AssistantResource[];
  navigateTo?: string;
  completedAt: string;
}

export type AssistantResource =
  | "staff"
  | "services"
  | "queue"
  | "overview"
  | "hours"
  | "bookings"
  | "customers"
  | "myBookings"
  | "myQueue"
  | "chairs"
  | "staffHours"
  | "offers"
  | "reviews"
  | "notifications"
  | "favorites"
  | "profile"
  | "employee";

export type AssistantCapabilityState = "SUPPORTED" | "DENIED" | "UNAVAILABLE";

export interface AssistantVoiceOptionsDto {
  // Browser speech recognition (development/testing; in Chrome the audio is processed by Google).
  browser: true;
  // A private, self-hosted Whisper server is configured for audio that never leaves FastQue.
  local: boolean;
}

export interface AssistantCapabilitiesDto {
  interpreter: "rules" | "local";
  voice: AssistantVoiceOptionsDto;
  actions: AssistantCapabilityDto[];
}

export interface AssistantTranscriptionDto {
  text: string;
  language: string | null;
}

export interface AssistantCapabilityDto {
  id: AssistantActionId;
  title: string;
  kind: "READ" | "WRITE";
  confirmation: boolean;
  state: AssistantCapabilityState;
  examples: string[];
}
