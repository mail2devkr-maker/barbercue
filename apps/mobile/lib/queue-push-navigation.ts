/**
 * Queue arrival pushes are data-only navigation requests. Never trust a push body for customer
 * identity, status, or ETA; the authenticated destination reloads its own server-authorized data.
 * Persist in memory until the role-specific navigator is mounted after cold-start auth restore.
 */
export type QueueArrivalPushData = {
  type: 'queue.arrival_check';
  salonId: string;
  queueEntryId: string;
};

type Listener = (payload: QueueArrivalPushData) => boolean;
let pendingOwner: QueueArrivalPushData | null = null;
let pendingCustomer: QueueArrivalPushData | null = null;
let pendingGuest: QueueArrivalPushData | null = null;
const ownerListeners = new Set<Listener>();
const customerListeners = new Set<Listener>();
const guestListeners = new Set<Listener>();

export function parseQueueArrivalPushData(raw: unknown): QueueArrivalPushData | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.type !== 'queue.arrival_check') return null;
  if (typeof value.salonId !== 'string' || value.salonId.length === 0) return null;
  if (typeof value.queueEntryId !== 'string' || value.queueEntryId.length === 0) return null;
  return {
    type: 'queue.arrival_check',
    salonId: value.salonId,
    queueEntryId: value.queueEntryId,
  };
}

function replay(target: 'owner' | 'customer' | 'guest') {
  const pending = target === 'owner' ? pendingOwner : target === 'customer' ? pendingCustomer : pendingGuest;
  if (!pending) return;
  const listeners = target === 'owner' ? ownerListeners : target === 'customer' ? customerListeners : guestListeners;
  for (const listener of listeners) {
    if (listener(pending)) {
      if (target === 'owner') pendingOwner = null;
      else if (target === 'customer') pendingCustomer = null;
      else pendingGuest = null;
      return;
    }
  }
}

export function requestQueueArrivalNavigation(target: 'owner' | 'customer' | 'guest', payload: QueueArrivalPushData): void {
  if (target === 'owner') pendingOwner = payload;
  else if (target === 'customer') pendingCustomer = payload;
  else pendingGuest = payload;
  replay(target);
}

export function subscribeQueueArrivalNavigation(target: 'owner' | 'customer' | 'guest', listener: Listener): () => void {
  const set = target === 'owner' ? ownerListeners : target === 'customer' ? customerListeners : guestListeners;
  set.add(listener);
  replay(target);
  return () => set.delete(listener);
}
