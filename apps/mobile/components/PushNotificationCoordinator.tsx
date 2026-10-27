import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { DASHBOARD_PATHS, Role, formatVoiceDateTime, type Language, type MeResponse, type OwnerBookingDetailDto } from '@barbercue/shared';
import { useAuth } from '../lib/auth-context';
import { apiFetch } from '../lib/api';
import { useLanguage } from '../lib/language-context';
import { speakBooking } from '../lib/voice-announce';
import { claimBookingVoiceEvent } from '../lib/booking-voice-dedupe';
import {
  ARRIVAL_ACTION_ARRIVED,
  ARRIVAL_ACTION_NOT_ARRIVED,
  isPushEligibleUser,
  registerPushDeviceForUser,
  reregisterRefreshedPushToken,
} from '../lib/push-notifications';
import {
  parseOwnerBookingPushData,
  parseCustomerBookingPushData,
  requestCustomerBookingPushNavigation,
  requestOwnerBookingPushNavigation,
  type OwnerBookingPushData,
} from '../lib/push-navigation';
import { requestOwnerArrivalPrompt } from '../lib/arrival-prompt';
import { parseQueueArrivalPushData, requestQueueArrivalNavigation } from '../lib/queue-push-navigation';
import {
  LOCAL_ARRIVAL_ALERT_TYPE,
  foregroundArrivalPushBehavior,
  localArrivalAlertBehavior,
  markArrivalAlerted,
} from '../lib/arrival-alert-sound';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data;
      // The in-app arrival alert (a local notification): heads-up + sound, never left in the tray.
      if (data?.type === LOCAL_ARRIVAL_ALERT_TYPE) return localArrivalAlertBehavior();
      // The real arrival-check push while the app is open: audible unless the in-app alert already
      // sounded for this booking - one alert per eligible arrival, never two.
      if (data?.type === 'booking.arrival_check') {
        return foregroundArrivalPushBehavior(typeof data.bookingId === 'string' ? data.bookingId : null);
      }
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      };
    },
  });
}

function isOwner(user: MeResponse | null): user is MeResponse {
  return Boolean(user?.roles.includes(Role.SALON_OWNER));
}

function isCustomer(user: MeResponse | null): user is MeResponse {
  return Boolean(user?.roles.includes(Role.CUSTOMER));
}

