import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AccountScreen from '../screens/AccountScreen';
import StyleAdvisorScreen from '../screens/StyleAdvisorScreen';
import { styleAdvisorHeaderOptions } from './screenOptions';
import type { AccountStackParamList } from './types';

const Stack = createNativeStackNavigator<AccountStackParamList>();

export default function AccountStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Account" component={AccountScreen} options={{ headerShown: false }} />
      <Stack.Screen name="StyleAdvisor" component={StyleAdvisorScreen} options={styleAdvisorHeaderOptions} />
    </Stack.Navigator>
  );
}
