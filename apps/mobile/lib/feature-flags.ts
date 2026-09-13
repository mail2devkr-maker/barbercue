/**
 * FastQue Credits is a promotional wallet/rewards feature. As the owner-approved Play compliance
 * response to the prior rejection, Credits must be unreachable from the Android app for V1 — the
 * backend, data model and web experience are untouched; only Android-visible entry points check
 * this flag. Re-enabling for a future organization-account launch is an explicit env change.
 *
 * Reads process.env at call time (not a module-level constant) so both a real EXPO_PUBLIC_*
 * build-time inline (Expo/Metro) and a plain Jest `process.env` mutation work identically.
 * Fails closed: Credits are enabled only by the exact lower-case string "true". This protects
 * production and OTA updates from a missing, malformed, or incorrectly scoped environment value.
 */
export function isCreditsEnabled(): boolean {
  return process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED === 'true';
}
