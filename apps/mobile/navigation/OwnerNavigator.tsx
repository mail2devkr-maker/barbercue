import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
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
import { useEffect } from 'react';
import { useSalon } from '../lib/salon-context';
import { navigationRef } from './navigation-ref';
import { subscribeToOwnerBookingPushNavigation } from '../lib/push-navigation';

export type OwnerTabParamList = {
  OwnerDashboardTab: undefined;
  OwnerQueueTab: undefined;
  // Optional initial filter so the Dashboard tab's booking summary cards can deep-link straight
  // into e.g. "Today" or "Cancelled" instead of always landing on the tab's own default.
  OwnerBookingsTab: { filter?: OwnerBookingFilter } | undefined;
  OwnerShopTab: NavigatorScreenParams<OwnerShopStackParamList> | undefined;
  OwnerAccountTab: NavigatorScreenParams<DashboardAccountStackParamList> | undefined;
};

const Tab = createBottomTabNavigator<OwnerTabParamList>();

// Mounted only for an authenticated user whose roles include SALON_OWNER (see App.tsx).
// SalonProvider scopes salon selection to this navigator's lifetime only — a customer or staff
// session never mounts it.
export default function OwnerNavigator() {
  return (
    <SalonProvider>
      <OwnerPushNavigationBridge />
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
  const unreadCount = useUnreadNotificationCount();
  const { t } = useLanguage();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: fastQue.pink,
        tabBarInactiveTintColor: fastQue.textMuted,
        tabBarStyle: { backgroundColor: fastQue.glassStrong, borderTopColor: fastQue.border, borderTopWidth: 1, height: 60, paddingBottom: 8, paddingTop: 8 },
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
    </Tab.Navigator>
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

function tabOptions(label: string, icon: TabIconName) {
  return {
    tabBarLabel: label,
    tabBarAccessibilityLabel: label,
    tabBarIcon: ({ color, size }: { color: string; size: number }) => <TabIcon name={icon} color={color} size={size} />,
  };
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: fastQue.background },
});
