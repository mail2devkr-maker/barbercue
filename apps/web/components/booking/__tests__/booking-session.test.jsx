import { SessionAudience } from '@barbercue/shared';
import { hasCustomerBookingSession } from '../booking-session';

const user = (audience) => ({ audience });

describe('customer booking session gate', () => {
  it('accepts only an authenticated CUSTOMER-audience session', () => {
    expect(hasCustomerBookingSession('authenticated', user(SessionAudience.CUSTOMER))).toBe(true);
    expect(hasCustomerBookingSession('authenticated', user(SessionAudience.STAFF))).toBe(false);
    expect(hasCustomerBookingSession('authenticated', user(SessionAudience.ADMIN))).toBe(false);
  });

  it('rejects loading, unauthenticated, and missing-user states', () => {
    expect(hasCustomerBookingSession('loading', user(SessionAudience.CUSTOMER))).toBe(false);
    expect(hasCustomerBookingSession('unauthenticated', user(SessionAudience.CUSTOMER))).toBe(false);
    expect(hasCustomerBookingSession('authenticated', null)).toBe(false);
  });
});
