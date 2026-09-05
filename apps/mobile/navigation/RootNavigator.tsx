import { useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HomeStack from './HomeStack';
import SearchStack from './SearchStack';
import BookingsStack from './BookingsStack';
import QueueStack from './QueueStack';
import AccountStack from './AccountStack';
import { useUnreadNotificationCount } from '../lib/notifications';
import { useLanguage } from '../lib/language-context';
import { takePendingGuestIntent } from '../lib/guest-booking-handoff';
import { navigationRef } from './navigation-ref';
import { color, font } from '../lib/theme';
import { TabIcon, type TabIconName } from '../components/ui/TabIcon';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

/**
 * Issue 2 (mobile launch mission) — replays a guest's in-progress booking/queue-join selection
 * once the authenticated customer tabs actually exist. RootNavigator only ever mounts fresh right
 * after App.tsx's status-driven swap (there is no other way to reach it), so "this component just
 * mounted" is itself the exact right signal — same reasoning as OwnerNavigator's own
 * OwnerPushNavigationBridge. navigationRef is already ready at this point: NavigationContainer
 * itself never unmounts across the swap, only its child does (see App.tsx).
 */
function GuestBookingHandoffBridge() {
  useEffect(() => {
    const intent = takePendingGuestIntent();
    if (!intent || !navigationRef.isReady()) return;
    if (intent.kind === 'booking') {
      navigationRef.navigate('SearchTab', { screen: 'ConfirmBooking', params: intent.params });
    } else {
      navigationRef.navigate('SearchTab', { screen: 'WalkInJoin', params: intent.params });
    }
  }, []);
  return null;
}

// Mounted only when authenticated (see App.tsx) — every screen here assumes a logged-in
// customer, matching the web app's book/layout.tsx + account/layout.tsx RequireRole gates.
// Text-only tab labels (no icon library added) — active tab reads via color + weight, matching
// the app's restrained, editorial visual language rather than a generic icon-driven tab bar.
export default function RootNavigator() {
  const unreadCount = useUnreadNotificationCount();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  return (
    <>
      <GuestBookingHandoffBridge />
      <Tab.Navigator
        screenOptions={{
        headerShown: false,
        // FastQue brand accent on the active tab (visual-fidelity checkpoint) — was plain ink,
        // indistinguishable from a default/unbranded tab bar; every tab (Home included) now reads
        // clearly as "selected" via the same brand accent the rest of Home's redesign uses.
        tabBarActiveTintColor: color.brandCoral,
        tabBarInactiveTintColor: color.muted,
        tabBarStyle: {
          backgroundColor: color.surface,
          borderTopColor: color.border,
          borderTopWidth: 1,
          // A fixed height/padding here previously overrode React Navigation's own automatic
          // safe-area handling for the bottom tab bar (bumping into a phone's gesture-nav bar/home
          // indicator on some devices) — insets.bottom restores that safe-area accommodation
          // explicitly instead of relying on the (bypassed) default.
          height: 60 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
          paddingTop: 8,
          shadowColor: color.ink,
          shadowOpacity: 0.06,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: -2 },
          elevation: 8,
        },
        tabBarLabelStyle: { fontFamily: font.bodySemiBold, fontSize: 11, marginTop: 2 },
        tabBarIconStyle: { marginTop: 2 },
      }}
    >
      <Tab.Screen name="HomeTab" component={HomeStack} options={tabOptions(t.tabHome, 'home')} />
      <Tab.Screen name="SearchTab" component={SearchStack} options={tabOptions(t.tabSearch, 'search')} />
      <Tab.Screen name="BookingsTab" component={BookingsStack} options={tabOptions(t.tabBookings, 'bookings')} />
      <Tab.Screen name="QueueTab" component={QueueStack} options={tabOptions(t.tabQueue, 'queue')} />
      <Tab.Screen
        name="AccountTab"
        component={AccountStack}
        options={{
            ...tabOptions(t.tabAccount, 'account'),
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
    </>
  );
}

function tabOptions(label: string, icon: TabIconName) {
  return {
    tabBarLabel: label,
    tabBarAccessibilityLabel: label,
    tabBarIcon: ({ color, size }: { color: string; size: number }) => <TabIcon name={icon} color={color} size={size} />,
  };
}
