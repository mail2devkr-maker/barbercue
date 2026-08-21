import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AccountScreen from '../screens/AccountScreen';
import SalonSearchScreen from '../screens/SalonSearchScreen';
import SalonProfileScreen from '../screens/SalonProfileScreen';
import StaffSelectScreen from '../screens/StaffSelectScreen';
import DateSelectScreen from '../screens/DateSelectScreen';
import SlotSelectScreen from '../screens/SlotSelectScreen';
import ConfirmBookingScreen from '../screens/ConfirmBookingScreen';
import MyBookingsScreen from '../screens/MyBookingsScreen';
import BookingDetailScreen from '../screens/BookingDetailScreen';
import WalkInJoinScreen from '../screens/WalkInJoinScreen';
import StyleAdvisorScreen from '../screens/StyleAdvisorScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Mounted only when authenticated (see App.tsx) — every screen here assumes a logged-in customer,
// matching the web app's book/layout.tsx + account/layout.tsx RequireRole gates.
export default function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Account"
      screenOptions={{
        headerStyle: { backgroundColor: '#1C1A17' },
        headerTintColor: '#EDE6DA',
        contentStyle: { backgroundColor: '#1C1A17' },
      }}
    >
      <Stack.Screen name="Account" component={AccountScreen} options={{ title: 'BarberCue' }} />
      <Stack.Screen name="SalonSearch" component={SalonSearchScreen} options={{ title: 'Find a salon' }} />
      <Stack.Screen name="SalonProfile" component={SalonProfileScreen} options={{ title: 'Salon' }} />
      <Stack.Screen name="StaffSelect" component={StaffSelectScreen} options={{ title: 'Choose a barber' }} />
      <Stack.Screen name="DateSelect" component={DateSelectScreen} options={{ title: 'Choose a date' }} />
      <Stack.Screen name="SlotSelect" component={SlotSelectScreen} options={{ title: 'Choose a time' }} />
      <Stack.Screen name="ConfirmBooking" component={ConfirmBookingScreen} options={{ title: 'Confirm' }} />
      <Stack.Screen name="MyBookings" component={MyBookingsScreen} options={{ title: 'My bookings' }} />
      <Stack.Screen name="BookingDetail" component={BookingDetailScreen} options={{ title: 'Booking' }} />
      <Stack.Screen name="WalkInJoin" component={WalkInJoinScreen} options={{ title: 'Queue' }} />
      <Stack.Screen name="StyleAdvisor" component={StyleAdvisorScreen} options={{ title: 'AI Style Advisor' }} />
    </Stack.Navigator>
  );
}
