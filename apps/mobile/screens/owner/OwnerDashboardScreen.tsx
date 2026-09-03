import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  SalonSetupErrorCode,
  SalonStatus,
  type OwnerBookingDetailDto,
  type OwnerBookingFilter,
  type PaginatedResult,
  type SalonStatusResultDto,
  type SalonSetupReadinessDto,
  type SalonTimezoneResultDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { getRealtimeSocket, joinSalonRoom, onReconnect } from '../../lib/realtime';
import { useSalon } from '../../lib/salon-context';
import { useUnreadNotificationCount } from '../../lib/notifications';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Screen, SectionHeader, Card, Button, EmptyState, Skeleton, InlineError, NotificationBell } from '../../components/ui';
import { CapacitySummaryPanel } from '../../components/dashboard/CapacitySummaryPanel';
import type { OwnerTabParamList } from '../../navigation/OwnerNavigator';

const SUMMARY_COUNT_LIMIT = 50;

function bookingsPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.bookings}`;
}

// The dashboard-bookings API resolves `date` using the salon's IANA timezone. A rolling client
// UTC range was previously wrong around midnight and could count an adjacent day's cancellation.
// Fetching the existing owner-only timezone resource lets mobile request the exact salon day
// without making any country/device-timezone assumption.
function salonCalendarDate(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = value('year');
  const month = value('month');
  const day = value('day');
  if (!year || !month || !day) throw new Error('Could not format salon date.');
  return `${year}-${month}-${day}`;
}

interface BookingSummary {
  today: string;
  upcoming: string;
  completedToday: string;
  cancelledNoShowToday: string;
}

async function fetchCount(
  salonId: string,
  filter: OwnerBookingFilter,
  date?: string,
): Promise<{ count: number; capped: boolean }> {
  const params = new URLSearchParams({ filter, limit: String(SUMMARY_COUNT_LIMIT) });
  if (date) params.set('date', date);
  const result = await apiFetch<PaginatedResult<OwnerBookingDetailDto>>(
    `${bookingsPath(salonId)}?${params}`,
  );
  return { count: result.items.length, capped: result.nextCursor !== null };
}

function formatCount(count: number, capped: boolean): string {
  return capped ? `${count}+` : String(count);
}

// Salon status is read from SalonWorkplaceDto (via useSalon) rather than re-fetched here — the
// workplaces list already carries it, and PATCH .../status returns the fresh value which this
// screen applies locally, matching the pattern the rest of the app uses (no redundant re-fetch).
export default function OwnerDashboardScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<OwnerTabParamList>>();
  const { workplaces, loading, error, selectedSalonId, selectedSalon, selectSalon, reload } = useSalon();
  const [status, setStatus] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<SalonSetupReadinessDto | null>(null);
  const [summary, setSummary] = useState<BookingSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const summaryRequestIdRef = useRef(0);
  const unreadCount = useUnreadNotificationCount();

  const loadSummary = useCallback(async () => {
    const requestId = ++summaryRequestIdRef.current;
    if (!selectedSalonId) {
      setSummary(null);
      setSummaryError(null);
      return;
    }

    setSummaryError(null);
    try {
      const timezone = await apiFetch<SalonTimezoneResultDto>(
        `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${selectedSalonId}/${DASHBOARD_PATHS.timezone}`,
      );
      if (requestId !== summaryRequestIdRef.current) return;
      if (!timezone.timezone) {
        setSummary(null);
        setSummaryError('Set your shop timezone to show accurate daily booking counts.');
        return;
      }
      const date = salonCalendarDate(timezone.timezone);
      const [today, upcoming, completed, cancelled_, noShow] = await Promise.all([
        fetchCount(selectedSalonId, 'today'),
        fetchCount(selectedSalonId, 'upcoming'),
        fetchCount(selectedSalonId, 'completed', date),
        fetchCount(selectedSalonId, 'cancelled', date),
        fetchCount(selectedSalonId, 'no_show', date),
      ]);
      if (requestId !== summaryRequestIdRef.current) return;
      setSummary({
        today: formatCount(today.count, today.capped),
        upcoming: formatCount(upcoming.count, upcoming.capped),
        completedToday: formatCount(completed.count, completed.capped),
        cancelledNoShowToday: formatCount(
          cancelled_.count + noShow.count,
          cancelled_.capped || noShow.capped,
        ),
      });
    } catch {
      if (requestId !== summaryRequestIdRef.current) return;
      setSummary(null);
      setSummaryError('Could not load today’s booking counts.');
    }
  }, [selectedSalonId]);

  useFocusEffect(
    useCallback(() => {
      setStatus(selectedSalon?.status ?? null);
      setReadiness(null);
      setActionError(null);
    }, [selectedSalon]),
  );

  useFocusEffect(
    useCallback(() => {
      void loadSummary();
    }, [loadSummary]),
  );

  // Issue 4 (mobile stabilization mission) — reload() (useSalon) refetches workplaces/status,
  // loadSummary() refetches today's counts; the spinner tracks loadSummary since it's the slower,
  // more failure-prone of the two (reload() is effectively instant local-state from a cached list).
  async function handleRefresh() {
    setRefreshing(true);
    reload();
    await loadSummary();
    setRefreshing(false);
  }

  useEffect(() => {
    if (!selectedSalonId) return undefined;
    const socket = getRealtimeSocket();
    joinSalonRoom(selectedSalonId);
    const refresh = (payload: { salonId: string }) => {
      if (payload.salonId === selectedSalonId) void loadSummary();
    };
    socket.on('booking.created', refresh);
    socket.on('booking.cancelled', refresh);
    const unsubscribeReconnect = onReconnect(() => void loadSummary());
    return () => {
      socket.off('booking.created', refresh);
      socket.off('booking.cancelled', refresh);
      unsubscribeReconnect();
    };
  }, [selectedSalonId, loadSummary]);

  async function toggleStatus(next: 'ACTIVE' | 'SUSPENDED') {
    if (!selectedSalonId) return;
    setUpdating(true);
    setActionError(null);
    setReadiness(null);
    try {
      const result = await apiFetch<SalonStatusResultDto>(
        `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${selectedSalonId}/${DASHBOARD_PATHS.status}`,
        { method: 'PATCH', body: JSON.stringify({ status: next }) },
      );
      setStatus(result.status);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === SalonSetupErrorCode.SALON_SETUP_INCOMPLETE) {
        setReadiness((err.details as SalonSetupReadinessDto | undefined) ?? null);
        setActionError(err.message);
      } else {
        setActionError(err instanceof ApiError ? err.message : 'Could not update shop status.');
      }
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <Skeleton style={styles.skeleton} />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen scroll={false}>
        <InlineError message={error} />
      </Screen>
    );
  }
  if (workplaces.length === 0) {
    return (
      <Screen scroll={false}>
        <EmptyState title="No shops yet" message="Register a shop on the FastQue web dashboard to manage it here." />
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={() => void handleRefresh()}>
      <View style={styles.headerRow}>
        <SectionHeader eyebrow="Owner" title="Dashboard" />
        <NotificationBell
          unreadCount={unreadCount}
          onPress={() => navigation.navigate('OwnerAccountTab', { screen: 'Notifications' })}
        />
      </View>

      {workplaces.length > 1 && (
        <View style={styles.pickerRow}>
          {workplaces.map((w) => (
            <Pressable
              key={w.id}
              style={[styles.pickerChip, w.id === selectedSalonId && styles.pickerChipActive]}
              onPress={() => selectSalon(w.id)}
            >
              <Text style={[styles.pickerChipText, w.id === selectedSalonId && styles.pickerChipTextActive]}>{w.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {selectedSalon && (
        <Card style={styles.card}>
          <Text style={styles.salonName}>{selectedSalon.name}</Text>
          <Text style={styles.salonStatus}>Status: {status ?? selectedSalon.status}</Text>

          {actionError && <InlineError message={actionError} />}
          {readiness && (
            <View style={styles.readinessList}>
              <Text style={styles.readinessItem}>{readiness.hasActiveService ? '✓' : '○'} Active service</Text>
              <Text style={styles.readinessItem}>{readiness.hasActiveChair ? '✓' : '○'} Active chair</Text>
              <Text style={styles.readinessItem}>{readiness.hasActiveStaff ? '✓' : '○'} Active barber</Text>
            </View>
          )}

          {(status ?? selectedSalon.status) === SalonStatus.ACTIVE ? (
            <Button title="Close shop" variant="secondary" onPress={() => void toggleStatus('SUSPENDED')} loading={updating} style={styles.actionButton} />
          ) : (
            <Button title="Open shop" onPress={() => void toggleStatus('ACTIVE')} loading={updating} style={styles.actionButton} />
          )}
        </Card>
      )}

      {selectedSalonId && <CapacitySummaryPanel salonId={selectedSalonId} />}

      {summaryError && <InlineError message={summaryError} />}

      {summary && (
        <View style={styles.summaryGrid}>
          <Pressable
            style={styles.summaryTile}
            onPress={() => navigation.navigate('OwnerBookingsTab', { filter: 'today' })}
          >
            <Text style={styles.summaryValue}>{summary.today}</Text>
            <Text style={styles.summaryLabel}>Today&apos;s bookings</Text>
          </Pressable>
          <Pressable
            style={styles.summaryTile}
            onPress={() => navigation.navigate('OwnerBookingsTab', { filter: 'upcoming' })}
          >
            <Text style={styles.summaryValue}>{summary.upcoming}</Text>
            <Text style={styles.summaryLabel}>Upcoming</Text>
          </Pressable>
          <Pressable
            style={styles.summaryTile}
            onPress={() => navigation.navigate('OwnerBookingsTab', { filter: 'completed' })}
          >
            <Text style={styles.summaryValue}>{summary.completedToday}</Text>
            <Text style={styles.summaryLabel}>Completed today</Text>
          </Pressable>
          <Pressable
            style={styles.summaryTile}
            onPress={() => navigation.navigate('OwnerBookingsTab', { filter: 'cancelled' })}
          >
            <Text style={styles.summaryValue}>{summary.cancelledNoShowToday}</Text>
            <Text style={styles.summaryLabel}>Cancelled / no-show today</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.quickLinks}>
        <Pressable style={styles.quickLink} onPress={() => navigation.navigate('OwnerBookingsTab', undefined)}>
          <Text style={styles.quickLinkText}>Bookings</Text>
        </Pressable>
        <Pressable style={styles.quickLink} onPress={() => navigation.navigate('OwnerQueueTab')}>
          <Text style={styles.quickLinkText}>Live queue</Text>
        </Pressable>
        <Pressable style={styles.quickLink} onPress={() => navigation.navigate('OwnerShopTab')}>
          <Text style={styles.quickLinkText}>Manage shop</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[2] },
  skeleton: { height: 140, borderRadius: radius.lg },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[4] },
  summaryTile: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: space[3],
  },
  summaryValue: { fontFamily: font.displaySemiBold, fontSize: fontSize.xl, color: color.ink },
  summaryLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[4] },
  pickerChip: { paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1, borderColor: color.border },
  pickerChipActive: { borderColor: color.accent, backgroundColor: color.accentSoft },
  pickerChipText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: color.muted },
  pickerChipTextActive: { color: color.accent },
  card: { marginBottom: space[4] },
  salonName: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: color.ink },
  salonStatus: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.muted, marginTop: space[1], marginBottom: space[3] },
  readinessList: { marginBottom: space[3] },
  readinessItem: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginBottom: 2 },
  actionButton: { marginTop: space[1] },
  quickLinks: { gap: space[2] },
  quickLink: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, padding: space[4] },
  quickLinkText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
});
