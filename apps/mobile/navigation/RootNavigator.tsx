import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
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
import { resolvePostAuthCustomerNavigation, takePendingCustomerDestination } from '../lib/customer-navigation-intent';
import { navigationRef } from './navigation-ref';
import { subscribeToCustomerBookingPushNavigation } from '../lib/push-navigation';
import { subscribeQueueArrivalNavigation } from '../lib/queue-push-navigation';
import { isCreditsEnabled } from '../lib/feature-flags';
import { fastQue, font } from '../lib/theme';
import { TabIcon, type TabIconName } from '../components/ui/TabIcon';
import { AssistantFab } from '../components/assistant/AssistantFab';
import { AppMenuSheet, type AppMenuSection } from '../components/AppMenuSheet';
import type { TabParamList } from './types';
import { useThemeTokens } from '../lib/theme-mode';

const Tab = createBottomTabNavigator<TabParamList>();

/** Placeholder for the Menu tab: pressing it opens the menu sheet and never navigates here. */
function MenuTabPlaceholder() {
  return <View />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tab navigator's own navigation object, captured on press
type TabNav = { navigate: (...args: any[]) => void };

function customerMenuSections(hi: boolean, go: (tab: string, screen: string) => void, creditsEnabled: boolean): AppMenuSection[] {
  const L = (en: string, hin: string) => (hi ? hin : en);
  return [
    {
      title: L('Explore', 'खोजें'),
      items: [
        { key: 'home', label: L('Home', 'होम'), onPress: () => go('HomeTab', 'CustomerDashboard') },
        { key: 'search', label: L('Find a salon', 'सैलून खोजें'), onPress: () => go('SearchTab', 'SalonSearch') },
        { key: 'offers', label: L('Offers', 'ऑफ़र'), onPress: () => go('SearchTab', 'Offers') },
        { key: 'style', label: L('AI Style Advisor', 'AI स्टाइल सलाहकार'), onPress: () => go('HomeTab', 'StyleAdvisor') },
        { key: 'recent', label: L('Recently viewed', 'हाल में देखे गए'), onPress: () => go('AccountTab', 'RecentlyViewed') },
      ],
    },
    {
      title: L('My activity', 'मेरी गतिविधि'),
      items: [
        { key: 'bookings', label: L('My bookings', 'मेरी बुकिंग'), onPress: () => go('BookingsTab', 'MyBookings') },
        { key: 'queue', label: L('My queue', 'मेरी कतार'), onPress: () => go('QueueTab', 'QueueHome') },
        { key: 'invoices', label: L('My invoices', 'मेरे बिल'), onPress: () => go('BookingsTab', 'MyInvoices') },
        { key: 'reviews', label: L('My reviews', 'मेरे रिव्यू'), onPress: () => go('AccountTab', 'MyReviews') },
        ...(creditsEnabled ? [{ key: 'credits', label: L('Credits', 'क्रेडिट'), onPress: () => go('AccountTab', 'CreditsHistory') }] : []),
        { key: 'notifications', label: L('Notifications', 'सूचनाएँ'), onPress: () => go('AccountTab', 'Notifications') },
      ],
    },
    {
      title: L('Account', 'खाता'),
      items: [
        { key: 'account', label: L('My account', 'मेरा खाता'), onPress: () => go('AccountTab', 'Account') },
        { key: 'assistant', label: L('FastQue Assistant', 'FastQue असिस्टेंट'), onPress: () => go('AccountTab', 'Assistant') },
        { key: 'register', label: L('Register your shop', 'अपनी दुकान रजिस्टर करें'), onPress: () => go('AccountTab', 'RegisterShop') },
      ],
    },
  ];
}

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

/** Replays the one signed-out customer CTA that was most recently selected after auth. */
function CustomerDestinationHandoffBridge() {
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const replay = () => {
      if (cancelled) return;
      // Do not consume the intent before NavigationContainer is ready. A native Google return can
      // complete while App.tsx is swapping AuthStack for RootNavigator; consuming here too early
      // would lose Register Shop and strand the customer on Home.
      if (!navigationRef.isReady()) {
        retry = setTimeout(replay, 0);
        return;
      }
      const intent = takePendingCustomerDestination();
      if (!intent) return;
      // CreditsHistory isn't registered when its release gate is off, so the resolver returns null
      // for that intent. Register Shop always resolves to AccountTab → RegisterShop.
      const destination = resolvePostAuthCustomerNavigation(intent, isCreditsEnabled());
      if (destination) navigationRef.navigate(destination.tab, { screen: destination.screen, initial: false });
    };

    replay();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, []);
  return null;
}

