import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DashboardAccountScreen from '../screens/dashboard/DashboardAccountScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import { lightStackOptions } from './screenOptions';
import type { DashboardAccountStackParamList } from './types';

const Stack = createNativeStackNavigator<DashboardAccountStackParamList>();

export default function DashboardAccountStack() {
  return (
    <Stack.Navigator screenOptions={lightStackOptions}>
      <Stack.Screen name="DashboardAccount" component={DashboardAccountScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
    </Stack.Navigator>
  );
}
