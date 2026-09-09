import { z } from 'zod';
import type { BookingDetailDto, BookingPaymentInfoDto } from './types';

// Deliberately PSP-neutral: one @, no whitespace, URL delimiters or control characters.
export const upiVpaSchema = z.string().trim().min(3).max(255)
  .regex(/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/, 'Enter a valid UPI ID, such as merchant@bank.');
export const upiPayeeNameSchema = z.string().trim().min(1).max(100)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Payee name contains invalid characters.');

const emptyToNull = (value: unknown) => typeof value === 'string' && !value.trim() ? null : value;
export const setSalonUpiSchema = z.object({
  upiVpa: z.preprocess(emptyToNull, upiVpaSchema.nullable()),
  upiPayeeName: z.preprocess(emptyToNull, upiPayeeNameSchema.nullable()),
}).strict().refine((value) => !value.upiVpa || !!value.upiPayeeName, {
  path: ['upiPayeeName'], message: 'Enter the business/payee name for this UPI ID.',
});
export type SetSalonUpiInput = z.infer<typeof setSalonUpiSchema>;

export const UPI_PAYMENT_NOTICE = 'Complete payment in your UPI app. FastQue does not automatically verify this payment yet.';
export const UPI_FALLBACK_NOTICE = 'If no UPI app opens, scan the shop QR or use the UPI ID in your payment app. Check the recipient and exact amount before paying.';

type CreatedBooking = Pick<BookingDetailDto, 'id' | 'status' | 'payableAmount'>;

/** Accept only a real booking response, never a service price or credit estimate. No side effects. */
export function canLaunchBookingUpi(booking: CreatedBooking | null, info: BookingPaymentInfoDto | null): boolean {
  if (!booking?.id || !['CONFIRMED', 'PENDING_PAYMENT'].includes(booking.status)) return false;
  if (!info?.onlinePaymentAvailable || !info.paymentQrImageUrl || info.currency !== 'INR') return false;
  if (!upiVpaSchema.safeParse(info.upiVpa).success || !upiPayeeNameSchema.safeParse(info.upiPayeeName).success) return false;
  const amount = booking.payableAmount;
  // Reject, rather than silently round, a value outside the server's two-decimal money contract.
  return Number.isFinite(amount) && amount > 0 && amount <= 99999999.99
    && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001;
}

/** Reference is a fresh UUID per user launch, supplied by the platform's existing crypto API.
 * FQ + 32 hex digits fits NPCI's 35-character transaction-reference limit. Not a Payment record. */
export function buildBookingUpiUri(booking: CreatedBooking | null, info: BookingPaymentInfoDto | null, attemptId: string): string | null {
  if (!canLaunchBookingUpi(booking, info) || !booking || !info) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)) return null;
  const fields = {
    pa: upiVpaSchema.parse(info.upiVpa),
    pn: upiPayeeNameSchema.parse(info.upiPayeeName),
    tr: `FQ${attemptId.replace(/-/g, '')}`,
    tn: `FastQue booking ${booking.id.slice(0, 8)}`,
    am: booking.payableAmount.toFixed(2),
    cu: 'INR',
  };
  return `upi://pay?${Object.entries(fields).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`;
}
