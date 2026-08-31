import { buildPushContent, formatSalonLocalSlot } from './push-content';

describe('push notification content', () => {
  it('formats appointment time deliberately in the salon IANA timezone', () => {
    expect(
      formatSalonLocalSlot('2026-09-01T14:00:00.000Z', 'Asia/Kolkata'),
    ).toContain('7:30 pm');
    expect(
      formatSalonLocalSlot('2026-09-01T14:00:00.000Z', 'America/New_York'),
    ).toContain('10:00 am');
  });

  it('creates privacy-safe owner heads-up text and keeps ids only in data', () => {
    const content = buildPushContent('owner.booking.created', {
      salonId: 'salon-private-id',
      bookingId: 'booking-private-id',
      serviceName: 'Haircut',
      customerDisplayName: 'Devdutta',
      slotStart: '2026-09-01T14:00:00.000Z',
      salonTimezone: 'Asia/Kolkata',
      durationMinutes: 30,
      phone: '+919999999999',
      email: 'private@example.com',
      servicePrice: 500,
      currency: 'INR',
    });
    expect(content.title).toBe('New booking');
    expect(content.body).toContain('₹500');
    expect(content.body).toContain('Haircut');
    expect(content.body).not.toContain('salon-private-id');
    expect(content.body).not.toContain('+919999999999');
    expect(content.body).not.toContain('private@example.com');
    expect(content.data).toEqual(
      expect.objectContaining({
        bookingId: 'booking-private-id',
        salonId: 'salon-private-id',
        screen: 'OWNER_BOOKINGS',
      }),
    );
  });

  it('maps each required actor event to the correct mobile destination', () => {
    expect(buildPushContent('booking.confirmed', {}).data.screen).toBe(
      'CUSTOMER_BOOKING',
    );
    expect(buildPushContent('queue.turn_approaching', {}).data.screen).toBe(
      'CUSTOMER_QUEUE',
    );
    expect(buildPushContent('owner.walk_in.joined', {}).data.screen).toBe(
      'OWNER_QUEUE',
    );
    expect(buildPushContent('staff.assigned', {}).data.screen).toBe(
      'STAFF_TODAY',
    );
  });
});
