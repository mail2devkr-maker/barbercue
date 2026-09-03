import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Role, type MeResponse } from '@barbercue/shared';
import { apiFetch } from './api';
import { deleteItem, getItem, setItem } from './secure-storage';

const PUSH_DEVICE_STORAGE_KEY = 'barbercue_expo_push_device';
export const ANDROID_BOOKING_CHANNEL_ID = 'booking-updates';

interface StoredPushDevice {
  expoPushToken: string;
  userId: string;
}
export function isPushEligibleUser(user: MeResponse | null): user is MeResponse {
  return Boolean(user?.roles.some((role) => role === Role.SALON_OWNER || role === Role.SALON_STAFF));
}

function isNativePlatform(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

function getEasProjectId(): string | null {
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  return typeof projectId === 'string' && projectId.length > 0 ? projectId : null;
}

function parseStoredPushDevice(value: string | null): StoredPushDevice | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.expoPushToken !== 'string' || typeof parsed.userId !== 'string') return null;
    if (!parsed.expoPushToken || !parsed.userId) return null;
    return { expoPushToken: parsed.expoPushToken, userId: parsed.userId };
  } catch {
    return null;
  }
}

/** Android 8+ notification behavior is channel-controlled, including heads-up/sound/vibration. */
export async function ensureBookingNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_BOOKING_CHANNEL_ID, {
    name: 'Booking updates',
    description: 'New bookings and operational FastQue updates.',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    sound: 'default',
    vibrationPattern: [0, 250, 160, 250],
    enableVibrate: true,
    showBadge: true,
  });
}

async function getGrantedPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

async function registerExpoPushToken(user: MeResponse, expoPushToken: string): Promise<void> {
  const platform = Platform.OS === 'android' ? 'android' : 'ios';
  await apiFetch('push-devices/register', {
    method: 'POST',
    body: JSON.stringify({ expoPushToken, platform }),
  });
  await setItem(PUSH_DEVICE_STORAGE_KEY, JSON.stringify({ expoPushToken, userId: user.id }));
}

/**
 * Best-effort registration only. A denied permission, unsupported runtime, offline call or missing
 * EAS project identity never interferes with the authenticated product flow; the coordinator
 * retries on the next eligible app start and on Expo token refresh.
 *
 * Issue 6 (mobile stabilization mission) — a real device reported voice announcements working but
 * Android OS push never arriving, and production had zero PushDevice rows despite an actively-used
 * owner app, meaning this function's own try/catch was silently swallowing the real failure at some
 * step. Each step now logs a distinct, token-free reason on failure — this is diagnostic-only (a
 * console.warn, visible via `adb logcat` / Metro), never changes control flow or return values, so
 * it cannot itself regress the best-effort behavior above.
 */
export async function registerPushDeviceForUser(user: MeResponse | null): Promise<boolean> {
  if (!isPushEligibleUser(user) || !isNativePlatform()) return false;

  try {
    await ensureBookingNotificationChannel();
  } catch (err) {
    console.warn('[push] could not create the Android notification channel', err);
    // Non-fatal: getExpoPushTokenAsync can still succeed without a channel pre-created.
  }

  const granted = await getGrantedPermission().catch((err: unknown) => {
    console.warn('[push] permission check/request threw', err);
    return false;
  });
  if (!granted) {
    console.warn('[push] registration skipped: notification permission not granted');
    return false;
  }

  const projectId = getEasProjectId();
  if (!projectId) {
    console.warn('[push] registration skipped: no EAS projectId resolved from app config at runtime');
    return false;
  }

  let expoPushToken: string;
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    expoPushToken = token.data;
  } catch (err) {
    // The single most common real-device cause: Notifications.getExpoPushTokenAsync throws when
    // the EAS project has no configured Android push (FCM) credential, or when Google Play
    // Services is unavailable/out of date on the device.
    console.warn('[push] getExpoPushTokenAsync threw — check EAS Android push (FCM) credentials and Google Play Services', err);
    return false;
  }

  try {
    await registerExpoPushToken(user, expoPushToken);
    return true;
  } catch (err) {
    // Never log the raw token — registerExpoPushToken's own request body already carries it;
    // logging the error object here is safe as long as callers don't stringify request bodies.
    console.warn('[push] backend registration call failed', err);
    return false;
  }
}

/** Reuses the authenticated, caller-scoped backend registration contract after Expo rotates a token. */
export async function reregisterRefreshedPushToken(user: MeResponse | null, expoPushToken: string): Promise<boolean> {
  if (!isPushEligibleUser(user) || !isNativePlatform() || !expoPushToken) return false;
  try {
    await registerExpoPushToken(user, expoPushToken);
    return true;
  } catch {
    return false;
  }
}

/**
 * Called before the auth refresh token is revoked. The backend deletion is scoped to the current
 * JWT user; clearing the local record in finally is intentional so a local logout never leaves a
 * token association around merely because the device was offline.
 */
export async function unregisterCurrentPushDevice(): Promise<void> {
  if (!isNativePlatform()) return;
  const stored = parseStoredPushDevice(await getItem(PUSH_DEVICE_STORAGE_KEY));
  if (!stored) return;
  try {
    await apiFetch('push-devices/unregister', {
      method: 'POST',
      body: JSON.stringify({ expoPushToken: stored.expoPushToken }),
    });
  } catch {
    // Logout stays reliable even if a network failure prevents best-effort push cleanup.
  } finally {
    await deleteItem(PUSH_DEVICE_STORAGE_KEY);
  }
}
