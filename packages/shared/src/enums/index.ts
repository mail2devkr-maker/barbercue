// Enums mirrored from DATABASE.md / STATE_MACHINES.md. This package holds shapes only — no I/O,
// no framework imports — so it can be consumed unmodified by NestJS, Next.js, and Expo alike.

export enum Role {
  CUSTOMER = 'CUSTOMER',
  SALON_STAFF = 'SALON_STAFF',
  SALON_OWNER = 'SALON_OWNER',
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
}

export enum SalonStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export enum SalonStaffRole {
  OWNER = 'OWNER',
  MANAGER = 'MANAGER',
  BARBER = 'BARBER',
}

export enum ChairStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  MAINTENANCE = 'MAINTENANCE',
}

export enum PrepaymentRequirement {
  NONE = 'NONE',
  OPTIONAL = 'OPTIONAL',
  PARTIAL = 'PARTIAL',
  FULL = 'FULL',
}

export enum BookingStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
  NO_SHOW = 'NO_SHOW',
  EXPIRED = 'EXPIRED',
}

export enum BookingSource {
  APP = 'APP',
  WEB = 'WEB',
  WALK_IN = 'WALK_IN',
}

export enum QueueEntrySource {
  WALK_IN = 'WALK_IN',
  APPOINTMENT = 'APPOINTMENT',
}

export enum QueueEntryStatus {
  WAITING = 'WAITING',
  CALLED = 'CALLED',
  IN_SERVICE = 'IN_SERVICE',
  COMPLETED = 'COMPLETED',
  NO_SHOW = 'NO_SHOW',
  CANCELLED = 'CANCELLED',
}

export enum ServiceSessionStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum ChargeType {
  FLAT = 'FLAT',
  PERCENTAGE = 'PERCENTAGE',
}

export enum PaymentType {
  BOOKING_PAYMENT = 'BOOKING_PAYMENT',
  CANCELLATION_CHARGE = 'CANCELLATION_CHARGE',
}

export enum PaymentProvider {
  RAZORPAY = 'RAZORPAY',
}

export enum PaymentStatus {
  CREATED = 'CREATED',
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
}

export enum RefundStatus {
  INITIATED = 'INITIATED',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

export enum LedgerReason {
  CANCELLATION_CHARGE = 'CANCELLATION_CHARGE',
  NO_SHOW_CHARGE = 'NO_SHOW_CHARGE',
}

export enum LedgerStatus {
  OUTSTANDING = 'OUTSTANDING',
  SETTLED = 'SETTLED',
  WAIVED = 'WAIVED',
}

export enum SubscriptionStatus {
  PILOT = 'PILOT',
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  EXPIRED = 'EXPIRED',
}

export enum NotificationChannel {
  SMS = 'SMS',
  PUSH = 'PUSH',
  EMAIL = 'EMAIL',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}
