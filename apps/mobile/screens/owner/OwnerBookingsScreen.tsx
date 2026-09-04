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
  type UiStrings,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useLanguage } from '../../lib/language-context';
import { getRealtimeSocket, joinSalonRoom, onReconnect } from '../../lib/realtime';
import { useSalon } from '../../lib/salon-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Screen, SectionHeader, Card, Button, EmptyState, Skeleton, InlineError } from '../../components/ui';
import type { OwnerTabParamList } from '../../navigation/OwnerNavigator';

type Props = BottomTabScreenProps<OwnerTabParamList, 'OwnerBookingsTab'>;

const PAGE_SIZE = 20;

function filterLabel(t: UiStrings, filter: OwnerBookingFilter): string {
  const labels: Record<OwnerBookingFilter, string> = {
    today: t.filterToday,
    upcoming: t.filterUpcoming,
    completed: t.filterCompleted,
    cancelled: t.filterCancelled,
    no_show: t.filterNoShow,
    all: t.filterHistory,
  };
  return labels[filter];
}

function statusLabel(t: UiStrings, status: string): string {
  const labels: Record<string, string> = {
    CONFIRMED: t.statusConfirmed,
    PENDING_PAYMENT: t.statusPendingPayment,
    COMPLETED: t.statusCompleted,
    CANCELLED: t.statusCancelled,
    NO_SHOW: t.statusNoShow,
    EXPIRED: t.statusExpired,
  };
  return labels[status] ?? status;
}

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
  const { t } = useLanguage();
  return (
    <Card style={styles.card}>
      <View style={styles.cardHeadRow}>
        <View style={styles.cardHeadText}>
          <Text style={styles.serviceName}>
            {booking.serviceName}
            {isNew && <Text style={styles.newBadge}> {t.newBadge}</Text>}
          </Text>
          <Text style={styles.meta}>{formatSlot(booking.slotStart)}</Text>
          {booking.customerPhone && <Text style={styles.meta}>{booking.customerPhone}</Text>}
          {(booking.assignedStaffName ?? booking.preferredStaffName) && (
            <Text style={styles.meta}>
              {booking.assignedStaffName ? booking.assignedStaffName : `${t.preferredPrefix}${booking.preferredStaffName}`}
            </Text>
          )}
        </View>
        <Text style={styles.statusBadge}>{statusLabel(t, booking.status)}</Text>
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
  const { t, language } = useLanguage();
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
  // Reads LanguageProvider's own `language`, NOT user.preferredLanguage directly. setLanguage()
  // (lib/language-context.tsx) updates this local state SYNCHRONOUSLY and OPTIMISTICALLY, before
  // the PATCH auth/language request even fires; user.preferredLanguage only catches up once that
  // request resolves AND the subsequent refreshMe() GET completes — two full round-trips later.
  // Reading user.preferredLanguage here was a real race: an owner who switched to Hindi and
  // immediately triggered a booking (exactly the physical-device test scenario) could have this
  // ref still holding the pre-switch language for the sub-second gap before that refetch landed,
  // producing an English announcement despite the UI already showing Hindi. Reading the same
  // state the language switcher itself writes closes that window entirely — there is only one
  // source of truth, updated in the same synchronous state transition the UI's own re-render
  // uses, not two independently-timed ones.
  const preferredLanguageRef = useRef(language);
  preferredLanguageRef.current = language;
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

    // Dedupe by "event kind + booking id", never by booking id alone — a real Build 9
    // physical-device concern was that a created+cancelled pair for the SAME booking could look
    // like it shares one dedupe slot. It never actually did (onCancelled never touched this ref),
    // but scoping the key this way makes that failure mode structurally impossible going forward:
    // the same event delivered twice (e.g. a duplicate emit) is suppressed, while a different
    // lifecycle event for the same booking always gets its own announcement.
    function onCreated(payload: { salonId: string; bookingId: string }) {
      if (payload.salonId !== selectedSalonId) return;
      void loadPage(filterRef.current, undefined, false);
      const dedupeKey = `created:${payload.bookingId}`;
      if (notifiedIdsRef.current.has(dedupeKey)) {
        console.warn('[voice] booking.created ignored — already announced', payload.bookingId);
        return;
      }
      notifiedIdsRef.current.add(dedupeKey);
      setNewIds((current) => [...current, payload.bookingId]);
      console.warn('[voice] booking.created received, fetching detail to announce', payload.bookingId);
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
          console.warn('[voice] speaking booking.created', { language: preferredLanguageRef.current });
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
        .catch((err: unknown) => {
          // toast just won't have rich details — the list refresh above still shows it
          console.warn('[voice] could not fetch booking detail for announcement', err);
        });
    }

    function onCancelled(payload: { salonId: string; bookingId: string }) {
      if (payload.salonId !== selectedSalonId) return;
      void loadPage(filterRef.current, undefined, false);
      const dedupeKey = `cancelled:${payload.bookingId}`;
      if (notifiedIdsRef.current.has(dedupeKey)) {
        console.warn('[voice] booking.cancelled ignored — already announced', payload.bookingId);
        return;
      }
      notifiedIdsRef.current.add(dedupeKey);
      setCancelNotice(true);
      console.warn('[voice] speaking booking.cancelled', { language: preferredLanguageRef.current });
      Speech.speak(voiceAnnouncementsFor(preferredLanguageRef.current).bookingCancelled(), {
        language: SPEECH_LOCALE[preferredLanguageRef.current ?? Language.EN],
      });
    }

    socket.on('booking.created', onCreated);
    socket.on('booking.cancelled', onCancelled);
    // Phase 15: resync once the socket reconnects — a missed booking.created/cancelled while
    // offline is never replayed by the backend, so the list catches up but any voice/toast for
    // whatever was missed during the disconnect never fires. Diagnostic-only warn (no behavior
    // change) so a physical retest can confirm whether this — not the announcement code itself —
    // explains a "voice didn't play" report: if this line appears in logcat between a created and
    // a cancelled announcement, the socket was briefly down and the gap is expected, not a bug.
    const unsubscribeReconnect = onReconnect(() => {
      console.warn('[voice] realtime socket reconnected — resyncing list; any event missed while disconnected will not retroactively announce');
      void loadPage(filterRef.current, undefined, false);
    });
    return () => {
      socket.off('booking.created', onCreated);
      socket.off('booking.cancelled', onCancelled);
      unsubscribeReconnect();
    };
  }, [selectedSalonId, loadPage]);

  if (!selectedSalonId) {
    return (
      <Screen scroll={false}>
        <SectionHeader eyebrow={t.ownerEyebrow} title={t.bookingsTitle} />
        <EmptyState title={t.noShopSelected} message={t.selectShopHint} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <SectionHeader eyebrow={t.ownerEyebrow} title={t.bookingsTitle} />

      {newNotice && (
        <Pressable style={styles.noticeBanner} onPress={() => setNewNotice(null)}>
          <Text style={styles.noticeTitle}>{t.newBookingReceivedBanner}</Text>
          <Text style={styles.noticeBody}>
            {newNotice.serviceName} · {formatSlot(newNotice.slotStart)}
            {newNotice.customerPhone ? ` · ${newNotice.customerPhone}` : ''}
          </Text>
        </Pressable>
      )}
      {cancelNotice && (
        <Pressable style={[styles.noticeBanner, styles.cancelBanner]} onPress={() => setCancelNotice(false)}>
          <Text style={styles.noticeTitle}>{t.bookingCancelledBanner}</Text>
        </Pressable>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
        accessibilityLabel={t.bookingFiltersLabel}
        accessibilityHint={t.bookingFiltersHint}
      >
        {OWNER_BOOKING_FILTERS.map((f) => (
          <Pressable
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>{filterLabel(t, f)}</Text>
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
            <EmptyState title={t.noBookingsTitle} message={t.noBookingsHint} />
          ) : (
            items.map((booking) => (
              <BookingRow key={booking.id} booking={booking} isNew={newIds.includes(booking.id)} />
            ))
          )}
          {nextCursor && (
            <Button
              title={loadingMore ? t.loading : t.loadMore}
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
