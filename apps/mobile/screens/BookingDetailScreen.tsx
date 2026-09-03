import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  BOOKING_PATHS,
  DISCOVERY_PATHS,
  SALON_BOOKING_INFO_PATHS,
  computeCancellationCharge,
  formatMoney,
} from '@barbercue/shared';
import type {
  BookingDetailDto,
  CancelBookingResponseDto,
  CancellationPolicyDto,
  QueueEntryDetailDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { openDirections, openWhatsappShare, salonPageUrl, shareSalon } from '../lib/booking-actions';
import { useRebook } from '../lib/use-rebook';
import { QueueStatusPanel } from '../components/QueueStatusPanel';
import { RescheduleSheet } from '../components/RescheduleSheet';
import { ReviewPanel } from '../components/ReviewPanel';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Card, Button, Skeleton, ErrorState, InlineError } from '../components/ui';
import type { BookingsStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<BookingsStackParamList, 'BookingDetail'>;

const CANCELLABLE_STATUSES = new Set(['CONFIRMED', 'PENDING_PAYMENT']);
// Mirrors the backend's EARLY_CHECKIN_WINDOW_MINUTES (queue.service.ts) — a UI convenience only;
// the backend remains authoritative and re-validates on the actual check-in request.
const EARLY_CHECKIN_WINDOW_MINUTES = 15;

function canCheckIn(booking: BookingDetailDto): boolean {
  if (booking.status !== 'CONFIRMED') return false;
  const minutesUntilSlot = (new Date(booking.slotStart).getTime() - Date.now()) / 60_000;
  return minutesUntilSlot <= EARLY_CHECKIN_WINDOW_MINUTES;
}

function statusColor(status: string): string {
  if (status === 'CONFIRMED') return color.success;
  if (status === 'PENDING_PAYMENT') return color.gold;
  if (status === 'CANCELLED') return color.muted;
  return color.ink;
}

export default function BookingDetailScreen({ route }: Props) {
  const { bookingId } = route.params;
  const { rebook, rebookingId, rebookError } = useRebook();
  const [booking, setBooking] = useState<BookingDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Cancel confirmation is inline state, not react-native's Alert.alert: Alert.alert renders
  // nothing on React Native Web (found while verifying this screen through the web target,
  // apps/mobile's standard verification path — see AGENTS.md), which would silently make
  // "Cancel booking" do nothing there. This mirrors apps/web's CancelBookingDialog instead: an
  // in-screen panel, portable across native and web.
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Once checked in, a booking can never be checked in again (the backend keys ALREADY_CHECKED_IN
  // off the booking, not the entry's current status) — so this never reverts to the button, even
  // after the resulting QueueEntry reaches a terminal state.
  const [queueEntry, setQueueEntry] = useState<QueueEntryDetailDto | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  function loadBooking() {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<BookingDetailDto>(`${BOOKING_PATHS.bookings}/${bookingId}`)
      .then((result) => {
        if (!cancelled) setBooking(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load this booking.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    return loadBooking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  // Issue 4 (mobile stabilization mission) — a silent refetch (no full-screen skeleton) for pull-
  // to-refresh, reusing the same GET as loadBooking() rather than a second fetch implementation.
  async function handleRefresh() {
    setRefreshing(true);
    try {
      const result = await apiFetch<BookingDetailDto>(`${BOOKING_PATHS.bookings}/${bookingId}`);
      setBooking(result);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this booking.');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleShare() {
    if (!booking) return;
    setActionError(null);
    try {
      await shareSalon(booking);
    } catch {
      setActionError('Could not open the share sheet.');
    }
  }

  async function startCancelFlow() {
    if (!booking) return;
    setConfirming(true);
    setPreviewLoading(true);
    setError(null);
    try {
      const policy = await apiFetch<CancellationPolicyDto>(
        `${DISCOVERY_PATHS.salons}/${booking.salonId}/booking/${SALON_BOOKING_INFO_PATHS.cancellationPolicy}`,
      );
      const minutesUntilSlot = (new Date(booking.slotStart).getTime() - Date.now()) / 60_000;
      setPreview(computeCancellationCharge(policy, booking.servicePrice, minutesUntilSlot, false));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the cancellation policy.');
      setConfirming(false);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function confirmCancel() {
    if (!booking) return;
    setCancelling(true);
    try {
      const result = await apiFetch<CancelBookingResponseDto>(
        `${BOOKING_PATHS.bookings}/${booking.id}/${BOOKING_PATHS.cancel}`,
        { method: 'POST', headers: { 'Idempotency-Key': newIdempotencyKey() } },
      );
      setBooking(result.booking);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel this booking.');
    } finally {
      setCancelling(false);
    }
  }

  async function handleCheckIn() {
    if (!booking) return;
    setCheckingIn(true);
    setError(null);
    try {
      const created = await apiFetch<QueueEntryDetailDto>(
        `${BOOKING_PATHS.bookings}/${booking.id}/${BOOKING_PATHS.checkIn}`,
        { method: 'POST', headers: { 'Idempotency-Key': newIdempotencyKey() } },
      );
      setQueueEntry(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check in. Please try again.');
    } finally {
      setCheckingIn(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <Skeleton style={styles.heroSkeleton} />
        <Skeleton style={styles.lineSkeleton} />
      </Screen>
    );
  }
  if (error && !booking) {
    return (
      <Screen scroll={false}>
        <ErrorState message={error} onRetry={loadBooking} />
      </Screen>
    );
  }
  if (!booking) return null;

  return (
    <Screen refreshing={refreshing} onRefresh={() => void handleRefresh()}>
      <SectionHeader eyebrow="Booking" title={booking.serviceName} subtitle={booking.salonName} />

      <Card style={styles.card}>
        <Text style={[styles.status, { color: statusColor(booking.status) }]}>Status: {booking.status}</Text>
        <Text style={styles.line}>
          {new Date(booking.slotStart).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </Text>
        <Text style={styles.line}>
          {new Date(booking.slotStart).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} –{' '}
          {new Date(booking.slotEnd).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          {` (${booking.serviceDurationMinutes} min)`}
        </Text>
        <Text style={styles.line}>{formatMoney(booking.servicePrice, booking.currency)}</Text>
        {booking.preferredStaffName && <Text style={styles.line}>Preferred barber: {booking.preferredStaffName}</Text>}
        {booking.selectedStyleName && <Text style={styles.line}>Style: {booking.selectedStyleName}</Text>}
        {booking.prepaymentRequiredAmount !== null && booking.prepaymentRequiredAmount > 0 && (
          <Text style={styles.line}>Prepayment required: {formatMoney(booking.prepaymentRequiredAmount, booking.currency)}</Text>
        )}
        {booking.cancellationChargeAmount !== null && booking.cancellationChargeAmount > 0 && (
          <Text style={styles.line}>Cancellation charge: {formatMoney(booking.cancellationChargeAmount, booking.currency)}</Text>
        )}
        <Text style={styles.bookingId}>Booking ID: {booking.id.slice(0, 8).toUpperCase()}</Text>
      </Card>

      <View style={styles.linkRow}>
        <Button title="Get Directions" variant="outline" onPress={() => void openDirections(booking)} style={styles.linkButton} />
        <Button title="Share" variant="outline" onPress={() => void handleShare()} style={styles.linkButton} />
      </View>
      <View style={styles.linkRow}>
        <Button
          title="Share on WhatsApp"
          variant="outline"
          onPress={() => void openWhatsappShare(`Check out ${booking.salonName} on BarberCue: ${salonPageUrl(booking)}`)}
          style={styles.linkButton}
        />
        <Button
          title="Book again"
          variant="outline"
          onPress={() => void rebook(booking)}
          loading={rebookingId === booking.id}
          style={styles.linkButton}
        />
      </View>

      {error && <InlineError message={error} />}
      {actionError && <InlineError message={actionError} />}
      {rebookError && <InlineError message={rebookError} />}

      {CANCELLABLE_STATUSES.has(booking.status) && !confirming && (
        <View style={styles.linkRow}>
          <Button title="Cancel booking" variant="secondary" onPress={() => void startCancelFlow()} style={styles.linkButton} />
          <Button
            title={rescheduling ? 'Hide reschedule' : 'Reschedule'}
            variant="secondary"
            onPress={() => setRescheduling((v) => !v)}
            style={styles.linkButton}
          />
        </View>
      )}

      {rescheduling && (
        <RescheduleSheet
          booking={booking}
          onClose={() => setRescheduling(false)}
          onRescheduled={(updated) => {
            setBooking(updated);
            setRescheduling(false);
          }}
        />
      )}

      {confirming && (
        <Card style={styles.confirmBox}>
          <Text style={styles.confirmTitle}>Cancel booking?</Text>
          {previewLoading && <ActivityIndicator color={color.muted} style={styles.previewSpinner} />}
          {!previewLoading && preview !== null && preview > 0 && (
            <Text style={styles.line}>
              Cancelling now will charge {formatMoney(preview, booking.currency)} (outside the free cancellation window).
            </Text>
          )}
          {!previewLoading && preview === 0 && <Text style={styles.line}>No charge — you&apos;re within the free cancellation window.</Text>}
          <View style={styles.confirmRow}>
            <Button
              title="Keep booking"
              variant="outline"
              onPress={() => setConfirming(false)}
              disabled={cancelling}
              style={styles.confirmRowButton}
            />
            <Button
              title="Confirm cancellation"
              onPress={() => void confirmCancel()}
              loading={cancelling}
              disabled={previewLoading}
              style={styles.confirmRowButton}
            />
          </View>
        </Card>
      )}

      {queueEntry ? (
        <QueueStatusPanel entry={queueEntry} onEntryChange={setQueueEntry} />
      ) : (
        canCheckIn(booking) && (
          <Button title="Check in" variant="secondary" onPress={() => void handleCheckIn()} loading={checkingIn} style={styles.actionButton} />
        )
      )}

      <ReviewPanel
        booking={booking}
        onReviewed={(bookingId) =>
          setBooking((prev) => (prev && prev.id === bookingId ? { ...prev, hasReview: true } : prev))
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroSkeleton: { height: 90, borderRadius: radius.lg, marginBottom: space[3] },
  lineSkeleton: { height: 16, borderRadius: 6, width: '60%' },
  card: { marginBottom: space[4] },
  line: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.ink, marginBottom: space[1] },
  status: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, marginBottom: space[2] },
  bookingId: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[2] },
  actionButton: { marginBottom: space[3] },
  linkRow: { flexDirection: 'row', gap: space[2], marginBottom: space[3] },
  linkButton: { flex: 1 },
  confirmBox: { marginBottom: space[4] },
  confirmTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink, marginBottom: space[2] },
  previewSpinner: { marginVertical: space[2], alignSelf: 'flex-start' },
  confirmRow: { flexDirection: 'row', gap: space[3], marginTop: space[3] },
  confirmRowButton: { flex: 1 },
});
