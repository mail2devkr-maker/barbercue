import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BOOKING_PATHS, formatMoney } from '@barbercue/shared';
import type { BookingDetailDto, PaginatedResult } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { openDirections } from '../lib/booking-actions';
import { useRebook } from '../lib/use-rebook';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Skeleton, EmptyState, InlineError, Button } from '../components/ui';
import type { BookingsStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<BookingsStackParamList, 'MyBookings'>;

function loadPage(cursor?: string): Promise<PaginatedResult<BookingDetailDto>> {
  const query = cursor ? `?cursor=${cursor}` : '';
  return apiFetch<PaginatedResult<BookingDetailDto>>(`${BOOKING_PATHS.bookings}/${BOOKING_PATHS.mine}${query}`);
}

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  PENDING_PAYMENT: 'Payment pending',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-show',
};

function statusColor(status: string): string {
  if (status === 'CONFIRMED') return color.success;
  if (status === 'PENDING_PAYMENT') return color.gold;
  if (status === 'CANCELLED') return color.muted;
  return color.ink;
}

function statusBg(status: string): string {
  if (status === 'CONFIRMED') return color.successSoft;
  if (status === 'PENDING_PAYMENT') return color.goldSoft;
  if (status === 'CANCELLED') return color.border;
  return color.goldSoft;
}

function BookingCard({
  booking,
  onPress,
  onRebook,
  rebooking,
}: {
  booking: BookingDetailDto;
  onPress: () => void;
  onRebook: () => void;
  rebooking: boolean;
}) {
  const date = new Date(booking.slotStart);
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardRow}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {booking.serviceName}
        </Text>
        <View style={[styles.statusPill, { backgroundColor: statusBg(booking.status) }]}>
          <Text style={[styles.statusPillText, { color: statusColor(booking.status) }]}>
            {STATUS_LABEL[booking.status] ?? booking.status}
          </Text>
        </View>
      </View>

      <Text style={styles.cardSalon}>{booking.salonName}</Text>
      <Text style={styles.cardMeta}>
        {date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ·{' '}
        {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </Text>

      {booking.preferredStaffName && <Text style={styles.cardMeta}>Barber: {booking.preferredStaffName}</Text>}
      {booking.selectedStyleName && <Text style={styles.cardMeta}>Style: {booking.selectedStyleName}</Text>}
      <Text style={styles.cardMeta}>{formatMoney(booking.servicePrice, booking.currency)}</Text>
      {booking.cancellationChargeAmount !== null && booking.cancellationChargeAmount > 0 && (
        <Text style={styles.cardMetaWarn}>Cancellation charge: {formatMoney(booking.cancellationChargeAmount, booking.currency)}</Text>
      )}

      <View style={styles.quickActionsRow}>
        <Pressable
          style={styles.quickActionButton}
          onPress={(e) => {
            e.stopPropagation();
            void openDirections(booking);
          }}
        >
          <Text style={styles.quickActionText}>Get Directions</Text>
        </Pressable>
        <Pressable
          style={styles.quickActionButton}
          onPress={(e) => {
            e.stopPropagation();
            onRebook();
          }}
          disabled={rebooking}
        >
          <Text style={styles.quickActionText}>{rebooking ? 'Loading…' : 'Book again'}</Text>
        </Pressable>
      </View>

      <View style={styles.detailsRow}>
        <Text style={styles.detailsText}>View details</Text>
        <Text style={styles.chevron}>›</Text>
      </View>
    </Pressable>
  );
}

export default function MyBookingsScreen({ navigation }: Props) {
  const { rebook, rebookingId, rebookError } = useRebook();
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
          ListHeaderComponent={rebookError ? <InlineError message={rebookError} /> : null}
          renderItem={({ item }) => (
            <BookingCard
              booking={item}
              onPress={() => navigation.navigate('BookingDetail', { bookingId: item.id })}
              onRebook={() => void rebook(item)}
              rebooking={rebookingId === item.id}
            />
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
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[2] },
  cardTitle: { flex: 1, fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink },
  statusPill: { paddingVertical: 3, paddingHorizontal: space[2], borderRadius: radius.pill },
  statusPillText: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
  cardSalon: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink, marginTop: space[2] },
  cardMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  cardMetaWarn: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: color.accent, marginTop: 2 },
  quickActionsRow: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  quickActionButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingVertical: space[2],
    alignItems: 'center',
  },
  quickActionText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.ink },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  detailsText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.accent },
  chevron: { fontFamily: font.bodyBold, fontSize: fontSize.base, color: color.accent, marginLeft: 4 },
  loadMore: { marginTop: space[2] },
});
