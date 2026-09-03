import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SalonSearchScreen from '../screens/SalonSearchScreen';
import SalonProfileScreen from '../screens/SalonProfileScreen';
import StaffSelectScreen from '../screens/StaffSelectScreen';
import DateSelectScreen from '../screens/DateSelectScreen';
import SlotSelectScreen from '../screens/SlotSelectScreen';
import ConfirmBookingScreen from '../screens/ConfirmBookingScreen';
import WalkInJoinScreen from '../screens/WalkInJoinScreen';
import { lightStackOptions } from './screenOptions';
import type { SearchStackParamList } from './types';

const Stack = createNativeStackNavigator<SearchStackParamList>();

/**
 * Issue 2 (mobile launch mission) — browse-first, auth-last. Reuses the exact same screens as the
 * authenticated SearchStack (no forked/duplicated booking logic); the only screens that behave
 * differently pre-auth are ConfirmBookingScreen and WalkInJoinScreen themselves, which each check
 * useAuth().status and show an inline Google sign-in gate in place of the real submit button —
 * see their own comments and lib/guest-booking-handoff.ts for how the in-progress selection
 * survives the auth-status navigator swap. No "Home" header shortcut here (unlike SearchStack) —
 * there is no customer Home tab to jump to before authentication.
 */
export default function GuestSearchStack() {
  return (
    <Stack.Navigator initialRouteName="SalonSearch" screenOptions={lightStackOptions}>
      <Stack.Screen name="SalonSearch" component={SalonSearchScreen} options={{ title: 'Find a salon' }} />
      <Stack.Screen name="SalonProfile" component={SalonProfileScreen} options={{ title: 'Salon' }} />
      <Stack.Screen name="StaffSelect" component={StaffSelectScreen} options={{ title: 'Choose a barber' }} />
      <Stack.Screen name="DateSelect" component={DateSelectScreen} options={{ title: 'Choose a date' }} />
      <Stack.Screen name="SlotSelect" component={SlotSelectScreen} options={{ title: 'Choose a time' }} />
      <Stack.Screen name="ConfirmBooking" component={ConfirmBookingScreen} options={{ title: 'Confirm' }} />
      <Stack.Screen name="WalkInJoin" component={WalkInJoinScreen} options={{ title: 'Queue' }} />
    </Stack.Navigator>
  );
}
