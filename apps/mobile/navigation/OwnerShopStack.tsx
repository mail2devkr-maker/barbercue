import { createNativeStackNavigator } from '@react-navigation/native-stack';
import OwnerShopScreen from '../screens/owner/OwnerShopScreen';
import OwnerCustomersScreen from '../screens/owner/OwnerCustomersScreen';
import OwnerCustomerDetailScreen from '../screens/owner/OwnerCustomerDetailScreen';
import OwnerInvoicesScreen from '../screens/owner/OwnerInvoicesScreen';
import OwnerInvoiceDetailScreen from '../screens/owner/OwnerInvoiceDetailScreen';
import OwnerAnalyticsScreen from '../screens/owner/OwnerAnalyticsScreen';
import OwnerInventoryScreen from '../screens/owner/OwnerInventoryScreen';
import { useLanguage } from '../lib/language-context';
import { fastQue, font } from '../lib/theme';

export type OwnerShopStackParamList = {
  OwnerShop: undefined;
  OwnerCustomers: undefined;
  OwnerCustomerDetail: { customerId: string };
  OwnerInvoices: undefined;
  OwnerInvoiceDetail: { salonId: string; invoiceId: string };
  OwnerAnalytics: undefined;
  OwnerInventory: undefined;
};

const Stack = createNativeStackNavigator<OwnerShopStackParamList>();

// Issue 1 (Manage Shop parity, mobile launch mission) — OwnerShopTab was a single flat screen;
// the owner customer CRM/ledger surface needs a real list -> detail flow, so this tab becomes a
// small native stack instead, same shape as DashboardAccountStack. Services/Chairs/Staff/Hours/
// Photos all stay on the root screen (they're forms/lists, not a drill-down flow).
export default function OwnerShopStack() {
  const { t, language } = useLanguage();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="OwnerShop" component={OwnerShopScreen} />
      <Stack.Screen name="OwnerCustomers" component={OwnerCustomersScreen} options={{ headerShown: true, title: t.customersLabel }} />
      <Stack.Screen
        name="OwnerCustomerDetail"
        component={OwnerCustomerDetailScreen}
        options={{ headerShown: true, title: t.customerLabel }}
      />
      <Stack.Screen name="OwnerInvoices" component={OwnerInvoicesScreen} options={{ headerShown: true, title: 'Shop invoices' }} />
      <Stack.Screen name="OwnerInvoiceDetail" component={OwnerInvoiceDetailScreen} options={{ headerShown: true, title: 'Invoice details' }} />
      <Stack.Screen
        name="OwnerAnalytics"
        component={OwnerAnalyticsScreen}
        options={{
          headerShown: true,
          title: language === 'HI' ? 'विश्लेषण' : 'Analytics',
          headerStyle: { backgroundColor: fastQue.backgroundRaised },
          headerTintColor: fastQue.text,
          headerTitleStyle: { fontFamily: font.bodySemiBold },
        }}
      />
      <Stack.Screen
        name="OwnerInventory"
        component={OwnerInventoryScreen}
        options={{
          headerShown: true,
          title: language === 'HI' ? 'इन्वेंटरी' : 'Inventory',
          headerStyle: { backgroundColor: fastQue.backgroundRaised },
          headerTintColor: fastQue.text,
          headerTitleStyle: { fontFamily: font.bodySemiBold },
        }}
      />
    </Stack.Navigator>
  );
}
