import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

const CHANNEL_ID = 'barbercue-operations';
const EAS_PROJECT_ID = '01998c87-126d-40e8-aac3-205891b74b08';

export function PushTransportProbe() {
  const [status, setStatus] = useState('UI READY — loading notification module…');
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const Notifications = await import('expo-notifications');
        if (!active) return;
        setStatus('Notification module loaded. Preparing Android channel…');

        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
            name: 'Bookings and live queue',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 120, 250],
            sound: 'default',
          });
        }

        if (!active) return;
        setStatus('Channel ready. Checking notification permission…');

        const current = await Notifications.getPermissionsAsync();
        const permission =
          current.status === 'granted'
            ? current
            : await Notifications.requestPermissionsAsync();

        if (!active) return;
        if (permission.status !== 'granted') {
          setStatus('PERMISSION DENIED — enable BarberCue notifications in Android Settings, then reopen this test app.');
          return;
        }

        setStatus('Permission granted. Requesting Expo push token…');
        const result = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
        if (!active) return;

        setToken(result.data);
        setStatus('READY — Firebase/FCM registration succeeded. Send the token below to Boss.');
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        setStatus(`PUSH DIAGNOSTIC ERROR — ${message}`);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.title}>LIVE PUSH STATUS</Text>
        <Text style={styles.status}>{status}</Text>
        {token ? (
          <View style={styles.tokenBox}>
            <Text style={styles.tokenLabel}>EXPO PUSH TOKEN</Text>
            <Text selectable style={styles.token}>
              {token}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    marginTop: 28,
  },
  card: {
    width: '100%',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: '#FFF8F2',
    borderWidth: 2,
    borderColor: '#D47A4A',
  },
  title: {
    fontSize: 14,
    fontWeight: '900',
    color: '#512719',
    letterSpacing: 1,
  },
  status: {
    marginTop: 10,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
    color: '#512719',
  },
  tokenBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D8C6B8',
  },
  tokenLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#7B5A49',
    letterSpacing: 1,
  },
  token: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    color: '#111111',
  },
});
