import { act } from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { CommonActions, NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

/*
 * Owner report (16 Nov 2026): after opening Notifications (bell), tapping the Account tab kept
 * opening Notifications instead of Account.
 *
 * Cause: the Account tab is lazy. The first time it is opened by `navigate('OwnerAccountTab',
 * { screen: 'Notifications' })`, React Navigation treats `screen` as the stack's INITIAL route
 * (initial defaults to true), so the stack was built as [Notifications] only, with no Account screen
 * underneath. popToTopOnBlur then had nothing to pop, and every later tap on the Account tab showed
 * that one remaining screen. Passing `initial: false` builds the normal [Account, Notifications]
 * stack, so popToTopOnBlur (already configured) returns the tab to Account.
 *
 * This uses a real Tab + nested Stack shaped like OwnerNavigator / DashboardAccountStack, with the
 * same popToTopOnBlur option.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NavRef = any;
const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const Screen = ({ label }: { label: string }) => <Text>{label}</Text>;
const AccountStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="DashboardAccount" options={{ headerShown: false }}>{() => <Screen label="account-root" />}</Stack.Screen>
    <Stack.Screen name="Notifications">{() => <Screen label="notifications" />}</Stack.Screen>
    <Stack.Screen name="Assistant">{() => <Screen label="assistant" />}</Stack.Screen>
  </Stack.Navigator>
);

function App({ navRef }: { navRef: NavRef }) {
  return (
    <NavigationContainer ref={navRef}>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="OwnerDashboardTab">{() => <Screen label="dashboard" />}</Tab.Screen>
        <Tab.Screen name="OwnerAccountTab" component={AccountStack} options={{ popToTopOnBlur: true }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

/** The screen currently on top of the nested Account stack. */
function accountScreen(navRef: NavRef): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nested = navRef.getRootState().routes.find((r: any) => r.name === 'OwnerAccountTab')?.state;
  return nested ? nested.routes[nested.index ?? 0].name : undefined;
}

/** What BottomTabBar does on a tap of an unfocused tab: navigate(route.name, route.params). */
function tapTab(navRef: NavRef, name: string) {
  const tabs = navRef.getRootState();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const route = tabs.routes.find((r: any) => r.name === name);
  navRef.dispatch({ ...CommonActions.navigate(route.name, route.params), target: tabs.key });
}

async function openThenLeaveThenTapAccount(screen: 'Notifications' | 'Assistant', params: Record<string, unknown>) {
  const navRef: NavRef = createNavigationContainerRef();
  await render(<App navRef={navRef} />);
  await act(async () => { navRef.navigate('OwnerAccountTab', { screen, ...params }); });
  expect(accountScreen(navRef)).toBe(screen);
  await act(async () => { tapTab(navRef, 'OwnerDashboardTab'); });
  await act(async () => { tapTab(navRef, 'OwnerAccountTab'); });
  return accountScreen(navRef);
}

describe('Account tab after opening a nested screen from elsewhere (owner report, 16 Nov)', () => {
  it('REPRODUCES the bug with the old call: the Account tab reopens Notifications', async () => {
    expect(await openThenLeaveThenTapAccount('Notifications', {})).toBe('Notifications');
  });

  it('REPRODUCES the same bug for the Assistant launcher with the old call', async () => {
    expect(await openThenLeaveThenTapAccount('Assistant', {})).toBe('Assistant');
  });

  it('with initial: false the Account tab opens the Account screen (Notifications)', async () => {
    expect(await openThenLeaveThenTapAccount('Notifications', { initial: false })).toBe('DashboardAccount');
  });

  it('with initial: false the Account tab opens the Account screen (Assistant)', async () => {
    expect(await openThenLeaveThenTapAccount('Assistant', { initial: false })).toBe('DashboardAccount');
  });

  it('opening Notifications again and again keeps working and never sticks', async () => {
    const navRef: NavRef = createNavigationContainerRef();
    await render(<App navRef={navRef} />);
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { navRef.navigate('OwnerAccountTab', { screen: 'Notifications', initial: false }); });
      expect(accountScreen(navRef)).toBe('Notifications');
      await act(async () => { tapTab(navRef, 'OwnerDashboardTab'); });
      await act(async () => { tapTab(navRef, 'OwnerAccountTab'); });
      expect(accountScreen(navRef)).toBe('DashboardAccount');
    }
  });
});
