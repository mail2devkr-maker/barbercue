import { randomUUID } from 'expo-crypto';

/** One key per mutating attempt (booking create/cancel) — expo-crypto's randomUUID is the
 * documented, version-stable way to get this on-device (rather than assuming a global
 * `crypto.randomUUID` polyfill is present across Expo/Hermes versions). */
export function newIdempotencyKey(): string {
  return randomUUID();
}
