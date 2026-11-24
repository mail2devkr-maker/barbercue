import { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NavigatorScreenParams } from '@react-navigation/native';
import RoleSelectScreen from '../screens/RoleSelectScreen';
import PhoneOtpLoginScreen from '../screens/PhoneOtpLoginScreen';
import OwnerStaffLoginScreen from '../screens/OwnerStaffLoginScreen';
import EmployeeLoginScreen from '../screens/EmployeeLoginScreen';
import OwnerRegisterScreen from '../screens/OwnerRegisterScreen';
import OwnerStaffPasswordRecoveryScreen from '../screens/OwnerStaffPasswordRecoveryScreen';
import GuestSearchStack from './GuestSearchStack';
import GuestQueueStatusScreen from '../screens/GuestQueueStatusScreen';
import { navigationRef } from './navigation-ref';
import { subscribeQueueArrivalNavigation } from '../lib/queue-push-navigation';
import { useStackOptions } from './screenOptions';
import { useLanguage } from '../lib/language-context';
import type { SearchStackParamList } from './types';

export type AuthStackParamList = {
  RoleSelect: undefined;
  CustomerLogin: undefined;
  OwnerStaffLogin: { role: 'OWNER' | 'STAFF' };
  EmployeeLogin: undefined;
  OwnerRegister: undefined;
  PasswordRecovery: { audience: 'owner' | 'staff' };
  // Issue 2 (mobile launch mission) — browse-first, auth-last. See GuestSearchStack's own comment.
  GuestBrowse: NavigatorScreenParams<SearchStackParamList> | undefined;
  GuestQueueStatus: { salonId: string; entryId: string };
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

function GuestQueuePushNavigationBridge() {
  useEffect(
    () => subscribeQueueArrivalNavigation('guest', (payload) => {
      if (!navigationRef.isReady()) return false;
      // The screen requires an existing local capability and verifies it against the server.
      navigationRef.navigate('GuestQueueStatus', {
        salonId: payload.salonId,
        entryId: payload.queueEntryId,
      });
      return true;
    }),
    [],
  );
  return null;
}

// Mounted only when unauthenticated (see App.tsx). Customer Google/OTP sign-in
// (PhoneOtpLoginScreen) is reused exactly as-is — its own logic and design are frozen. Owner and
// Staff both hit the same POST auth/staff/login the web app's own /owner/login and /staff/login
// pages already use; there is no separate backend concept of "owner auth" vs "staff auth".
// Sign-in pages draw their own "‹ Back" (components/AuthBackButton) instead of the native header, so
// the way back is always visible on the dark sign-in design (owner report 24 Nov).
export default function AuthStack() {
  const stackOptions = useStackOptions();
  const { t } = useLanguage();
  return (
    <>
    <GuestQueuePushNavigationBridge />
    <Stack.Navigator screenOptions={stackOptions}>
      <Stack.Screen name="RoleSelect" component={RoleSelectScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CustomerLogin" component={PhoneOtpLoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="OwnerStaffLogin" component={OwnerStaffLoginScreen} options={{ headerShown: false, title: t.signInTitle }} />
      <Stack.Screen name="EmployeeLogin" component={EmployeeLoginScreen} options={{ headerShown: false, title: t.employeeLoginTitle }} />
      <Stack.Screen name="OwnerRegister" component={OwnerRegisterScreen} options={{ headerShown: false, title: "Create your account" }} />
      <Stack.Screen name="PasswordRecovery" component={OwnerStaffPasswordRecoveryScreen} options={{ headerShown: false, title: t.passwordRecoveryTitle }} />
      <Stack.Screen name="GuestBrowse" component={GuestSearchStack} options={{ headerShown: false }} />
      <Stack.Screen name="GuestQueueStatus" component={GuestQueueStatusScreen} options={{ title: "Your Live Queue" }} />
    </Stack.Navigator>
    </>
  );
}