function CustomerBookingPushNavigationBridge() {
  useEffect(
    () => subscribeToCustomerBookingPushNavigation(() => {
      if (!navigationRef.isReady()) return false;
      navigationRef.navigate('BookingsTab', { screen: 'MyBookings' });
      return true;
    }),
    [],
  );
  return null;
}

function CustomerQueueArrivalPushNavigationBridge() {
  useEffect(
    () => subscribeQueueArrivalNavigation('customer', () => {
      if (!navigationRef.isReady()) return false;
      // Queue tab re-fetches authenticated server truth; push payload is never trusted as a ticket.
      navigationRef.navigate('QueueTab', { screen: 'QueueHome' });
      return true;
    }),
    [],
  );
  return null;
}

// Mounted only when authenticated (see App.tsx) — every screen here assumes a logged-in
// customer, matching the web app's book/layout.tsx + account/layout.tsx RequireRole gates.
// Text-only tab labels (no icon library added) — active tab reads via color + weight, matching
// the app's restrained, editorial visual language rather than a generic icon-driven tab bar.
export default function RootNavigator() {
  const { fastQue } = useThemeTokens();
  const unreadCount = useUnreadNotificationCount();
  const { t, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const tabNav = useRef<TabNav | null>(null);
  const go = (tab: string, screen: string) => tabNav.current?.navigate(tab, { screen, initial: false });

  return (
    <>
      <AppMenuSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={language === 'HI' ? 'मेन्यू' : 'Menu'}
        sections={customerMenuSections(language === 'HI', go, isCreditsEnabled())}
      />
      <GuestBookingHandoffBridge />
      <CustomerDestinationHandoffBridge />
      <CustomerBookingPushNavigationBridge />
      <CustomerQueueArrivalPushNavigationBridge />
      <Tab.Navigator
        // Owner (18 Nov): Back (the new in-app button and the phone's own) returns to the PREVIOUS tab.
        backBehavior="history"
        screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        // FastQue brand accent on the active tab (visual-fidelity checkpoint) — was plain ink,
        // indistinguishable from a default/unbranded tab bar; every tab (Home included) now reads
        // clearly as "selected" via the same brand accent the rest of Home's redesign uses.
        tabBarActiveTintColor: fastQue.pink,
        tabBarInactiveTintColor: fastQue.textMuted,
        tabBarStyle: {
          backgroundColor: fastQue.glassStrong,
          borderTopColor: fastQue.border,
          borderTopWidth: 1,
          // A fixed height/padding here previously overrode React Navigation's own automatic
          // safe-area handling for the bottom tab bar (bumping into a phone's gesture-nav bar/home
          // indicator on some devices) — insets.bottom restores that safe-area accommodation
          // explicitly instead of relying on the (bypassed) default.
          height: 60 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
          paddingTop: 8,
          shadowColor: '#000000',
          shadowOpacity: 0.3,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -4 },
          elevation: 8,
        },
        tabBarLabelStyle: { fontFamily: font.bodySemiBold, fontSize: 11, marginTop: 2 },
        tabBarIconStyle: { marginTop: 2 },
      }}
    >
      <Tab.Screen name="HomeTab" component={HomeStack} options={tabOptions(t.tabDashboard, 'home')} />
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
      <Tab.Screen
        name="MenuTab"
        component={MenuTabPlaceholder}
        options={tabOptions(language === 'HI' ? 'मेन्यू' : 'Menu', 'menu')}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            tabNav.current = navigation as TabNav;
            setMenuOpen(true);
          },
        })}
      />
      </Tab.Navigator>
      <AssistantFab
        tabBarHeight={60 + insets.bottom}
        includeBottomInset
        onOpen={() => navigationRef.navigate('AccountTab', { screen: 'Assistant', initial: false })}
      />
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
