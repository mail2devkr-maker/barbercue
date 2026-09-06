import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import {
  BOOKING_PATHS,
  CREDITS_PATHS,
  DISCOVERY_PATHS,
  SALON_BOOKING_INFO_PATHS,
  computeMaxRedeemableCredits,
  formatBookingArrivalTime,
  formatMoney,
} from '@barbercue/shared';
import type {
  BookingDetailDto,
  CancellationPolicyDto,
  CustomerCreditBalanceDto,
  UiStrings,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { dateLocaleFor } from '../lib/date-locale';
import { newIdempotencyKey } from '../lib/idempotency';
import { useAuth } from '../lib/auth-context';
import { useLanguage } from '../lib/language-context';
import { stashPendingGuestIntent } from '../lib/guest-booking-handoff';
import { GoogleSignInGate } from '../components/auth/GoogleSignInGate';
import { color, font, fontSize, lineHeightFor, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Card, Button, InlineError } from '../components/ui';
import type { SearchStackParamList, TabParamList } from '../navigation/types';

// FastQue Credits / Wallet V1: steps by a flat ₹5 — fine-grained enough to reach any cap value
// (all multiples of 10, per computeMaxRedeemableCredits) without a control cluttered by 1-unit
// taps. No slider dependency exists in this app, so a stepper (−/+) is the RN-native equivalent of
// web's <input type="range">.
const CREDITS_STEP = 5;

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
    servicePrice,
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
  const { t, language } = useLanguage();
  const { status } = useAuth();

  // FastQue Credits / Wallet V1 — only fetched once signed in; an anonymous guest has no wallet.
  // maxRedeemable is a pure client-side preview (packages/shared's computeMaxRedeemableCredits,
  // the same formula the server independently re-derives and enforces) — never trusted as
  // authoritative; the server always recomputes it from its own price and clamps to the live
  // balance regardless of what this screen sends.
  const [creditsBalance, setCreditsBalance] = useState<number | null>(null);
  const [creditsToRedeem, setCreditsToRedeem] = useState(0);
  const maxRedeemable = Math.min(creditsBalance ?? 0, computeMaxRedeemableCredits(servicePrice));

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

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    apiFetch<CustomerCreditBalanceDto>(`${CREDITS_PATHS.credits}/${CREDITS_PATHS.balance}`)
      .then((result) => {
        if (!cancelled) setCreditsBalance(result.balance);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status]);

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
          ...(creditsToRedeem > 0 ? { creditsToRedeem } : {}),
        }),
      });
      setBooking(result);
      setCreditsToRedeem(0);
      // Redemption never fails/rejects — the server always clamps to whatever is actually
      // redeemable (see BookingsService.create) — so re-fetch the real balance rather than
      // locally subtracting: result.creditsRedeemedAmount is the server's actual applied amount,
      // which may be less than what this screen requested.
      if (creditsToRedeem > 0) {
        apiFetch<CustomerCreditBalanceDto>(`${CREDITS_PATHS.credits}/${CREDITS_PATHS.balance}`)
          .then((r) => setCreditsBalance(r.balance))
          .catch(() => undefined);
      }
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
            {booking.serviceName}{t.atConnector}{booking.salonName}
          </Text>
          {(() => {
            // Part 5 (show arrival time after booking): converted through the salon's own
            // timezone, never the device's — a customer booking a shop outside their own
            // city/timezone must never be shown a silently-wrong arrival time.
            const arrival = formatBookingArrivalTime(
              booking.slotStart,
              booking.salonTimezone,
              dateLocaleFor(language),
            );
            return (
              <Text style={styles.line}>
                {arrival.date}, {arrival.time}
                {!arrival.isDeviceLocalTimezone && t.shopLocalTimeSuffix}
              </Text>
            );
          })()}
          {booking.selectedStyleName && <Text style={styles.line}>{t.styleLabelPrefix}{booking.selectedStyleName}</Text>}
          {booking.creditsRedeemedAmount !== null && booking.creditsRedeemedAmount > 0 && (
            <Text style={styles.line}>
              {t.creditsRedeemedLabel}: {formatMoney(booking.creditsRedeemedAmount, null)} · {t.payableAmountLabel}:{' '}
              {formatMoney(booking.payableAmount, null)}
            </Text>
          )}
          <Text style={styles.status}>{t.statusLabelPrefix}{booking.status}</Text>
        </Card>
        <Button
          title={t.bookAgainAction}
          onPress={() => {
            // ConfirmBookingScreen's route params carry no countryCode/citySlug/salonSlug, so there
            // is no direct route back to this same salon's profile — the search root is the
            // reachable, always-valid reset target. Local state is reset too (rather than relying
            // solely on popToTop unmounting this instance) since this screen can in principle be
            // revisited without a full remount depending on navigator config.
            setBooking(null);
            setError(null);
            setCreditsToRedeem(0);
            navigation.popToTop();
            navigation.navigate('SearchTab', { screen: 'SalonSearch' });
          }}
          style={styles.actionButton}
        />
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
          {serviceName}{t.atConnector}{salonName}
        </Text>
        <Text style={styles.line}>
          {new Date(slotStart).toLocaleString(dateLocaleFor(language))} –{' '}
          {new Date(slotEnd).toLocaleTimeString(dateLocaleFor(language), { hour: '2-digit', minute: '2-digit' })}
        </Text>
        {preferredStaffName && <Text style={styles.line}>{t.preferredBarberPrefix}{preferredStaffName}</Text>}
        {selectedStyleName && <Text style={styles.line}>{t.styleLabelPrefix}{selectedStyleName}</Text>}
        {cancellationPolicy && (
          <Text style={styles.policyLine}>
            {t.freeCancellationUpTo}{formatFreeCancellationWindow(cancellationPolicy.effectiveFreeCancellationWindowMinutes, t)}{t.beforeYourAppointment}
          </Text>
        )}
      </Card>
      {status === 'authenticated' && maxRedeemable > 0 && (
        <Card style={styles.card}>
          <Text style={styles.line}>{t.redeemCreditsLabel}</Text>
          <Text style={styles.line}>
            {t.walletBalanceLabel}: {formatMoney(creditsBalance ?? 0, null)}
          </Text>
          <Text style={styles.hint}>{t.redeemCreditsHint}</Text>
          <View style={styles.stepperRow}>
            <Pressable
              style={styles.stepperButton}
              disabled={creditsToRedeem <= 0}
              onPress={() => setCreditsToRedeem((v) => Math.max(0, v - CREDITS_STEP))}
            >
              <Text style={styles.stepperButtonText}>−</Text>
            </Pressable>
            <Text style={styles.stepperValue}>{formatMoney(creditsToRedeem, null)}</Text>
            <Pressable
              style={styles.stepperButton}
              disabled={creditsToRedeem >= maxRedeemable}
              onPress={() => setCreditsToRedeem((v) => Math.min(maxRedeemable, v + CREDITS_STEP))}
            >
              <Text style={styles.stepperButtonText}>+</Text>
            </Pressable>
            <Pressable
              style={styles.maxButton}
              disabled={creditsToRedeem >= maxRedeemable}
              onPress={() => setCreditsToRedeem(maxRedeemable)}
            >
              <Text style={styles.maxButtonText}>{formatMoney(maxRedeemable, null)}</Text>
            </Pressable>
          </View>
          <Text style={styles.policyLine}>
            {t.payableAmountLabel}: {formatMoney(Math.max(0, servicePrice - creditsToRedeem), null)}
          </Text>
        </Card>
      )}
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
  hint: {
    fontFamily: font.bodyRegular,
    fontSize: fontSize.xs,
    lineHeight: lineHeightFor(fontSize.xs),
    color: color.muted,
    marginBottom: space[2],
  },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: { fontFamily: font.bodySemiBold, fontSize: fontSize.lg, color: color.ink },
  stepperValue: {
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.sm,
    lineHeight: lineHeightFor(fontSize.sm),
    color: color.ink,
    minWidth: 64,
    textAlign: 'center',
  },
  maxButton: {
    marginLeft: 'auto',
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: color.accentSoft,
  },
  maxButtonText: {
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.xs,
    lineHeight: lineHeightFor(fontSize.xs),
    color: color.accent,
  },
});
