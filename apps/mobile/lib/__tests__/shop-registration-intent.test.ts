import {
  beginShopRegistrationAuthentication,
  stashPendingShopRegistrationIntent,
  takePendingShopRegistrationIntent,
} from '../shop-registration-intent';
import { resolvePostAuthCustomerNavigation, takePendingCustomerDestination } from '../customer-navigation-intent';

describe('shop-registration-intent', () => {
  it('take returns false when nothing was stashed', () => {
    expect(takePendingShopRegistrationIntent()).toBe(false);
  });

  it('take returns true exactly once after a stash — a second take does not re-fire it', () => {
    stashPendingShopRegistrationIntent();

    expect(takePendingShopRegistrationIntent()).toBe(true);
    expect(takePendingShopRegistrationIntent()).toBe(false);
  });

  it('stashing again after a take can be replayed independently', () => {
    stashPendingShopRegistrationIntent();
    takePendingShopRegistrationIntent();

    stashPendingShopRegistrationIntent();
    expect(takePendingShopRegistrationIntent()).toBe(true);
  });

  it('starts at customer login and replays the authenticated user into Register Shop', () => {
    expect(beginShopRegistrationAuthentication()).toBe('CustomerLogin');

    // Google errors and cancellations do not consume this module-level intent. RootNavigator only
    // takes it after AuthProvider has actually moved to authenticated state.
    const intent = takePendingCustomerDestination();
    expect(intent).toEqual({ kind: 'registerShop' });
    expect(resolvePostAuthCustomerNavigation(intent!, true)).toEqual({
      tab: 'AccountTab',
      screen: 'RegisterShop',
    });
  });
});
