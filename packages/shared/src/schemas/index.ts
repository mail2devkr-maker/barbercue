import { z } from 'zod';
import { ChargeType, PrepaymentRequirement } from '../enums';

// Validation schemas shared by the backend (request validation) and clients (form validation).
// The backend is always the authority — these schemas exist so both sides reject bad input the
// same way before a request ever reaches the server, not to move validation off the server.

export const createBookingSchema = z.object({
  salonId: z.string().uuid(),
  serviceId: z.string().uuid(),
  slotStart: z.string().datetime(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const joinQueueSchema = z.object({
  serviceId: z.string().uuid().optional(),
});
export type JoinQueueInput = z.infer<typeof joinQueueSchema>;

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
