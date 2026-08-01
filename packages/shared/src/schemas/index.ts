import { z } from 'zod';
import { ChargeType, PrepaymentRequirement, StaffMemberStatus } from '../enums';

// Validation schemas shared by the backend (request validation) and clients (form validation).
// The backend is always the authority — these schemas exist so both sides reject bad input the
// same way before a request ever reaches the server, not to move validation off the server.

export const createBookingSchema = z.object({
  salonId: z.string().uuid(),
  serviceId: z.string().uuid(),
  slotStart: z.string().datetime(),
  // Soft preference only ("Any Staff" = omitted) — see DATABASE.md's Booking section.
  preferredStaffId: z.string().uuid().optional(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// GET /salons/:salonId/availability query params.
export const availabilityQuerySchema = z.object({
  serviceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format'),
  staffId: z.string().uuid().optional(),
});
export type AvailabilityQueryInput = z.infer<typeof availabilityQuerySchema>;

// GET /salons/:salonId/staff query params.
export const staffListQuerySchema = z.object({
  serviceId: z.string().uuid(),
});
export type StaffListQueryInput = z.infer<typeof staffListQuerySchema>;

export const joinQueueSchema = z.object({
  serviceId: z.string().uuid().optional(),
});
export type JoinQueueInput = z.infer<typeof joinQueueSchema>;

// POST /dashboard/queue-entries/:id/assign — serviceId is only required when the queue entry
// itself has none (e.g. a walk-in that never picked one); validated in the service layer, not
// here, since that depends on the target entry's existing state.
export const assignQueueEntrySchema = z.object({
  staffId: z.string().uuid(),
  chairId: z.string().uuid(),
  serviceId: z.string().uuid().optional(),
});
export type AssignQueueEntryInput = z.infer<typeof assignQueueEntrySchema>;

// PATCH /dashboard/staff/:id/status
export const staffStatusSchema = z.object({
  status: z.nativeEnum(StaffMemberStatus),
});
export type StaffStatusInput = z.infer<typeof staffStatusSchema>;

// GET /salons query params — validated the same way on backend (ZodValidationPipe on @Query())
// and client (search form) so both agree on shape before a request is ever made.
export const salonSearchQuerySchema = z.object({
  city: z.string().optional(),
  locality: z.string().optional(),
  service: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type SalonSearchQueryInput = z.infer<typeof salonSearchQuerySchema>;

export const otpRequestSchema = z.object({
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, 'phone must be in E.164 format, e.g. +919876543210'),
});
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  phone: z.string(),
  code: z.string().length(6),
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

// Shared password rule: staff/owner/admin accounts only (customers never have a password).
const passwordSchema = z
  .string()
  .min(8, 'password must be at least 8 characters')
  .max(72, 'password must be at most 72 characters'); // bcrypt truncates beyond 72 bytes

export const staffLoginSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
});
export type StaffLoginInput = z.infer<typeof staffLoginSchema>;

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  // Optional at the schema layer so the service can distinguish "missing TOTP" (→
  // TOTP_REQUIRED) from "wrong shape" (→ 400) rather than zod rejecting the request outright.
  totpCode: z
    .string()
    .regex(/^\d{6}$/, 'totpCode must be 6 digits')
    .optional(),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export const refreshRequestSchema = z.object({
  // Optional: web relies on the httpOnly refresh cookie instead of sending this in the body.
  refreshToken: z.string().optional(),
});
export type RefreshRequestInput = z.infer<typeof refreshRequestSchema>;

export const logoutRequestSchema = z.object({
  refreshToken: z.string().optional(),
});
export type LogoutRequestInput = z.infer<typeof logoutRequestSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const salonPaymentPolicySchema = z
  .object({
    prepaymentRequirement: z.nativeEnum(PrepaymentRequirement),
    prepaymentPercentage: z.number().int().min(1).max(100).optional(),
  })
  .refine(
    (val) => val.prepaymentRequirement !== PrepaymentRequirement.PARTIAL || !!val.prepaymentPercentage,
    { message: 'prepaymentPercentage is required when prepaymentRequirement is PARTIAL', path: ['prepaymentPercentage'] },
  );
export type SalonPaymentPolicyInput = z.infer<typeof salonPaymentPolicySchema>;

export const cancellationPolicySchema = z.object({
  freeCancellationWindowMinutes: z.number().int().min(0),
  lateCancellationChargeType: z.nativeEnum(ChargeType),
  lateCancellationChargeValue: z.number().min(0),
  noShowChargeType: z.nativeEnum(ChargeType),
  noShowChargeValue: z.number().min(0),
  appointmentArrivalGraceMinutes: z.number().int().min(0),
  queueCallResponseGraceMinutes: z.number().int().min(0),
});
export type CancellationPolicyInput = z.infer<typeof cancellationPolicySchema>;
