import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import {
  DASHBOARD_PATHS,
  Language,
  OWNER_BOOKING_FILTERS,
  SPEECH_LOCALE,
  formatVoiceDateTime,
  voiceAnnouncementsFor,
  type OwnerBookingDetailDto,
  type OwnerBookingFilter,
  type PaginatedResult,
  type SalonTimezoneResultDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { getRealtimeSocket, joinSalonRoom, onReconnect } from '../../lib/realtime';
import { useSalon } from '../../lib/salon-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Screen, SectionHeader, Card, Button, EmptyState, Skeleton, InlineError } from '../../components/ui';
import type { OwnerTabParamList } from '../../navigation/OwnerNavigator';

type Props = BottomTabScreenProps<OwnerTabParamList, 'OwnerBookingsTab'>;

const PAGE_SIZE = 20;

const FILTER_LABEL: Record<OwnerBookingFilter, string> = {
  today: 'Today',
  upcoming: 'Upcoming',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
  all: 'History',
};

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  PENDING_PAYMENT: 'Pending payment',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
  EXPIRED: 'Expired',
};

function bookingsPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.bookings}`;
}

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function BookingRow({ booking, isNew }: { booking: OwnerBookingDetailDto; isNew: boolean }) {
  return (
    <Card style={styles.card}>
      <View style={styles.cardHeadRow}>
        <View style={styles.cardHeadText}>
          <Text style={styles.serviceName}>
            {booking.serviceName}
            {isNew && <Text style={styles.newBadge}> NEW</Text>}
          </Text>
          <Text style={styles.meta}>{formatSlot(booking.slotStart)}</Text>
          {booking.customerPhone && <Text style={styles.meta}>{booking.customerPhone}</Text>}
          {(booking.assignedStaffName ?? booking.preferredStaffName) && (
            <Text style={styles.meta}>
              {booking.assignedStaffName ? booking.assignedStaffName : `Pref: ${booking.preferredStaffName}`}
            </Text>
          )}
        </View>
        <Text style={styles.statusBadge}>{STATUS_LABEL[booking.status] ?? booking.status}</Text>
      </View>
      <Text style={styles.priceText}>
        {booking.currency ?? ''} {booking.servicePrice} · Ref {booking.id.slice(0, 8)}
      </Text>
    </Card>
  );
}

/**
 * Owner-only salon bookings: today/upcoming/completed/cancelled/no-show/history over the same
 * dashboard-bookings API the web owner dashboard uses, with realtime "new booking"/"cancelled"
 * alerts (toast + spoken notice) over the same /realtime socket the live-queue tab already joins.
 * No sound-enable gate like the web version needs — React Native has no browser autoplay policy to
 * work around, so a new booking speaks immediately while this screen is mounted.
 */
export default function OwnerBookingsScreen({ route }: Props) {
  const { selectedSalonId } = useSalon();
  const { user } = useAuth();
  const [filter, setFilter] = useState<OwnerBookingFilter>(route.params?.filter ?? 'today');
  const [items, setItems] = useState<OwnerBookingDetailDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<string[]>([]);
  const [newNotice, setNewNotice] = useState<OwnerBookingDetailDto | null>(null);
  const [cancelNotice, setCancelNotice] = useState(false);

  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const preferredLanguageRef = useRef(user?.preferredLanguage);
  preferredLanguageRef.current = user?.preferredLanguage;
  // Voice announcements must speak this salon's own local date/time (Part 7/28 of the mobile
  // launch mission), never the listening device's timezone. Fetched once per salon rather than
  // per announcement — a booking event needs this instantly, not after a network round-trip.
  const salonTimeZoneRef = useRef<string | null>(null);

  useEffect(() => {
    salonTimeZoneRef.current = null;
    if (!selectedSalonId) return;
    apiFetch<SalonTimezoneResultDto>(
      `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${selectedSalonId}/${DASHBOARD_PATHS.timezone}`,
    )
      .then((result) => {
        salonTimeZoneRef.current = result.timezone ?? null;
      })
      .catch(() => {
        /* voice announcement degrades to no date/time below rather than blocking on this */
      });
  }, [selectedSalonId]);

  const loadPage = useCallback(
    (targetFilter: OwnerBookingFilter, cursor: string | undefined, append: boolean) => {
      if (!selectedSalonId) return Promise.resolve();
      if (append) setLoadingMore(true);
      else if (!append) setLoading((prev) => (cursor ? prev : true));
      setError(null);
      const params = new URLSearchParams({ filter: targetFilter, limit: String(PAGE_SIZE) });
      if (cursor) params.set('cursor', cursor);
      return apiFetch<PaginatedResult<OwnerBookingDetailDto>>(`${bookingsPath(selectedSalonId)}?${params}`)
        .then((result) => {
          setItems((prev) => (append ? [...prev, ...result.items] : result.items));
          setNextCursor(result.nextCursor);
        })
        .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load bookings.'))
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        });
    },
    [selectedSalonId],
  );

  // Re-applies the tab's own param filter every time this screen gains focus with a fresh
  // navigate() — e.g. tapping a different Dashboard summary card while already on this tab.
  useFocusEffect(
    useCallback(() => {
      if (route.params?.filter) setFilter(route.params.filter);
    }, [route.params?.filter]),
  );

  useFocusEffect(
    useCallback(() => {
      void loadPage(filter, undefined, false);
      // Only re-run on focus/filter change, not on every loadPage identity change.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filter, selectedSalonId]),
  );

  useEffect(() => {
    if (!selectedSalonId) return undefined;
    const socket = getRealtimeSocket();
    joinSalonRoom(selectedSalonId);

    function onCreated(payload: { salonId: string; bookingId: string }) {
      if (payload.salonId !== selectedSalonId) return;
      void loadPage(filterRef.current, undefined, false);
      if (notifiedIdsRef.current.has(payload.bookingId)) return;
      notifiedIdsRef.current.add(payload.bookingId);
      setNewIds((current) => [...current, payload.bookingId]);
      apiFetch<OwnerBookingDetailDto>(`${bookingsPath(selectedSalonId)}/${payload.bookingId}`)
        .then((detail) => {
          setNewNotice(detail);
          // Real assigned barber wins over the customer's soft preference (Part 6 of the mobile
          // launch mission); at booking.created neither can be a stale/wrong value yet — assignment
          // only ever happens later, at queue check-in. Never invented when both are null (the
          // customer picked "Any staff" and no one is assigned yet) — the announcement itself says
          // so instead ("Barber not assigned yet."), see packages/shared/src/i18n.
          const barberName = detail.assignedStaffName ?? detail.preferredStaffName ?? null;
          const timeZone = salonTimeZoneRef.current;
          const { date, time } = detail.slotStart && timeZone
            ? formatVoiceDateTime(detail.slotStart, timeZone)
            : { date: null, time: null };
          Speech.speak(
            voiceAnnouncementsFor(preferredLanguageRef.current).newBookingReceived(
              detail.serviceName ?? null,
              barberName,
              detail.salonName ?? null,
              date,
              time,
            ),
            { language: SPEECH_LOCALE[preferredLanguageRef.current ?? Language.EN] },
          );
        })
        .catch(() => {
          /* toast just won't have rich details — the list refresh above still shows it */
        });
    }

    function onCancelled(payload: { salonId: string; bookingId: string }) {
      if (payload.salonId !== selectedSalonId) return;
      void loadPage(filterRef.current, undefined, false);
      setCancelNotice(true);
      Speech.speak(voiceAnnouncementsFor(preferredLanguageRef.current).bookingCancelled(), {
        language: SPEECH_LOCALE[preferredLanguageRef.current ?? Language.EN],
      });
    }

    socket.on('booking.created', onCreated);
    socket.on('booking.cancelled', onCancelled);
    // Phase 15: resync once the socket reconnects — a missed booking.created/cancelled while
    // offline is never replayed by the backend.
    const unsubscribeReconnect = onReconnect(() => void loadPage(filterRef.current, undefined, false));
    return () => {
      socket.off('booking.created', onCreated);
      socket.off('booking.cancelled', onCancelled);
      unsubscribeReconnect();
    };
  }, [selectedSalonId, loadPage]);

  if (!selectedSalonId) {
    return (
      <Screen scroll={false}>
        <SectionHeader eyebrow="Owner" title="Bookings" />
        <EmptyState title="No shop selected" message="Select a shop from the Dashboard tab to see its bookings." />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <SectionHeader eyebrow="Owner" title="Bookings" />

      {newNotice && (
        <Pressable style={styles.noticeBanner} onPress={() => setNewNotice(null)}>
          <Text style={styles.noticeTitle}>New booking received</Text>
          <Text style={styles.noticeBody}>
            {newNotice.serviceName} · {formatSlot(newNotice.slotStart)}
            {newNotice.customerPhone ? ` · ${newNotice.customerPhone}` : ''}
          </Text>
        </Pressable>
      )}
      {cancelNotice && (
        <Pressable style={[styles.noticeBanner, styles.cancelBanner]} onPress={() => setCancelNotice(false)}>
          <Text style={styles.noticeTitle}>Booking cancelled</Text>
        </Pressable>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
        accessibilityLabel="Booking filters"
        accessibilityHint="Swipe left or right to reach every booking filter"
      >
        {OWNER_BOOKING_FILTERS.map((f) => (
          <Pressable
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>{FILTER_LABEL[f]}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {error && <InlineError message={error} />}

      {loading ? (
        <>
          <Skeleton style={styles.skeleton} />
          <Skeleton style={styles.skeleton} />
        </>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadPage(filter, undefined, false);
              }}
              tintColor={color.accent}
              colors={[color.accent]}
            />
          }
        >
          {items.length === 0 ? (
            <EmptyState title="No bookings" message="Nothing in this view yet." />
          ) : (
            items.map((booking) => (
              <BookingRow key={booking.id} booking={booking} isNew={newIds.includes(booking.id)} />
            ))
          )}
          {nextCursor && (
            <Button
              title={loadingMore ? 'Loading…' : 'Load more'}
              variant="outline"
              onPress={() => void loadPage(filter, nextCursor, true)}
              loading={loadingMore}
              style={styles.loadMoreButton}
            />
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeleton: { height: 90, borderRadius: radius.lg, marginBottom: space[3] },
  noticeBanner: {
    backgroundColor: color.successSoft,
    borderWidth: 1,
    borderColor: 'rgba(46, 125, 50, 0.24)',
    borderRadius: radius.sm,
    padding: space[3],
    marginBottom: space[3],
  },
  cancelBanner: { backgroundColor: color.goldSoft, borderColor: color.border },
  noticeTitle: { fontFamily: font.bodyBold, fontSize: fontSize.sm, color: color.ink },
  noticeBody: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  filterScroll: { marginBottom: space[3] },
  filterRow: { gap: space[2], paddingRight: space[4] },
  filterChip: { paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1, borderColor: color.border },
  filterChipActive: { borderColor: color.accent, backgroundColor: color.accentSoft },
  filterChipText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: color.muted },
  filterChipTextActive: { color: color.accent },
  card: { marginBottom: space[3] },
  cardHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardHeadText: { flex: 1, paddingRight: space[2] },
  serviceName: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink },
  newBadge: { fontFamily: font.bodyBold, fontSize: 10, color: color.surface, backgroundColor: '#2e7d32' },
  meta: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginTop: 2 },
  statusBadge: { fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.5, color: color.gold, textTransform: 'uppercase' },
  priceText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: color.muted, marginTop: space[2] },
  loadMoreButton: { marginTop: space[2], marginBottom: space[6] },
});
