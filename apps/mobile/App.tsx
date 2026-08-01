import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { Role } from '@barbercue/shared';

// Phase 1 foundation shell only — the real screens (role select, salon list, booking, queue
// status) are rebuilt against the live API in a later phase per PROJECT_STRUCTURE.md; the
// original prototype's screens remain as reference in /legacy-prototype. Importing Role from
// @barbercue/shared here is the foundation-level proof this app can consume the shared package,
// per Phase 1 requirement #13.
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>BarberCue</Text>
      <Text style={styles.subtitle}>Skip the wait. Book your chair.</Text>
      <Text style={styles.note}>
        Phase 1 foundation shell — shared package loaded ({Role.CUSTOMER} role available).
      </Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1C1A17',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { fontSize: 34, fontWeight: '700', color: '#EDE6DA' },
  subtitle: { fontSize: 15, color: '#B8AFA0', marginTop: 8, marginBottom: 24 },
  note: { fontSize: 12, color: '#B8AFA0', textAlign: 'center' },
});
