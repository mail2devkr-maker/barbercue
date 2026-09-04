import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SalonSearchScreen from '../screens/SalonSearchScreen';
import SalonProfileScreen from '../screens/SalonProfileScreen';
import StaffSelectScreen from '../screens/StaffSelectScreen';
import DateSelectScreen from '../screens/DateSelectScreen';
import SlotSelectScreen from '../screens/SlotSelectScreen';
import ConfirmBookingScreen from '../screens/ConfirmBookingScreen';
import WalkInJoinScreen from '../screens/WalkInJoinScreen';
import { lightStackOptions } from './screenOptions';
import { HomeHeaderButton } from './HomeHeaderButton';
import { useLanguage } from '../lib/language-context';
import type { SearchStackParamList } from './types';

const Stack = createNativeStackNavigator<SearchStackParamList>();

// A header-right "Home" action on every screen below the tab root — the native back button
// alone gets you one step up, but a customer three steps into a booking flow (or six, via
// StyleAdvisor -> Search -> Profile -> Staff -> Date -> Slot -> Confirm) still needs a single tap
// straight back to Home rather than repeated Back presses. SalonSearch itself doesn't get one —
// it's already the Search tab's own root, reachable via the tab bar.
const homeAction = { headerRight: () => <HomeHeaderButton /> };

// Discovery + the full booking flow, nested under the Search tab so it keeps a native back
// button through every step while the bottom tab bar stays visible.
export default function SearchStack() {
  const { t } = useLanguage();
  return (
    <Stack.Navigator initialRouteName="SalonSearch" screenOptions={lightStackOptions}>
      <Stack.Screen name="SalonSearch" component={SalonSearchScreen} options={{ title: t.findASalonTitle }} />
      <Stack.Screen name="SalonProfile" component={SalonProfileScreen} options={{ title: t.salonTitle, ...homeAction }} />
      <Stack.Screen name="StaffSelect" component={StaffSelectScreen} options={{ title: t.chooseABarberTitle, ...homeAction }} />
      <Stack.Screen name="DateSelect" component={DateSelectScreen} options={{ title: t.chooseADateTitle, ...homeAction }} />
      <Stack.Screen name="SlotSelect" component={SlotSelectScreen} options={{ title: t.chooseATimeTitle, ...homeAction }} />
      <Stack.Screen name="ConfirmBooking" component={ConfirmBookingScreen} options={{ title: t.confirmTitle, ...homeAction }} />
      <Stack.Screen name="WalkInJoin" component={WalkInJoinScreen} options={{ title: t.queueTitle, ...homeAction }} />
    </Stack.Navigator>
  );
}
