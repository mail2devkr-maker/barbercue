import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AccountScreen from '../screens/AccountScreen';
import StyleAdvisorScreen from '../screens/StyleAdvisorScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import CreditsHistoryScreen from '../screens/CreditsHistoryScreen';
import RegisterShopScreen from '../screens/RegisterShopScreen';
import { lightStackOptions, styleAdvisorHeaderOptions } from './screenOptions';
import { HomeHeaderButton } from './HomeHeaderButton';
import { useLanguage } from '../lib/language-context';
import { isCreditsEnabled } from '../lib/feature-flags';
import type { AccountStackParamList } from './types';

const Stack = createNativeStackNavigator<AccountStackParamList>();

export default function AccountStack() {
  const { t } = useLanguage();
  return (
    <Stack.Navigator>
      <Stack.Screen name="Account" component={AccountScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="StyleAdvisor"
        component={StyleAdvisorScreen}
        options={{ ...styleAdvisorHeaderOptions, title: t.aiStyleAdvisor, headerRight: () => <HomeHeaderButton /> }}
      />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: t.notifications }} />
      {/* Google Play release gate (see lib/feature-flags.ts): the route itself is unregistered in
          the production build, not just hidden from menus — navigation.navigate('CreditsHistory')
          from anywhere (a stray link, a queued notification replay) has nowhere to go.
          CreditsHistoryScreen already renders a dark PremiumScreen body; without this header
          override it would fall back to the native-stack light default, leaving a light bar above
          a dark screen (Notifications/RegisterShop keep the default here since their bodies are
          still the legacy cream Screen wrapper, unchanged in this pass). */}
      {isCreditsEnabled() && (
        <Stack.Screen name="CreditsHistory" component={CreditsHistoryScreen} options={{ ...lightStackOptions, title: t.fastQueCreditsLabel }} />
      )}
      <Stack.Screen name="RegisterShop" component={RegisterShopScreen} options={{ title: t.registerShopTitle }} />
    </Stack.Navigator>
  );
}
