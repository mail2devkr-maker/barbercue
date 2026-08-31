import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import { NOTIFICATION_PATHS, PushPlatform, PushProvider, Role, type MeResponse, type NotificationDto, type PushNotificationData } from '@barbercue/shared';
import { apiFetch } from './api';
import { getItem, setItem } from './secure-storage';

export const OPERATIONS_CHANNEL_ID = 'barbercue-operations';
const INSTALLATION_ID_KEY = 'barbercue_push_installation_id';
const VOICE_BOOKING_KEY = 'barbercue_voice_booking_announcements';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function installationId(): Promise<string> {
  const existing = await getItem(INSTALLATION_ID_KEY);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await setItem(INSTALLATION_ID_KEY, created);
  return created;
}

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

export async function configureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(OPERATIONS_CHANNEL_ID, {
    name: 'Bookings and live queue',
    description: 'Time-sensitive BarberCue booking, appointment and live queue updates.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 120, 250],
    sound: 'default',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

export async function registerPushDevice(): Promise<'registered' | 'denied' | 'unsupported'> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return 'unsupported';
  await configureAndroidNotificationChannel();
  const current = await Notifications.getPermissionsAsync();
  const permission = current.status === 'granted' ? current : await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') {
    await unregisterPushDevice().catch(() => undefined);
    return 'denied';
  }
  const easProjectId = projectId();
  if (!easProjectId) return 'unsupported';
  const token = await Notifications.getExpoPushTokenAsync({
    projectId: easProjectId,
  });
  await apiFetch(`${NOTIFICATION_PATHS.notifications}/${NOTIFICATION_PATHS.devices}`, {
    method: 'POST',
    body: JSON.stringify({
      platform: Platform.OS === 'android' ? PushPlatform.ANDROID : PushPlatform.IOS,
      provider: PushProvider.EXPO,
      pushToken: token.data,
      installationId: await installationId(),
    }),
  });
  return 'registered';
}

export async function unregisterPushDevice(): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  const id = await getItem(INSTALLATION_ID_KEY);
  if (!id) return;
  await apiFetch(`${NOTIFICATION_PATHS.notifications}/${NOTIFICATION_PATHS.devices}/${NOTIFICATION_PATHS.unregister}`, {
    method: 'POST',
    body: JSON.stringify({ provider: PushProvider.EXPO, installationId: id }),
  });
}

export function listenForPushTokenRefresh(onRefresh: () => void): Notifications.EventSubscription {
  return Notifications.addPushTokenListener(() => onRefresh());
}

export function notificationData(notification: Notifications.Notification): PushNotificationData | null {
  const value = notification.request.content.data;
  if (!value || typeof value.type !== 'string' || typeof value.screen !== 'string') return null;
  return value as unknown as PushNotificationData;
}

export function notificationDtoData(notification: NotificationDto): PushNotificationData {
  const payload = notification.payload ?? {};
  const type = notification.type;
  const screen: PushNotificationData['screen'] = type.startsWith('owner.booking') ? 'OWNER_BOOKINGS' : type === 'owner.walk_in.joined' ? 'OWNER_QUEUE' : type.startsWith('staff.') ? 'STAFF_TODAY' : type === 'queue.turn_approaching' ? 'CUSTOMER_QUEUE' : 'CUSTOMER_BOOKING';
  const optional = (key: string) => (typeof payload[key] === 'string' ? (payload[key] as string) : undefined);
  return {
    type,
    screen,
    ...(optional('bookingId') ? { bookingId: optional('bookingId') } : {}),
    ...(optional('salonId') ? { salonId: optional('salonId') } : {}),
    ...(optional('queueEntryId') ? { queueEntryId: optional('queueEntryId') } : {}),
  };
}

export async function getVoiceBookingAnnouncementsEnabled(): Promise<boolean> {
  return (await getItem(VOICE_BOOKING_KEY)) === 'true';
}

export function setVoiceBookingAnnouncementsEnabled(enabled: boolean): Promise<void> {
  return setItem(VOICE_BOOKING_KEY, String(enabled));
}

export async function maybeSpeakForegroundBooking(data: PushNotificationData, user: MeResponse): Promise<void> {
  if (AppState.currentState !== 'active') return;
  if (!(await getVoiceBookingAnnouncementsEnabled())) return;
  if (user.roles.includes(Role.SALON_OWNER) && data.type === 'owner.booking.created') {
    Speech.speak('New booking received.');
  } else if (user.roles.includes(Role.SALON_STAFF) && data.type === 'staff.booking.created') {
    Speech.speak('New appointment.');
  }
}
