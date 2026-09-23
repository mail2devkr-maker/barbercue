interface OwnerBookingPushBase {
  salonId: string;
  bookingId: string;
}
// A discriminated union (not one interface with a union-typed `type`), so checking
// `payload.type === 'booking.arrival_check'` narrows the whole payload at every call site.
export type OwnerBookingPushData =
  | (OwnerBookingPushBase & { type: 'booking.created' })
  | (OwnerBookingPushBase & { type: 'booking.rescheduled' })
  | (OwnerBookingPushBase & { type: 'booking.cancelled' })
  | (OwnerBookingPushBase & { type: 'booking.arrival_check' });
type OwnerBookingPushListener = (payload: OwnerBookingPushData) => boolean;

export type CustomerBookingPushData = {
  type: 'booking.reminder';
  salonId: string;
  bookingId: string;
};
type CustomerBookingPushListener = (payload: CustomerBookingPushData) => boolean;

let pendingOwnerBookingPush: OwnerBookingPushData | null = null;
const ownerBookingPushListeners = new Set<OwnerBookingPushListener>();
let pendingCustomerBookingPush: CustomerBookingPushData | null = null;
const customerBookingPushListeners = new Set<CustomerBookingPushListener>();

/**
 * Narrowly accepts the IDs-only booking payload the backend emits. Notification data is an
 * untrusted transport boundary, so it must never become a navigation target without shape
 * validation first.
 */
export function parseOwnerBookingPushData(value: unknown): OwnerBookingPushData | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (
    data.type !== 'booking.created' &&
    data.type !== 'booking.rescheduled' &&
    data.type !== 'booking.cancelled' &&
    data.type !== 'booking.arrival_check'
  ) return null;
  if (typeof data.salonId !== 'string' || data.salonId.length === 0) return null;
  if (typeof data.bookingId !== 'string' || data.bookingId.length === 0) return null;
  return { type: data.type, salonId: data.salonId, bookingId: data.bookingId };
}

export function requestOwnerBookingPushNavigation(payload: OwnerBookingPushData): void {
  pendingOwnerBookingPush = payload;
  replayPendingOwnerBookingPushNavigation();
}

export function parseCustomerBookingPushData(value: unknown): CustomerBookingPushData | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.type !== 'booking.reminder') return null;
  if (typeof data.salonId !== 'string' || data.salonId.length === 0) return null;
  if (typeof data.bookingId !== 'string' || data.bookingId.length === 0) return null;
  return { type: 'booking.reminder', salonId: data.salonId, bookingId: data.bookingId };
}

export function requestCustomerBookingPushNavigation(payload: CustomerBookingPushData): void {
  pendingCustomerBookingPush = payload;
  replayPendingCustomerBookingPushNavigation();
}

export function subscribeToCustomerBookingPushNavigation(listener: CustomerBookingPushListener): () => void {
  customerBookingPushListeners.add(listener);
  replayPendingCustomerBookingPushNavigation();
  return () => customerBookingPushListeners.delete(listener);
}

export function replayPendingCustomerBookingPushNavigation(): void {
  if (!pendingCustomerBookingPush) return;
  for (const listener of customerBookingPushListeners) {
    if (listener(pendingCustomerBookingPush)) {
      pendingCustomerBookingPush = null;
      return;
    }
  }
}

/**
 * Returns a disposer. The listener returns true only after it has safely selected a salon and
 * navigated; until then the payload remains queued for cold starts and auth restoration.
 */
export function subscribeToOwnerBookingPushNavigation(listener: OwnerBookingPushListener): () => void {
  ownerBookingPushListeners.add(listener);
  replayPendingOwnerBookingPushNavigation();
  return () => ownerBookingPushListeners.delete(listener);
}

export function replayPendingOwnerBookingPushNavigation(): void {
  if (!pendingOwnerBookingPush) return;
  for (const listener of ownerBookingPushListeners) {
    if (listener(pendingOwnerBookingPush)) {
      pendingOwnerBookingPush = null;
      return;
    }
  }
}
