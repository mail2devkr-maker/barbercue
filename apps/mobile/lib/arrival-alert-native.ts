import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { Language } from '@barbercue/shared';

/**
 * JS side of the native Android arrival alert (modules/fastque-arrival-alert).
 *
 * The native module wakes the phone for the mandatory "Has the customer arrived?" decision (full-screen
 * over the lock screen where Android allows it, a heads-up notification otherwise). This file is only a
 * safe bridge: on iOS, on web, and on an installed binary that predates the module (`requireOptional...`
 * returns null) every function is a harmless no-op, so a JS update can never crash an older build.
 *
 * Nothing here mutates a booking. The two-step confirmation and the idempotent backend calls stay in
 * OwnerArrivalPromptCoordinator; native only alerts, and hands the owner to that prompt.
 */

interface NativeArrivalAlertModule {
  getReadiness(): {
    sdkInt: number;
    notificationsEnabled: boolean;
    fullScreenIntentAllowed: boolean;
    fullScreenIntentNeedsUserGrant: boolean;
  };
  openFullScreenIntentSettings(): void;
  openNotificationSettings(): void;
  dismissNotification(bookingId: string): void;
  cancelAlert(bookingId: string): void;
  scheduleSnooze(
    salonId: string,
    bookingId: string,
    slotStart: string | null,
    serviceName: string | null,
    lang: string | null,
  ): void;
  reconcile(salonId: string, eligibleBookingIds: string[]): void;
  getNativeState(): string;
}

const nativeModule: NativeArrivalAlertModule | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeArrivalAlertModule>('FastQueArrivalAlert') : null;

/** True only on an Android binary that contains the native arrival alert. */
export function isNativeArrivalAlertAvailable(): boolean {
  return nativeModule !== null;
}

export interface ArrivalAlertReadiness {
  notificationsEnabled: boolean;
  /** On Android 14+ this is a special access the owner must grant; earlier versions grant it by default. */
  fullScreenIntentAllowed: boolean;
  fullScreenIntentNeedsUserGrant: boolean;
}

/** null = this binary has no native arrival alert (nothing to set up). */
export function getArrivalAlertReadiness(): ArrivalAlertReadiness | null {
  if (!nativeModule) return null;
  try {
    const readiness = nativeModule.getReadiness();
    return {
      notificationsEnabled: readiness.notificationsEnabled,
      fullScreenIntentAllowed: readiness.fullScreenIntentAllowed,
      fullScreenIntentNeedsUserGrant: readiness.fullScreenIntentNeedsUserGrant,
    };
  } catch {
    return null;
  }
}

export function openFullScreenIntentSettings(): void {
  try {
    nativeModule?.openFullScreenIntentSettings();
  } catch {
    /* settings are a convenience; a missing screen must not break the app */
  }
}

export function openArrivalNotificationSettings(): void {
  try {
    nativeModule?.openNotificationSettings();
  } catch {
    /* see above */
  }
}

/** The React Native prompt took over: remove the tray notification (the episode stays alerted). */
export function dismissNativeArrivalNotification(bookingId: string): void {
  try {
    nativeModule?.dismissNotification(bookingId);
  } catch {
    /* best effort */
  }
}

/** The booking was resolved (arrived / no-show / cancelled): nothing native may alert for it again. */
export function cancelNativeArrivalAlert(bookingId: string): void {
  try {
    nativeModule?.cancelAlert(bookingId);
  } catch {
    /* best effort */
  }
}

/** "Remind me in 2 minutes": the phone re-alerts exactly once, even if the JS timer is asleep. */
export function scheduleNativeArrivalSnooze(
  alert: { salonId: string; bookingId: string; slotStart: string; serviceName: string },
  language: Language,
): void {
  try {
    nativeModule?.scheduleSnooze(
      alert.salonId,
      alert.bookingId,
      alert.slotStart,
      alert.serviceName,
      language === Language.HI ? 'HI' : 'EN',
    );
  } catch {
    /* best effort: the JS snooze timer still works while the app is open */
  }
}

/** Backend truth: these are the eligible arrivals for the salon; native forgets every other one. */
export function reconcileNativeArrivalAlerts(salonId: string, eligibleBookingIds: readonly string[]): void {
  try {
    nativeModule?.reconcile(salonId, [...eligibleBookingIds]);
  } catch {
    /* best effort */
  }
}

export interface NativeArrivalState {
  /** Bookings the phone alerted on its own since the app was last in front. Returned once. */
  alerted: string[];
  /** Pending native snoozes: bookingId -> epoch ms when the re-alert is due. */
  snoozes: Record<string, number>;
}

export function readNativeArrivalState(): NativeArrivalState {
  const empty: NativeArrivalState = { alerted: [], snoozes: {} };
  if (!nativeModule) return empty;
  try {
    const parsed = JSON.parse(nativeModule.getNativeState()) as Partial<NativeArrivalState>;
    return {
      alerted: Array.isArray(parsed.alerted) ? parsed.alerted.filter((id): id is string => typeof id === 'string') : [],
      snoozes: parsed.snoozes && typeof parsed.snoozes === 'object' ? parsed.snoozes : {},
    };
  } catch {
    return empty;
  }
}
