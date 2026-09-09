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
  isPushEligibleUser,
  registerPushDeviceForUser,
  reregisterRefreshedPushToken,
} from '../lib/push-notifications';
import {
  parseOwnerBookingPushData,
  requestOwnerBookingPushNavigation,
  type OwnerBookingPushData,
} from '../lib/push-navigation';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function isOwner(user: MeResponse | null): user is MeResponse {
  return Boolean(user?.roles.includes(Role.SALON_OWNER));
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
    requestOwnerBookingPushNavigation(payload);
    return true;
  }

  function scheduleForegroundVoiceFallback(payload: OwnerBookingPushData): void {
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
      const payload = parseOwnerBookingPushData(notification.request.content.data);
      if (payload && isOwner(currentUserRef.current)) scheduleForegroundVoiceFallback(payload);
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (!handleOwnerBookingResponse(response, currentUserRef.current)) {
        deferredResponseRef.current = response;
      }
    });
    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      void reregisterRefreshedPushToken(currentUserRef.current, token.data);
    });

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!mounted || !response) return;
        if (handleOwnerBookingResponse(response, currentUserRef.current)) {
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
    if (deferredResponse && handleOwnerBookingResponse(deferredResponse, user)) {
      deferredResponseRef.current = null;
      void Notifications.clearLastNotificationResponseAsync();
    }
  }, [status, user]);

  return null;
}
