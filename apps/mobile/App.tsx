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
import { AuthProvider, useAuth } from './lib/auth-context';
import { color } from './lib/theme';
import PhoneOtpLoginScreen from './screens/PhoneOtpLoginScreen';
import RootNavigator from './navigation/RootNavigator';

// Phase 2: real authentication screens replace the Phase 1.5 foundation shell. Customer-only —
// staff/owner/admin authenticate via the web dashboard, not this app (ARCHITECTURE.md §2). The
// original prototype's screens remain as reference in /legacy-prototype.
//
// Phase 3B: once authenticated, mount the real navigation stack (salon browse + booking journey)
// instead of rendering AccountScreen directly — every screen in RootNavigator assumes a logged-in
// customer, same boundary as the web app's RequireRole gates.
function Root() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={color.accent} size="large" />
      </View>
    );
  }

  if (status !== 'authenticated') return <PhoneOtpLoginScreen />;

  return (
    <NavigationContainer>
      <RootNavigator />
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
        {/* Default for the authenticated app (RootNavigator's screens are dark-themed, unchanged
            in this task) — PhoneOtpLoginScreen overrides this locally for its own light surface. */}
        <StatusBar style="light" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
});
