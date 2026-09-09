import { __resetBookingVoiceDedupeForTests, claimBookingVoiceEvent } from '../booking-voice-dedupe';

describe('booking voice cross-channel dedupe', () => {
  beforeEach(__resetBookingVoiceDedupeForTests);

  it('collapses websocket/push duplicates for the same lifecycle event', () => {
    expect(claimBookingVoiceEvent('booking.cancelled', 'b1', undefined, 1_000)).toBe(true);
    expect(claimBookingVoiceEvent('booking.cancelled', 'b1', undefined, 1_100)).toBe(false);
  });

  it('does not suppress cancellation after a reschedule of the same booking', () => {
    expect(claimBookingVoiceEvent('booking.rescheduled', 'b1', 'slot-a', 1_000)).toBe(true);
    expect(claimBookingVoiceEvent('booking.cancelled', 'b1', undefined, 1_100)).toBe(true);
  });

  it('allows two distinct reschedules of the same booking when the new slot differs', () => {
    expect(claimBookingVoiceEvent('booking.rescheduled', 'b1', 'slot-a', 1_000)).toBe(true);
    expect(claimBookingVoiceEvent('booking.rescheduled', 'b1', 'slot-b', 1_100)).toBe(true);
  });
});
