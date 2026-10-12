import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  DASHBOARD_PATHS,
  DISCOVERY_PATHS,
  SALON_BOOKING_INFO_PATHS,
  createInShopBookingSchema,
  type InShopBookingDto,
  type SalonServiceDto,
  type SalonTimezoneResultDto,
  type StaffOptionDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { useSalon } from '../../lib/salon-context';
import { formatMoney, formatShopDate, formatShopTime, ownerOpsPaths } from '../../lib/owner/ops';
import { fastQue, font, fontSize, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumButton, PremiumCard, PremiumScreen, PremiumSectionHeader, PremiumTextField } from '../../components/ui';
import { Chip, ChipRow, FieldLabel, Hint, ToggleRow } from '../../components/owner/ops-ui';
import { SlotPickerNative } from '../../components/owner/SlotPickerNative';

/**
 * "New in-shop appointment": a scheduled booking an operator makes for someone who contacted the shop
 * directly. It runs through the real booking engine (same availability, capacity and barber checks),
 * with no FastQue account and no online payment hold - any charge is settled at the shop and invoiced
 * afterwards. A phone number is stored only with the customer's consent.
 */
export default function OwnerInShopAppointmentScreen() {
  const navigation = useNavigation<{ goBack: () => void; navigate: (name: string, params?: unknown) => void }>();
  const { selectedSalonId } = useSalon();
  const [services, setServices] = useState<SalonServiceDto[] | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [barbers, setBarbers] = useState<StaffOptionDto[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<InShopBookingDto | null>(null);
  const [attemptKey, setAttemptKey] = useState(() => newIdempotencyKey());

  useEffect(() => {
    if (!selectedSalonId) return undefined;
    let cancelled = false;
    setServices(null);
    apiFetch<SalonServiceDto[]>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${selectedSalonId}/${DASHBOARD_PATHS.services}`)
      .then((list) => !cancelled && setServices(list.filter((s) => s.isActive)))
      .catch(() => !cancelled && setServices([]));
    apiFetch<SalonTimezoneResultDto>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${selectedSalonId}/${DASHBOARD_PATHS.timezone}`)
      .then((tz) => !cancelled && setTimeZone(tz.timezone ?? null))
      .catch(() => {
        /* times then render in the device zone; availability itself is still the shop's */
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSalonId]);

  const serviceKey = selected.join(',');
  useEffect(() => {
    if (!selectedSalonId || !serviceKey) {
      setBarbers([]);
      return undefined;
    }
    let cancelled = false;
    apiFetch<StaffOptionDto[]>(`${DISCOVERY_PATHS.salons}/${selectedSalonId}/booking/${SALON_BOOKING_INFO_PATHS.staff}?serviceIds=${serviceKey}`)
      .then((list) => {
        if (cancelled) return;
        setBarbers(list);
        setStaffId((current) => (current && list.some((b) => b.id === current) ? current : null));
      })
      .catch(() => !cancelled && setBarbers([]));
    return () => {
      cancelled = true;
    };
  }, [selectedSalonId, serviceKey]);

  const chosen = useMemo(() => (services ?? []).filter((s) => selected.includes(s.id)), [services, selected]);
  const totalMinutes = chosen.reduce((sum, s) => sum + s.durationMinutes, 0);
  const totalPrice = chosen.reduce((sum, s) => sum + s.price, 0);
  const currency = services?.[0]?.currency ?? 'INR';

  function toggleService(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setSlot(null);
  }

  async function submit() {
    if (!selectedSalonId) return;
    setError(null);
    const parsed = createInShopBookingSchema.safeParse({
      guestName: name,
      ...(phone.trim() ? { guestPhone: phone.trim() } : {}),
      contactConsent: consent,
      serviceIds: selected,
      slotStart: slot ?? '',
      ...(staffId ? { preferredStaffId: staffId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.path[0] === 'slotStart' ? 'Choose a date and a free time.' : (issue?.message ?? 'Check the details and try again.'));
      return;
    }
    setBusy(true);
    try {
      const booking = await apiFetch<InShopBookingDto>(ownerOpsPaths.inShopBooking(selectedSalonId), {
        method: 'POST',
        headers: { 'Idempotency-Key': attemptKey },
        body: JSON.stringify(parsed.data),
      });
      setCreated(booking);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the appointment.');
      // A rejected attempt is retried under a new key once the operator changes something.
      setAttemptKey(newIdempotencyKey());
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCreated(null);
    setName('');
    setPhone('');
    setConsent(false);
    setSelected([]);
    setStaffId(null);
    setSlot(null);
    setNote('');
    setAttemptKey(newIdempotencyKey());
  }

  if (!selectedSalonId) {
    return (
      <PremiumScreen scroll={false}>
        <EmptyState title="Choose a shop" message="Select a shop to create an appointment." />
      </PremiumScreen>
    );
  }

  if (created) {
    return (
      <PremiumScreen>
        <PremiumSectionHeader title="Appointment created" />
        <PremiumCard strong testID="inshop-created">
          <Text style={styles.ok}>The in-shop appointment is booked and now appears in Bookings.</Text>
          <Text style={styles.row}>Customer: {created.guestName}</Text>
          {created.guestPhone ? <Text style={styles.row}>Mobile: {created.guestPhone}</Text> : null}
          <Text style={styles.row}>
            When: {formatShopDate(created.slotStart, timeZone)} at {formatShopTime(created.slotStart, timeZone)}
          </Text>
          <Text style={styles.row}>Services: {created.serviceNames.join(' + ')}</Text>
          <Text style={styles.row}>Barber: {created.staffName ?? 'Any available barber'}</Text>
          <Text style={styles.row}>Reference: {created.id.slice(0, 8).toUpperCase()}</Text>
          <View style={styles.actions}>
            <PremiumButton title="View bookings" onPress={() => navigation.navigate('OwnerBookingsTab')} />
            <PremiumButton title="Create another" variant="secondary" onPress={reset} />
          </View>
        </PremiumCard>
      </PremiumScreen>
    );
  }

  return (
    <PremiumScreen>
      <PremiumSectionHeader
        eyebrow="Bookings"
        title="New in-shop appointment"
        subtitle="For a customer who came to the shop or phoned and wants a set time. They do not need a FastQue account or an online payment. To seat someone right now, add them to the Live Queue instead."
      />
      {error && <InlineError message={error} />}

      <PremiumCard style={styles.card}>
        <Text style={styles.cardTitle}>1 · Customer</Text>
        <FieldLabel>Customer name</FieldLabel>
        <PremiumTextField testID="inshop-name" value={name} onChangeText={setName} maxLength={60} autoCapitalize="words" accessibilityLabel="Customer name" />
        <FieldLabel>Mobile number (optional)</FieldLabel>
        <PremiumTextField testID="inshop-phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98765 43210" accessibilityLabel="Mobile number" />
        <Hint>Used only to reach them about this appointment.</Hint>
        {phone.trim() ? (
          <ToggleRow testID="inshop-consent" label="The customer agreed that the shop may save their number and contact them about this appointment." value={consent} onChange={setConsent} />
        ) : null}
      </PremiumCard>

      <PremiumCard style={styles.card}>
        <Text style={styles.cardTitle}>2 · Services</Text>
        {services === null ? (
          <Hint>Loading services…</Hint>
        ) : services.length === 0 ? (
          <Hint tone="warn">This shop has no active services yet. Add a service under Shop first.</Hint>
        ) : (
          <ChipRow>
            {services.map((s) => (
              <Chip key={s.id} testID={`inshop-service-${s.id}`} label={`${s.name} · ${s.durationMinutes} min · ${formatMoney(s.price, s.currency)}`} selected={selected.includes(s.id)} onPress={() => toggleService(s.id)} />
            ))}
          </ChipRow>
        )}
        {chosen.length > 0 && (
          <Hint>
            Total {totalMinutes} min · {formatMoney(totalPrice, currency)}
          </Hint>
        )}
      </PremiumCard>

      <PremiumCard style={styles.card}>
        <Text style={styles.cardTitle}>3 · Barber (optional)</Text>
        {selected.length === 0 ? (
          <Hint>Choose services first.</Hint>
        ) : barbers.length === 0 ? (
          <Hint tone="warn">No barber is qualified for every chosen service.</Hint>
        ) : (
          <ChipRow>
            <Chip testID="inshop-barber-any" label="Any available barber" selected={staffId === null} onPress={() => { setStaffId(null); setSlot(null); }} />
            {barbers.map((b) => (
              <Chip key={b.id} testID={`inshop-barber-${b.id}`} label={b.displayName} selected={staffId === b.id} onPress={() => { setStaffId(b.id); setSlot(null); }} />
            ))}
          </ChipRow>
        )}
      </PremiumCard>

      <PremiumCard style={styles.card}>
        <Text style={styles.cardTitle}>4 · Date & time</Text>
        <SlotPickerNative salonId={selectedSalonId} serviceIds={selected} staffId={staffId ?? undefined} timeZone={timeZone} value={slot} onChange={setSlot} />
      </PremiumCard>

      <PremiumCard style={styles.card}>
        <Text style={styles.cardTitle}>5 · Note (optional)</Text>
        <Hint>Internal note - never shown to the customer.</Hint>
        <PremiumTextField testID="inshop-note" value={note} onChangeText={setNote} maxLength={500} multiline style={styles.note} accessibilityLabel="Internal note" />
      </PremiumCard>

      <PremiumButton title={busy ? 'Creating…' : 'Create appointment'} onPress={() => void submit()} loading={busy} testID="inshop-submit" />
      <PremiumButton title="Cancel" variant="quiet" onPress={() => navigation.goBack()} style={styles.cancel} />
    </PremiumScreen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[3] },
  cardTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: fastQue.text },
  ok: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.success, marginBottom: space[2] },
  row: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.textSecondary, marginTop: space[1] },
  actions: { gap: space[2], marginTop: space[3] },
  note: { minHeight: 84, textAlignVertical: 'top' },
  cancel: { marginTop: space[2] },
});
