import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MyBookingsScreen from '../screens/MyBookingsScreen';
import BookingDetailScreen from '../screens/BookingDetailScreen';
import { lightStackOptions } from './screenOptions';
import type { BookingsStackParamList } from './types';

const Stack = createNativeStackNavigator<BookingsStackParamList>();

export default function BookingsStack() {
  return (
    <Stack.Navigator initialRouteName="MyBookings" screenOptions={lightStackOptions}>
      <Stack.Screen name="MyBookings" component={MyBookingsScreen} options={{ title: 'My bookings' }} />
      <Stack.Screen name="BookingDetail" component={BookingDetailScreen} options={{ title: 'Booking' }} />
    </Stack.Navigator>
  );
}
