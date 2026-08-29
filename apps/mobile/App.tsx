import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Fraunces_500Medium, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import {
  WorkSans_400Regular,
  WorkSans_500Medium,
  WorkSans_600SemiBold,
  WorkSans_700Bold,
} from '@expo-google-fonts/work-sans';
import { Role } from '@barbercue/shared';
import { AuthProvider, useAuth } from './lib/auth-context';
import { color } from './lib/theme';
import { OfflineBanner } from './components/OfflineBanner';
import AuthStack from './navigation/AuthStack';
import RootNavigator from './navigation/RootNavigator';
import OwnerNavigator from './navigation/OwnerNavigator';
import StaffNavigator from './navigation/StaffNavigator';

// Routes by the account's ACTUAL roles (never by which login screen was used to sign in) — an
// owner-role account routes to the Owner shell even if it somehow also carries CUSTOMER, and an
// owner+staff account gets the strictly-more-capable Owner shell. Customer is the fallback: every
// account has at least one role, and the only other roles this app's login screens ever produce
// are OWNER/STAFF, so falling through to Customer only happens for a genuine customer account.
function AuthenticatedNavigator({ roles }: { roles: Role[] }) {
  if (roles.includes(Role.SALON_OWNER)) return <OwnerNavigator />;
  if (roles.includes(Role.SALON_STAFF)) return <StaffNavigator />;
  return <RootNavigator />;
}

function Root() {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={color.accent} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <OfflineBanner />
      {status === 'authenticated' && user ? <AuthenticatedNavigator roles={user.roles} /> : <AuthStack />}
    </NavigationContainer>
  );
}

export default function App() {
  // Loaded once for the whole app — Fraunces (display/headings) + Work Sans (body/UI), matching
  // apps/web's --font-display / --font-body. Gated behind the same loading view already used for
  // the auth-status check below, rather than a second splash/loading mechanism.
  const [fontsLoaded] = useFonts({
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    WorkSans_400Regular,
    WorkSans_500Medium,
    WorkSans_600SemiBold,
    WorkSans_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={color.accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Root />
        <StatusBar style="dark" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
});
