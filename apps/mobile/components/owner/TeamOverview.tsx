import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DASHBOARD_PATHS, Language, type OwnerOverviewDto, type SalonStaffDto, type StaffWorkingHoursDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { color, font, fontSize, space } from '../../lib/theme';
import { Card, InlineError } from '../ui';

/**
 * Website parity for apps/web/components/owner/TeamPanel.tsx: per-barber performance (right now,
 * done today, done in 30 days, estimated value — listed prices, not recorded revenue) and the week's
 * working hours per barber ("Shop hours" when a barber has no own hours). Read-only; editing stays
 * under Shop → Staff, exactly as the website points to Manage staff.
 */
const DAYS = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], hi: ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'] };
const STATE: Record<string, { en: string; hi: string }> = {
  AVAILABLE: { en: 'Available', hi: 'उपलब्ध' }, IN_SERVICE: { en: 'With a customer', hi: 'ग्राहक के साथ' },
  RESERVED: { en: 'Booked soon', hi: 'जल्द बुक' }, OFF_DUTY: { en: 'Off duty', hi: 'छुट्टी पर' },
};

function money(value: number, currency: string | null): string {
  if (!currency) return value.toFixed(0);
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); } catch { return `${currency} ${value}`; }
}

export function TeamOverview({ salonId, language }: { salonId: string; language: Language }) {
  const hi = language === Language.HI;
  const [tab, setTab] = useState<'performance' | 'schedule'>('performance');
  return (
    <>
      <View style={styles.tabs}>
        {(['performance', 'schedule'] as const).map((id) => (
          <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: tab === id }} onPress={() => setTab(id)} style={[styles.chip, tab === id && styles.chipOn]}>
            <Text style={[styles.chipText, tab === id && styles.chipTextOn]}>{id === 'performance' ? (hi ? 'प्रदर्शन' : 'Performance') : (hi ? 'शेड्यूल' : 'Schedule')}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'performance' ? <Performance salonId={salonId} hi={hi} /> : <Schedule salonId={salonId} hi={hi} />}
    </>
  );
}

function Performance({ salonId, hi }: { salonId: string; hi: boolean }) {
  const [data, setData] = useState<OwnerOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<OwnerOverviewDto>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/overview`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load staff performance.'); });
    return () => { cancelled = true; };
  }, [salonId]);
  if (error) return <InlineError message={error} />;
  if (!data) return <Text style={styles.muted}>…</Text>;
  return (
    <Card>
      {data.staffPerformance.length === 0 ? <Text style={styles.muted}>{hi ? 'अभी कोई कर्मचारी नहीं' : 'No barbers yet'}</Text> : data.staffPerformance.map((s) => (
        <View key={s.staffId} style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.strong}>{s.displayName}</Text>
            <Text style={styles.muted}>{(STATE[s.availabilityState] ?? { en: s.availabilityState, hi: s.availabilityState })[hi ? 'hi' : 'en']}</Text>
          </View>
          <View style={styles.numbers}>
            <Text style={styles.small}>{`${hi ? 'आज' : 'Today'} ${s.completedToday} · ${hi ? '30 दिन' : '30 days'} ${s.completedLast30Days}`}</Text>
            <Text style={styles.small}>{money(s.estimatedValueLast30Days, data.currency)}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.muted}>{hi ? 'अनुमानित मूल्य सेवा की सूची कीमत से है; यह दर्ज आय नहीं है।' : "Estimated value uses each service's listed price; it is not recorded revenue."}</Text>
    </Card>
  );
}

function Schedule({ salonId, hi }: { salonId: string; hi: boolean }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.staff}`;
  const [rows, setRows] = useState<{ staff: SalonStaffDto; hours: StaffWorkingHoursDto[] }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<SalonStaffDto[]>(base)
      .then(async (staff) => {
        const hours = await Promise.all(staff.map((s) => apiFetch<StaffWorkingHoursDto[]>(`${base}/${s.id}/${DASHBOARD_PATHS.workingHours}`).catch(() => [] as StaffWorkingHoursDto[])));
        if (!cancelled) setRows(staff.map((s, i) => ({ staff: s, hours: hours[i] })));
      })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load schedules.'); });
    return () => { cancelled = true; };
  }, [base]);
  if (error) return <InlineError message={error} />;
  if (!rows) return <Text style={styles.muted}>…</Text>;
  if (rows.length === 0) return <Text style={styles.muted}>{hi ? 'अभी कोई कर्मचारी नहीं' : 'No barbers yet'}</Text>;
  const days = DAYS[hi ? 'hi' : 'en'];
  return (
    <Card>
      {rows.map(({ staff, hours }) => (
        <View key={staff.id} style={styles.block}>
          <Text style={styles.strong}>{`${staff.displayName} · ${staff.status === 'ACTIVE' ? (hi ? 'ड्यूटी पर' : 'On duty') : (hi ? 'ड्यूटी पर नहीं' : 'Off duty')}`}</Text>
          {days.map((d, dow) => {
            const h = hours.find((x) => x.dayOfWeek === dow);
            return <Text key={d} style={[styles.small, !h?.configured && styles.mutedInline]}>{`${d}: ${!h || !h.configured ? (hi ? 'दुकान का समय' : 'Shop hours') : h.isClosed ? (hi ? 'छुट्टी' : 'Off') : `${h.openTime}–${h.closeTime}`}`}</Text>;
          })}
        </View>
      ))}
      <Text style={styles.muted}>{hi ? 'समय बदलने के लिए दुकान → स्टाफ़ खोलें।' : "To change a barber's hours, open Shop → Staff and choose their hours."}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: space[2], marginBottom: space[2] },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: 16, paddingHorizontal: space[3], paddingVertical: space[2], backgroundColor: color.surface },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  chipText: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.xs },
  chipTextOn: { color: color.accent, fontFamily: font.bodyBold },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  flex: { flex: 1 },
  numbers: { alignItems: 'flex-end' },
  block: { paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border, gap: 2 },
  strong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  small: { fontFamily: font.bodyRegular, color: color.ink, fontSize: fontSize.xs },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  mutedInline: { color: color.muted },
});
