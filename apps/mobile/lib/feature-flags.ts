/**
 * FastQue Credits is a promotional wallet/rewards feature. Google Play rejected the first closed-
 * testing submission because the "Rewards, points, frequent flier miles, and other incentives"
 * Financial Features declaration requires an organization developer account, and this account is
 * currently Personal. Per owner decision, Credits must be unreachable from the Android app for V1
 * — the backend, data model and web experience are untouched; only Android-visible entry points
 * check this flag. Re-enabling for a future organization-account launch is a one-line env change.
 *
 * Reads process.env at call time (not a module-level constant) so both a real EXPO_PUBLIC_*
 * build-time inline (Expo/Metro) and a plain Jest `process.env` mutation work identically.
 * Defaults to enabled — matches pre-existing behavior everywhere this var isn't explicitly set to
 * "false" (local dev, the preview profile), so only the production build is affected.
 */
export function isCreditsEnabled(): boolean {
  return process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED !== 'false';
}
