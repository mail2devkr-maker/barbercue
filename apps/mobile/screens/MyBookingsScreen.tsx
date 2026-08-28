import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BOOKING_PATHS } from '@barbercue/shared';
import type { BookingDetailDto, PaginatedResult } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import type { BookingsStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<BookingsStackParamList, 'MyBookings'>;

function loadPage(cursor?: string): Promise<PaginatedResult<BookingDetailDto>> {
  const query = cursor ? `?cursor=${cursor}` : '';
  return apiFetch<PaginatedResult<BookingDetailDto>>(`${BOOKING_PATHS.bookings}/${BOOKING_PATHS.mine}${query}`);
}

function statusColor(status: string): string {
  if (status === 'CONFIRMED') return '#5FA777';
  if (status === 'PENDING_PAYMENT') return '#D69A4E';
  if (status === 'CANCELLED') return '#8A8377';
  return '#EDE6DA';
}

export default function MyBookingsScreen({ navigation }: Props) {
  const [bookings, setBookings] = useState<BookingDetailDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPage()
      .then((result) => {
        if (cancelled) return;
        setBookings(result.items);
        setNextCursor(result.nextCursor);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your bookings.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLoadMore() {
    if (!nextCursor) return;
    const result = await loadPage(nextCursor);
    setBookings((prev) => [...prev, ...result.items]);
    setNextCursor(result.nextCursor);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My bookings</Text>
      {loading && <ActivityIndicator color="#EDE6DA" style={{ marginTop: 16 }} />}
      {error && <Text style={styles.error}>{error}</Text>}
      {!loading && !error && bookings.length === 0 && (
        <Text style={styles.subtitle}>You have no bookings yet.</Text>
      )}
      <FlatList
        data={bookings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: 16 }}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => navigation.navigate('BookingDetail', { bookingId: item.id })}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={styles.cardTitle}>{item.serviceName}</Text>
              <Text style={[styles.cardTitle, { color: statusColor(item.status) }]}>{item.status}</Text>
            </View>
            <Text style={styles.cardSubtitle}>
              {item.salonName} — {new Date(item.slotStart).toLocaleString()}
            </Text>
          </Pressable>
        )}
        ListFooterComponent={
          nextCursor ? (
            <Pressable style={styles.loadMore} onPress={() => void handleLoadMore()}>
              <Text style={styles.loadMoreText}>Load more</Text>
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1A17', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', color: '#EDE6DA' },
  subtitle: { fontSize: 14, color: '#B8AFA0', marginTop: 16 },
  error: { color: '#E24B4A', fontSize: 14, marginTop: 16 },
  card: { backgroundColor: '#2A2723', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { color: '#EDE6DA', fontSize: 15, fontWeight: '600' },
  cardSubtitle: { color: '#B8AFA0', fontSize: 13, marginTop: 4 },
  loadMore: { alignItems: 'center', paddingVertical: 12 },
  loadMoreText: { color: '#EDE6DA', fontSize: 14, fontWeight: '600' },
});
