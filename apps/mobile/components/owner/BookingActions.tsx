import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  Language,
  shopCancelBookingSchema,
  type AvailabilitySlotDto,
  type InvoiceDetailDto,
  type OwnerBookingDetailDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, InlineError } from '../ui';
import { CreateInvoiceButton } from './InvoiceTools';

/**
 * Website parity for apps/web/components/owner/ShopBookingActions.tsx: per-booking Call customer,
 * Reschedule (free times from the same availability engine customers book from), Cancel appointment
 * (optional reason, explicit confirmation, idempotent), Create/View invoice for a completed visit,
 * and who cancelled a cancelled booking. Server-side authorization and notifications are unchanged.
 */

const COPY = {
  en: {
    call: 'Call customer', reschedule: 'Reschedule', cancel: 'Cancel appointment', keep: 'Keep appointment',
    cancelTitle: 'Cancel this appointment?', reasonPlaceholder: 'Reason (optional, shown to the customer)',
    cancelled: 'Appointment cancelled.', cancelledNotified: 'Appointment cancelled and the customer was notified.',
    cancelledGuest: 'Appointment cancelled. This guest has no FastQue account, so no notification was sent.',
    moveTitle: 'Move this appointment', moveHelp: 'Pick a new free time; the customer is notified of the change.',
    keepTime: 'Keep current time', move: 'Move appointment', moving: 'Moving…', moved: 'Appointment moved and the customer was told about the new time.',
    movedGuest: 'Appointment moved. This guest has no FastQue account, so no notification was sent.',
    loadingTimes: 'Loading times…', noTimes: 'No free times on this date. Try another date.', working: 'Working…',
    cancelledBy: 'Cancelled by', reason: 'reason', notRecorded: 'not recorded for this older booking',
    ACTOR: { CUSTOMER: 'the customer', OWNER: 'the shop owner', STAFF: 'shop staff', SYSTEM: 'FastQue (automatic)', ADMIN: 'FastQue support' } as Record<string, string>,
  },
  hi: {
    call: 'ग्राहक को कॉल करें', reschedule: 'समय बदलें', cancel: 'अपॉइंटमेंट रद्द करें', keep: 'अपॉइंटमेंट रखें',
    cancelTitle: 'यह अपॉइंटमेंट रद्द करें?', reasonPlaceholder: 'कारण (वैकल्पिक, ग्राहक को दिखेगा)',
    cancelled: 'अपॉइंटमेंट रद्द हुआ।', cancelledNotified: 'अपॉइंटमेंट रद्द हुआ और ग्राहक को सूचना दी गई।',
    cancelledGuest: 'अपॉइंटमेंट रद्द हुआ। इस मेहमान का FastQue खाता नहीं है, इसलिए सूचना नहीं भेजी गई।',
    moveTitle: 'यह अपॉइंटमेंट आगे-पीछे करें', moveHelp: 'नया खाली समय चुनें; ग्राहक को बदलाव की सूचना दी जाएगी।',
    keepTime: 'वही समय रखें', move: 'समय बदलें', moving: 'बदला जा रहा है…', moved: 'अपॉइंटमेंट का समय बदला और ग्राहक को सूचना दी गई।',
    movedGuest: 'समय बदला। इस मेहमान का FastQue खाता नहीं है, इसलिए सूचना नहीं भेजी गई।',
    loadingTimes: 'समय लोड हो रहे हैं…', noTimes: 'इस तारीख पर कोई खाली समय नहीं। दूसरी तारीख चुनें।', working: 'हो रहा है…',
    cancelledBy: 'रद्द करने वाला', reason: 'कारण', notRecorded: 'इस पुरानी बुकिंग में दर्ज नहीं',
    ACTOR: { CUSTOMER: 'ग्राहक', OWNER: 'दुकान मालिक', STAFF: 'दुकान कर्मचारी', SYSTEM: 'FastQue (स्वतः)', ADMIN: 'FastQue सहायता' } as Record<string, string>,
  },
} as const;
type Copy = (typeof COPY)['en'];

