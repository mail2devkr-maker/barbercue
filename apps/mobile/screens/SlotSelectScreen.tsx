import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DISCOVERY_PATHS, SALON_BOOKING_INFO_PATHS } from '@barbercue/shared';
import type { AvailabilitySlotDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'SlotSelect'>;

export default function SlotSelectScreen({ route, navigation }: Props) {
  const { salonId, serviceId, preferredStaffId, date, ...rest } = route.params;
  const [slots, setSlots] = useState<AvailabilitySlotDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ serviceId, date });
    if (preferredStaffId) params.set('staffId', preferredStaffId);
    apiFetch<AvailabilitySlotDto[]>(
      `${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.availability}?${params.toString()}`,
    )
      .then((result) => {
        if (!cancelled) setSlots(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load available times.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [salonId, serviceId, preferredStaffId, date]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Choose a time</Text>
      {loading && <ActivityIndicator color="#EDE6DA" style={{ marginTop: 16 }} />}
      {error && <Text style={styles.error}>{error}</Text>}
      {!loading && !error && slots.length === 0 && <Text style={styles.subtitle}>No slots on this day.</Text>}
      <FlatList
        data={slots}
        keyExtractor={(item) => item.slotStart}
        numColumns={3}
        contentContainerStyle={{ paddingTop: 16 }}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.slot, !item.available && styles.slotDisabled]}
            disabled={!item.available}
            onPress={() =>
              navigation.navigate('ConfirmBooking', {
                salonId,
                serviceId,
                preferredStaffId,
                ...rest,
                slotStart: item.slotStart,
                slotEnd: item.slotEnd,
              })
            }
          >
            <Text style={[styles.slotText, !item.available && styles.slotTextDisabled]}>
              {new Date(item.slotStart).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1A17', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', color: '#EDE6DA' },
  subtitle: { fontSize: 14, color: '#B8AFA0', marginTop: 16 },
  error: { color: '#E24B4A', fontSize: 14, marginTop: 16 },
  slot: {
    backgroundColor: '#2A2723',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    flex: 1,
    margin: 4,
  },
  slotDisabled: { opacity: 0.3 },
  slotText: { color: '#EDE6DA', fontSize: 13, fontWeight: '600' },
  slotTextDisabled: { color: '#8A8377' },
});
