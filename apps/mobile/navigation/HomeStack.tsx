import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import CustomerDashboardScreen from '../screens/CustomerDashboardScreen';
import StyleAdvisorScreen from '../screens/StyleAdvisorScreen';
import { useStackOptions } from './screenOptions';
import { HomeHeaderButton } from './HomeHeaderButton';
import { useLanguage } from '../lib/language-context';
import type { HomeStackParamList } from './types';

const Stack = createNativeStackNavigator<HomeStackParamList>();

export default function HomeStack() {
  const stackOptions = useStackOptions();
  const { t } = useLanguage();
  return (
    <Stack.Navigator initialRouteName="CustomerDashboard">
      {/* Owner (18 Nov): in the customer login the first tab is the customer's Dashboard (it renders
          its own header). The former Home screen stays registered so existing links still open. */}
      <Stack.Screen name="CustomerDashboard" component={CustomerDashboardScreen} options={{ headerShown: false }} />
      {/* Home renders its own branded header (SectionHeader) — no native header needed for a
          tab-root screen with nowhere to go "back" from. */}
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="StyleAdvisor"
        component={StyleAdvisorScreen}
        options={{ ...stackOptions, title: t.aiStyleAdvisor, headerRight: () => <HomeHeaderButton /> }}
      />
    </Stack.Navigator>
  );
}
