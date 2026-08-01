import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  BOOKING_PATHS,
  DISCOVERY_PATHS,
  SALON_BOOKING_INFO_PATHS,
  computeCancellationCharge,
} from '@barbercue/shared';
import type {
  BookingDetailDto,
  CancelBookingResponseDto,
  CancellationPolicyDto,
  QueueEntryDetailDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { QueueStatusPanel } from '../components/QueueStatusPanel';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'BookingDetail'>;

const CANCELLABLE_STATUSES = new Set(['CONFIRMED', 'PENDING_PAYMENT']);
// Mirrors the backend's EARLY_CHECKIN_WINDOW_MINUTES (queue.service.ts) — a UI convenience only;
// the backend remains authoritative and re-validates on the actual check-in request.
const EARLY_CHECKIN_WINDOW_MINUTES = 15;

function canCheckIn(booking: BookingDetailDto): boolean {
  if (booking.status !== 'CONFIRMED') return false;
  const minutesUntilSlot = (new Date(booking.slotStart).getTime() - Date.now()) / 60_000;
  return minutesUntilSlot <= EARLY_CHECKIN_WINDOW_MINUTES;
}

export default function BookingDetailScreen({ route }: Props) {
  const { bookingId } = route.params;
  const [booking, setBooking] = useState<BookingDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
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
  }, [bookingId]);

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
      <View style={styles.center}>
        <ActivityIndicator color="#EDE6DA" />
      </View>
    );
  }
  if (error && !booking) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!booking) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{booking.serviceName}</Text>
      <Text style={styles.subtitle}>{booking.salonName}</Text>
      <Text style={styles.subtitle}>{new Date(booking.slotStart).toLocaleString()}</Text>
      <Text style={styles.status}>Status: {booking.status}</Text>
      {booking.preferredStaffName && (
        <Text style={styles.subtitle}>Preferred barber: {booking.preferredStaffName}</Text>
      )}
      {booking.cancellationChargeAmount !== null && booking.cancellationChargeAmount > 0 && (
        <Text style={styles.subtitle}>Cancellation charge: ₹{booking.cancellationChargeAmount}</Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      {CANCELLABLE_STATUSES.has(booking.status) && !confirming && (
        <Pressable style={styles.button} onPress={() => void startCancelFlow()}>
          <Text style={styles.buttonText}>Cancel booking</Text>
        </Pressable>
      )}

      {confirming && (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmTitle}>Cancel booking?</Text>
          {previewLoading && <ActivityIndicator color="#EDE6DA" style={{ marginTop: 8 }} />}
          {!previewLoading && preview !== null && preview > 0 && (
            <Text style={styles.subtitle}>
              Cancelling now will charge ₹{preview} (outside the free cancellation window).
            </Text>
          )}
          {!previewLoading && preview === 0 && (
            <Text style={styles.subtitle}>No charge — you&apos;re within the free cancellation window.</Text>
          )}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
            <Pressable
              style={[styles.button, styles.secondaryButton]}
              onPress={() => setConfirming(false)}
              disabled={cancelling}
            >
              <Text style={styles.buttonText}>Keep booking</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => void confirmCancel()} disabled={cancelling || previewLoading}>
              {cancelling ? (
                <ActivityIndicator color="#EDE6DA" />
              ) : (
                <Text style={styles.buttonText}>Confirm cancellation</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}

      {queueEntry ? (
        <QueueStatusPanel entry={queueEntry} onEntryChange={setQueueEntry} />
      ) : (
        canCheckIn(booking) && (
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void handleCheckIn()} disabled={checkingIn}>
            {checkingIn ? <ActivityIndicator color="#EDE6DA" /> : <Text style={styles.buttonText}>Check in</Text>}
          </Pressable>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1A17', padding: 24 },
  center: { flex: 1, backgroundColor: '#1C1A17', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: '#EDE6DA' },
  subtitle: { fontSize: 14, color: '#B8AFA0', marginTop: 4 },
  status: { fontSize: 15, color: '#EDE6DA', marginTop: 12, fontWeight: '600' },
  error: { color: '#E24B4A', fontSize: 14, marginTop: 12 },
  button: {
    backgroundColor: '#B0413E',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
    flex: 1,
  },
  secondaryButton: { backgroundColor: '#2A2723', borderWidth: 1, borderColor: '#B8AFA0' },
  buttonText: { color: '#EDE6DA', fontSize: 16, fontWeight: '600' },
  confirmBox: { backgroundColor: '#2A2723', borderRadius: 12, padding: 16, marginTop: 24 },
  confirmTitle: { color: '#EDE6DA', fontSize: 16, fontWeight: '700' },
});
