// Enums mirrored from DATABASE.md / STATE_MACHINES.md. This package holds shapes only — no I/O,
// no framework imports — so it can be consumed unmodified by NestJS, Next.js, and Expo alike.
//
// Deliberately `as const` objects + derived union types, NOT TypeScript `enum`s. Prisma generates
// its own enums as string-literal unions (e.g. `type Role = "CUSTOMER" | "SALON_STAFF" | ...`),
// which are NOT structurally assignable to a real TS `enum` even with identical values — TS
// enums are nominal. Using the same union-type shape here means a value read from Prisma
// (`user.roles[0].role`) is directly assignable to this package's `Role` with no cast anywhere
// in the codebase, while `Role.CUSTOMER` etc. still works exactly like an enum at every call site.

export const Role = {
  CUSTOMER: 'CUSTOMER',
  SALON_STAFF: 'SALON_STAFF',
  SALON_OWNER: 'SALON_OWNER',
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

// Phase 14 (Localization & Voice Operations). Deliberately tiny — every entry is a language the
// platform actually has real translated voice-announcement/UI strings for (see
// packages/shared/src/i18n). Adding a language means adding both an enum value here AND a
// complete VoiceAnnouncements implementation in i18n/index.ts — never a code without strings.
export const Language = {
  EN: 'EN',
  HI: 'HI',
} as const;
export type Language = (typeof Language)[keyof typeof Language];

export const OtpPurpose = {
  LOGIN: 'LOGIN',
  SIGNUP: 'SIGNUP',
} as const;
export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];

// Customer auth is provider-based (AuthIdentity, one row per linked account). GOOGLE is live;
// WHATSAPP is reserved for a future OtpSender-style implementation — genuinely free production
// WhatsApp OTP requires Meta Business verification + a paid-per-message account, neither of which
// exists yet (see ARCHITECTURE.md). Phone OTP itself stays on User.phone directly, unchanged —
// only *additional* linked identities go through AuthIdentity.
export const AuthProvider = {
  GOOGLE: 'GOOGLE',
  WHATSAPP: 'WHATSAPP',
} as const;
export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider];

export const SalonStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type SalonStatus = (typeof SalonStatus)[keyof typeof SalonStatus];

export const SalonStaffRole = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  BARBER: 'BARBER',
} as const;
export type SalonStaffRole = (typeof SalonStaffRole)[keyof typeof SalonStaffRole];

export const StaffMemberStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type StaffMemberStatus = (typeof StaffMemberStatus)[keyof typeof StaffMemberStatus];

export const ChairStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  MAINTENANCE: 'MAINTENANCE',
} as const;
export type ChairStatus = (typeof ChairStatus)[keyof typeof ChairStatus];

export const PhotoType = {
  COVER: 'COVER',
  GALLERY: 'GALLERY',
} as const;
export type PhotoType = (typeof PhotoType)[keyof typeof PhotoType];

export const PrepaymentRequirement = {
  NONE: 'NONE',
  OPTIONAL: 'OPTIONAL',
  PARTIAL: 'PARTIAL',
  FULL: 'FULL',
} as const;
export type PrepaymentRequirement = (typeof PrepaymentRequirement)[keyof typeof PrepaymentRequirement];

export const BookingStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
  EXPIRED: 'EXPIRED',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

export const BookingSource = {
  APP: 'APP',
  WEB: 'WEB',
  WALK_IN: 'WALK_IN',
} as const;
export type BookingSource = (typeof BookingSource)[keyof typeof BookingSource];

export const QueueEntrySource = {
  WALK_IN: 'WALK_IN',
  APPOINTMENT: 'APPOINTMENT',
} as const;
export type QueueEntrySource = (typeof QueueEntrySource)[keyof typeof QueueEntrySource];

