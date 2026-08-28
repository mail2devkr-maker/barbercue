import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BOOKING_PATHS } from '@barbercue/shared';
import type { BookingDetailDto, PaginatedResult } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Skeleton, EmptyState, InlineError, Button } from '../components/ui';
import type { BookingsStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<BookingsStackParamList, 'MyBookings'>;

function loadPage(cursor?: string): Promise<PaginatedResult<BookingDetailDto>> {
  const query = cursor ? `?cursor=${cursor}` : '';
  return apiFetch<PaginatedResult<BookingDetailDto>>(`${BOOKING_PATHS.bookings}/${BOOKING_PATHS.mine}${query}`);
}

function statusColor(status: string): string {
  if (status === 'CONFIRMED') return color.success;
  if (status === 'PENDING_PAYMENT') return color.gold;
  if (status === 'CANCELLED') return color.muted;
  return color.ink;
}

export default function MyBookingsScreen({ navigation }: Props) {
  const [bookings, setBookings] = useState<BookingDetailDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((isRefresh: boolean) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    return loadPage()
      .then((result) => {
        setBookings(result.items);
        setNextCursor(result.nextCursor);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load your bookings.'))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  async function handleLoadMore() {
    if (!nextCursor) return;
    const result = await loadPage(nextCursor);
    setBookings((prev) => [...prev, ...result.items]);
    setNextCursor(result.nextCursor);
  }

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <SectionHeader eyebrow="Bookings" title="My bookings" />
      {loading ? (
        <View style={styles.skeletonStack}>
          <Skeleton style={styles.skeletonCard} />
          <Skeleton style={styles.skeletonCard} />
        </View>
      ) : error ? (
        <InlineError message={error} />
      ) : bookings.length === 0 ? (
        <EmptyState title="No bookings yet" message="Find a salon and book your next visit." />
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={color.accent} />}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => navigation.navigate('BookingDetail', { bookingId: item.id })}>
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle}>{item.serviceName}</Text>
                <Text style={[styles.cardStatus, { color: statusColor(item.status) }]}>{item.status}</Text>
              </View>
              <Text style={styles.cardSubtitle}>
                {item.salonName} — {new Date(item.slotStart).toLocaleString()}
              </Text>
            </Pressable>
          )}
          ListFooterComponent={
            nextCursor ? <Button title="Load more" variant="outline" onPress={() => void handleLoadMore()} style={styles.loadMore} /> : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  skeletonStack: { gap: space[3] },
  skeletonCard: { height: 72, borderRadius: radius.lg },
  listContent: { paddingTop: space[2] },
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space[4],
    marginBottom: space[3],
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between' },
  cardTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  cardStatus: { fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.5 },
  cardSubtitle: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[1] },
  loadMore: { marginTop: space[2] },
});
