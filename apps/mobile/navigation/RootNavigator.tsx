import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeStack from './HomeStack';
import SearchStack from './SearchStack';
import BookingsStack from './BookingsStack';
import QueueStack from './QueueStack';
import AccountStack from './AccountStack';
import { useUnreadNotificationCount } from '../lib/notifications';
import { color, font } from '../lib/theme';
import { TabIcon, type TabIconName } from '../components/ui/TabIcon';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

// Mounted only when authenticated (see App.tsx) — every screen here assumes a logged-in
// customer, matching the web app's book/layout.tsx + account/layout.tsx RequireRole gates.
// Text-only tab labels (no icon library added) — active tab reads via color + weight, matching
// the app's restrained, editorial visual language rather than a generic icon-driven tab bar.
export default function RootNavigator() {
  const unreadCount = useUnreadNotificationCount();

  return (
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
        tabBarIconStyle: { marginTop: 2 },
      }}
    >
      <Tab.Screen name="HomeTab" component={HomeStack} options={tabOptions('Home', 'home')} />
      <Tab.Screen name="SearchTab" component={SearchStack} options={tabOptions('Search', 'search')} />
      <Tab.Screen name="BookingsTab" component={BookingsStack} options={tabOptions('Bookings', 'bookings')} />
      <Tab.Screen name="QueueTab" component={QueueStack} options={tabOptions('Queue', 'queue')} />
      <Tab.Screen
        name="AccountTab"
        component={AccountStack}
        options={{
            ...tabOptions('Account', 'account'),
          tabBarBadge: unreadCount > 0 ? (unreadCount > 9 ? '9+' : unreadCount) : undefined,
          // Regression fix: the notification bell navigates into this tab's nested stack via
          // navigate('AccountTab', { screen: 'Notifications' }), which leaves that nested stack's
          // state pointed at Notifications. Bottom-tabs' default tab-press behavior only resets a
          // tab's stack to its first screen when that tab is ALREADY focused (re-tapping the
          // active tab) — it does NOT reset when switching TO this tab from a different one, so
          // without this the Account tab would silently reopen on Notifications instead of Account
          // every time. popToTopOnBlur resets the nested stack the moment this tab loses focus
          // (i.e. the instant the owner/customer taps away to another tab), so the next visit to
          // Account always lands on its root screen.
          popToTopOnBlur: true,
        }}
      />
    </Tab.Navigator>
  );
}

function tabOptions(label: string, icon: TabIconName) {
  return {
    tabBarLabel: label,
    tabBarAccessibilityLabel: label,
    tabBarIcon: ({ color, size }: { color: string; size: number }) => <TabIcon name={icon} color={color} size={size} />,
  };
}
