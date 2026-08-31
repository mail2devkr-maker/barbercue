import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import type { OwnerBookingFilter } from '@barbercue/shared';
import OwnerDashboardScreen from '../screens/owner/OwnerDashboardScreen';
import OwnerQueueScreen from '../screens/owner/OwnerQueueScreen';
import OwnerBookingsScreen from '../screens/owner/OwnerBookingsScreen';
import OwnerShopScreen from '../screens/owner/OwnerShopScreen';
import DashboardAccountStack from './DashboardAccountStack';
import { SalonProvider } from '../lib/salon-context';
import { useUnreadNotificationCount } from '../lib/notifications';
import { color, font } from '../lib/theme';
import type { DashboardAccountStackParamList } from './types';

export type OwnerTabParamList = {
  OwnerDashboardTab: undefined;
  OwnerQueueTab: undefined;
  // Optional initial filter so the Dashboard tab's booking summary cards can deep-link straight
  // into e.g. "Today" or "Cancelled" instead of always landing on the tab's own default.
  OwnerBookingsTab: { filter?: OwnerBookingFilter } | undefined;
  OwnerShopTab: undefined;
  OwnerAccountTab: NavigatorScreenParams<DashboardAccountStackParamList>;
};

const Tab = createBottomTabNavigator<OwnerTabParamList>();

// Mounted only for an authenticated user whose roles include SALON_OWNER (see App.tsx).
// SalonProvider scopes salon selection to this navigator's lifetime only — a customer or staff
// session never mounts it.
export default function OwnerNavigator() {
  const unreadCount = useUnreadNotificationCount();
  return (
    <SalonProvider>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: color.ink,
          tabBarInactiveTintColor: color.muted,
          tabBarStyle: {
            backgroundColor: color.surface,
            borderTopColor: color.border,
            borderTopWidth: 1,
            height: 60,
            paddingBottom: 8,
            paddingTop: 8,
          },
          tabBarLabelStyle: { fontFamily: font.bodySemiBold, fontSize: 11 },
        }}
      >
        <Tab.Screen name="OwnerDashboardTab" component={OwnerDashboardScreen} options={{ tabBarLabel: 'Dashboard' }} />
        <Tab.Screen name="OwnerQueueTab" component={OwnerQueueScreen} options={{ tabBarLabel: 'Queue' }} />
        <Tab.Screen name="OwnerBookingsTab" component={OwnerBookingsScreen} options={{ tabBarLabel: 'Bookings' }} />
        <Tab.Screen name="OwnerShopTab" component={OwnerShopScreen} options={{ tabBarLabel: 'Shop' }} />
        <Tab.Screen
          name="OwnerAccountTab"
          component={DashboardAccountStack}
          options={{
            tabBarLabel: 'Account',
            tabBarBadge: unreadCount > 0 ? (unreadCount > 9 ? '9+' : unreadCount) : undefined,
          }}
        />
      </Tab.Navigator>
    </SalonProvider>
  );
}
