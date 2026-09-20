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

const ARRIVAL_LINK_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Parses the deep link the native arrival alert hands to the app:
 *   fastque://arrival-check?salonId=...&bookingId=...&action=open|arrived|not-arrived
 *
 * The link only ever asks the app to OPEN the existing arrival prompt for a booking; the prompt loads
 * eligibility from the backend and still requires the owner's two-step confirmation, so a crafted link
 * from another app can prioritise a prompt at most - it can never resolve a booking. Anything that is
 * not exactly this shape (including malformed ids) is rejected.
 */
export function parseArrivalCheckUrl(url: string | null | undefined): OwnerArrivalPromptRequest | null {
  if (!url) return null;
  const match = /^fastque:\/\/arrival-check\?([^#]*)/.exec(url);
  if (!match) return null;
  const params = new Map<string, string>();
  for (const pair of match[1].split('&')) {
    const [rawKey, rawValue = ''] = pair.split('=');
    try {
      params.set(decodeURIComponent(rawKey), decodeURIComponent(rawValue));
    } catch {
      return null;
    }
  }
  const salonId = params.get('salonId');
  const bookingId = params.get('bookingId');
  if (!salonId || !bookingId || !ARRIVAL_LINK_ID.test(salonId) || !ARRIVAL_LINK_ID.test(bookingId)) return null;
  const action = params.get('action');
  const initialAction: OwnerArrivalPromptInitialAction =
    action === 'arrived' ? 'arrived' : action === 'not-arrived' ? 'not-arrived' : null;
  return { type: 'booking.arrival_check', salonId, bookingId, initialAction };
}
