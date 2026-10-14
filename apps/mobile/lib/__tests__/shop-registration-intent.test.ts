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

  it('starts at the email/password owner signup (never customer Google login) and replays the new owner into Register Shop', () => {
    expect(beginShopRegistrationAuthentication()).toBe('OwnerRegister');

    // The destination is not consumed by the signup screen itself. RootNavigator only takes it after
    // AuthProvider has actually moved to authenticated state.
    const intent = takePendingCustomerDestination();
    expect(intent).toEqual({ kind: 'registerShop' });
    expect(resolvePostAuthCustomerNavigation(intent!, true)).toEqual({
      tab: 'AccountTab',
      screen: 'RegisterShop',
    });
  });
});
