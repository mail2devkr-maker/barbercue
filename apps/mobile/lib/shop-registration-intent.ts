// Mobile Shop Owner Onboarding mission — "Register your shop" CTAs reachable while signed out
// (RoleSelectScreen's hamburger menu, OwnerStaffLoginScreen's "New to FastQue?" link) must send
// the visitor through the existing customer sign-in flow first: there is no separate "create an
// owner account" endpoint, only POST salons on an already-authenticated user (see
// RegisterSalonResponseDto's doc comment). App.tsx swaps AuthStack out for the authenticated
// customer tabs the instant sign-in succeeds, unmounting whatever screen stashed this intent —
// same "stash an intent, replay it once the right navigator exists" shape as
// push-navigation.ts's pending owner-booking-push handoff and guest-booking-handoff.ts's pending
// guest intent, applied to this different trigger.
let pendingShopRegistration = false;

export function stashPendingShopRegistrationIntent(): void {
  pendingShopRegistration = true;
}

/** Consumes the stash — at most one replay per stashed intent, never re-fired on a later remount. */
export function takePendingShopRegistrationIntent(): boolean {
  const pending = pendingShopRegistration;
  pendingShopRegistration = false;
  return pending;
}
