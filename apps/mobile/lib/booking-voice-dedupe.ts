export type BookingVoiceEvent = 'booking.created' | 'booking.rescheduled' | 'booking.cancelled';

const RECENT_EVENT_WINDOW_MS = 5 * 60_000;
const spokenEvents = new Map<string, number>();

function keyFor(event: BookingVoiceEvent, bookingId: string, fingerprint?: string | null): string {
  return `${event}:${bookingId}:${fingerprint ?? ''}`;
}

function prune(now: number): void {
  for (const [key, at] of spokenEvents) {
    if (now - at > RECENT_EVENT_WINDOW_MS) spokenEvents.delete(key);
  }
}

export function claimBookingVoiceEvent(
  event: BookingVoiceEvent,
  bookingId: string,
  fingerprint?: string | null,
  now = Date.now(),
): boolean {
  prune(now);
  const key = keyFor(event, bookingId, fingerprint);
  if (spokenEvents.has(key)) return false;
  spokenEvents.set(key, now);
  return true;
}

export function __resetBookingVoiceDedupeForTests(): void {
  spokenEvents.clear();
}
