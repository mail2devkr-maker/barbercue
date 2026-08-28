import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SalonSearchScreen from '../screens/SalonSearchScreen';
import SalonProfileScreen from '../screens/SalonProfileScreen';
import StaffSelectScreen from '../screens/StaffSelectScreen';
import DateSelectScreen from '../screens/DateSelectScreen';
import SlotSelectScreen from '../screens/SlotSelectScreen';
import ConfirmBookingScreen from '../screens/ConfirmBookingScreen';
import WalkInJoinScreen from '../screens/WalkInJoinScreen';
import { darkStackOptions } from './screenOptions';
import type { SearchStackParamList } from './types';

const Stack = createNativeStackNavigator<SearchStackParamList>();

// Discovery + the full booking flow, nested under the Search tab so it keeps a native back
// button through every step while the bottom tab bar stays visible. Screen visuals here are
// unchanged from the MVP pass (M2B) — this checkpoint only moves them into the new shell.
export default function SearchStack() {
  return (
    <Stack.Navigator initialRouteName="SalonSearch" screenOptions={darkStackOptions}>
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
