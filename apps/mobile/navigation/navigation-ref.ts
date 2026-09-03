import { createNavigationContainerRef } from '@react-navigation/native';

// The authenticated root swaps between customer, owner and staff navigators. A notification can
// open the app before its authenticated navigator has mounted, so this ref is deliberately paired
// with the small pending-navigation queue in lib/push-navigation.ts instead of assuming a route
// is immediately available.
export type AppNavigationParamList = {
  OwnerBookingsTab: undefined;
};

export const navigationRef = createNavigationContainerRef<AppNavigationParamList>();