/** YYYY-MM-DD of `date` in the shop's time zone (falls back to the device zone). */
export function shopDay(date: Date, timeZone: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone ?? undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${v.year}-${v.month}-${v.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function nextDays(start: string, count: number): string[] {
  const [y, m, d] = start.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
}

function timeText(iso: string, timeZone: string | null): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { timeZone: timeZone ?? undefined, hour: 'numeric', minute: '2-digit' });
  } catch {
    return new Date(iso).toLocaleTimeString();
  }
}

function dayText(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
}

export function BookingActions({ booking, language, onChanged, onOpenInvoice }: {
  booking: OwnerBookingDetailDto;
  language: Language;
  onChanged: (message: string) => void;
  onOpenInvoice: (invoice: InvoiceDetailDto) => void;
}) {
  const c: Copy = language === Language.HI ? (COPY.hi as unknown as Copy) : COPY.en;
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${booking.salonId}`;
  const [mode, setMode] = useState<'cancel' | 'move' | null>(null);
  const live = booking.status === 'CONFIRMED' || booking.status === 'PENDING_PAYMENT';
  const phone = booking.customerPhone ?? booking.guestPhone ?? null;

  return (
    <View style={styles.wrap}>
      {booking.status === 'CANCELLED' && (
        <Text style={styles.muted}>
          {`${c.cancelledBy}: ${booking.cancelledByActor ? c.ACTOR[booking.cancelledByActor] ?? booking.cancelledByActor : `— (${c.notRecorded})`}`}
          {booking.cancellationReason ? ` · ${c.reason}: “${booking.cancellationReason}”` : ''}
        </Text>
      )}
      {mode === null && (
        <View style={styles.row}>
          {phone && <Button title={c.call} variant="outline" onPress={() => void Linking.openURL(`tel:${phone}`)} style={styles.btn} />}
          {live && <Button title={c.reschedule} variant="secondary" onPress={() => setMode('move')} style={styles.btn} />}
          {live && <Button title={c.cancel} variant="outline" onPress={() => setMode('cancel')} style={styles.btn} />}
        </View>
      )}
      {booking.status === 'COMPLETED' && (
        <CreateInvoiceButton base={base} bookingId={booking.id} language={language} onOpen={onOpenInvoice} />
      )}
      {mode === 'cancel' && <CancelForm base={base} booking={booking} c={c} onClose={() => setMode(null)} onDone={(m) => { setMode(null); onChanged(m); }} />}
      {mode === 'move' && <MoveForm base={base} booking={booking} c={c} onClose={() => setMode(null)} onDone={(m) => { setMode(null); onChanged(m); }} />}
    </View>
  );
}

function CancelForm({ base, booking, c, onClose, onDone }: { base: string; booking: OwnerBookingDetailDto; c: Copy; onClose: () => void; onDone: (m: string) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());

  const run = async (data: { reason?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ notification?: { inApp?: string } }>(`${base}/bookings/${booking.id}/cancel`, {
        method: 'POST', headers: { 'Idempotency-Key': key.current }, body: JSON.stringify(data),
      });
      const inApp = result?.notification?.inApp;
      onDone(inApp === 'NO_ACCOUNT' ? c.cancelledGuest : inApp ? c.cancelledNotified : c.cancelled);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : c.cancel);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const parsed = shopCancelBookingSchema.safeParse({ reason });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? c.cancel); return; }
    Alert.alert(c.cancelTitle, `${booking.serviceName}`, [
      { text: c.keep, style: 'cancel' },
      { text: c.cancel, style: 'destructive', onPress: () => void run(parsed.data) },
    ]);
  };

  return (
    <View style={styles.form}>
      <TextInput accessibilityLabel={c.reasonPlaceholder} placeholder={c.reasonPlaceholder} value={reason} onChangeText={setReason} maxLength={300} style={styles.input} />
      {!!error && <InlineError message={error} />}
      <View style={styles.row}>
        <Button title={busy ? c.working : c.cancel} onPress={submit} disabled={busy} style={styles.btn} />
        <Button title={c.keep} variant="outline" onPress={onClose} disabled={busy} style={styles.btn} />
      </View>
    </View>
  );
}

function MoveForm({ base, booking, c, onClose, onDone }: { base: string; booking: OwnerBookingDetailDto; c: Copy; onClose: () => void; onDone: (m: string) => void }) {
  const tz = booking.salonTimezone ?? null;
  const days = useMemo(() => nextDays(shopDay(new Date(), tz), 14), [tz]);
  const [day, setDay] = useState(days[0]);
  const [slots, setSlots] = useState<AvailabilitySlotDto[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  const serviceIds = (booking.services ?? []).map((s) => s.serviceId).join(',') || booking.serviceId;

  useEffect(() => {
    let cancelled = false;
    setSlots(null);
    setSlot(null);
    const params = new URLSearchParams({ serviceIds, date: day, ...(booking.preferredStaffId ? { staffId: booking.preferredStaffId } : {}) });
    apiFetch<AvailabilitySlotDto[]>(`salons/${booking.salonId}/booking/availability?${params.toString()}`)
      .then((list) => { if (!cancelled) setSlots(list); })
      .catch((err) => { if (!cancelled) { setSlots([]); setError(err instanceof ApiError ? err.message : c.noTimes); } });
    return () => { cancelled = true; };
  }, [booking.salonId, booking.preferredStaffId, serviceIds, day, c.noTimes]);

  const submit = async () => {
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ notification?: { inApp?: string } }>(`${base}/bookings/${booking.id}/reschedule`, {
        method: 'POST', headers: { 'Idempotency-Key': key.current }, body: JSON.stringify({ slotStart: slot }),
      });
      onDone(result?.notification?.inApp === 'NO_ACCOUNT' ? c.movedGuest : c.moved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : c.move);
      key.current = newIdempotencyKey();
    } finally {
      setBusy(false);
    }
  };

  const open = (slots ?? []).filter((s) => s.available);
  return (
    <View style={styles.form}>
      <Text style={styles.heading}>{c.moveTitle}</Text>
      <Text style={styles.muted}>{c.moveHelp}</Text>
      <View style={styles.chips}>
        {days.map((d) => (
          <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: day === d }} onPress={() => setDay(d)} style={[styles.chip, day === d && styles.chipOn]}>
            <Text style={[styles.chipText, day === d && styles.chipTextOn]}>{dayText(d)}</Text>
          </Pressable>
        ))}
      </View>
      {slots === null ? <Text style={styles.muted}>{c.loadingTimes}</Text> : open.length === 0 ? <Text style={styles.muted}>{c.noTimes}</Text> : (
        <View style={styles.chips}>
          {open.map((s) => (
            <Pressable key={s.slotStart} accessibilityRole="radio" accessibilityState={{ checked: slot === s.slotStart }} onPress={() => setSlot(s.slotStart)} style={[styles.chip, slot === s.slotStart && styles.chipOn]}>
              <Text style={[styles.chipText, slot === s.slotStart && styles.chipTextOn]}>{timeText(s.slotStart, tz)}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {!!error && <InlineError message={error} />}
      <View style={styles.row}>
        <Button title={busy ? c.moving : c.move} onPress={() => void submit()} disabled={!slot || busy} style={styles.btn} />
        <Button title={c.keepTime} variant="outline" onPress={onClose} disabled={busy} style={styles.btn} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space[3], gap: space[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  btn: { flexGrow: 1 },
  form: { gap: space[2] },
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: 16, paddingHorizontal: space[3], paddingVertical: space[2], backgroundColor: color.surface },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  chipText: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.xs },
  chipTextOn: { color: color.accent, fontFamily: font.bodyBold },
});
