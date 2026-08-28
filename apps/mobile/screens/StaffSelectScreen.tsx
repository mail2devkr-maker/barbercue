import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DISCOVERY_PATHS, SALON_BOOKING_INFO_PATHS } from '@barbercue/shared';
import type { StaffOptionDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'StaffSelect'>;

export default function StaffSelectScreen({ route, navigation }: Props) {
  const { salonId, serviceId, ...rest } = route.params;
  const [options, setOptions] = useState<StaffOptionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<StaffOptionDto[]>(
      `${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.staff}?serviceId=${serviceId}`,
    )
      .then((result) => {
        if (!cancelled) setOptions(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load staff.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [salonId, serviceId]);

  function choose(preferredStaffId: string | null, preferredStaffName: string | null) {
    navigation.navigate('DateSelect', { salonId, serviceId, ...rest, preferredStaffId, preferredStaffName });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Choose a barber</Text>
      <Text style={styles.subtitle}>
        This is a preference, not a guarantee — the salon assigns the actual barber and chair when you check in.
      </Text>
      {loading && <ActivityIndicator color="#EDE6DA" style={{ marginTop: 16 }} />}
      {error && <Text style={styles.error}>{error}</Text>}
      {!loading && (
        <FlatList
          data={options}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 16 }}
          ListHeaderComponent={
            <Pressable style={styles.card} onPress={() => choose(null, null)}>
              <Text style={styles.cardTitle}>Any Staff</Text>
            </Pressable>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => choose(item.id, item.displayName)}>
              <Text style={styles.cardTitle}>{item.displayName}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1A17', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', color: '#EDE6DA' },
  subtitle: { fontSize: 13, color: '#B8AFA0', marginTop: 8 },
  error: { color: '#E24B4A', fontSize: 14, marginTop: 16 },
  card: { backgroundColor: '#2A2723', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { color: '#EDE6DA', fontSize: 16, fontWeight: '600' },
});
