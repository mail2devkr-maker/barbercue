import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import StaffTodayScreen from '../screens/staff/StaffTodayScreen';
import DashboardAccountScreen from '../screens/dashboard/DashboardAccountScreen';
import { SalonProvider } from '../lib/salon-context';
import { color, font } from '../lib/theme';

export type StaffTabParamList = {
  StaffTodayTab: undefined;
  StaffAccountTab: undefined;
};

const Tab = createBottomTabNavigator<StaffTabParamList>();

// Mounted only for an authenticated user whose roles include SALON_STAFF but not SALON_OWNER
// (see App.tsx) — deliberately just two tabs. Staff has no shop-management surface (that stays
// on OwnerNavigator's Dashboard/Shop tabs only), so there is nothing else to give it a tab for.
export default function StaffNavigator() {
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
        <Tab.Screen name="StaffTodayTab" component={StaffTodayScreen} options={{ tabBarLabel: 'Today' }} />
        <Tab.Screen name="StaffAccountTab" component={DashboardAccountScreen} options={{ tabBarLabel: 'Account' }} />
      </Tab.Navigator>
    </SalonProvider>
  );
}
