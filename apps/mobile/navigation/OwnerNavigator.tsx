import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AssistantFab } from '../components/assistant/AssistantFab';
import { ThemeFab } from '../components/ThemeFab';
import { OwnerLiveAlerts } from '../components/owner/OwnerLiveAlerts';
import { SalonStatus, type OwnerBookingFilter } from '@barbercue/shared';
import OwnerDashboardScreen from '../screens/owner/OwnerDashboardScreen';
import OwnerQueueScreen from '../screens/owner/OwnerQueueScreen';
import OwnerBookingsScreen from '../screens/owner/OwnerBookingsScreen';
import OwnerOnboardingScreen from '../screens/owner/OwnerOnboardingScreen';
import RegisterShopScreen from '../screens/RegisterShopScreen';
import OwnerShopStack, { type OwnerShopStackParamList } from './OwnerShopStack';
import DashboardAccountStack, { type DashboardAccountStackParamList } from './DashboardAccountStack';
import { SalonProvider } from '../lib/salon-context';
import { useUnreadNotificationCount } from '../lib/notifications';
import { useLanguage } from '../lib/language-context';
import { fastQue, font } from '../lib/theme';
import { TabIcon, type TabIconName } from '../components/ui/TabIcon';
import { useEffect, useRef, useState } from 'react';
import { AppMenuSheet, type AppMenuSection } from '../components/AppMenuSheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setStatusBarStyle } from 'expo-status-bar';
import { useSalon } from '../lib/salon-context';
import { navigationRef } from './navigation-ref';
import { subscribeToOwnerBookingPushNavigation } from '../lib/push-navigation';
import { subscribeQueueArrivalNavigation } from '../lib/queue-push-navigation';
import { OwnerArrivalPromptCoordinator } from '../components/owner/OwnerArrivalPromptCoordinator';
import { statusBarStyleFor, useThemedStyles, useThemeTokens, type ThemeTokens } from '../lib/theme-mode';

export type OwnerTabParamList = {
  OwnerDashboardTab: undefined;
  OwnerQueueTab: undefined;
  // Optional initial filter so the Dashboard tab's booking summary cards can deep-link straight
  // into e.g. "Today" or "Cancelled" instead of always landing on the tab's own default.
  OwnerBookingsTab: { filter?: OwnerBookingFilter } | undefined;
  OwnerShopTab: NavigatorScreenParams<OwnerShopStackParamList> | undefined;
  OwnerAccountTab: NavigatorScreenParams<DashboardAccountStackParamList> | undefined;
  // Not a real page: pressing the Menu tab opens the menu sheet instead.
  OwnerMenuTab: undefined;
};

const Tab = createBottomTabNavigator<OwnerTabParamList>();

