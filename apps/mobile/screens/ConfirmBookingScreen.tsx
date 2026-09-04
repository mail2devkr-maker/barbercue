import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { BOOKING_PATHS, DISCOVERY_PATHS, SALON_BOOKING_INFO_PATHS } from '@barbercue/shared';
import type { BookingDetailDto, CancellationPolicyDto, UiStrings } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { useAuth } from '../lib/auth-context';
import { useLanguage } from '../lib/language-context';
import { stashPendingGuestIntent } from '../lib/guest-booking-handoff';
import { GoogleSignInGate } from '../components/auth/GoogleSignInGate';
import { color, font, fontSize, space } from '../lib/theme';
import { Screen, SectionHeader, Card, Button, InlineError } from '../components/ui';
import type { SearchStackParamList, TabParamList } from '../navigation/types';

type Props = CompositeScreenProps<
  NativeStackScreenProps<SearchStackParamList, 'ConfirmBooking'>,
  BottomTabScreenProps<TabParamList>
>;

// Part O (Customer Dues + Cancellation Policy mission) — same formatting rule as apps/web's
// BookingFlow.tsx: only the real effective window, never a hard-coded "1 hour".
function formatFreeCancellationWindow(minutes: number, t: UiStrings): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? t.hoursSingular : t.hoursPlural}`;
  }
  return `${minutes} ${t.minutesSuffix}`;
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
  const { t } = useLanguage();
  const { status } = useAuth();

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
      setError(err instanceof ApiError ? err.message : t.couldNotCreateBooking);
    } finally {
      setSubmitting(false);
    }
  }

  if (booking) {
    return (
      <Screen contentStyle={styles.centeredContent}>
        <SectionHeader eyebrow={t.confirmedEyebrow} title={t.bookingConfirmedTitle} />
        <Card style={styles.card}>
          <Text style={styles.line}>
            {booking.serviceName} at {booking.salonName}
          </Text>
          <Text style={styles.line}>{new Date(booking.slotStart).toLocaleString()}</Text>
          {booking.selectedStyleName && <Text style={styles.line}>{t.styleLabelPrefix}{booking.selectedStyleName}</Text>}
          <Text style={styles.status}>{t.statusLabelPrefix}{booking.status}</Text>
        </Card>
        <Button
          title={t.viewMyBookings}
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
      <SectionHeader eyebrow={t.bookingTitle} title={t.confirmBookingTitle} />
      <Card style={styles.card}>
        <Text style={styles.line}>
          {serviceName} at {salonName}
        </Text>
        <Text style={styles.line}>
          {new Date(slotStart).toLocaleString()} –{' '}
          {new Date(slotEnd).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </Text>
        {preferredStaffName && <Text style={styles.line}>{t.preferredBarberPrefix}{preferredStaffName}</Text>}
        {selectedStyleName && <Text style={styles.line}>{t.styleLabelPrefix}{selectedStyleName}</Text>}
        {cancellationPolicy && (
          <Text style={styles.policyLine}>
            {t.freeCancellationUpTo}{formatFreeCancellationWindow(cancellationPolicy.effectiveFreeCancellationWindowMinutes, t)}{t.beforeYourAppointment}
          </Text>
        )}
      </Card>
      {error && <InlineError message={error} />}
      {/* The summary above (service/salon/time) already functions as the confirmation step —
          matching apps/web's BookingFlow, which also has no separate "are you sure" dialog.
          Deliberately not react-native's Alert.alert here: it renders nothing on React Native
          Web (found while verifying this screen through the web target), which would silently
          make this button do nothing. */}
      {status === 'authenticated' ? (
        <Button title={t.confirm} onPress={() => void handleConfirm()} loading={submitting} style={styles.actionButton} />
      ) : (
        // Issue 2 (mobile launch mission) — browse-first, auth-last: a guest reaches this exact
        // screen with a real slot already chosen. Signing in here (not earlier) is what makes
        // "browse before you commit to an account" genuinely true. App.tsx swaps the whole
        // navigator tree the instant auth status flips, so the in-progress params are stashed
        // first and replayed once the authenticated customer tabs exist (see
        // lib/guest-booking-handoff.ts + RootNavigator's own replay effect) — the guest taps
        // Confirm one more time there rather than losing this screen's state outright.
        <GoogleSignInGate
          label={t.signInWithGoogle}
          onBeforeSignIn={() => stashPendingGuestIntent({ kind: 'booking', params: route.params })}
        />
      )}
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
