import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DashboardAccountScreen from '../screens/dashboard/DashboardAccountScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import { useLanguage } from '../lib/language-context';

export type DashboardAccountStackParamList = {
  DashboardAccount: undefined;
  Notifications: undefined;
};

const Stack = createNativeStackNavigator<DashboardAccountStackParamList>();

// Issue 7 (mobile stabilization mission) — NotificationsScreen already existed (list, unread/read,
// mark-read, mark-all-read, pull-to-refresh) but was only ever registered on the customer
// AccountStack; Owner and Staff had no route to it at all, despite both already badging an unread
// count on their Account tab icon (see OwnerNavigator/StaffNavigator's tabBarBadge). Shared by both
// navigators' Account tab rather than declared twice, since they show the exact same two screens.
export default function DashboardAccountStack() {
  const { t } = useLanguage();
  return (
    <Stack.Navigator>
      <Stack.Screen name="DashboardAccount" component={DashboardAccountScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: t.notifications }} />
    </Stack.Navigator>
  );
}
