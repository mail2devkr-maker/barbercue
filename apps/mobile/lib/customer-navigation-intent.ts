export type PendingCustomerDestination = { kind: 'credits' } | { kind: 'registerShop' };
export type PostAuthCustomerNavigation =
  | { tab: 'AccountTab'; screen: 'CreditsHistory' }
  | { tab: 'AccountTab'; screen: 'RegisterShop' };

let pendingCustomerDestination: PendingCustomerDestination | null = null;

/**
 * Stashes one authenticated-customer destination to replay after the auth navigator is replaced.
 * Stashing a new destination intentionally supersedes any older one, so cancelled/backtracked
 * auth flows can never replay two destinations after the next successful login.
 */
export function stashPendingCustomerDestination(intent: PendingCustomerDestination): void {
  pendingCustomerDestination = intent;
}

/** Consumes the stash once so a later unrelated auth remount cannot replay an old destination. */
export function takePendingCustomerDestination(): PendingCustomerDestination | null {
  const intent = pendingCustomerDestination;
  pendingCustomerDestination = null;
  return intent;
}

/**
 * The only mapping from a signed-out customer action to its authenticated destination. Keeping it
 * pure lets the onboarding golden-path test assert the same destination RootNavigator executes.
 */
export function resolvePostAuthCustomerNavigation(
  intent: PendingCustomerDestination,
  creditsEnabled: boolean,
): PostAuthCustomerNavigation | null {
  if (intent.kind === 'credits') {
    return creditsEnabled ? { tab: 'AccountTab', screen: 'CreditsHistory' } : null;
  }
  return { tab: 'AccountTab', screen: 'RegisterShop' };
}