/** Placeholder for the Menu tab: pressing it opens the menu sheet and never navigates here. */
function OwnerMenuTabPlaceholder() {
  return <View />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tab navigator's own navigation object, captured on press
type TabNav = { navigate: (...args: any[]) => void };

type BusinessPanel = NonNullable<NonNullable<OwnerShopStackParamList['OwnerBusiness']>['initialPanel']>;

function ownerMenuSections(hi: boolean, nav: () => TabNav | null): AppMenuSection[] {
  const L = (en: string, hin: string) => (hi ? hin : en);
  const tab = (name: string, params?: object) => () => nav()?.navigate(name, params);
  const shop = (screen: string, params?: object) => () => nav()?.navigate('OwnerShopTab', { screen, params, initial: false });
  const panel = (p: BusinessPanel) => shop('OwnerBusiness', { initialPanel: p });
  const filter = (f: OwnerBookingFilter) => tab('OwnerBookingsTab', { filter: f });
  return [
    {
      title: L('Today', 'आज'),
      items: [
        { key: 'dash', label: L('Dashboard', 'डैशबोर्ड'), onPress: tab('OwnerDashboardTab') },
        { key: 'queue', label: L('Live queue', 'लाइव कतार'), onPress: tab('OwnerQueueTab') },
        { key: 'b-today', label: L("Today's bookings", 'आज की बुकिंग'), onPress: filter('today') },
        { key: 'b-up', label: L('Upcoming bookings', 'आने वाली बुकिंग'), onPress: filter('upcoming') },
        { key: 'b-done', label: L('Completed bookings', 'पूरी हुई बुकिंग'), onPress: filter('completed') },
        { key: 'b-cancel', label: L('Cancelled bookings', 'रद्द बुकिंग'), onPress: filter('cancelled') },
      ],
    },
    {
      title: L('Shop', 'दुकान'),
      items: [
        { key: 'shop', label: L('Shop, services & team', 'दुकान, सेवाएँ और टीम'), onPress: shop('OwnerShop') },
        { key: 'settings', label: L('Shop settings', 'दुकान की सेटिंग'), onPress: shop('OwnerSettings') },
        { key: 'customers', label: L('Customers', 'ग्राहक'), onPress: shop('OwnerCustomers') },
        { key: 'inventory', label: L('Inventory', 'इन्वेंटरी'), onPress: shop('OwnerInventory') },
        { key: 'qr', label: L('Shop QR poster', 'दुकान का QR पोस्टर'), onPress: shop('OwnerQrPoster') },
      ],
    },
    {
      title: L('Business', 'बिज़नेस'),
      items: [
        { key: 'analytics', label: L('Analytics', 'एनालिटिक्स'), onPress: panel('analytics') },
        { key: 'report', label: L('Reports', 'रिपोर्ट'), onPress: panel('report') },
        { key: 'sources', label: L('Booking sources', 'बुकिंग कहाँ से आई'), onPress: panel('sources') },
        { key: 'team', label: L('Team performance', 'टीम का प्रदर्शन'), onPress: panel('team') },
        { key: 'contacts', label: L('Contacts', 'संपर्क'), onPress: panel('contacts') },
        { key: 'invoices', label: L('Invoices', 'बिल'), onPress: panel('invoices') },
        { key: 'payments', label: L('Payments', 'भुगतान'), onPress: panel('payments') },
        { key: 'offers', label: L('Offers', 'ऑफ़र'), onPress: panel('offers') },
        { key: 'reviews', label: L('Reviews', 'रिव्यू'), onPress: panel('reviews') },
        { key: 'cancellations', label: L('Cancellations', 'रद्दीकरण'), onPress: panel('cancellations') },
        { key: 'verification', label: L('Verification', 'सत्यापन'), onPress: panel('verification') },
      ],
    },
    {
      title: L('Account', 'खाता'),
      items: [
        { key: 'account', label: L('My account', 'मेरा खाता'), onPress: tab('OwnerAccountTab', { screen: 'DashboardAccount' }) },
        { key: 'notifications', label: L('Notifications', 'सूचनाएँ'), onPress: tab('OwnerAccountTab', { screen: 'Notifications', initial: false }) },
        { key: 'assistant', label: L('FastQue Assistant', 'FastQue असिस्टेंट'), onPress: tab('OwnerAccountTab', { screen: 'Assistant', initial: false }) },
      ],
    },
  ];
}

// Mounted only for an authenticated user whose roles include SALON_OWNER (see App.tsx).
// SalonProvider scopes salon selection to this navigator's lifetime only — a customer or staff
// session never mounts it.
export default function OwnerNavigator() {
  return (
    <SalonProvider>
      <OwnerPushNavigationBridge />
      <OwnerQueueArrivalPushBridge />
      <OwnerArrivalPromptCoordinator />
      <OwnerNavigatorGate />
    </SalonProvider>
  );
}

/**
 * Mobile Shop Owner Onboarding mission — decides between the normal owner shell, the setup
 * wizard, and registration itself, using the exact same GET salons/workplaces data every other
 * owner screen already reads (SalonWorkplaceDto.status/isOwner via useSalon()).
 *
 * - Zero workplaces: a SALON_OWNER-role account with no salon at all (addendum's explicit "route
 *   toward registration rather than an empty/broken dashboard" requirement — normally unreachable
 *   since the role is only ever granted alongside creating a salon, but this is the defensive
 *   fallback for that case rather than a broken/empty tab bar).
 * - Any workplace still PENDING: the owner has registered but not finished setup — onboarding
 *   picks up automatically, whether this is the very first render right after registration (the
 *   same STAFF-audience session swap that mounted this navigator in the first place) or a later
 *   app open (the "close the app mid-setup" resume case). If an owner somehow has more than one
 *   PENDING shop, the first is completed before the shell opens — a PENDING salon must never be
 *   left stranded with no route back to finishing it.
 * - Otherwise: every workplace is already ACTIVE/SUSPENDED — the normal tab shell.
 */
function OwnerNavigatorGate() {
  const { fastQue } = useThemeTokens();
  const styles = useThemedStyles(makeStyles);
  const { workplaces, loading, reload } = useSalon();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={fastQue.pink} size="large" />
      </View>
    );
  }

  if (workplaces.length === 0) {
    return <RegisterShopScreen onRegistered={reload} />;
  }

  const pending = workplaces.find((w) => w.status === SalonStatus.PENDING);
  if (pending) {
    return <OwnerOnboardingScreen salonId={pending.id} />;
  }

  return <OwnerTabs />;
}

