import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AccountScreen from '../screens/AccountScreen';
import StyleAdvisorScreen from '../screens/StyleAdvisorScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import CreditsHistoryScreen from '../screens/CreditsHistoryScreen';
import RegisterShopScreen from '../screens/RegisterShopScreen';
import { lightStackOptions, styleAdvisorHeaderOptions } from './screenOptions';
import { HomeHeaderButton } from './HomeHeaderButton';
import { useLanguage } from '../lib/language-context';
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
      {/* CreditsHistoryScreen already renders a dark PremiumScreen body; without this override the
          header would fall back to the native-stack light default, leaving a light bar above a
          dark screen (Notifications/RegisterShop keep the default here since their bodies are
          still the legacy cream Screen wrapper, unchanged in this pass). */}
      <Stack.Screen name="CreditsHistory" component={CreditsHistoryScreen} options={{ ...lightStackOptions, title: t.fastQueCreditsLabel }} />
      <Stack.Screen name="RegisterShop" component={RegisterShopScreen} options={{ title: t.registerShopTitle }} />
    </Stack.Navigator>
  );
}
