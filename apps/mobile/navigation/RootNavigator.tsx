import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeStack from './HomeStack';
import SearchStack from './SearchStack';
import BookingsStack from './BookingsStack';
import QueueStack from './QueueStack';
import AccountStack from './AccountStack';
import { color, font } from '../lib/theme';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

// Mounted only when authenticated (see App.tsx) — every screen here assumes a logged-in
// customer, matching the web app's book/layout.tsx + account/layout.tsx RequireRole gates.
// Text-only tab labels (no icon library added) — active tab reads via color + weight, matching
// the app's restrained, editorial visual language rather than a generic icon-driven tab bar.
export default function RootNavigator() {
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
      }}
    >
      <Tab.Screen name="HomeTab" component={HomeStack} options={{ tabBarLabel: 'Home' }} />
      <Tab.Screen name="SearchTab" component={SearchStack} options={{ tabBarLabel: 'Search' }} />
      <Tab.Screen name="BookingsTab" component={BookingsStack} options={{ tabBarLabel: 'Bookings' }} />
      <Tab.Screen name="QueueTab" component={QueueStack} options={{ tabBarLabel: 'Queue' }} />
      <Tab.Screen name="AccountTab" component={AccountStack} options={{ tabBarLabel: 'Account' }} />
    </Tab.Navigator>
  );
}
