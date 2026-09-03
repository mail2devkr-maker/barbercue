import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { OwnerBookingFilter } from '@barbercue/shared';
import OwnerDashboardScreen from '../screens/owner/OwnerDashboardScreen';
import OwnerQueueScreen from '../screens/owner/OwnerQueueScreen';
import OwnerBookingsScreen from '../screens/owner/OwnerBookingsScreen';
import OwnerShopScreen from '../screens/owner/OwnerShopScreen';
import DashboardAccountScreen from '../screens/dashboard/DashboardAccountScreen';
import { SalonProvider } from '../lib/salon-context';
import { useUnreadNotificationCount } from '../lib/notifications';
import { color, font } from '../lib/theme';
import { TabIcon, type TabIconName } from '../components/ui/TabIcon';

export type OwnerTabParamList = {
  OwnerDashboardTab: undefined;
  OwnerQueueTab: undefined;
  // Optional initial filter so the Dashboard tab's booking summary cards can deep-link straight
  // into e.g. "Today" or "Cancelled" instead of always landing on the tab's own default.
  OwnerBookingsTab: { filter?: OwnerBookingFilter } | undefined;
  OwnerShopTab: undefined;
  OwnerAccountTab: undefined;
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
          tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.border, borderTopWidth: 1, height: 60, paddingBottom: 8, paddingTop: 8 },
          tabBarLabelStyle: { fontFamily: font.bodySemiBold, fontSize: 11 },
          tabBarIconStyle: { marginTop: 2 },
        }}
      >
        <Tab.Screen name="OwnerDashboardTab" component={OwnerDashboardScreen} options={tabOptions('Dashboard', 'home')} />
        <Tab.Screen name="OwnerQueueTab" component={OwnerQueueScreen} options={tabOptions('Queue', 'queue')} />
        <Tab.Screen name="OwnerBookingsTab" component={OwnerBookingsScreen} options={tabOptions('Bookings', 'bookings')} />
        <Tab.Screen name="OwnerShopTab" component={OwnerShopScreen} options={tabOptions('Shop', 'shop')} />
        <Tab.Screen
          name="OwnerAccountTab"
          component={DashboardAccountScreen}
          options={{
            ...tabOptions('Account', 'account'),
            tabBarBadge: unreadCount > 0 ? (unreadCount > 9 ? '9+' : unreadCount) : undefined,
          }}
        />
      </Tab.Navigator>
    </SalonProvider>
  );
}

function tabOptions(label: string, icon: TabIconName) {
  return {
    tabBarLabel: label,
    tabBarAccessibilityLabel: label,
    tabBarIcon: ({ color, size }: { color: string; size: number }) => <TabIcon name={icon} color={color} size={size} />,
  };
}
