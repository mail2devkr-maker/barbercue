import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './lib/auth-context';
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
        <ActivityIndicator color="#EDE6DA" size="large" />
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
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Root />
        <StatusBar style="light" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#1C1A17', alignItems: 'center', justifyContent: 'center' },
});
