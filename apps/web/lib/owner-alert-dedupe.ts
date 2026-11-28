/**
 * One alert (chime + voice) per event, however many places hear it. The shell-wide
 * OwnerLiveAlerts, the Bookings page and the Live Queue page can all receive the same
 * booking.created / queue join; whichever claims it first announces it, the others stay quiet
 * (they still refresh their own lists). Kept for a few minutes so a reconnect replay is ignored.
 */
export type OwnerAlertKind = "booking.created" | "queue.joined";

const WINDOW_MS = 5 * 60_000;
const claimed = new Map<string, number>();

export function claimOwnerAlert(kind: OwnerAlertKind, id: string, now = Date.now()): boolean {
  for (const [key, at] of claimed) if (now - at > WINDOW_MS) claimed.delete(key);
  const key = `${kind}:${id}`;
  if (claimed.has(key)) return false;
  claimed.set(key, now);
  return true;
}

export function __resetOwnerAlertDedupeForTests(): void {
  claimed.clear();
}
