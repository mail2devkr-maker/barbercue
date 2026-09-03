import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import type { OwnerBookingFilter } from '@barbercue/shared';
import OwnerDashboardScreen from '../screens/owner/OwnerDashboardScreen';
import OwnerQueueScreen from '../screens/owner/OwnerQueueScreen';
import OwnerBookingsScreen from '../screens/owner/OwnerBookingsScreen';
import OwnerShopScreen from '../screens/owner/OwnerShopScreen';
import DashboardAccountStack, { type DashboardAccountStackParamList } from './DashboardAccountStack';
import { SalonProvider } from '../lib/salon-context';
import { useUnreadNotificationCount } from '../lib/notifications';
import { color, font } from '../lib/theme';
import { TabIcon, type TabIconName } from '../components/ui/TabIcon';
import { useEffect } from 'react';
import { useSalon } from '../lib/salon-context';
import { navigationRef } from './navigation-ref';
import { subscribeToOwnerBookingPushNavigation } from '../lib/push-navigation';

export type OwnerTabParamList = {
  OwnerDashboardTab: undefined;
  OwnerQueueTab: undefined;
  // Optional initial filter so the Dashboard tab's booking summary cards can deep-link straight
  // into e.g. "Today" or "Cancelled" instead of always landing on the tab's own default.
  OwnerBookingsTab: { filter?: OwnerBookingFilter } | undefined;
  OwnerShopTab: undefined;
  OwnerAccountTab: NavigatorScreenParams<DashboardAccountStackParamList> | undefined;
};

const Tab = createBottomTabNavigator<OwnerTabParamList>();

// Mounted only for an authenticated user whose roles include SALON_OWNER (see App.tsx).
// SalonProvider scopes salon selection to this navigator's lifetime only — a customer or staff
// session never mounts it.
export default function OwnerNavigator() {
  const unreadCount = useUnreadNotificationCount();
  return (
    <SalonProvider>
      <OwnerPushNavigationBridge />
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: color.ink,
          tabBarInactiveTintColor: color.muted,
          tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.border, borderTopWidth: 1, height: 60, paddingBottom: 8, paddingTop: 8 },
          tabBarLabelStyle: { fontFamily: font.bodySemiBold, fontSize: 11 },
          tabBarIconStyle: { marginTop: 2 },
        }}
      >
        <Tab.Screen name="OwnerDashboardTab" component={OwnerDashboardScreen} options={tabOptions('Dashboard', 'home')} />
        <Tab.Screen name="OwnerQueueTab" component={OwnerQueueScreen} options={tabOptions('Queue', 'queue')} />
        <Tab.Screen
          name="OwnerBookingsTab"
          component={OwnerBookingsScreen}
          options={{
            ...tabOptions('Bookings', 'bookings'),
            // PROTECTED FEATURE — VOICE NOTIFICATIONS. OwnerBookingsScreen owns the proven
            // booking.created -> fetch detail -> Speech.speak listener. Bottom tabs are lazy by
            // default, which meant a fresh owner session received no spoken booking alert until
            // the owner manually opened Bookings once. Eagerly mount this one tab only; do not
            // duplicate or rewrite the TTS path, and keep all other tabs lazy.
            lazy: false,
          }}
        />
        <Tab.Screen name="OwnerShopTab" component={OwnerShopScreen} options={tabOptions('Shop', 'shop')} />
        <Tab.Screen
          name="OwnerAccountTab"
          component={DashboardAccountStack}
          options={{
            ...tabOptions('Account', 'account'),
            tabBarBadge: unreadCount > 0 ? (unreadCount > 9 ? '9+' : unreadCount) : undefined,
            // See the matching comment in RootNavigator.tsx — resets the nested Account stack
            // (which the notification bell navigates into via {screen: 'Notifications'}) back to
            // its root the moment this tab loses focus, so Account never silently reopens on
            // Notifications.
            popToTopOnBlur: true,
          }}
        />
      </Tab.Navigator>
    </SalonProvider>
  );
}

/**
 * Notification taps can arrive before this role-specific navigator has mounted. The global queue
 * is replayed here only after the booking's salon is confirmed to be one of the signed-in owner's
 * workplaces, then the exact salon is selected before opening the existing bookings surface.
 */
function OwnerPushNavigationBridge() {
  const { workplaces, selectSalon } = useSalon();

  useEffect(
    () =>
      subscribeToOwnerBookingPushNavigation((payload) => {
        if (workplaces.length === 0) return false;
        if (!workplaces.some((workplace) => workplace.id === payload.salonId)) return true;
        if (!navigationRef.isReady()) return false;
        selectSalon(payload.salonId);
        navigationRef.navigate('OwnerBookingsTab');
        return true;
      }),
    [workplaces, selectSalon],
  );

  return null;
}

function tabOptions(label: string, icon: TabIconName) {
  return {
    tabBarLabel: label,
    tabBarAccessibilityLabel: label,
    tabBarIcon: ({ color, size }: { color: string; size: number }) => <TabIcon name={icon} color={color} size={size} />,
  };
}
