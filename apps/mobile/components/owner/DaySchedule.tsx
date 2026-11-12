import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  Language,
  type InvoiceDetailDto,
  type OwnerBookingDetailDto,
  type PaginatedResult,
  type SalonStaffDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';
import { BookingActions, nextDays, shopDay } from './BookingActions';

/**
 * Website parity for apps/web/components/dashboard/DayScheduler.tsx, laid out for a phone: ONE day of
 * real bookings, by barber, in the shop's own wall-clock time (never the phone's zone). A booking sits
 * under its assigned barber, else the customer's preferred barber, else "No preference" — a preference
 * is never presented as an assignment. Busy days are paged to the end, never silently truncated.
 */
const UNASSIGNED = '__none__';
const STATUS: Record<string, { en: string; hi: string }> = {
  CONFIRMED: { en: 'Confirmed', hi: 'पक्की' }, PENDING_PAYMENT: { en: 'Pending payment', hi: 'भुगतान बाकी' },
  COMPLETED: { en: 'Completed', hi: 'पूरी' }, CANCELLED: { en: 'Cancelled', hi: 'रद्द' }, NO_SHOW: { en: 'No-show', hi: 'नहीं आए' }, EXPIRED: { en: 'Expired', hi: 'समाप्त' },
};

export async function fetchDay(salonId: string, date: string): Promise<OwnerBookingDetailDto[]> {
  const items: OwnerBookingDetailDto[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const params = new URLSearchParams({ date, limit: '50' });
    if (cursor) params.set('cursor', cursor);
    const page = await apiFetch<PaginatedResult<OwnerBookingDetailDto>>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.bookings}?${params.toString()}`);
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}

export function DaySchedule({ salonId, timeZone, language, onOpenInvoice }: {
  salonId: string;
  timeZone: string;
  language: Language;
  onOpenInvoice: (invoice: InvoiceDetailDto) => void;
}) {
  const hi = language === Language.HI;
  const [date, setDate] = useState(() => shopDay(new Date(), timeZone));
  const [staff, setStaff] = useState<SalonStaffDto[]>([]);
  const [bookings, setBookings] = useState<OwnerBookingDetailDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    apiFetch<SalonStaffDto[]>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.staff}`)
      .then((list) => setStaff(list.filter((s) => s.status === 'ACTIVE')))
      .catch(() => setStaff([]));
  }, [salonId]);

  useEffect(() => {
    let cancelled = false;
    setBookings(null);
    setError(null);
    fetchDay(salonId, date)
      .then((items) => { if (!cancelled) setBookings(items); })
      .catch((err) => { if (!cancelled) { setBookings([]); setError(err instanceof ApiError ? err.message : hi ? 'इस दिन का शेड्यूल लोड नहीं हो सका।' : 'Could not load the schedule for this day.'); } });
    return () => { cancelled = true; };
  }, [salonId, date, tick, hi]);

  const lanes = useMemo(() => {
    const map = new Map<string, OwnerBookingDetailDto[]>();
    for (const b of bookings ?? []) {
      const key = b.assignedStaffId ?? b.preferredStaffId ?? UNASSIGNED;
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    for (const list of map.values()) list.sort((a, b) => a.slotStart.localeCompare(b.slotStart));
    const named = staff.map((s) => ({ key: s.id, label: s.displayName }));
    // A booking for a barber no longer on the active roster still shows, under its stored name.
    for (const key of map.keys()) {
      if (key !== UNASSIGNED && !named.some((n) => n.key === key)) {
        const b = map.get(key)![0];
        named.push({ key, label: b.assignedStaffName ?? b.preferredStaffName ?? (hi ? 'कर्मचारी' : 'Staff') });
      }
    }
    return [...named, { key: UNASSIGNED, label: hi ? 'कोई पसंद नहीं' : 'No preference' }].map((lane) => ({ ...lane, items: map.get(lane.key) ?? [] }));
  }, [bookings, staff, hi]);

  const today = shopDay(new Date(), timeZone);
  const next = () => { setSelected(null); setNotice(null); setDate(nextDays(date, 2)[1]); };
  const previous = () => {
    const [y, m, d] = date.split('-').map(Number);
    setSelected(null); setNotice(null);
    setDate(new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10));
  };
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <View>
      <View style={styles.toolbar}>
        <Button title={hi ? '← पिछला' : '← Previous'} variant="outline" onPress={previous} style={styles.navBtn} />
        <View style={styles.dateBox}>
          <Text style={styles.date}>{label}</Text>
          {date !== today && <Pressable accessibilityRole="button" onPress={() => { setSelected(null); setDate(today); }}><Text style={styles.link}>{hi ? 'आज' : 'Today'}</Text></Pressable>}
        </View>
        <Button title={hi ? 'अगला →' : 'Next →'} variant="outline" onPress={next} style={styles.navBtn} />
      </View>
      <Text style={styles.muted}>{hi ? `समय दुकान के समय क्षेत्र (${timeZone}) में।` : `Times are in the shop's time zone (${timeZone}). Columns show a customer's barber preference until check-in assigns one.`}</Text>
      {!!error && <InlineError message={error} />}
      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      {bookings === null ? <Text style={styles.muted}>{hi ? 'लोड हो रहा है…' : 'Loading…'}</Text> : lanes.map((lane) => (
        <Card key={lane.key} style={styles.lane}>
          <Text style={styles.laneTitle}>{`${lane.label} (${lane.items.length})`}</Text>
          {lane.items.length === 0 ? <Text style={styles.muted}>{hi ? 'इस दिन कोई बुकिंग नहीं' : 'No bookings this day'}</Text> : lane.items.map((b) => {
            const open = selected === b.id;
            const preferenceOnly = !b.assignedStaffId && !!b.preferredStaffId;
            return (
              <View key={b.id}>
                <Pressable accessibilityRole="button" accessibilityLabel={`${clock(b.slotStart, timeZone)} ${b.serviceName}`} onPress={() => setSelected(open ? null : b.id)} style={[styles.block, b.status === 'COMPLETED' ? styles.done : b.status === 'CONFIRMED' || b.status === 'PENDING_PAYMENT' ? styles.live : styles.off]}>
                  <Text style={styles.time}>{`${clock(b.slotStart, timeZone)} – ${clock(b.slotEnd, timeZone)}`}</Text>
                  <Text style={styles.service}>{b.serviceName}</Text>
                  <Text style={styles.muted}>{`${(STATUS[b.status] ?? { en: b.status, hi: b.status })[hi ? 'hi' : 'en']}${preferenceOnly ? (hi ? ' · पसंद' : ' · preference') : ''}${b.customerPhone ?? b.guestPhone ? ` · ${b.customerPhone ?? b.guestPhone}` : ''}`}</Text>
                </Pressable>
                {open && <BookingActions booking={b} language={language} onOpenInvoice={onOpenInvoice} onChanged={(m) => { setNotice(m); setSelected(null); setTick((n) => n + 1); }} />}
              </View>
            );
          })}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[2] },
  navBtn: { flexShrink: 0 },
  dateBox: { flex: 1, alignItems: 'center' },
  date: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.sm, textAlign: 'center' },
  link: { fontFamily: font.bodySemiBold, color: color.accent, fontSize: fontSize.xs, marginTop: space[1] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  notice: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.successSoft, padding: space[3], borderRadius: radius.sm, marginVertical: space[2] },
  lane: { marginTop: space[3] },
  laneTitle: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[2] },
  block: { borderLeftWidth: 4, borderRadius: radius.sm, padding: space[3], marginBottom: space[2], backgroundColor: color.surfaceTint },
  live: { borderLeftColor: color.accent },
  done: { borderLeftColor: color.success },
  off: { borderLeftColor: color.muted, opacity: 0.7 },
  time: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.sm },
  service: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, marginTop: space[1] },
});
