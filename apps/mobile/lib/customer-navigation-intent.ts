export type PendingCustomerDestination = { kind: 'credits' };

let pendingCustomerDestination: PendingCustomerDestination | null = null;

/** Stashes one authenticated-customer destination to replay after the auth navigator is replaced. */
export function stashPendingCustomerDestination(intent: PendingCustomerDestination): void {
  pendingCustomerDestination = intent;
}

/** Consumes the stash once so a later unrelated auth remount cannot replay an old destination. */
export function takePendingCustomerDestination(): PendingCustomerDestination | null {
  const intent = pendingCustomerDestination;
  pendingCustomerDestination = null;
  return intent;
}
