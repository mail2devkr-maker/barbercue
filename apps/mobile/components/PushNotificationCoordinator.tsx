import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../lib/auth-context';
import { listenForPushTokenRefresh, maybeSpeakForegroundBooking, notificationData, registerPushDevice } from '../lib/push-notifications';
import { navigateFromPush } from '../navigation/navigation-ref';

export function PushNotificationCoordinator() {
  const { status, user } = useAuth();
  const handledResponseId = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !user) return undefined;
    let active = true;
    const retryTimers = new Set<ReturnType<typeof setTimeout>>();
    const route = (data: NonNullable<ReturnType<typeof notificationData>>) => {
      if (navigateFromPush(data, user)) return;
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        if (active) navigateFromPush(data, user);
      }, 250);
      retryTimers.add(timer);
    };
    const register = () => {
      void registerPushDevice().catch(() => {
        // Permission denial, Expo credential absence, and transient network failures must never
        // block normal app use. Authenticated startup will try again next time.
      });
    };
    register();
    const tokenSubscription = listenForPushTokenRefresh(register);
    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notificationData(notification);
      if (active && data) void maybeSpeakForegroundBooking(data, user);
    });
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handledResponseId.current = response.notification.request.identifier;
      const data = notificationData(response.notification);
      if (data) route(data);
      void Notifications.clearLastNotificationResponseAsync();
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!active || !response || response.notification.request.identifier === handledResponseId.current) return;
      handledResponseId.current = response.notification.request.identifier;
      const data = notificationData(response.notification);
      if (data) route(data);
      void Notifications.clearLastNotificationResponseAsync();
    });
    return () => {
      active = false;
      tokenSubscription.remove();
      receivedSubscription.remove();
      responseSubscription.remove();
      retryTimers.forEach(clearTimeout);
    };
  }, [status, user]);

  return null;
}
