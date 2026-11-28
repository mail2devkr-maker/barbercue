import { isBookingSlotInFuture, isCustomerBookingActionable, isCustomerBookingUpcoming } from '../customer-bookings';

const now = new Date('2026-09-23T12:00:00.000Z');

describe('customer booking time gates', () => {
  it('classifies a future eligible booking as upcoming/actionable', () => {
    const booking = { status: 'CONFIRMED', slotStart: '2026-09-23T12:15:00.000Z' };
    expect(isCustomerBookingUpcoming(booking, now)).toBe(true);
    expect(isCustomerBookingActionable(booking, now)).toBe(true);
  });

  it('classifies a past eligible booking as history and not actionable', () => {
    const booking = { status: 'CONFIRMED', slotStart: '2026-09-23T11:59:59.999Z' };
    expect(isCustomerBookingUpcoming(booking, now)).toBe(false);
    expect(isCustomerBookingActionable(booking, now)).toBe(false);
  });

  it('does not make terminal bookings actionable even when their slot is future', () => {
    expect(isCustomerBookingUpcoming({ status: 'CANCELLED', slotStart: '2026-09-23T12:15:00.000Z' }, now)).toBe(false);
    expect(isCustomerBookingUpcoming({ status: 'COMPLETED', slotStart: '2026-09-23T12:15:00.000Z' }, now)).toBe(false);
  });

  it('uses absolute instants, independent of display timezone', () => {
    expect(isBookingSlotInFuture('2026-09-23T12:00:00.001Z', now)).toBe(true);
    expect(isBookingSlotInFuture('2026-09-23T11:59:59.999Z', now)).toBe(false);
  });
});