function bookingDetailPath(salonId: string, bookingId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.bookings}/${bookingId}`;
}

/**
 * Owns device registration and the OS-notification lifecycle. Websocket-driven screen refreshes
 * remain separate in the Owner screens: an OS notification is for background/away delivery, not
 * a second realtime business-event mechanism.
 */
export function PushNotificationCoordinator() {
  const { status, user } = useAuth();
  const { language } = useLanguage();
  const currentUserRef = useRef<MeResponse | null>(null);
  const languageRef = useRef<Language>(language);
  const deferredResponseRef = useRef<Notifications.NotificationResponse | null>(null);

  useEffect(() => {
    currentUserRef.current = status === 'authenticated' ? user : null;
  }, [status, user]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  function handleOwnerBookingResponse(response: Notifications.NotificationResponse, actor: MeResponse | null): boolean {
    if (!isOwner(actor)) return false;
    const payload = parseOwnerBookingPushData(response.notification.request.content.data);
    if (!payload) return false;
    if (payload.type === 'booking.arrival_check') {
      // The owner tapped the push (which already sounded) - opening the prompt must stay silent.
      markArrivalAlerted(payload.bookingId);
      const initialAction =
        response.actionIdentifier === ARRIVAL_ACTION_ARRIVED
          ? 'arrived'
          : response.actionIdentifier === ARRIVAL_ACTION_NOT_ARRIVED
            ? 'not-arrived'
            : null;
      requestOwnerArrivalPrompt({ ...payload, initialAction });
      return true;
    }
    requestOwnerBookingPushNavigation(payload);
    return true;
  }

  function handleCustomerBookingResponse(response: Notifications.NotificationResponse, actor: MeResponse | null): boolean {
    if (!isCustomer(actor)) return false;
    const payload = parseCustomerBookingPushData(response.notification.request.content.data);
    if (!payload) return false;
    requestCustomerBookingPushNavigation(payload);
    return true;
  }

  function handleQueueArrivalResponse(
    response: Notifications.NotificationResponse,
    actor: MeResponse | null,
  ): boolean {
    const payload = parseQueueArrivalPushData(response.notification.request.content.data);
    if (!payload) return false;
    // A push only requests navigation; neither this handler nor its payload
    // marks a customer arrived. Explicit UI actions require the normal API auth.
    if (isOwner(actor)) {
      requestQueueArrivalNavigation('owner', payload);
      return true;
    }
    if (isCustomer(actor)) {
      requestQueueArrivalNavigation('customer', payload);
      return true;
    }
    // Guest push is supported as a heads-up, but its ticket remains a separate
    // capability: never pretend a signed-out device has account-based navigation.
    return false;
  }

  function scheduleForegroundVoiceFallback(payload: OwnerBookingPushData): void {
    if (payload.type === 'booking.arrival_check') {
      // Sound for this push is decided by the notification handler above; just keep the in-app
      // alert from doubling it.
      markArrivalAlerted(payload.bookingId);
      requestOwnerArrivalPrompt(payload);
      return;
    }
    setTimeout(() => {
      if (!isOwner(currentUserRef.current)) return;
      const activeLanguage = languageRef.current;
      if (payload.type === 'booking.cancelled') {
        if (!claimBookingVoiceEvent(payload.type, payload.bookingId)) return;
        speakBooking({ event: payload.type, bookingId: payload.bookingId, language: activeLanguage });
        return;
      }

      void apiFetch<OwnerBookingDetailDto>(bookingDetailPath(payload.salonId, payload.bookingId))
        .then((detail) => {
          const fingerprint = payload.type === 'booking.rescheduled' ? detail.slotStart : undefined;
          if (!claimBookingVoiceEvent(payload.type, payload.bookingId, fingerprint)) return;
          const timeZone = detail.salonTimezone;
          const { date, time } = detail.slotStart && timeZone
            ? formatVoiceDateTime(detail.slotStart, timeZone)
            : { date: null, time: null };
          if (payload.type === 'booking.created') {
            speakBooking({
              event: payload.type,
              bookingId: payload.bookingId,
              language: activeLanguage,
              serviceName: detail.serviceName ?? null,
              barberName: detail.assignedStaffName ?? detail.preferredStaffName ?? null,
              salonName: detail.salonName ?? null,
              date,
              time,
            });
          } else {
            speakBooking({ event: 'booking.rescheduled', bookingId: payload.bookingId, language: activeLanguage, date, time });
          }
        })
        .catch(() => {
          if (!claimBookingVoiceEvent(payload.type, payload.bookingId, 'detail-unavailable')) return;
          if (payload.type === 'booking.created') {
            speakBooking({
              event: payload.type,
              bookingId: payload.bookingId,
              language: activeLanguage,
              serviceName: null,
              barberName: null,
              salonName: null,
              date: null,
              time: null,
            });
          } else {
            speakBooking({ event: 'booking.rescheduled', bookingId: payload.bookingId, language: activeLanguage, date: null, time: null });
          }
        });
    }, 1200);
  }

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let mounted = true;

    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const queuePayload = parseQueueArrivalPushData(notification.request.content.data);
      const actor = currentUserRef.current;
      if (queuePayload && isOwner(actor)) requestQueueArrivalNavigation('owner', queuePayload);
      else if (queuePayload && isCustomer(actor)) requestQueueArrivalNavigation('customer', queuePayload);

      const payload = parseOwnerBookingPushData(notification.request.content.data);
      if (payload && isOwner(actor)) scheduleForegroundVoiceFallback(payload);
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (!handleOwnerBookingResponse(response, currentUserRef.current) && !handleCustomerBookingResponse(response, currentUserRef.current) && !handleQueueArrivalResponse(response, currentUserRef.current)) {
        deferredResponseRef.current = response;
      }
    });
    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      void reregisterRefreshedPushToken(currentUserRef.current, token.data);
    });

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!mounted || !response) return;
        if (handleOwnerBookingResponse(response, currentUserRef.current) || handleCustomerBookingResponse(response, currentUserRef.current) || handleQueueArrivalResponse(response, currentUserRef.current)) {
          void Notifications.clearLastNotificationResponseAsync();
        } else {
          deferredResponseRef.current = response;
        }
      })
      .catch(() => {
        // Notification-response lookup is best effort; a native-service hiccup must not block app launch.
      });

    return () => {
      mounted = false;
      receivedSubscription.remove();
      responseSubscription.remove();
      tokenSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (status !== 'authenticated' || !isPushEligibleUser(user)) return;
    void registerPushDeviceForUser(user);

    const deferredResponse = deferredResponseRef.current;
    if (deferredResponse && (handleOwnerBookingResponse(deferredResponse, user) || handleCustomerBookingResponse(deferredResponse, user) || handleQueueArrivalResponse(deferredResponse, user))) {
      deferredResponseRef.current = null;
      void Notifications.clearLastNotificationResponseAsync();
    }
  }, [status, user]);

  return null;
}
