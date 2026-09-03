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
    description: 'New bookings and operational BarberCue updates.',
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
 */
export async function registerPushDeviceForUser(user: MeResponse | null): Promise<boolean> {
  if (!isPushEligibleUser(user) || !isNativePlatform()) return false;

  try {
    await ensureBookingNotificationChannel();
    if (!(await getGrantedPermission())) return false;
    const projectId = getEasProjectId();
    if (!projectId) return false;
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerExpoPushToken(user, token.data);
    return true;
  } catch {
    // Do not log a raw Expo token or make notification setup block sign-in.
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
