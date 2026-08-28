import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import OwnerDashboardScreen from '../screens/owner/OwnerDashboardScreen';
import OwnerQueueScreen from '../screens/owner/OwnerQueueScreen';
import OwnerBookingsScreen from '../screens/owner/OwnerBookingsScreen';
import OwnerShopScreen from '../screens/owner/OwnerShopScreen';
import DashboardAccountScreen from '../screens/dashboard/DashboardAccountScreen';
import { SalonProvider } from '../lib/salon-context';
import { color, font } from '../lib/theme';

export type OwnerTabParamList = {
  OwnerDashboardTab: undefined;
  OwnerQueueTab: undefined;
  OwnerBookingsTab: undefined;
  OwnerShopTab: undefined;
  OwnerAccountTab: undefined;
};

const Tab = createBottomTabNavigator<OwnerTabParamList>();

// Mounted only for an authenticated user whose roles include SALON_OWNER (see App.tsx).
// SalonProvider scopes salon selection to this navigator's lifetime only — a customer or staff
// session never mounts it.
export default function OwnerNavigator() {
  return (
    <SalonProvider>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: color.ink,
          tabBarInactiveTintColor: color.muted,
          tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.border, borderTopWidth: 1, height: 60, paddingBottom: 8, paddingTop: 8 },
          tabBarLabelStyle: { fontFamily: font.bodySemiBold, fontSize: 11 },
        }}
      >
        <Tab.Screen name="OwnerDashboardTab" component={OwnerDashboardScreen} options={{ tabBarLabel: 'Dashboard' }} />
        <Tab.Screen name="OwnerQueueTab" component={OwnerQueueScreen} options={{ tabBarLabel: 'Queue' }} />
        <Tab.Screen name="OwnerBookingsTab" component={OwnerBookingsScreen} options={{ tabBarLabel: 'Bookings' }} />
        <Tab.Screen name="OwnerShopTab" component={OwnerShopScreen} options={{ tabBarLabel: 'Shop' }} />
        <Tab.Screen name="OwnerAccountTab" component={DashboardAccountScreen} options={{ tabBarLabel: 'Account' }} />
      </Tab.Navigator>
    </SalonProvider>
  );
}
