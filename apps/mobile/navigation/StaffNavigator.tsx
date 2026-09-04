import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import StaffTodayScreen from '../screens/staff/StaffTodayScreen';
import DashboardAccountStack, { type DashboardAccountStackParamList } from './DashboardAccountStack';
import { SalonProvider } from '../lib/salon-context';
import { useUnreadNotificationCount } from '../lib/notifications';
import { useLanguage } from '../lib/language-context';
import { color, font } from '../lib/theme';
import { TabIcon, type TabIconName } from '../components/ui/TabIcon';

export type StaffTabParamList = {
  StaffTodayTab: undefined;
  StaffAccountTab: NavigatorScreenParams<DashboardAccountStackParamList> | undefined;
};

const Tab = createBottomTabNavigator<StaffTabParamList>();

// Mounted only for an authenticated user whose roles include SALON_STAFF but not SALON_OWNER
// (see App.tsx) — deliberately just two tabs. Staff has no shop-management surface (that stays
// on OwnerNavigator's Dashboard/Shop tabs only), so there is nothing else to give it a tab for.
export default function StaffNavigator() {
  const unreadCount = useUnreadNotificationCount();
  const { t } = useLanguage();
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
        <Tab.Screen name="StaffTodayTab" component={StaffTodayScreen} options={tabOptions(t.tabToday, 'today')} />
        <Tab.Screen
          name="StaffAccountTab"
          component={DashboardAccountStack}
          options={{
            ...tabOptions(t.tabAccount, 'account'),
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

function tabOptions(label: string, icon: TabIconName) {
  return {
    tabBarLabel: label,
    tabBarAccessibilityLabel: label,
    tabBarIcon: ({ color, size }: { color: string; size: number }) => <TabIcon name={icon} color={color} size={size} />,
  };
}
