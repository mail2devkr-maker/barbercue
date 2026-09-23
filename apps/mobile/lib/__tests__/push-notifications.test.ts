import { Role } from '@barbercue/shared';
import { isPushEligibleUser } from '../push-notifications';

const user = (roles: string[]) => ({ id: 'u1', roles } as never);

describe('native push registration eligibility', () => {
  it('allows customer devices to register for booking reminders', () => {
    expect(isPushEligibleUser(user([Role.CUSTOMER]))).toBe(true);
  });

  it('preserves owner and staff eligibility', () => {
    expect(isPushEligibleUser(user([Role.SALON_OWNER]))).toBe(true);
    expect(isPushEligibleUser(user([Role.SALON_STAFF]))).toBe(true);
  });

  it('does not register unauthenticated users', () => {
    expect(isPushEligibleUser(null)).toBe(false);
  });
});
