export interface OwnerBookingPushData {
  type: 'booking.created';
  salonId: string;
  bookingId: string;
}
type OwnerBookingPushListener = (payload: OwnerBookingPushData) => boolean;

let pendingOwnerBookingPush: OwnerBookingPushData | null = null;
const ownerBookingPushListeners = new Set<OwnerBookingPushListener>();

/**
 * Narrowly accepts the IDs-only booking payload the backend emits. Notification data is an
 * untrusted transport boundary, so it must never become a navigation target without shape
 * validation first.
 */
export function parseOwnerBookingPushData(value: unknown): OwnerBookingPushData | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.type !== 'booking.created') return null;
  if (typeof data.salonId !== 'string' || data.salonId.length === 0) return null;
  if (typeof data.bookingId !== 'string' || data.bookingId.length === 0) return null;
  return { type: 'booking.created', salonId: data.salonId, bookingId: data.bookingId };
}

export function requestOwnerBookingPushNavigation(payload: OwnerBookingPushData): void {
  pendingOwnerBookingPush = payload;
  replayPendingOwnerBookingPushNavigation();
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
