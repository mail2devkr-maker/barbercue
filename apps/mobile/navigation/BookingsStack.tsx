import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MyBookingsScreen from '../screens/MyBookingsScreen';
import BookingDetailScreen from '../screens/BookingDetailScreen';
import MyInvoicesScreen from '../screens/MyInvoicesScreen';
import InvoiceDetailScreen from '../screens/InvoiceDetailScreen';
import { useStackOptions } from './screenOptions';
import { HomeHeaderButton } from './HomeHeaderButton';
import { useLanguage } from '../lib/language-context';
import type { BookingsStackParamList } from './types';
import { TabBackButton } from '../components/TabBackButton';

const Stack = createNativeStackNavigator<BookingsStackParamList>();

export default function BookingsStack() {
  const stackOptions = useStackOptions();
  const { t } = useLanguage();
  return (
    <Stack.Navigator initialRouteName="MyBookings" screenOptions={stackOptions}>
      <Stack.Screen name="MyBookings" component={MyBookingsScreen} options={{ title: t.myBookingsTitle, headerLeft: () => <TabBackButton compact /> }} />
      <Stack.Screen
        name="BookingDetail"
        component={BookingDetailScreen}
        options={{ title: t.bookingTitle, headerRight: () => <HomeHeaderButton /> }}
      />
      <Stack.Screen name="MyInvoices" component={MyInvoicesScreen} options={{ title: 'My invoices' }} />
      <Stack.Screen name="InvoiceDetail" component={InvoiceDetailScreen} options={{ title: 'Invoice details' }} />
    </Stack.Navigator>
  );
}
