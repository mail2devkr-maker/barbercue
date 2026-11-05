import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  createInShopBookingSchema,
  DASHBOARD_PATHS,
  Language,
  MAX_SERVICES_PER_BOOKING,
  type AvailabilitySlotDto,
  type InShopBookingDto,
  type SalonServiceDto,
  type SalonTimezoneResultDto,
  type StaffOptionDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, InlineError, Screen, SectionHeader } from '../../components/ui';

const BASE = (salonId: string) => `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;

function shopDate(timeZone: string | null, offset = 0): string {
  const date = new Date(Date.now() + offset * 86_400_000);
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone ?? undefined }).format(date); }
  catch { return date.toISOString().slice(0, 10); }
}

function localTime(value: string, timeZone: string | null): string {
  try { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timeZone ?? undefined }).format(new Date(value)); }
  catch { return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
}

export default function InShopAppointmentPanel({ salonId, onBack, onCreated }: { salonId: string; onBack: () => void; onCreated: () => void }) {
  const { language } = useLanguage();
  const hi = language === Language.HI;
  const [services, setServices] = useState<SalonServiceDto[]>([]);
  const [staff, setStaff] = useState<StaffOptionDto[]>([]);
  const [slots, setSlots] = useState<AvailabilitySlotDto[]>([]);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(() => shopDate(null));
  const [slotStart, setSlotStart] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [contactConsent, setContactConsent] = useState(false);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<InShopBookingDto | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const requestSeq = useRef(0);
  const base = BASE(salonId);
  const serviceKey = serviceIds.join(',');
  const selectedServices = useMemo(() => services.filter((item) => serviceIds.includes(item.id)), [services, serviceIds]);
  const currency = selectedServices[0]?.currency ?? services[0]?.currency ?? 'INR';
  const total = selectedServices.reduce((sum, item) => sum + (item.durationMinutes ?? 0), 0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      apiFetch<SalonServiceDto[]>(`${base}/${DASHBOARD_PATHS.services}`),
      apiFetch<SalonTimezoneResultDto>(`${base}/${DASHBOARD_PATHS.timezone}`).catch(() => ({ timezone: null })),
    ]).then(([catalog, timezone]) => {
      if (!active) return;
      setServices(catalog.filter((item) => item.isActive));
      setTimeZone(timezone.timezone ?? null);
      setDate(shopDate(timezone.timezone ?? null));
    }).catch((err: unknown) => {
      if (active) setError(err instanceof ApiError ? err.message : 'Could not load shop services.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base]);

  useEffect(() => {
    const seq = ++requestSeq.current;
    if (!serviceKey) {
      setStaff([]);
      setSlots([]);
      setSlotStart('');
      return;
    }
    setSlots([]);
    setSlotStart('');
    setError(null);
    const params = new URLSearchParams({ serviceIds: serviceKey, date, ...(staffId ? { staffId } : {}) });
    void Promise.all([
      apiFetch<StaffOptionDto[]>(`salons/${salonId}/booking/staff?serviceIds=${serviceKey}`),
      apiFetch<AvailabilitySlotDto[]>(`salons/${salonId}/booking/availability?${params.toString()}`),
    ]).then(([qualifiedStaff, availability]) => {
      if (seq !== requestSeq.current) return;
      setStaff(qualifiedStaff);
      if (staffId && !qualifiedStaff.some((item) => item.id === staffId)) setStaffId('');
      setSlots(availability);
    }).catch((err: unknown) => {
      if (seq === requestSeq.current) setError(err instanceof ApiError ? err.message : 'Could not load qualified staff and available times.');
    });
    return () => { requestSeq.current += 1; };
  }, [salonId, serviceKey, date, staffId]);

  const submit = async () => {
    setError(null);
    const parsed = createInShopBookingSchema.safeParse({
      guestName,
      ...(guestPhone.trim() ? { guestPhone: guestPhone.trim() } : {}),
      contactConsent,
      serviceIds,
      slotStart,
      ...(staffId ? { preferredStaffId: staffId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.path[0] === 'slotStart' ? 'Choose an available time.' : issue?.message ?? 'Check the appointment details.');
      return;
    }
    setBusy(true);
    try {
      const booking = await apiFetch<InShopBookingDto>(`${base}/${DASHBOARD_PATHS.bookings}/in-shop`, {
        method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(parsed.data),
      });
      setCreated(booking);
      onCreated();
    } catch (err) {
      // Keep the same key after an ambiguous network error. The first request may have committed
      // even if its response was lost; retrying the same key lets the server replay that result.
      setError(err instanceof ApiError ? err.message : (hi ? 'अपॉइंटमेंट नहीं बन सका। उसी अनुरोध को सुरक्षित रूप से फिर आज़माएँ।' : 'Could not create the appointment. Retry this same request safely.'));
    } finally { setBusy(false); }
  };

  return (
    <Screen contentStyle={styles.screen}>
      <SectionHeader eyebrow={hi ? 'बुकिंग' : 'Bookings'} title={created ? (hi ? 'अपॉइंटमेंट बन गया' : 'Appointment created') : (hi ? 'दुकान पर अपॉइंटमेंट' : 'New in-shop appointment')} subtitle={hi ? 'जिस ग्राहक ने दुकान से संपर्क किया है, उसके लिए समय तय करें। अभी प्रतीक्षा कर रहे ग्राहक को लाइव कतार में जोड़ें।' : 'Book a set time for a customer who contacted the shop. For someone waiting now, use Live Queue.'} />
      <Button title={hi ? 'बुकिंग पर वापस जाएँ' : 'Back to bookings'} variant="outline" onPress={onBack} />
      {error ? <InlineError message={error} /> : null}
      {created ? <Card>
        <Text style={styles.heading}>{hi ? 'अपॉइंटमेंट बुक हो गया' : 'Appointment booked'}</Text>
        <Text style={styles.body}>{created.guestName} · {localTime(created.slotStart, timeZone)} · {created.serviceNames.join(' + ')}</Text>
        <Text style={styles.muted}>{hi ? 'संदर्भ' : 'Reference'} {created.id.slice(0, 8).toUpperCase()}</Text>
        <Button title={hi ? 'बुकिंग पर वापस जाएँ' : 'Return to bookings'} onPress={onBack} style={styles.button} />
      </Card> : <>
        <Card><Text style={styles.heading}>{hi ? 'ग्राहक' : 'Customer'}</Text>
          <TextInput accessibilityLabel={hi ? 'ग्राहक का नाम' : 'Customer name'} value={guestName} onChangeText={setGuestName} placeholder={hi ? 'ग्राहक का नाम' : 'Customer name'} maxLength={60} style={styles.input} />
          <TextInput accessibilityLabel={hi ? 'मोबाइल नंबर (वैकल्पिक)' : 'Mobile number (optional)'} value={guestPhone} onChangeText={setGuestPhone} placeholder={hi ? 'मोबाइल नंबर (वैकल्पिक)' : 'Mobile number (optional)'} keyboardType="phone-pad" maxLength={30} style={styles.input} />
          {guestPhone.trim() ? <Pressable accessibilityRole="checkbox" accessibilityLabel={hi ? 'फोन से संपर्क की सहमति' : 'Customer contact consent'} accessibilityState={{ checked: contactConsent }} onPress={() => setContactConsent((value) => !value)} style={styles.checkRow}><Text style={styles.check}>{contactConsent ? '☑' : '☐'}</Text><Text style={styles.body}>{hi ? 'ग्राहक ने इस अपॉइंटमेंट के बारे में संपर्क के लिए नंबर सहेजने की सहमति दी है।' : 'Customer agreed that the shop may save and use this number about this appointment.'}</Text></Pressable> : null}
        </Card>
        <Card><Text style={styles.heading}>{hi ? 'सेवाएँ' : 'Services'}</Text>
          {loading ? <Text style={styles.muted}>{hi ? 'सेवाएँ लोड हो रही हैं…' : 'Loading services…'}</Text> : services.length === 0 ? <Text style={styles.muted}>{hi ? 'कोई सक्रिय सेवा उपलब्ध नहीं है।' : 'No active services are available.'}</Text> : services.map((item) => {
            const checked = serviceIds.includes(item.id);
            const maxReached = !checked && serviceIds.length >= MAX_SERVICES_PER_BOOKING;
            return <Pressable key={item.id} accessibilityRole="checkbox" accessibilityLabel={`Service ${item.name}`} accessibilityState={{ checked, disabled: maxReached }} disabled={maxReached} onPress={() => { setServiceIds((current) => checked ? current.filter((id) => id !== item.id) : [...current, item.id]); setSlotStart(''); }} style={[styles.checkRow, maxReached && styles.disabled]}><Text style={styles.check}>{checked ? '☑' : '☐'}</Text><Text style={styles.body}>{item.name} · {item.durationMinutes} {hi ? 'मिनट' : 'min'} · {new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(item.price)}</Text></Pressable>;
          })}
          {total > 0 ? <Text style={styles.muted}>{hi ? `कुल समय: ${total} मिनट` : `Combined duration: ${total} minutes`}</Text> : null}
        </Card>
        <Card><Text style={styles.heading}>{hi ? 'तारीख और समय' : 'Date and available time'}</Text>
          <TextInput accessibilityLabel={hi ? 'अपॉइंटमेंट की तारीख' : 'Appointment date'} value={date} onChangeText={(value) => { setDate(value); setSlotStart(''); }} placeholder="YYYY-MM-DD" autoCapitalize="none" style={styles.input} />
          {slots.filter((item) => item.available).length === 0 ? <Text style={styles.muted}>{serviceKey ? (hi ? 'कोई समय उपलब्ध नहीं। तारीख या कर्मचारी चुनें।' : 'No available times. Check the date or selected staff.') : (hi ? 'समय देखने के लिए कम से कम एक सेवा चुनें।' : 'Choose at least one service to load available times.')}</Text> : <View style={styles.slotRow}>{slots.filter((item) => item.available).map((item) => <Pressable key={item.slotStart} accessibilityRole="radio" accessibilityLabel={`Appointment slot ${item.slotStart}`} accessibilityState={{ checked: slotStart === item.slotStart }} onPress={() => setSlotStart(item.slotStart)} style={[styles.slot, slotStart === item.slotStart && styles.slotSelected]}><Text style={[styles.slotText, slotStart === item.slotStart && styles.slotTextSelected]}>{localTime(item.slotStart, timeZone)}</Text></Pressable>)}</View>}
        </Card>
        {serviceKey ? <Card><Text style={styles.heading}>{hi ? 'पसंदीदा कर्मचारी (वैकल्पिक)' : 'Preferred staff (optional)'}</Text><Pressable accessibilityRole="radio" accessibilityState={{ checked: !staffId }} onPress={() => setStaffId('')} style={styles.checkRow}><Text style={styles.check}>{!staffId ? '◉' : '○'}</Text><Text style={styles.body}>{hi ? 'कोई भी योग्य कर्मचारी' : 'Any qualified staff'}</Text></Pressable>{staff.map((item) => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: staffId === item.id }} onPress={() => setStaffId(item.id)} style={styles.checkRow}><Text style={styles.check}>{staffId === item.id ? '◉' : '○'}</Text><Text style={styles.body}>{item.displayName}</Text></Pressable>)}</Card> : null}
        <Card><Text style={styles.heading}>{hi ? 'आंतरिक नोट (वैकल्पिक)' : 'Internal note (optional)'}</Text><TextInput accessibilityLabel={hi ? 'आंतरिक नोट' : 'Internal note'} value={note} onChangeText={setNote} placeholder={hi ? 'ग्राहक को नहीं दिखेगा' : 'Not shown to the customer'} maxLength={500} multiline style={[styles.input, styles.multiline]} /></Card>
        <Button title={busy ? (hi ? 'बन रहा है…' : 'Creating…') : (hi ? 'अपॉइंटमेंट बनाएँ' : 'Create appointment')} onPress={() => void submit()} loading={busy} disabled={loading} style={styles.button} />
      </>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { gap: space[3] },
  heading: { color: color.ink, fontFamily: font.bodyBold, fontSize: fontSize.lg, marginBottom: space[2] },
  body: { color: color.ink, fontSize: fontSize.base, flexShrink: 1 },
  muted: { color: color.muted, fontSize: fontSize.sm, marginTop: space[2] },
  input: { minHeight: 48, color: color.ink, backgroundColor: color.surface, borderColor: color.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space[3], marginTop: space[2] },
  multiline: { minHeight: 90, textAlignVertical: 'top', paddingTop: space[3] },
  checkRow: { flexDirection: 'row', gap: space[2], alignItems: 'center', paddingVertical: space[2] },
  check: { fontSize: fontSize.lg, color: color.accent, minWidth: 24 },
  slotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  slot: { paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface },
  slotSelected: { backgroundColor: color.accent, borderColor: color.accent },
  slotText: { color: color.ink },
  slotTextSelected: { color: color.accentContrast },
  disabled: { opacity: 0.45 },
  button: { marginTop: space[2] },
});