export const QueueEntryStatus = {
  WAITING: 'WAITING',
  CALLED: 'CALLED',
  IN_SERVICE: 'IN_SERVICE',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type QueueEntryStatus = (typeof QueueEntryStatus)[keyof typeof QueueEntryStatus];

export const ServiceSessionStatus = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type ServiceSessionStatus = (typeof ServiceSessionStatus)[keyof typeof ServiceSessionStatus];

export const ChargeType = {
  FLAT: 'FLAT',
  PERCENTAGE: 'PERCENTAGE',
} as const;
export type ChargeType = (typeof ChargeType)[keyof typeof ChargeType];

export const PaymentType = {
  BOOKING_PAYMENT: 'BOOKING_PAYMENT',
  CANCELLATION_CHARGE: 'CANCELLATION_CHARGE',
} as const;
export type PaymentType = (typeof PaymentType)[keyof typeof PaymentType];

export const PaymentProvider = {
  RAZORPAY: 'RAZORPAY',
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

export const PaymentStatus = {
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const RefundStatus = {
  INITIATED: 'INITIATED',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export const LedgerReason = {
  CANCELLATION_CHARGE: 'CANCELLATION_CHARGE',
  NO_SHOW_CHARGE: 'NO_SHOW_CHARGE',
} as const;
export type LedgerReason = (typeof LedgerReason)[keyof typeof LedgerReason];

export const LedgerStatus = {
  OUTSTANDING: 'OUTSTANDING',
  SETTLED: 'SETTLED',
  WAIVED: 'WAIVED',
} as const;
export type LedgerStatus = (typeof LedgerStatus)[keyof typeof LedgerStatus];

// Customer-facing Premium subscription (Basic/Pro/Max, AI credits) — distinct from the existing
// SubscriptionStatus enum above, which is salon (B2B) billing, inert in V1. Deliberately no
// TRIALING/PAST_DUE/PILOT here: a customer's Premium subscription is only ever ACTIVE, EXPIRED
// (lazily computed — periodEnd has passed), or CANCELLED (superseded by a newer activation).
export const CustomerSubscriptionStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type CustomerSubscriptionStatus =
  (typeof CustomerSubscriptionStatus)[keyof typeof CustomerSubscriptionStatus];

// Every balance-affecting event on a CustomerSubscription's AI credits — see AiCreditTransaction
// in schema.prisma and AiCreditService, the only writer of this table.
export const AiCreditTransactionType = {
  ALLOCATION: 'ALLOCATION',
  RESERVATION: 'RESERVATION',
  CONSUMPTION: 'CONSUMPTION',
  RELEASE: 'RELEASE',
  MANUAL_ADJUSTMENT: 'MANUAL_ADJUSTMENT',
} as const;
export type AiCreditTransactionType =
  (typeof AiCreditTransactionType)[keyof typeof AiCreditTransactionType];

export const SubscriptionStatus = {
  PILOT: 'PILOT',
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  EXPIRED: 'EXPIRED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const NotificationChannel = {
  SMS: 'SMS',
  PUSH: 'PUSH',
  EMAIL: 'EMAIL',
  // Phase 11 (Notification Center) — see the Prisma schema's own doc comment on this value.
  IN_APP: 'IN_APP',
  // Phase 13 (Communication Preferences) — architecture-only, see the Prisma schema's doc comment.
  WHATSAPP: 'WHATSAPP',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
} as const;
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

// Phase 13 (Communication Preferences) — see NotificationPreference's own schema.prisma doc
// comment for what "no row" (the default) means for each category.
export const NotificationCategory = {
  BOOKING_UPDATES: 'BOOKING_UPDATES',
  QUEUE_UPDATES: 'QUEUE_UPDATES',
  REMINDERS: 'REMINDERS',
  PROMOTIONAL: 'PROMOTIONAL',
} as const;
export type NotificationCategory =
  (typeof NotificationCategory)[keyof typeof NotificationCategory];

// Stable machine-readable error codes for authentication — API.md's convention: clients branch on
// `error.code`, never on `error.message`. Shared so backend and every client agree on the exact
// strings.
// Stable machine-readable error codes for the booking flow — same convention as AuthErrorCode.
export const BookingErrorCode = {
  SALON_NOT_FOUND: 'SALON_NOT_FOUND',
  SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND',
  STAFF_NOT_FOUND: 'STAFF_NOT_FOUND',
  STAFF_NOT_QUALIFIED: 'STAFF_NOT_QUALIFIED',
  SALON_TIMEZONE_REQUIRED: 'SALON_TIMEZONE_REQUIRED',
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  SLOT_IN_PAST: 'SLOT_IN_PAST',
  OUTSIDE_OPERATING_HOURS: 'OUTSIDE_OPERATING_HOURS',
  SLOT_FULL: 'SLOT_FULL',
  // A specific customer-selected barber (Booking.preferredStaffId) already has a conflicting
  // booking at this time — distinct from SLOT_FULL, which is about salon-wide pool capacity.
  // Pool capacity can have room while this one named barber is still unavailable, and vice versa.
  STAFF_SLOT_UNAVAILABLE: 'STAFF_SLOT_UNAVAILABLE',
  OUTSTANDING_BALANCE: 'OUTSTANDING_BALANCE',
  BOOKING_NOT_CANCELLABLE: 'BOOKING_NOT_CANCELLABLE',
  BOOKING_NOT_RESCHEDULABLE: 'BOOKING_NOT_RESCHEDULABLE',
  CANCELLATION_POLICY_MISSING: 'CANCELLATION_POLICY_MISSING',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  REQUEST_IN_PROGRESS: 'REQUEST_IN_PROGRESS',
  // Owner booking dashboard: an unrecognized `filter` query value was supplied.
  INVALID_FILTER: 'INVALID_FILTER',
  // Customer dues + cancellation policy mission — owner ledger waive/restore mutations.
  LEDGER_ENTRY_NOT_FOUND: 'LEDGER_ENTRY_NOT_FOUND',
  // Attempted to waive a ledger entry that isn't an OUTSTANDING NO_SHOW_CHARGE, or whose customer
  // no longer qualifies for the New Customer Grace waiver (3+ COMPLETED bookings at this salon).
  LEDGER_ENTRY_NOT_WAIVABLE: 'LEDGER_ENTRY_NOT_WAIVABLE',
  // Attempted to restore a ledger entry that isn't currently WAIVED.
  LEDGER_ENTRY_NOT_RESTORABLE: 'LEDGER_ENTRY_NOT_RESTORABLE',
} as const;
export type BookingErrorCode = (typeof BookingErrorCode)[keyof typeof BookingErrorCode];

// Stable machine-readable error codes for the queue/check-in engine — same convention as
// BookingErrorCode/AuthErrorCode. Reuses BookingErrorCode.{STAFF_NOT_FOUND,STAFF_NOT_QUALIFIED,
// BOOKING_NOT_FOUND} rather than duplicating them.
export const QueueErrorCode = {
  CHAIR_NOT_FOUND: 'CHAIR_NOT_FOUND',
  CHAIR_INACTIVE: 'CHAIR_INACTIVE',
  CHAIR_ALREADY_OCCUPIED: 'CHAIR_ALREADY_OCCUPIED',
  STAFF_ALREADY_OCCUPIED: 'STAFF_ALREADY_OCCUPIED',
  SALON_ACCESS_DENIED: 'SALON_ACCESS_DENIED',
  QUEUE_ENTRY_NOT_FOUND: 'QUEUE_ENTRY_NOT_FOUND',
  SERVICE_SESSION_NOT_FOUND: 'SERVICE_SESSION_NOT_FOUND',
  INVALID_QUEUE_TRANSITION: 'INVALID_QUEUE_TRANSITION',
  ALREADY_CHECKED_IN: 'ALREADY_CHECKED_IN',
  ALREADY_IN_QUEUE: 'ALREADY_IN_QUEUE',
  CHECK_IN_TOO_EARLY: 'CHECK_IN_TOO_EARLY',
  NOT_YOUR_STAFF_PROFILE: 'NOT_YOUR_STAFF_PROFILE',
  SERVICE_REQUIRED: 'SERVICE_REQUIRED',
} as const;
export type QueueErrorCode = (typeof QueueErrorCode)[keyof typeof QueueErrorCode];

export const AuthErrorCode = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_MAX_ATTEMPTS: 'OTP_MAX_ATTEMPTS',
  OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',
  // The generated/hashed/stored OTP is fine — only SMS delivery via the configured OtpSender
  // (e.g. TwoFactorOtpSender in production) failed. Distinct from OTP_INVALID/OTP_EXPIRED, which
  // are about what the user typed, not whether the code ever reached them.
  OTP_DELIVERY_FAILED: 'OTP_DELIVERY_FAILED',
  // Google ID token failed verification (expired, malformed, wrong audience, or the provider's
  // own email_verified claim was false) — never distinguishes *which* check failed to the client.
  GOOGLE_TOKEN_INVALID: 'GOOGLE_TOKEN_INVALID',
  // POST auth/staff/google: the ID token verified fine, but no existing SALON_OWNER/SALON_STAFF
  // account is linked to (or matches the verified email of) this Google account. Deliberately
  // distinct from GOOGLE_TOKEN_INVALID — the token itself was genuine, the account just isn't
  // authorized for this login path. Never distinguishes "no such account" from "account exists
  // but isn't staff/owner" to the client, for the same reason INVALID_CREDENTIALS doesn't reveal
  // which part of email+password was wrong.
  GOOGLE_ACCOUNT_NOT_STAFF: 'GOOGLE_ACCOUNT_NOT_STAFF',
  GOOGLE_ACCOUNT_NOT_ADMIN: 'GOOGLE_ACCOUNT_NOT_ADMIN',
  TOTP_REQUIRED: 'TOTP_REQUIRED',
  TOTP_INVALID: 'TOTP_INVALID',
  TOTP_SETUP_REQUIRED: 'TOTP_SETUP_REQUIRED',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',
  RESET_TOKEN_INVALID: 'RESET_TOKEN_INVALID',
  RESET_TOKEN_EXPIRED: 'RESET_TOKEN_EXPIRED',
  PASSWORD_ALREADY_CONFIGURED: 'PASSWORD_ALREADY_CONFIGURED',
  EMAIL_DELIVERY_UNAVAILABLE: 'EMAIL_DELIVERY_UNAVAILABLE',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
} as const;
export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

// Stable machine-readable error codes for the AI Style Advisor (major-upgrade phase) — same
// convention as AuthErrorCode/BookingErrorCode.
export const StyleAdvisorErrorCode = {
  // No AiImageProvider is configured (GEMINI_API_KEY unset) — see UnconfiguredAiImageProvider.
  // Never a fake result.
  AI_PROVIDER_NOT_CONFIGURED: 'AI_PROVIDER_NOT_CONFIGURED',
  IMAGE_REQUIRED: 'IMAGE_REQUIRED',
  INVALID_IMAGE: 'INVALID_IMAGE',
  // A real provider is configured but the generation call itself failed (provider auth error,
  // malformed/empty response, network/timeout) — distinct from "not configured at all".
  AI_GENERATION_FAILED: 'AI_GENERATION_FAILED',
  // The provider's own rate limit was hit — distinct from a generic failure since it's expected
  // to be transient (try again shortly), not a persistent error.
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  // Premium phase: caller has no active CustomerSubscription at all. Distinct from
  // AI_CREDITS_EXHAUSTED (has Premium, but zero credits left) so the client can show the right
  // upsell ("go Premium" vs. "you're out of credits this period").
  PREMIUM_REQUIRED: 'PREMIUM_REQUIRED',
  AI_CREDITS_EXHAUSTED: 'AI_CREDITS_EXHAUSTED',
} as const;
export type StyleAdvisorErrorCode = (typeof StyleAdvisorErrorCode)[keyof typeof StyleAdvisorErrorCode];

// Stable machine-readable error codes for the Premium plans/subscription module — same convention
// as StyleAdvisorErrorCode.
// Stable machine-readable error codes for owner-side salon setup (Phase 11) — services, chairs,
// staff roster, and salon activation. Reuses QueueErrorCode.SALON_ACCESS_DENIED (the existing
// SalonAccessService failure) and BookingErrorCode.{SALON_NOT_FOUND,SERVICE_NOT_FOUND,
// STAFF_NOT_FOUND,CHAIR_NOT_FOUND} rather than duplicating them.
export const SalonSetupErrorCode = {
  SERVICE_ALREADY_EXISTS: 'SERVICE_ALREADY_EXISTS',
  // Another SalonStaff row at this salon is already linked to that email's User account.
  STAFF_ALREADY_EXISTS: 'STAFF_ALREADY_EXISTS',
  // The email belongs to a User that is suspended — linking would create an unusable barber.
  STAFF_ACCOUNT_UNAVAILABLE: 'STAFF_ACCOUNT_UNAVAILABLE',
  // Phone and email each resolve to a different existing User. Identities are never silently
  // merged; the owner must correct one of them.
  STAFF_IDENTITY_CONFLICT: 'STAFF_IDENTITY_CONFLICT',
  // Owner tried to open a PENDING salon that can't serve anyone yet. The error's `details` carry
  // a SalonSetupReadinessDto so the UI can tick off what's done and name what's missing, rather
  // than repeating a generic sentence.
  SALON_SETUP_INCOMPLETE: 'SALON_SETUP_INCOMPLETE',
} as const;
export type SalonSetupErrorCode = (typeof SalonSetupErrorCode)[keyof typeof SalonSetupErrorCode];

// Stable machine-readable error codes for Ratings & Reviews (Phase 16) — same convention as
// BookingErrorCode. Reuses QueueErrorCode.SALON_ACCESS_DENIED for the owner-response permission
// check (the existing SalonAccessService failure) rather than duplicating it.
export const ReviewErrorCode = {
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  // Only a COMPLETED booking can be reviewed — the service was actually received.
  BOOKING_NOT_COMPLETED: 'BOOKING_NOT_COMPLETED',
  REVIEW_ALREADY_EXISTS: 'REVIEW_ALREADY_EXISTS',
  REVIEW_NOT_FOUND: 'REVIEW_NOT_FOUND',
  // The review exists, but the caller isn't the customer who wrote it.
  NOT_YOUR_REVIEW: 'NOT_YOUR_REVIEW',
} as const;
export type ReviewErrorCode = (typeof ReviewErrorCode)[keyof typeof ReviewErrorCode];

// Phase 18 (Shop / Barber Verification Foundation) — foundation only: manual PLATFORM_ADMIN
// review of owner-supplied evidence, never automated KYC/identity verification. See
// VerificationRequest's own schema.prisma doc comment for the full lifecycle rationale.
export const VerificationSubjectType = {
  SHOP: 'SHOP',
  PROFESSIONAL: 'PROFESSIONAL',
} as const;
export type VerificationSubjectType =
  (typeof VerificationSubjectType)[keyof typeof VerificationSubjectType];

// NOT_SUBMITTED is never a stored value — see VerificationRequest's own doc comment: absence of a
// row IS "not submitted," the same "no row = default" convention used elsewhere in this schema.
export const VerificationStatus = {
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

export const VerificationErrorCode = {
  SALON_NOT_FOUND: 'SALON_NOT_FOUND',
  STAFF_NOT_FOUND: 'STAFF_NOT_FOUND',
  VERIFICATION_NOT_FOUND: 'VERIFICATION_NOT_FOUND',
  // A SUBMITTED or UNDER_REVIEW request already exists for this subject — resubmission is only
  // allowed after a REJECTED outcome (or before any submission at all).
  VERIFICATION_ALREADY_PENDING: 'VERIFICATION_ALREADY_PENDING',
  // Already APPROVED — re-verifying something already approved isn't a supported flow here.
  VERIFICATION_ALREADY_APPROVED: 'VERIFICATION_ALREADY_APPROVED',
  // e.g. deciding a request that isn't UNDER_REVIEW, or starting review on one that isn't SUBMITTED.
  INVALID_VERIFICATION_TRANSITION: 'INVALID_VERIFICATION_TRANSITION',
} as const;
export type VerificationErrorCode =
  (typeof VerificationErrorCode)[keyof typeof VerificationErrorCode];

export const PremiumErrorCode = {
  PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
  // The dev-only test-activation endpoint was called outside a non-production environment — see
  // PremiumController's dev-activate route, which is unreachable in production by design.
  DEV_ACTIVATION_DISABLED: 'DEV_ACTIVATION_DISABLED',
} as const;
export type PremiumErrorCode = (typeof PremiumErrorCode)[keyof typeof PremiumErrorCode];
