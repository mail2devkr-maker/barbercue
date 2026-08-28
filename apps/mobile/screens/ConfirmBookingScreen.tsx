import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { BOOKING_PATHS } from '@barbercue/shared';
import type { BookingDetailDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import type { SearchStackParamList, TabParamList } from '../navigation/types';

type Props = CompositeScreenProps<
  NativeStackScreenProps<SearchStackParamList, 'ConfirmBooking'>,
  BottomTabScreenProps<TabParamList>
>;

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
      <View style={styles.container}>
        <Text style={styles.title}>Booking confirmed</Text>
        <Text style={styles.subtitle}>
          {booking.serviceName} at {booking.salonName}
        </Text>
        <Text style={styles.subtitle}>{new Date(booking.slotStart).toLocaleString()}</Text>
        {booking.selectedStyleName && <Text style={styles.subtitle}>Style: {booking.selectedStyleName}</Text>}
        <Text style={styles.status}>Status: {booking.status}</Text>
        <Pressable
          style={styles.button}
          onPress={() => {
            // Leave this stack clean for next time (pop back to the salon search root) before
            // jumping to the Bookings tab — otherwise returning to Search later would land back
            // on this now-stale confirmation screen. CompositeScreenProps below gives `navigate`
            // both this stack's routes and the parent tab navigator's routes.
            navigation.popToTop();
            navigation.navigate('BookingsTab', { screen: 'MyBookings' });
          }}
        >
          <Text style={styles.buttonText}>View my bookings</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Confirm booking</Text>
      <Text style={styles.subtitle}>
        {serviceName} at {salonName}
      </Text>
      <Text style={styles.subtitle}>
        {new Date(slotStart).toLocaleString()} – {new Date(slotEnd).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </Text>
      {preferredStaffName && <Text style={styles.subtitle}>Preferred barber: {preferredStaffName}</Text>}
      {selectedStyleName && <Text style={styles.subtitle}>Style: {selectedStyleName}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}
      {/* The summary above (service/salon/time) already functions as the confirmation step —
          matching apps/web's BookingFlow, which also has no separate "are you sure" dialog.
          Deliberately not react-native's Alert.alert here: it renders nothing on React Native
          Web (found while verifying this screen through the web target), which would silently
          make this button do nothing. */}
      <Pressable style={styles.button} onPress={() => void handleConfirm()} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#EDE6DA" /> : <Text style={styles.buttonText}>Confirm booking</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1A17', padding: 24, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: '#EDE6DA', marginBottom: 12 },
  subtitle: { fontSize: 14, color: '#B8AFA0', marginTop: 4 },
  status: { fontSize: 15, color: '#EDE6DA', marginTop: 12, fontWeight: '600' },
  error: { color: '#E24B4A', fontSize: 14, marginTop: 12 },
  button: { backgroundColor: '#B0413E', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#EDE6DA', fontSize: 16, fontWeight: '600' },
});
