import { createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { Role, type MeResponse, type PushNotificationData } from '@barbercue/shared';

export const navigationRef = createNavigationContainerRef<ParamListBase>();

export function navigateFromPush(data: PushNotificationData, user: MeResponse): boolean {
  if (!navigationRef.isReady()) return false;
  if (user.roles.includes(Role.SALON_OWNER)) {
    if (data.screen === 'OWNER_QUEUE') navigationRef.navigate('OwnerQueueTab');
    else if (data.screen === 'NOTIFICATIONS') navigationRef.navigate('OwnerAccountTab', { screen: 'Notifications' });
    else navigationRef.navigate('OwnerBookingsTab');
    return true;
  }
  if (user.roles.includes(Role.SALON_STAFF)) {
    if (data.screen === 'NOTIFICATIONS') navigationRef.navigate('StaffAccountTab', { screen: 'Notifications' });
    else navigationRef.navigate('StaffTodayTab');
    return true;
  }
  if (data.screen === 'CUSTOMER_QUEUE') {
    navigationRef.navigate('QueueTab', { screen: 'QueueHome' });
  } else if (data.screen === 'NOTIFICATIONS') {
    navigationRef.navigate('AccountTab', { screen: 'Notifications' });
  } else if (data.bookingId) {
    navigationRef.navigate('BookingsTab', {
      screen: 'BookingDetail',
      params: { bookingId: data.bookingId },
    });
  } else {
    navigationRef.navigate('BookingsTab', { screen: 'MyBookings' });
  }
  return true;
}
