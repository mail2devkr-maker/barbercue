import type { SearchStackParamList } from '../navigation/types';

// Issue 2 (mobile launch mission) — a guest who browsed and picked a slot/queue before signing in
// must not lose that choice. App.tsx swaps the entire navigator tree the instant auth status
// flips (AuthStack -> the authenticated customer tabs), which unmounts GuestSearchStack along
// with whatever screen the guest was on — there is no way to keep that screen instance alive
// across the swap. Same "stash an intent, replay it once the right navigator exists" shape as
// push-navigation.ts's pending owner-booking-push handoff, applied to this different trigger.
export type PendingGuestIntent =
  | { kind: 'booking'; params: SearchStackParamList['ConfirmBooking'] }
  | { kind: 'walkIn'; params: SearchStackParamList['WalkInJoin'] };

let pendingGuestIntent: PendingGuestIntent | null = null;

export function stashPendingGuestIntent(intent: PendingGuestIntent): void {
  pendingGuestIntent = intent;
}

/** Consumes the stash — at most one replay per stashed intent, never re-fired on a later remount. */
export function takePendingGuestIntent(): PendingGuestIntent | null {
  const intent = pendingGuestIntent;
  pendingGuestIntent = null;
  return intent;
}
