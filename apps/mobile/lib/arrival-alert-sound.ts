import * as Notifications from 'expo-notifications';
import { Platform, Vibration } from 'react-native';
import type { Language } from '@barbercue/shared';
import { ANDROID_BOOKING_CHANNEL_ID } from './push-notifications';
import { canSpeak, speakBooking } from './voice-announce';

/**
 * Audible + haptic attention for the owner arrival check.
 *
 * Why this exists: the native prompt used to open in silence. Nothing in the coordinator ever made
 * a sound, and the arrival push named no channel/sound of its own. This module makes the alert
 * audible without any new native code or bundled sound asset, so it ships over the air to the
 * installed binary: a local notification on the existing HIGH-importance `booking-updates`
 * channel (default sound, vibration) plus a short vibration.
 *
 * It obeys the phone: the OS still applies the user's notification permission, channel settings,
 * media/ring volume and Do-Not-Disturb. FastQue does not and cannot override any of those.
 *
 * "Exactly once per eligible arrival": a booking's alert sounds once per *episode*. The set below
 * is the single arbiter shared by (a) the local alert, (b) the foreground push handler and (c)
 * user-initiated opens (push tap, Notification Center), so the 30-second safety refresh, a socket
 * reconnect or a re-delivered event can never re-sound it. An episode ends - and the alert may
 * sound again - only when the booking leaves the eligible list or a snooze expires.
 */

// Local alerts carry this so the notification handler can tell them apart from the real push and
// so tapping one never re-enters the arrival-prompt replay path.
export const LOCAL_ARRIVAL_ALERT_TYPE = 'local.arrival_alert';
const VIBRATION_PATTERN = [0, 250, 160, 250];
const AUTO_DISMISS_MS = 10_000;

const alerted = new Set<string>();

export function hasArrivalAlerted(bookingId: string): boolean {
  return alerted.has(bookingId);
}

export function markArrivalAlerted(bookingId: string): void {
  alerted.add(bookingId);
}

/** A snooze expired (or the owner otherwise re-arms the reminder): the next appearance may sound. */
export function clearArrivalAlerted(bookingId: string): void {
  alerted.delete(bookingId);
}

/** Ends the episode for every booking that is no longer eligible (resolved, cancelled, no-show...). */
export function pruneArrivalAlerted(eligibleBookingIds: readonly string[]): void {
  const keep = new Set(eligibleBookingIds);
  for (const id of [...alerted]) if (!keep.has(id)) alerted.delete(id);
}

export function __resetArrivalAlertsForTests(): void {
  alerted.clear();
}

export interface ForegroundPushBehavior {
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
}

/**
 * What the OS should do with an arrival-check PUSH that lands while the app is open. If this
 * booking already sounded (the in-app alert got there first) the push is shown quietly; otherwise
 * the push itself is the audible alert and is recorded as such so the in-app path stays silent.
 */
export function foregroundArrivalPushBehavior(bookingId: string | null): ForegroundPushBehavior {
  if (bookingId && hasArrivalAlerted(bookingId)) {
    return { shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
  }
  if (bookingId) markArrivalAlerted(bookingId);
  return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
}

/** The local alert: heads-up with sound, but never left behind in the notification list. */
export function localArrivalAlertBehavior(): ForegroundPushBehavior {
  return { shouldShowBanner: true, shouldShowList: false, shouldPlaySound: true, shouldSetBadge: false };
}

function vibrate(): void {
  try {
    Vibration.vibrate(VIBRATION_PATTERN);
  } catch {
    /* vibration is best-effort and must never break the prompt */
  }
}

/**
 * Sounds the arrival alert for a booking unless it already has this episode. Returns whether it
 * fired. Resolves without throwing - a denied permission or missing channel just means silence.
 */
export async function alertArrivalOnce(input: {
  bookingId: string;
  salonId: string;
  title: string;
  body: string;
  /**
   * When given, the alert is SPOKEN ("Appointment reminder. Has the 6:30 PM Haircut customer arrived?
   * Please confirm arrived or not arrived." - the shared VoiceAnnouncements.arrivalCheck sentence, through
   * the same speakBooking pipeline as the new-booking announcement). Speech REPLACES the notification tone:
   * exactly one audible thing per episode. Only when speech is impossible on this phone (no TTS engine, or
   * Hindi with no Hindi voice) does it fall back to the tone, so the alert is never silent.
   */
  voice?: { language: Language; serviceName: string | null; time: string | null };
}): Promise<boolean> {
  if (alerted.has(input.bookingId)) return false;
  alerted.add(input.bookingId);
  vibrate();
  if (input.voice) {
    try {
      if (await canSpeak(input.voice.language)) {
        speakBooking({
          event: 'booking.arrival_check',
          bookingId: input.bookingId,
          language: input.voice.language,
          serviceName: input.voice.serviceName,
          time: input.voice.time,
        });
        return true;
      }
    } catch (err) {
      console.warn('[arrival-alert] speech failed, falling back to the tone', err);
    }
  }
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: input.title,
        body: input.body,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.HIGH,
        data: { type: LOCAL_ARRIVAL_ALERT_TYPE, bookingId: input.bookingId, salonId: input.salonId },
      },
      trigger: Platform.OS === 'android' ? { channelId: ANDROID_BOOKING_CHANNEL_ID } : null,
    });
    // The full-screen prompt is already showing; don't leave a duplicate sitting in the tray.
    setTimeout(() => {
      void Notifications.dismissNotificationAsync(id).catch(() => undefined);
    }, AUTO_DISMISS_MS);
  } catch (err) {
    console.warn('[arrival-alert] could not post the local alert notification', err);
  }
  return true;
}
