import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DISCOVERY_PATHS } from '@barbercue/shared';
import type { SalonProfileDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SalonProfile'>;

// Public discovery endpoint — same GET /salons/:citySlug/:salonSlug apps/web uses.
export default function SalonProfileScreen({ route, navigation }: Props) {
  const { citySlug, salonSlug, selectedStyleName } = route.params;
  const [salon, setSalon] = useState<SalonProfileDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SalonProfileDto>(`${DISCOVERY_PATHS.salons}/${citySlug}/${salonSlug}`)
      .then((result) => {
        if (!cancelled) setSalon(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load this salon.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [citySlug, salonSlug]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#EDE6DA" />
      </View>
    );
  }
  if (error || !salon) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Salon not found.'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{salon.name}</Text>
      <Text style={styles.subtitle}>{salon.addressLine}</Text>
      {salon.ratingCount > 0 && (
        <Text style={styles.subtitle}>
          ★ {salon.ratingAverage?.toFixed(1)} ({salon.ratingCount} reviews)
        </Text>
      )}

      <Pressable
        style={styles.queueButton}
        onPress={() =>
          navigation.navigate('WalkInJoin', { salonId: salon.id, salonName: salon.name, services: salon.services })
        }
      >
        <Text style={styles.queueButtonText}>Join queue now</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Services</Text>
      <FlatList
        data={salon.services}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() =>
              navigation.navigate('StaffSelect', {
                salonId: salon.id,
                salonName: salon.name,
                serviceId: item.id,
                serviceName: item.name,
                servicePrice: item.price,
                serviceDurationMinutes: item.durationMinutes,
                operatingHours: salon.operatingHours,
                selectedStyleName,
              })
            }
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardTitle}>₹{item.price}</Text>
            </View>
            <Text style={styles.cardSubtitle}>{item.durationMinutes} min</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1A17', padding: 24 },
  center: { flex: 1, backgroundColor: '#1C1A17', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: '#EDE6DA' },
  subtitle: { fontSize: 14, color: '#B8AFA0', marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#EDE6DA', marginTop: 20, marginBottom: 8 },
  error: { color: '#E24B4A', fontSize: 14 },
  card: { backgroundColor: '#2A2723', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { color: '#EDE6DA', fontSize: 16, fontWeight: '600' },
  cardSubtitle: { color: '#B8AFA0', fontSize: 13, marginTop: 4 },
  queueButton: {
    backgroundColor: '#2A2723',
    borderWidth: 1,
    borderColor: '#B0413E',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  queueButtonText: { color: '#B0413E', fontSize: 15, fontWeight: '600' },
});
