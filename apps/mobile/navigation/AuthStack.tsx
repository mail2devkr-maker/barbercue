import { createNativeStackNavigator } from '@react-navigation/native-stack';
import RoleSelectScreen from '../screens/RoleSelectScreen';
import PhoneOtpLoginScreen from '../screens/PhoneOtpLoginScreen';
import OwnerStaffLoginScreen from '../screens/OwnerStaffLoginScreen';
import OwnerStaffPasswordRecoveryScreen from '../screens/OwnerStaffPasswordRecoveryScreen';
import { lightStackOptions } from './screenOptions';

export type AuthStackParamList = {
  RoleSelect: undefined;
  CustomerLogin: undefined;
  OwnerStaffLogin: { role: 'OWNER' | 'STAFF' };
  PasswordRecovery: { audience: 'owner' | 'staff' };
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

// Mounted only when unauthenticated (see App.tsx). Customer Google/OTP sign-in
// (PhoneOtpLoginScreen) is reused exactly as-is — its own logic and design are frozen. Owner and
// Staff both hit the same POST auth/staff/login the web app's own /owner/login and /staff/login
// pages already use; there is no separate backend concept of "owner auth" vs "staff auth".
export default function AuthStack() {
  return (
    <Stack.Navigator screenOptions={lightStackOptions}>
      <Stack.Screen name="RoleSelect" component={RoleSelectScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CustomerLogin" component={PhoneOtpLoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="OwnerStaffLogin" component={OwnerStaffLoginScreen} options={{ title: 'Sign in' }} />
      <Stack.Screen name="PasswordRecovery" component={OwnerStaffPasswordRecoveryScreen} options={{ title: 'Password recovery' }} />
    </Stack.Navigator>
  );
}