function OwnerTabs() {
  const { fastQue } = useThemeTokens();
  const unreadCount = useUnreadNotificationCount();
  const { t, language } = useLanguage();
  const { selectedSalonId } = useSalon();
  const [menuOpen, setMenuOpen] = useState(false);
  const tabNav = useRef<TabNav | null>(null);
  // Owner report (16 Nov): on phones with Android's back/home bar the 5 tabs sat underneath it. The
  // fixed 60px bar ignored the bottom inset (the customer bar already adds it).
  const insets = useSafeAreaInsets();
  // The app-wide status bar is light (white text) for the dark customer screens. Every owner tab
  // except the dark Dashboard sits on the cream surface with no header, so white clock/battery
  // icons were invisible there. Switch per focused tab; restore light when the owner shell closes.
  const { resolved } = useThemeTokens();
  useEffect(() => () => setStatusBarStyle('light'), []);
  return (
    <>
    <Tab.Navigator
      // Owner (18 Nov): Back (the new in-app button and the phone's own) returns to the PREVIOUS tab.
      backBehavior="history"
      screenListeners={({ route }) => ({
        // Every owner page now sits under the dark FastQue brand bar (components/TopBrandBar), so the
        // status bar icons above it stay light on every tab.
        focus: () => setStatusBarStyle('light'),
      })}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: fastQue.pink,
        tabBarInactiveTintColor: fastQue.textMuted,
        tabBarStyle: { backgroundColor: fastQue.glassStrong, borderTopColor: fastQue.border, borderTopWidth: 1, height: 60 + insets.bottom, paddingBottom: 8 + insets.bottom, paddingTop: 8 },
        tabBarLabelStyle: { fontFamily: font.bodySemiBold, fontSize: 11 },
        tabBarIconStyle: { marginTop: 2 },
      }}
    >
      <Tab.Screen name="OwnerDashboardTab" component={OwnerDashboardScreen} options={tabOptions(t.tabDashboard, 'home')} />
      <Tab.Screen name="OwnerQueueTab" component={OwnerQueueScreen} options={tabOptions(t.tabQueue, 'queue')} />
      <Tab.Screen
        name="OwnerBookingsTab"
        component={OwnerBookingsScreen}
        options={{
          ...tabOptions(t.tabBookings, 'bookings'),
          // PROTECTED FEATURE — VOICE NOTIFICATIONS. OwnerBookingsScreen owns the proven
          // booking.created -> fetch detail -> Speech.speak listener. Bottom tabs are lazy by
          // default, which meant a fresh owner session received no spoken booking alert until
          // the owner manually opened Bookings once. Eagerly mount this one tab only; do not
          // duplicate or rewrite the TTS path, and keep all other tabs lazy.
          lazy: false,
        }}
      />
      <Tab.Screen name="OwnerShopTab" component={OwnerShopStack} options={tabOptions(t.tabShop, 'shop')} />
      <Tab.Screen
        name="OwnerAccountTab"
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
      <Tab.Screen
        name="OwnerMenuTab"
        component={OwnerMenuTabPlaceholder}
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
    <AppMenuSheet
      visible={menuOpen}
      onClose={() => setMenuOpen(false)}
      title={language === 'HI' ? 'मेन्यू' : 'Menu'}
      sections={ownerMenuSections(language === 'HI', () => tabNav.current)}
    />
    <ThemeFab tabBarHeight={60 + insets.bottom} includeBottomInset />
    <AssistantFab tabBarHeight={60 + insets.bottom} includeBottomInset onOpen={() => navigationRef.navigate('OwnerAccountTab', { screen: 'Assistant', initial: false, params: { salonId: selectedSalonId ?? undefined } })} />
    <OwnerLiveAlerts />
    </>
  );
}

/**
 * Notification taps can arrive before this role-specific navigator has mounted. The global queue
 * is replayed here only after the booking's salon is confirmed to be one of the signed-in owner's
 * workplaces, then the exact salon is selected before opening the existing bookings surface.
 */
function OwnerPushNavigationBridge() {
  const { workplaces, selectSalon } = useSalon();

  useEffect(
    () =>
      subscribeToOwnerBookingPushNavigation((payload) => {
        if (workplaces.length === 0) return false;
        if (!workplaces.some((workplace) => workplace.id === payload.salonId)) return true;
        if (!navigationRef.isReady()) return false;
        selectSalon(payload.salonId);
        navigationRef.navigate('OwnerBookingsTab');
        return true;
      }),
    [workplaces, selectSalon],
  );

  return null;
}

function OwnerQueueArrivalPushBridge() {
  const { workplaces, selectSalon } = useSalon();

  useEffect(
    () => subscribeQueueArrivalNavigation('owner', (payload) => {
      if (workplaces.length === 0) return false;
      // A push cannot grant access to a salon. Only route to a verified owned workplace.
      if (!workplaces.some((shop) => shop.id === payload.salonId)) return true;
      if (!navigationRef.isReady()) return false;
      selectSalon(payload.salonId);
      navigationRef.navigate('OwnerQueueTab');
      return true;
    }),
    [workplaces, selectSalon],
  );
  return null;
}

function tabOptions(label: string, icon: TabIconName) {
  return {
    tabBarLabel: label,
    tabBarAccessibilityLabel: label,
    tabBarIcon: ({ color, size }: { color: string; size: number }) => <TabIcon name={icon} color={color} size={size} />,
  };
}

const makeStyles = ({ fastQue }: ThemeTokens) => StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: fastQue.background },
});
