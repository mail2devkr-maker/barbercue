import {
  stashPendingCustomerDestination,
  takePendingCustomerDestination,
} from './customer-navigation-intent';

// "Register your shop" is a dedicated owner-account creation path. The signup endpoint creates
// only the authenticated onboarding account; POST /salons later grants the real salon-scoped
// SALON_OWNER role and fresh STAFF-audience session. The pending intent survives AuthStack being
// replaced after signup, then RootNavigator replays it into RegisterShop.
export function stashPendingShopRegistrationIntent(): void {
  stashPendingCustomerDestination({ kind: 'registerShop' });
}

/** Starts the protected onboarding auth handoff and returns the exact auth-stack route to open. */
export function beginShopRegistrationAuthentication(): 'OwnerRegister' {
  stashPendingShopRegistrationIntent();
  return 'OwnerRegister';
}

/** Consumes the stash — at most one replay per stashed intent, never re-fired on a later remount. */
export function takePendingShopRegistrationIntent(): boolean {
  return takePendingCustomerDestination()?.kind === 'registerShop';
}
