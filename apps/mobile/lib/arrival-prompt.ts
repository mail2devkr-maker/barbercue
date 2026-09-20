export type OwnerArrivalPromptInitialAction = 'arrived' | 'not-arrived' | null;

export interface OwnerArrivalPromptRequest {
  type: 'booking.arrival_check';
  salonId: string;
  bookingId: string;
  initialAction?: OwnerArrivalPromptInitialAction;
}

type OwnerArrivalPromptListener = (request: OwnerArrivalPromptRequest) => boolean;

let pendingRequest: OwnerArrivalPromptRequest | null = null;
const listeners = new Set<OwnerArrivalPromptListener>();

/**
 * Queues an arrival-check prompt until the authenticated owner shell is mounted. This is used by
 * foreground push delivery, notification taps/actions and the in-app Notification Center.
 */
export function requestOwnerArrivalPrompt(request: OwnerArrivalPromptRequest): void {
  pendingRequest = request;
  replayPendingOwnerArrivalPrompt();
}

export function subscribeToOwnerArrivalPrompt(listener: OwnerArrivalPromptListener): () => void {
  listeners.add(listener);
  replayPendingOwnerArrivalPrompt();
  return () => listeners.delete(listener);
}

export function replayPendingOwnerArrivalPrompt(): void {
  if (!pendingRequest) return;
  for (const listener of listeners) {
    if (listener(pendingRequest)) {
      pendingRequest = null;
      return;
    }
  }
}
