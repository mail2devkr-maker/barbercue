import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { PushTransportProbe } from './components/PushTransportProbe';

export default function App() {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.kicker}>BARBERCUE</Text>
        <Text style={styles.title}>PHYSICAL PUSH TEST</Text>
        <Text style={styles.note}>
          This temporary build only verifies Android notification permission, Firebase/FCM registration,
          and Expo push-token delivery. The normal BarberCue UI is intentionally disabled in this test build.
        </Text>
      </View>
      <PushTransportProbe />
      <View style={styles.footer}>
        <Text style={styles.footerText}>TEST BUILD — NOT PRODUCTION</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#17130F',
    paddingHorizontal: 16,
    paddingTop: 28,
  },
  header: {
    marginTop: 24,
    paddingTop: 24,
    paddingHorizontal: 4,
  },
  kicker: {
    color: '#D79B73',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 2,
  },
  title: {
    marginTop: 8,
    color: '#FFFFFF',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
  },
  note: {
    marginTop: 14,
    color: '#D9D0C7',
    fontSize: 15,
    lineHeight: 22,
  },
  footer: {
    marginTop: 'auto',
    marginBottom: 24,
    alignItems: 'center',
  },
  footerText: {
    color: '#A89B90',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
