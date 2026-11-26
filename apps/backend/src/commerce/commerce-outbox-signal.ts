/**
 * Wake-up signal for the commerce outbox sweep. The sweep only touches the database while armed, so
 * an idle site lets the database compute sleep. Anything that can create outbox work (an outbox row,
 * a salon marketplace order event) arms it; the sweep disarms itself once nothing is left to send.
 * A plain module flag, not a provider, so the shop module can arm it without a module dependency.
 */
let armed = true; // one sweep after boot picks up anything left from before a restart
let seq = 0;

export function armCommerceOutbox(): void {
  armed = true;
  seq += 1;
}

export function commerceOutboxArmed(): boolean {
  return armed;
}

export function commerceOutboxSeq(): number {
  return seq;
}

/** Disarms only if nothing armed it again while the sweep was running. */
export function disarmCommerceOutbox(seqAtStart: number): void {
  if (seq === seqAtStart) armed = false;
}
