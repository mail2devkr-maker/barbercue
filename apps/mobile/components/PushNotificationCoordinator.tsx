import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Role, type MeResponse } from '@barbercue/shared';
import { useAuth } from '../lib/auth-context';
import {
  isPushEligibleUser,
  registerPushDeviceForUser,
  reregisterRefreshedPushToken,
} from '../lib/push-notifications';
import {
  parseOwnerBookingPushData,
  requestOwnerBookingPushNavigation,
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

/**
 * Owns device registration and the OS-notification lifecycle. Websocket-driven screen refreshes
 * remain separate in the Owner screens: an OS notification is for background/away delivery, not
 * a second realtime business-event mechanism.
 */
export function PushNotificationCoordinator() {
  const { status, user } = useAuth();
  const currentUserRef = useRef<MeResponse | null>(null);
  const deferredResponseRef = useRef<Notifications.NotificationResponse | null>(null);

  useEffect(() => {
    currentUserRef.current = status === 'authenticated' ? user : null;
  }, [status, user]);

  function handleOwnerBookingResponse(response: Notifications.NotificationResponse, actor: MeResponse | null): boolean {
    if (!isOwner(actor)) return false;
    const payload = parseOwnerBookingPushData(response.notification.request.content.data);
    if (!payload) return false;
    requestOwnerBookingPushNavigation(payload);
    return true;
  }

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let mounted = true;

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
