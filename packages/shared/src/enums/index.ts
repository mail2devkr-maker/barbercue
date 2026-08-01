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

export const OtpPurpose = {
  LOGIN: 'LOGIN',
  SIGNUP: 'SIGNUP',
} as const;
export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];

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

export const ChairStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  MAINTENANCE: 'MAINTENANCE',
} as const;
export type ChairStatus = (typeof ChairStatus)[keyof typeof ChairStatus];

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
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
} as const;
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

// Stable machine-readable error codes for authentication — API.md's convention: clients branch on
// `error.code`, never on `error.message`. Shared so backend and every client agree on the exact
// strings.
export const AuthErrorCode = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_MAX_ATTEMPTS: 'OTP_MAX_ATTEMPTS',
  OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',
  TOTP_REQUIRED: 'TOTP_REQUIRED',
  TOTP_INVALID: 'TOTP_INVALID',
  TOTP_SETUP_REQUIRED: 'TOTP_SETUP_REQUIRED',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',
  RESET_TOKEN_INVALID: 'RESET_TOKEN_INVALID',
  RESET_TOKEN_EXPIRED: 'RESET_TOKEN_EXPIRED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
} as const;
export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];
