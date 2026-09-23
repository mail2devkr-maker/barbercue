import { parseCustomerBookingPushData, parseOwnerBookingPushData } from '../push-navigation';

describe('owner booking push payload parsing', () => {
  it.each(['booking.created', 'booking.rescheduled', 'booking.cancelled', 'booking.arrival_check'] as const)('accepts %s', (type) => {
    expect(parseOwnerBookingPushData({ type, salonId: 's1', bookingId: 'b1' })).toEqual({ type, salonId: 's1', bookingId: 'b1' });
  });

  it('rejects unrelated or malformed payloads', () => {
    expect(parseOwnerBookingPushData({ type: 'queue.updated', salonId: 's1', bookingId: 'b1' })).toBeNull();
    expect(parseOwnerBookingPushData({ type: 'booking.cancelled', salonId: '', bookingId: 'b1' })).toBeNull();
  });

  it('accepts only IDs-only customer reminder payloads', () => {
    expect(parseCustomerBookingPushData({ type: 'booking.reminder', salonId: 's1', bookingId: 'b1' })).toEqual({
      type: 'booking.reminder', salonId: 's1', bookingId: 'b1',
    });
    expect(parseCustomerBookingPushData({ type: 'booking.reminder', salonId: '', bookingId: 'b1' })).toBeNull();
    expect(parseCustomerBookingPushData({ type: 'booking.created', salonId: 's1', bookingId: 'b1' })).toBeNull();
  });
});
