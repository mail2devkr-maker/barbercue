import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { BOOKING_PATHS, DISCOVERY_PATHS, SALON_BOOKING_INFO_PATHS } from '@barbercue/shared';
import type { BookingDetailDto, CancellationPolicyDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { color, font, fontSize, space } from '../lib/theme';
import { Screen, SectionHeader, Card, Button, InlineError } from '../components/ui';
import type { SearchStackParamList, TabParamList } from '../navigation/types';

type Props = CompositeScreenProps<
  NativeStackScreenProps<SearchStackParamList, 'ConfirmBooking'>,
  BottomTabScreenProps<TabParamList>
>;

// Part O (Customer Dues + Cancellation Policy mission) — same formatting rule as apps/web's
// BookingFlow.tsx: only the real effective window, never a hard-coded "1 hour".
function formatFreeCancellationWindow(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minutes`;
}

export default function ConfirmBookingScreen({ route, navigation }: Props) {
  const {
    salonId,
    salonName,
    serviceId,
    serviceName,
    preferredStaffId,
    preferredStaffName,
    slotStart,
    slotEnd,
    selectedStyleName,
  } = route.params;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingDetailDto | null>(null);
  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicyDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<CancellationPolicyDto>(
      `${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.cancellationPolicy}`,
    )
      .then((policy) => {
        if (!cancelled) setCancellationPolicy(policy);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [salonId]);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch<BookingDetailDto>(BOOKING_PATHS.bookings, {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify({
          salonId,
          serviceId,
          slotStart,
          ...(preferredStaffId ? { preferredStaffId } : {}),
          ...(selectedStyleName ? { selectedStyleName } : {}),
        }),
      });
      setBooking(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the booking. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (booking) {
    return (
      <Screen contentStyle={styles.centeredContent}>
        <SectionHeader eyebrow="Confirmed" title="Booking confirmed" />
        <Card style={styles.card}>
          <Text style={styles.line}>
            {booking.serviceName} at {booking.salonName}
          </Text>
          <Text style={styles.line}>{new Date(booking.slotStart).toLocaleString()}</Text>
          {booking.selectedStyleName && <Text style={styles.line}>Style: {booking.selectedStyleName}</Text>}
          <Text style={styles.status}>Status: {booking.status}</Text>
        </Card>
        <Button
          title="View my bookings"
          onPress={() => {
            // Leave this stack clean for next time (pop back to the salon search root) before
            // jumping to the Bookings tab — otherwise returning to Search later would land back
            // on this now-stale confirmation screen.
            navigation.popToTop();
            navigation.navigate('BookingsTab', { screen: 'MyBookings' });
          }}
          style={styles.actionButton}
        />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.centeredContent}>
      <SectionHeader eyebrow="Booking" title="Confirm booking" />
      <Card style={styles.card}>
        <Text style={styles.line}>
          {serviceName} at {salonName}
        </Text>
        <Text style={styles.line}>
          {new Date(slotStart).toLocaleString()} –{' '}
          {new Date(slotEnd).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </Text>
        {preferredStaffName && <Text style={styles.line}>Preferred barber: {preferredStaffName}</Text>}
        {selectedStyleName && <Text style={styles.line}>Style: {selectedStyleName}</Text>}
        {cancellationPolicy && (
          <Text style={styles.policyLine}>
            Free cancellation up to {formatFreeCancellationWindow(cancellationPolicy.effectiveFreeCancellationWindowMinutes)}{' '}
            before your appointment.
          </Text>
        )}
      </Card>
      {error && <InlineError message={error} />}
      {/* The summary above (service/salon/time) already functions as the confirmation step —
          matching apps/web's BookingFlow, which also has no separate "are you sure" dialog.
          Deliberately not react-native's Alert.alert here: it renders nothing on React Native
          Web (found while verifying this screen through the web target), which would silently
          make this button do nothing. */}
      <Button title="Confirm booking" onPress={() => void handleConfirm()} loading={submitting} style={styles.actionButton} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centeredContent: { justifyContent: 'center' },
  card: { marginBottom: space[4] },
  line: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.ink, marginBottom: space[1] },
  policyLine: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[1] },
  status: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.accent, marginTop: space[2] },
  actionButton: { marginTop: space[2] },
});
