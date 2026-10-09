import { createNativeStackNavigator } from '@react-navigation/native-stack';
import OwnerManageScreen from '../screens/owner/OwnerManageScreen';
import OwnerCustomersScreen from '../screens/owner/OwnerCustomersScreen';
import OwnerCustomerDetailScreen from '../screens/owner/OwnerCustomerDetailScreen';
import OwnerAnalyticsScreen from '../screens/owner/OwnerAnalyticsScreen';
import OwnerSettingsScreen from '../screens/owner/OwnerSettingsScreen';
import OwnerReviewsScreen from '../screens/owner/OwnerReviewsScreen';
import OwnerScheduleScreen from '../screens/owner/OwnerScheduleScreen';
import OwnerVerificationScreen from '../screens/owner/OwnerVerificationScreen';
import {
  OwnerChairsScreen,
  OwnerHoursScreen,
  OwnerPhotosScreen,
  OwnerServicesScreen,
  OwnerStaffScreen,
} from '../screens/owner/OwnerShopSectionScreens';
import { useLanguage } from '../lib/language-context';
import { lightStackOptions } from './screenOptions';

export type OwnerShopStackParamList = {
  // The Shop tab's root is the management hub (every section the website offers).
  OwnerShop: undefined;
  OwnerSettings: undefined;
  OwnerSchedule: undefined;
  OwnerCustomers: undefined;
  OwnerCustomerDetail: { customerId: string };
  OwnerAnalytics: undefined;
  OwnerReviews: undefined;
  OwnerVerification: undefined;
  OwnerServices: undefined;
  OwnerHours: undefined;
  OwnerPhotos: undefined;
  OwnerChairs: undefined;
  OwnerStaff: undefined;
};

const Stack = createNativeStackNavigator<OwnerShopStackParamList>();

// The Shop tab was a single long screen; it is now a hub (OwnerShop) that opens one native screen
// per website management section. Live queue and Bookings are existing tabs, reached from the hub.
export default function OwnerShopStack() {
  const { t } = useLanguage();
  // The app's premium (dark) header preset, so owner screens match the rest of the app.
  const titled = (title: string) => ({ ...lightStackOptions, headerShown: true, title });
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="OwnerShop" component={OwnerManageScreen} />
      <Stack.Screen name="OwnerSettings" component={OwnerSettingsScreen} options={titled(t.ownerSectionSettings)} />
      <Stack.Screen name="OwnerSchedule" component={OwnerScheduleScreen} options={titled(t.ownerSectionSchedule)} />
      <Stack.Screen name="OwnerCustomers" component={OwnerCustomersScreen} options={titled(t.customersLabel)} />
      <Stack.Screen name="OwnerCustomerDetail" component={OwnerCustomerDetailScreen} options={titled(t.customerLabel)} />
      <Stack.Screen name="OwnerAnalytics" component={OwnerAnalyticsScreen} options={titled(t.ownerSectionAnalytics)} />
      <Stack.Screen name="OwnerReviews" component={OwnerReviewsScreen} options={titled(t.ownerSectionReviews)} />
      <Stack.Screen name="OwnerVerification" component={OwnerVerificationScreen} options={titled(t.ownerSectionVerification)} />
      <Stack.Screen name="OwnerServices" component={OwnerServicesScreen} options={titled(t.ownerSectionServices)} />
      <Stack.Screen name="OwnerHours" component={OwnerHoursScreen} options={titled(t.ownerSectionHours)} />
      <Stack.Screen name="OwnerPhotos" component={OwnerPhotosScreen} options={titled(t.ownerSectionPhotos)} />
      <Stack.Screen name="OwnerChairs" component={OwnerChairsScreen} options={titled(t.ownerSectionChairs)} />
      <Stack.Screen name="OwnerStaff" component={OwnerStaffScreen} options={titled(t.ownerSectionStaff)} />
    </Stack.Navigator>
  );
}
