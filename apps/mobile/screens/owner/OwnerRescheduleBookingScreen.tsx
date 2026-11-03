import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { DASHBOARD_PATHS, shopRescheduleBookingSchema, type SalonTimezoneResultDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { describeRescheduleNotice, formatShopDate, formatShopTime, ownerOpsPaths } from '../../lib/owner/ops';
import { fastQue, font, fontSize, space } from '../../lib/theme';
import { InlineError, PremiumButton, PremiumCard, PremiumScreen, PremiumSectionHeader } from '../../components/ui';
import { Hint } from '../../components/owner/ops-ui';
import { SlotPickerNative } from '../../components/owner/SlotPickerNative';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

/** Moves an appointment to another real free time; the customer is notified of the new time. */
export default function OwnerRescheduleBookingScreen() {
  const route = useRoute<RouteProp<OwnerShopStackParamList, 'OwnerRescheduleBooking'>>();
  const navigation = useNavigation<{ goBack: () => void; navigate: (name: string, params?: unknown) => void }>();
  const { salonId, bookingId, serviceIds, staffId, label } = route.params;
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SalonTimezoneResultDto>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.timezone}`)
      .then((tz) => !cancelled && setTimeZone(tz.timezone ?? null))
      .catch(() => {
        /* times then render in the device zone; availability itself is still the shop's */
      });
    return () => {
      cancelled = true;
    };
  }, [salonId]);

  async function submit() {
    setError(null);
    const parsed = shopRescheduleBookingSchema.safeParse({ slotStart: slot ?? '' });
    if (!parsed.success) {
      setError('Choose a date and a free time.');
      return;
    }
    setBusy(true);
    try {
      const result = await apiFetch<{ notification?: { inApp: string; push: string } }>(ownerOpsPaths.rescheduleBooking(salonId, bookingId), {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify(parsed.data),
      });
      setDone(`Moved to ${formatShopDate(parsed.data.slotStart, timeZone)} at ${formatShopTime(parsed.data.slotStart, timeZone)}. ${describeRescheduleNotice(result)}`.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not move this appointment. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PremiumScreen>
      <PremiumSectionHeader eyebrow="Bookings" title="Reschedule appointment" subtitle={label} />
      {done ? (
        <PremiumCard strong testID="reschedule-done">
          <Text style={styles.ok}>{done}</Text>
          <PremiumButton title="Back to bookings" onPress={() => navigation.navigate('OwnerBookingsTab')} style={styles.button} />
        </PremiumCard>
      ) : (
        <>
          {error && <InlineError message={error} />}
          <PremiumCard>
            <SlotPickerNative salonId={salonId} serviceIds={serviceIds} staffId={staffId ?? undefined} timeZone={timeZone} value={slot} onChange={setSlot} />
            <Hint>Only times that are really free for the same services and barber are offered.</Hint>
          </PremiumCard>
          <PremiumButton testID="reschedule-submit" title="Move appointment" onPress={() => void submit()} loading={busy} style={styles.button} />
          <PremiumButton title="Cancel" variant="quiet" onPress={() => navigation.goBack()} style={styles.button} />
        </>
      )}
    </PremiumScreen>
  );
}

const styles = StyleSheet.create({
  ok: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.success },
  button: { marginTop: space[3] },
});
