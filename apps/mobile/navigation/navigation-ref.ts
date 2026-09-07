import { createNavigationContainerRef, type NavigatorScreenParams } from '@react-navigation/native';
import type { AccountStackParamList, SearchStackParamList } from './types';

// The authenticated root swaps between customer, owner and staff navigators. A notification can
// open the app before its authenticated navigator has mounted, so this ref is deliberately paired
// with the small pending-navigation queue in lib/push-navigation.ts instead of assuming a route
// is immediately available. SearchTab (customer) is used the same way by
// lib/guest-booking-handoff.ts's replay, and AccountTab by
// lib/shop-registration-intent.ts's replay (Mobile Shop Owner Onboarding mission) — all three are
// "this specific route only exists once the right role-specific navigator has mounted" cases
// sharing one generic ref.
export type AppNavigationParamList = {
  OwnerBookingsTab: undefined;
  SearchTab: NavigatorScreenParams<SearchStackParamList>;
  AccountTab: NavigatorScreenParams<AccountStackParamList>;
};

export const navigationRef = createNavigationContainerRef<AppNavigationParamList>();
