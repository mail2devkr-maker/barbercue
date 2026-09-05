import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AccountScreen from '../screens/AccountScreen';
import StyleAdvisorScreen from '../screens/StyleAdvisorScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import CreditsHistoryScreen from '../screens/CreditsHistoryScreen';
import { styleAdvisorHeaderOptions } from './screenOptions';
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
      <Stack.Screen name="CreditsHistory" component={CreditsHistoryScreen} options={{ title: t.fastQueCreditsLabel }} />
    </Stack.Navigator>
  );
}
