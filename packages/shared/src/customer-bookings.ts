/**
 * Customer-facing booking time gates use the absolute appointment instant. Display formatting
 * may use the salon's timezone, but whether an appointment is still actionable must never depend
 * on the device or salon calendar date.
 */
const CUSTOMER_ACTIONABLE_STATUSES = new Set(['CONFIRMED', 'PENDING_PAYMENT']);

export function isBookingSlotInFuture(slotStart: string | Date, now: Date = new Date()): boolean {
  const startMs = typeof slotStart === 'string' ? Date.parse(slotStart) : slotStart.getTime();
  return Number.isFinite(startMs) && startMs > now.getTime();
}

export function isCustomerBookingUpcoming(
  booking: { status: string; slotStart: string | Date },
  now: Date = new Date(),
): boolean {
  return CUSTOMER_ACTIONABLE_STATUSES.has(booking.status) && isBookingSlotInFuture(booking.slotStart, now);
}

export function isCustomerBookingActionable(
  booking: { status: string; slotStart: string | Date },
  now: Date = new Date(),
): boolean {
  return isCustomerBookingUpcoming(booking, now);
}
