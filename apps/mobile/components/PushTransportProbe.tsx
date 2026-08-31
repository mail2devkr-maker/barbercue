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
          setStatus('Notification permission denied. Enable it in Android Settings and reopen the app.');
          return;
        }

        const easProjectId = projectId();
        if (!easProjectId) {
          setStatus('EAS project ID missing.');
          return;
        }

        setStatus('Requesting Expo push token…');
        const result = await Notifications.getExpoPushTokenAsync({ projectId: easProjectId });
        if (!active) return;
        setToken(result.data);
        setStatus('READY — send this Expo token to Boss for the transport test.');
      } catch (error) {
        if (!active) return;
        setStatus(`Push probe error: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.title}>BARBERCUE PUSH TEST</Text>
        <Text style={styles.status}>{status}</Text>
        {token ? (
          <Text selectable style={styles.token}>
            {token}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    zIndex: 9999,
    left: 8,
    right: 8,
    top: 38,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFF8F2',
    borderWidth: 1,
    borderColor: '#8A3F28',
  },
  title: {
    fontSize: 12,
    fontWeight: '800',
    color: '#512719',
  },
  status: {
    marginTop: 4,
    fontSize: 11,
    color: '#512719',
  },
  token: {
    marginTop: 6,
    fontSize: 9,
    lineHeight: 12,
    color: '#111111',
  },
});
