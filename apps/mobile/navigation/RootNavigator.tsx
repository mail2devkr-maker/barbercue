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
