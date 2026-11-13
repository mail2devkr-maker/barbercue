import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BOOKING_PATHS, Language, QUEUE_ENTRIES_HISTORY_PATH, QUEUE_ENTRIES_PATH, formatBookingArrivalTime, formatMoney, formatZonedDateTime } from '@barbercue/shared';
import type { BookingDetailDto, CustomerQueueHistoryItemDto, PaginatedResult } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { openDirections } from '../lib/booking-actions';
import { dateLocaleFor } from '../lib/date-locale';
import { useRebook } from '../lib/use-rebook';
import { useLanguage } from '../lib/language-context';
import { color, font, fontSize, lineHeightFor, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Skeleton, EmptyState, InlineError, Button } from '../components/ui';
import type { UiStrings } from '@barbercue/shared';
import type { BookingsStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<BookingsStackParamList, 'MyBookings'>;

function loadPage(cursor?: string): Promise<PaginatedResult<BookingDetailDto>> {
  const query = cursor ? `?cursor=${cursor}` : '';
  return apiFetch<PaginatedResult<BookingDetailDto>>(`${BOOKING_PATHS.bookings}/${BOOKING_PATHS.mine}${query}`);
}

function statusLabel(t: UiStrings, status: string): string {
  const labels: Record<string, string> = {
    CONFIRMED: t.statusConfirmed,
    PENDING_PAYMENT: t.statusPendingPayment,
    CANCELLED: t.statusCancelled,
    COMPLETED: t.statusCompleted,
    NO_SHOW: t.statusNoShow,
  };
  return labels[status] ?? status;
}

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

type HistoryView = 'bookings' | 'queue';

function queueStatusLabel(status: string, hi: boolean): string {
  const labels: Record<string, [string, string]> = {
    WAITING: ['Waiting', 'इंतज़ार में'],
    CALLED: ['Called', 'बुलाया गया'],
    IN_SERVICE: ['In service', 'सेवा जारी'],
    COMPLETED: ['Completed', 'पूरा हुआ'],
    CANCELLED: ['Left queue', 'कतार छोड़ी'],
    NO_SHOW: ['Missed', 'नहीं पहुंचे'],
    EXPIRED: ['Expired', 'समय समाप्त'],
  };
  const pair = labels[status];
  return pair ? pair[hi ? 1 : 0] : status;
}

function queueStatusColors(status: string): { fg: string; bg: string } {
  if (status === 'WAITING' || status === 'CALLED' || status === 'IN_SERVICE') return { fg: color.success, bg: color.successSoft };
  if (status === 'COMPLETED') return { fg: color.ink, bg: color.goldSoft };
  return { fg: color.muted, bg: color.border };
}

/** One Live Queue visit (owner report 14 Nov: customers had no Live Queue history). */
function QueueVisitCard({ visit }: { visit: CustomerQueueHistoryItemDto }) {
  const { language } = useLanguage();
  const hi = language === Language.HI;
  const colors = queueStatusColors(visit.status);
  const joined = formatZonedDateTime(visit.joinedAt, visit.salonTimezone ?? 'Asia/Kolkata', dateLocaleFor(language), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <View style={styles.card} testID="queue-history-item">
      <View style={styles.cardRow}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {(hi ? 'टोकन #' : 'Token #') + visit.tokenNumber}
        </Text>
        <View style={[styles.statusPill, { backgroundColor: colors.bg }]}>
          <Text style={[styles.statusPillText, { color: colors.fg }]}>{queueStatusLabel(visit.status, hi)}</Text>
        </View>
      </View>
      <Text style={styles.cardSalon}>{visit.salonName}</Text>
      {visit.serviceName ? <Text style={styles.cardMeta}>{visit.serviceName}</Text> : null}
      <Text style={styles.cardMeta}>{(hi ? 'कतार में जुड़े: ' : 'Joined: ') + joined}</Text>
    </View>
  );
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
  const { t, language } = useLanguage();
  // Part 5 (show arrival time after booking): converted through the salon's own timezone, never
  // the device's — a customer booking a shop outside their own city/timezone must never be shown
  // a silently-wrong arrival time.
  const arrival = formatBookingArrivalTime(booking.slotStart, booking.salonTimezone, dateLocaleFor(language));
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardRow}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {booking.serviceName}
        </Text>
        <View style={[styles.statusPill, { backgroundColor: statusBg(booking.status) }]}>
          <Text style={[styles.statusPillText, { color: statusColor(booking.status) }]}>
            {statusLabel(t, booking.status)}
          </Text>
        </View>
      </View>

      <Text style={styles.cardSalon}>{booking.salonName}</Text>
      <Text style={styles.cardMeta}>
        {arrival.date} · {arrival.time}
        {!arrival.isDeviceLocalTimezone && t.shopLocalTimeSuffix}
      </Text>
      {/* Part 5 completion (arrival guidance) — compact single-boundary form only, per "don't
          clutter compact cards"; the full window shows on BookingDetailScreen instead. Both null
          means no guidance applies (cancelled/completed/already checked in/no snapshot). */}
      {booking.checkInDueBy && (
        <Text style={styles.cardMeta}>
          {t.checkInByPrefix}
          {formatZonedDateTime(booking.checkInDueBy, booking.salonTimezone, dateLocaleFor(language), {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </Text>
      )}

      {booking.preferredStaffName && <Text style={styles.cardMeta}>{t.barberPrefix}{booking.preferredStaffName}</Text>}
      {booking.selectedStyleName && <Text style={styles.cardMeta}>{t.styleLabelPrefix}{booking.selectedStyleName}</Text>}
      <Text style={styles.cardMeta}>{formatMoney(booking.servicePrice, booking.currency)}</Text>
      {booking.cancellationChargeAmount !== null && booking.cancellationChargeAmount > 0 && (
        <Text style={styles.cardMetaWarn}>{t.cancellationChargePrefix}{formatMoney(booking.cancellationChargeAmount, booking.currency)}</Text>
      )}

      <View style={styles.quickActionsRow}>
        <Pressable
          style={styles.quickActionButton}
          onPress={(e) => {
            e.stopPropagation();
            void openDirections(booking);
          }}
        >
          <Text style={styles.quickActionText}>{t.getDirections}</Text>
        </Pressable>
        <Pressable
          style={styles.quickActionButton}
          onPress={(e) => {
            e.stopPropagation();
            onRebook();
          }}
          disabled={rebooking}
        >
          <Text style={styles.quickActionText}>{rebooking ? t.loading : t.bookAgainAction}</Text>
        </Pressable>
      </View>

      <View style={styles.detailsRow}>
        <Text style={styles.detailsText}>{t.viewDetailsAction}</Text>
        <Text style={styles.chevron}>›</Text>
      </View>
    </Pressable>
  );
}

export default function MyBookingsScreen({ navigation }: Props) {
  const { t, language } = useLanguage();
  const hi = language === Language.HI;
  const { rebook, rebookingId, rebookError } = useRebook();
  const [view, setView] = useState<HistoryView>('bookings');
  const [visits, setVisits] = useState<CustomerQueueHistoryItemDto[]>([]);
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [visitsError, setVisitsError] = useState<string | null>(null);
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
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : t.couldNotLoadBookings))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  const loadVisits = useCallback((isRefresh: boolean) => {
    isRefresh ? setRefreshing(true) : setVisitsLoading(true);
    setVisitsError(null);
    return apiFetch<CustomerQueueHistoryItemDto[]>(`${QUEUE_ENTRIES_PATH}/${QUEUE_ENTRIES_HISTORY_PATH}?limit=50`)
      .then((items) => setVisits(Array.isArray(items) ? items : []))
      .catch((err: unknown) =>
        setVisitsError(err instanceof ApiError ? err.message : hi ? 'Live Queue इतिहास लोड नहीं हो सका।' : 'Could not load your Live Queue history.'),
      )
      .finally(() => {
        setVisitsLoading(false);
        setRefreshing(false);
      });
  }, [hi]);

  useFocusEffect(
    useCallback(() => {
      if (view === 'queue') void loadVisits(false);
      else void load(false);
    }, [load, loadVisits, view]),
  );

  async function handleLoadMore() {
    if (!nextCursor) return;
    const result = await loadPage(nextCursor);
    setBookings((prev) => [...prev, ...result.items]);
    setNextCursor(result.nextCursor);
  }

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <SectionHeader eyebrow={t.tabBookings} title={t.myBookingsTitle} />
      <View style={styles.segment} accessibilityRole="tablist">
        {(['bookings', 'queue'] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === option }}
            onPress={() => setView(option)}
            style={[styles.segmentItem, view === option && styles.segmentItemActive]}
            testID={`history-tab-${option}`}
          >
            <Text style={[styles.segmentText, view === option && styles.segmentTextActive]}>
              {option === 'bookings' ? (hi ? 'बुकिंग' : 'Bookings') : 'Live Queue'}
            </Text>
          </Pressable>
        ))}
      </View>
      {view === 'queue' ? (
        visitsLoading ? (
          <View style={styles.skeletonStack}>
            <Skeleton style={styles.skeletonCard} />
            <Skeleton style={styles.skeletonCard} />
          </View>
        ) : visitsError ? (
          <InlineError message={visitsError} />
        ) : visits.length === 0 ? (
          <EmptyState
            title={hi ? 'अभी कोई Live Queue इतिहास नहीं' : 'No Live Queue visits yet'}
            message={hi ? 'जब आप किसी दुकान की Live Queue में जुड़ेंगे, वह यहां दिखेगा।' : 'When you join a shop’s Live Queue, it will show here.'}
          />
        ) : (
          <FlatList
            data={visits}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadVisits(true)} tintColor={color.accent} />}
            renderItem={({ item }) => <QueueVisitCard visit={item} />}
          />
        )
      ) : loading ? (
        <View style={styles.skeletonStack}>
          <Skeleton style={styles.skeletonCard} />
          <Skeleton style={styles.skeletonCard} />
        </View>
      ) : error ? (
        <InlineError message={error} />
      ) : bookings.length === 0 ? (
        <EmptyState title={t.noBookingsYetTitle} message={t.noBookingsYetHint} />
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
            nextCursor ? <Button title={t.loadMore} variant="outline" onPress={() => void handleLoadMore()} style={styles.loadMore} /> : null
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
  cardTitle: { flex: 1, fontFamily: font.displaySemiBold, fontSize: fontSize.base, lineHeight: lineHeightFor(fontSize.base), color: color.ink },
  statusPill: { minHeight: 22, justifyContent: 'center', paddingVertical: 3, paddingHorizontal: space[2], borderRadius: radius.pill },
  statusPillText: { fontFamily: font.bodyBold, fontSize: 10, lineHeight: lineHeightFor(10), letterSpacing: 0.4, textTransform: 'uppercase' },
  cardSalon: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink, marginTop: space[2] },
  cardMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.muted, marginTop: 2 },
  cardMetaWarn: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.accent, marginTop: 2 },
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
  segment: { flexDirection: 'row', gap: space[2], marginBottom: space[3] },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space[2],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
  },
  segmentItemActive: { backgroundColor: color.accent, borderColor: color.accent },
  segmentText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  segmentTextActive: { color: '#ffffff' },
});
