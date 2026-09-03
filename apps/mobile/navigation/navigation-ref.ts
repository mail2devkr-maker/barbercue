import { createNavigationContainerRef, type NavigatorScreenParams } from '@react-navigation/native';
import type { SearchStackParamList } from './types';

// The authenticated root swaps between customer, owner and staff navigators. A notification can
// open the app before its authenticated navigator has mounted, so this ref is deliberately paired
// with the small pending-navigation queue in lib/push-navigation.ts instead of assuming a route
// is immediately available. SearchTab (customer) is used the same way by
// lib/guest-booking-handoff.ts's replay — both are "this specific route only exists once the
// right role-specific navigator has mounted" cases sharing one generic ref.
export type AppNavigationParamList = {
  OwnerBookingsTab: undefined;
  SearchTab: NavigatorScreenParams<SearchStackParamList>;
};

export const navigationRef = createNavigationContainerRef<AppNavigationParamList>();
