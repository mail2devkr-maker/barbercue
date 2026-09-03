import { createNativeStackNavigator } from '@react-navigation/native-stack';
import OwnerShopScreen from '../screens/owner/OwnerShopScreen';
import OwnerCustomersScreen from '../screens/owner/OwnerCustomersScreen';
import OwnerCustomerDetailScreen from '../screens/owner/OwnerCustomerDetailScreen';

export type OwnerShopStackParamList = {
  OwnerShop: undefined;
  OwnerCustomers: undefined;
  OwnerCustomerDetail: { customerId: string };
};

const Stack = createNativeStackNavigator<OwnerShopStackParamList>();

// Issue 1 (Manage Shop parity, mobile launch mission) — OwnerShopTab was a single flat screen;
// the owner customer CRM/ledger surface needs a real list -> detail flow, so this tab becomes a
// small native stack instead, same shape as DashboardAccountStack. Services/Chairs/Staff/Hours/
// Photos all stay on the root screen (they're forms/lists, not a drill-down flow).
export default function OwnerShopStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="OwnerShop" component={OwnerShopScreen} />
      <Stack.Screen name="OwnerCustomers" component={OwnerCustomersScreen} options={{ headerShown: true, title: 'Customers' }} />
      <Stack.Screen
        name="OwnerCustomerDetail"
        component={OwnerCustomerDetailScreen}
        options={{ headerShown: true, title: 'Customer' }}
      />
    </Stack.Navigator>
  );
}
