import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { QUEUE_ENTRIES_PATH, type QueueEntryDetailDto } from '@barbercue/shared';
import { apiFetch } from '../lib/api';
import { getItem } from '../lib/secure-storage';
import { QueueStatusPanel } from '../components/QueueStatusPanel';
import type { AuthStackParamList } from '../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'GuestQueueStatus'>;

/** Signed-out arrival push destination: a push alone never grants access to a queue ticket.
 * The locally stored, unguessable capability must still match this exact entry on the server. */
export default function GuestQueueStatusScreen({ route, navigation }: Props) {
  const { salonId, entryId } = route.params;
  const [entry, setEntry] = useState<QueueEntryDetailDto | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await getItem(`fastque_guest_queue_${salonId}`);
        if (!saved) return;
        const ticket = JSON.parse(saved) as { id?: string; token?: string };
        if (ticket.id !== entryId || !ticket.token) return;
        const result = await apiFetch<QueueEntryDetailDto>(
          `${QUEUE_ENTRIES_PATH}/${entryId}/guest-status`,
          { headers: { 'X-Queue-Guest-Token': ticket.token } },
        );
        if (!cancelled && result.salonId === salonId) {
          setToken(ticket.token);
          setEntry(result);
        }
      } catch {
        // Missing, expired, or rejected capabilities grant no customer or shop data.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entryId, salonId]);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Your Live Queue</Text>
      {loading ? <ActivityIndicator accessibilityLabel="Loading Live Queue" /> :
        entry && token ? <QueueStatusPanel entry={entry} guestAccessToken={token} onEntryChange={setEntry} /> :
        <Text style={styles.message}>This ticket is no longer available on this device. Please contact the shop.</Text>}
      <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>Back</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, padding: 22, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: 'bold', marginVertical: 18, color: '#141414' },
  message: { marginVertical: 24, lineHeight: 22, color: '#333' },
  back: { marginTop: 26, padding: 12, borderRadius: 10, backgroundColor: '#eee', alignItems: 'center' },
  backText: { color: '#111', fontWeight: '600' },
});
