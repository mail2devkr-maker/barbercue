import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MyBookingsScreen from '../screens/MyBookingsScreen';
import BookingDetailScreen from '../screens/BookingDetailScreen';
import { darkStackOptions } from './screenOptions';
import type { BookingsStackParamList } from './types';

const Stack = createNativeStackNavigator<BookingsStackParamList>();

// Unchanged screen visuals this checkpoint (M2B) — moved into the new shell only.
export default function BookingsStack() {
  return (
    <Stack.Navigator initialRouteName="MyBookings" screenOptions={darkStackOptions}>
      <Stack.Screen name="MyBookings" component={MyBookingsScreen} options={{ title: 'My bookings' }} />
      <Stack.Screen name="BookingDetail" component={BookingDetailScreen} options={{ title: 'Booking' }} />
    </Stack.Navigator>
  );
}
