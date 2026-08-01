import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { QUEUE_ENTRIES_PATH, SALON_QUEUE_PATHS, type QueueEntryDetailDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { QueueStatusPanel } from '../components/QueueStatusPanel';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'WalkInJoin'>;

export default function WalkInJoinScreen({ route }: Props) {
  const { salonId, services } = route.params;
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<QueueEntryDetailDto | null>(null);

  // A customer can only hold one active token anywhere — check for one on mount so a repeat
  // visit to this screen shows live status instead of a doomed join attempt.
  useEffect(() => {
    let cancelled = false;
    apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`)
      .then((active) => {
        if (!cancelled) setEntry(active);
      })
      .catch(() => {
        /* no active entry, or a transient error — the join button remains available */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleJoin() {
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiFetch<QueueEntryDetailDto>(`salons/${salonId}/queue/${SALON_QUEUE_PATHS.join}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify(selectedServiceId ? { serviceId: selectedServiceId } : {}),
      });
      setEntry(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join the queue. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#EDE6DA" />
      </View>
    );
  }

  if (entry && entry.salonId !== salonId) {
    return (
      <View style={styles.container}>
        <Text style={styles.subtitle}>
          You already have an active queue token at another salon. Finish or cancel it before joining here.
        </Text>
      </View>
    );
  }

  if (entry) {
    return (
      <View style={styles.container}>
        <QueueStatusPanel entry={entry} onEntryChange={setEntry} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join the queue</Text>
      <Text style={styles.subtitle}>Service (optional)</Text>
      <View style={styles.serviceList}>
        <Pressable
          style={[styles.serviceOption, selectedServiceId === null && styles.serviceOptionSelected]}
          onPress={() => setSelectedServiceId(null)}
        >
          <Text style={styles.serviceOptionText}>Any service</Text>
        </Pressable>
        {services.map((s) => (
          <Pressable
            key={s.id}
            style={[styles.serviceOption, selectedServiceId === s.id && styles.serviceOptionSelected]}
            onPress={() => setSelectedServiceId(s.id)}
          >
            <Text style={styles.serviceOptionText}>
              {s.name} ({s.durationMinutes} min)
            </Text>
          </Pressable>
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.button} onPress={() => void handleJoin()} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#EDE6DA" /> : <Text style={styles.buttonText}>Join the queue</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1A17', padding: 24 },
  center: { flex: 1, backgroundColor: '#1C1A17', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: '#EDE6DA' },
  subtitle: { fontSize: 14, color: '#B8AFA0', marginTop: 12 },
  serviceList: { marginTop: 12, gap: 8 },
  serviceOption: { backgroundColor: '#2A2723', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#2A2723' },
  serviceOptionSelected: { borderColor: '#B0413E' },
  serviceOptionText: { color: '#EDE6DA', fontSize: 14 },
  error: { color: '#E24B4A', fontSize: 14, marginTop: 12 },
  button: { backgroundColor: '#B0413E', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#EDE6DA', fontSize: 16, fontWeight: '600' },
});
