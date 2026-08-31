import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

const CHANNEL_ID = 'barbercue-operations';

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

export function PushTransportProbe() {
  const [status, setStatus] = useState('Preparing physical push probe…');
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
            name: 'Bookings and live queue',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 120, 250],
            sound: 'default',
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
          });
        }

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

        const easProjectId = projectId();
        if (!easProjectId) {
          setStatus('ERROR — EAS project ID missing.');
          return;
        }

        setStatus('Permission granted. Requesting Expo push token…');
        const result = await Notifications.getExpoPushTokenAsync({ projectId: easProjectId });
        if (!active) return;
        setToken(result.data);
        setStatus('READY — Firebase/FCM registration succeeded. Send the token below to Boss.');
      } catch (error) {
        if (!active) return;
        setStatus(`PUSH PROBE ERROR — ${error instanceof Error ? error.message : String(error)}`);
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
