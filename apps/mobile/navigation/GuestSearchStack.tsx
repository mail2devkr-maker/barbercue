import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SalonSearchScreen from '../screens/SalonSearchScreen';
import SalonProfileScreen from '../screens/SalonProfileScreen';
import StaffSelectScreen from '../screens/StaffSelectScreen';
import DateSelectScreen from '../screens/DateSelectScreen';
import SlotSelectScreen from '../screens/SlotSelectScreen';
import ConfirmBookingScreen from '../screens/ConfirmBookingScreen';
import WalkInJoinScreen from '../screens/WalkInJoinScreen';
import { lightStackOptions } from './screenOptions';
import { useLanguage } from '../lib/language-context';
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
  const { t } = useLanguage();
  return (
    <Stack.Navigator initialRouteName="SalonSearch" screenOptions={lightStackOptions}>
      <Stack.Screen name="SalonSearch" component={SalonSearchScreen} options={{ title: t.findASalonTitle }} />
      <Stack.Screen name="SalonProfile" component={SalonProfileScreen} options={{ title: t.salonTitle }} />
      <Stack.Screen name="StaffSelect" component={StaffSelectScreen} options={{ title: t.chooseABarberTitle }} />
      <Stack.Screen name="DateSelect" component={DateSelectScreen} options={{ title: t.chooseADateTitle }} />
      <Stack.Screen name="SlotSelect" component={SlotSelectScreen} options={{ title: t.chooseATimeTitle }} />
      <Stack.Screen name="ConfirmBooking" component={ConfirmBookingScreen} options={{ title: t.confirmTitle }} />
      <Stack.Screen name="WalkInJoin" component={WalkInJoinScreen} options={{ title: t.queueTitle }} />
    </Stack.Navigator>
  );
}
