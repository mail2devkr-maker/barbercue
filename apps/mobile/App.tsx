import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { HEALTH_PATH, Role, type HealthCheckResponse } from '@barbercue/shared';

type Status = 'checking' | 'healthy' | 'offline';

// Phase 1 foundation shell + Phase 1.5 integration check. Importing Role/HealthCheckResponse/
// HEALTH_PATH from @barbercue/shared proves this app consumes the shared package; the fetch below
// proves it can actually reach the backend over the network. The real screens (role select, salon
// list, booking, queue status) are rebuilt against the live API in a later phase — the original
// prototype's screens remain as reference in /legacy-prototype.
export default function App() {
  const [status, setStatus] = useState<Status>(() =>
    process.env.EXPO_PUBLIC_API_BASE_URL ? 'checking' : 'offline',
  );

  useEffect(() => {
    const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (!baseUrl) return;

    let cancelled = false;

    fetch(`${baseUrl}/${HEALTH_PATH}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HealthCheckResponse>;
      })
      .then((body) => {
        if (!cancelled) setStatus(body.status === 'ok' ? 'healthy' : 'offline');
      })
      .catch(() => {
        if (!cancelled) setStatus('offline');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>BarberCue</Text>
      <Text style={styles.subtitle}>Skip the wait. Book your chair.</Text>
      <Text style={styles.note}>
        Phase 1 foundation shell — shared package loaded ({Role.CUSTOMER} role available).
      </Text>
      <Text style={styles.status}>
        Backend Status:{' '}
        <Text
          style={
            status === 'healthy' ? styles.statusHealthy : status === 'offline' ? styles.statusOffline : undefined
          }
        >
          {status === 'checking' ? 'Checking...' : status === 'healthy' ? 'Healthy' : 'Backend Offline'}
        </Text>
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
  status: { fontSize: 14, color: '#EDE6DA', marginTop: 16, fontFamily: 'monospace' },
  statusHealthy: { color: '#7CB342', fontWeight: '700' },
  statusOffline: { color: '#E24B4A', fontWeight: '700' },
});
