import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MyBookingsScreen from '../screens/MyBookingsScreen';
import BookingDetailScreen from '../screens/BookingDetailScreen';
import { lightStackOptions } from './screenOptions';
import { HomeHeaderButton } from './HomeHeaderButton';
import { useLanguage } from '../lib/language-context';
import type { BookingsStackParamList } from './types';

const Stack = createNativeStackNavigator<BookingsStackParamList>();

export default function BookingsStack() {
  const { t } = useLanguage();
  return (
    <Stack.Navigator initialRouteName="MyBookings" screenOptions={lightStackOptions}>
      <Stack.Screen name="MyBookings" component={MyBookingsScreen} options={{ title: t.myBookingsTitle }} />
      <Stack.Screen
        name="BookingDetail"
        component={BookingDetailScreen}
        options={{ title: t.bookingTitle, headerRight: () => <HomeHeaderButton /> }}
      />
    </Stack.Navigator>
  );
}
