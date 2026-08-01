import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './lib/auth-context';
import PhoneOtpLoginScreen from './screens/PhoneOtpLoginScreen';
import AccountScreen from './screens/AccountScreen';

// Phase 2: real authentication screens replace the Phase 1.5 foundation shell. Customer-only —
// staff/owner/admin authenticate via the web dashboard, not this app (ARCHITECTURE.md §2). The
// original prototype's screens remain as reference in /legacy-prototype.
function Root() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#EDE6DA" size="large" />
      </View>
    );
  }

  return status === 'authenticated' ? <AccountScreen /> : <PhoneOtpLoginScreen />;
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
      <StatusBar style="light" />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#1C1A17', alignItems: 'center', justifyContent: 'center' },
});
