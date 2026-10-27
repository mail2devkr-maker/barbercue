import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  OWNER_OPS_PATHS,
  formatMoney,
  type CancellationActorOrUnknown,
  type CancellationAnalyticsDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { dateLocaleFor } from '../../lib/date-locale';
import { useLanguage } from '../../lib/language-context';
import { useSalon } from '../../lib/salon-context';
import { fastQue, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumCard, PremiumScreen, PremiumSectionHeader, Skeleton } from '../../components/ui';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

type Props = NativeStackScreenProps<OwnerShopStackParamList, 'OwnerCancellations'>;
type Range = '7d' | '30d' | '90d';
type ActorFilter = CancellationActorOrUnknown | 'ALL';

const ranges: Range[] = ['7d', '30d', '90d'];
const actors: CancellationActorOrUnknown[] = ['CUSTOMER', 'OWNER', 'STAFF', 'SYSTEM', 'ADMIN', 'UNKNOWN'];
const actorLabels = {
  EN: { CUSTOMER: 'Customer', OWNER: 'Owner', STAFF: 'Barber', SYSTEM: 'Automatic', ADMIN: 'FastQue support', UNKNOWN: 'Not recorded' },
  HI: { CUSTOMER: 'ग्राहक', OWNER: 'मालिक', STAFF: 'नाई', SYSTEM: 'स्वचालित', ADMIN: 'FastQue सहायता', UNKNOWN: 'दर्ज नहीं' },
} as const;

const copy = {
  EN: {
    title: 'Cancellations', subtitle: 'Recorded booking cancellations for this shop. Older records are shown as not recorded when attribution is unavailable.',
    seven: '7 days', thirty: '30 days', ninety: '90 days', everyone: 'Everyone', by: 'Cancelled by',
    total: 'Cancellations', rate: 'Cancellation rate', of: 'of bookings', charges: 'Recorded charges',
    waived: 'Waived', outstanding: 'Outstanding', settled: 'Settled', queue: 'Live Queue (separate)',
    queueCounts: 'cancelled · expired · no-show', who: 'Who cancelled', service: 'By service', reasons: 'Reasons given',
    rows: 'Cancelled bookings', cancelled: 'Cancelled', appointment: 'Appointment', byColumn: 'By', reason: 'Reason', charge: 'Charge',
    none: 'None recorded', noRows: 'No cancelled bookings match this period and filter.', noData: 'No recorded cancellations in this period.',
    noBreakdown: 'No recorded breakdown.', old: 'Older cancellations without recorded attribution are shown as “Not recorded,” never guessed.',
    loading: 'Loading cancellations…', retry: 'Could not load cancellation analytics. Please try again.',
    noBookings: 'No bookings were made in this period, so a rate is unavailable.', latest: 'Showing the latest 200 booking cancellations.',
  },
  HI: {
    title: 'रद्दीकरण', subtitle: 'इस दुकान के दर्ज बुकिंग रद्दीकरण। पुराने रिकॉर्ड में कारणकर्ता उपलब्ध न होने पर “दर्ज नहीं” दिखता है।',
    seven: '7 दिन', thirty: '30 दिन', ninety: '90 दिन', everyone: 'सभी', by: 'किसने रद्द किया',
    total: 'रद्दीकरण', rate: 'रद्दीकरण दर', of: 'बुकिंग में से', charges: 'दर्ज शुल्क',
    waived: 'माफ़', outstanding: 'बकाया', settled: 'निपटाया गया', queue: 'लाइव कतार (अलग)',
    queueCounts: 'रद्द · समाप्त · नहीं आए', who: 'किसने रद्द किया', service: 'सेवा के अनुसार', reasons: 'दिए गए कारण',
    rows: 'रद्द की गई बुकिंग', cancelled: 'रद्द किया', appointment: 'अपॉइंटमेंट', byColumn: 'द्वारा', reason: 'कारण', charge: 'शुल्क',
    none: 'कोई दर्ज नहीं', noRows: 'इस अवधि और फ़िल्टर में रद्द बुकिंग नहीं हैं।', noData: 'इस अवधि में दर्ज रद्दीकरण नहीं हैं।',
    noBreakdown: 'दर्ज विवरण नहीं है।', old: 'पुराने रद्दीकरणों में दर्ज कारणकर्ता न होने पर “दर्ज नहीं” दिखता है; अनुमान नहीं लगाया जाता।',
    loading: 'रद्दीकरण लोड हो रहे हैं…', retry: 'रद्दीकरण विश्लेषण लोड नहीं हुआ। फिर प्रयास करें।',
    noBookings: 'इस अवधि में बुकिंग नहीं हुई, इसलिए दर उपलब्ध नहीं है।', latest: 'नवीनतम 200 बुकिंग रद्दीकरण दिखाए जा रहे हैं।',
  },
} as const;

function cancellationsPath(salonId: string, range: Range, actor: ActorFilter): string {
  const params = new URLSearchParams({ range });
  if (actor !== 'ALL') params.set('actor', actor);
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${OWNER_OPS_PATHS.cancellationAnalytics}?${params.toString()}`;
}

function dateLabel(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function OwnerCancellationsScreen(_props: Props) {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { language } = useLanguage();
  const labels = language === 'HI' ? copy.HI : copy.EN;
  const actorNames = language === 'HI' ? actorLabels.HI : actorLabels.EN;
  const locale = dateLocaleFor(language);
  const [range, setRange] = useState<Range>('30d');
  const [actor, setActor] = useState<ActorFilter>('ALL');
  const [data, setData] = useState<CancellationAnalyticsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (refresh = false) => {
    const currentRequest = ++requestId.current;
    if (!selectedSalonId) {
      setData(null); setError(null); setLoading(false); return;
    }
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<CancellationAnalyticsDto>(cancellationsPath(selectedSalonId, range, actor));
      if (currentRequest === requestId.current) setData(result);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      setData(null);
      setError(err instanceof ApiError ? err.message : labels.retry);
    } finally {
      if (currentRequest === requestId.current) { setLoading(false); setRefreshing(false); }
    }
  }, [actor, labels.retry, range, selectedSalonId]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]));

  const money = (value: number) => formatMoney(value, data?.currency ?? null);
  const rate = data?.cancellationRatePercent === null || data?.cancellationRatePercent === undefined ? '—' : `${data.cancellationRatePercent}%`;

  return (
    <PremiumScreen refreshing={refreshing} onRefresh={() => void load(true)}>
      <PremiumSectionHeader eyebrow={selectedSalon?.name} title={labels.title} subtitle={labels.subtitle} />
      {!selectedSalonId ? <EmptyState title={labels.title} message={labels.retry} /> : loading ? (
        <View style={styles.loading}><Text style={styles.muted}>{labels.loading}</Text><Skeleton style={styles.skeleton} /><Skeleton style={styles.skeleton} /></View>
      ) : error && !data ? <InlineError message={error} /> : !data ? <EmptyState title={labels.title} message={labels.retry} /> : (
        <>
          {error ? <InlineError message={error} /> : null}
          <View style={styles.filterBlock}>
            <View style={styles.filterRow} accessibilityRole="tablist">
              {ranges.map((option) => {
                const selected = range === option;
                const label = option === '7d' ? labels.seven : option === '30d' ? labels.thirty : labels.ninety;
                return <Pressable key={option} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => setRange(option)} style={[styles.chip, selected && styles.chipSelected]}>
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
                </Pressable>;
              })}
            </View>
            <Text style={styles.filterLabel}>{labels.by}</Text>
            <View style={styles.filterRow} accessibilityRole="tablist">
              {(['ALL', ...actors] as ActorFilter[]).map((option) => {
                const selected = actor === option;
                const label = option === 'ALL' ? labels.everyone : actorNames[option];
                return <Pressable key={option} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => setActor(option)} style={[styles.chip, selected && styles.chipSelected]}>
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
                </Pressable>;
              })}
            </View>
          </View>

          <View style={styles.metrics}>
            <Metric label={labels.total} value={data.totalCancellations.toLocaleString()} />
            <Metric label={labels.rate} value={rate} detail={data.cancellationRatePercent === null ? labels.noBookings : `${data.totalBookings} ${labels.of}`} />
            <Metric label={labels.charges} value={money(data.charges.charged)} detail={`${money(data.charges.settled)} ${labels.settled}`} />
          </View>
          <PremiumCard style={styles.card}>
            <Text style={styles.cardTitle}>{labels.charges}</Text>
            <View style={styles.breakdownRow}><Text style={styles.body}>{labels.waived}</Text><Text style={styles.body}>{money(data.charges.waived)}</Text></View>
            <View style={styles.breakdownRow}><Text style={styles.body}>{labels.outstanding}</Text><Text style={styles.body}>{money(data.charges.outstanding)}</Text></View>
            <View style={styles.breakdownRow}><Text style={styles.body}>{labels.settled}</Text><Text style={styles.body}>{money(data.charges.settled)}</Text></View>
            <Text style={styles.disclaimer}>These are recorded charge ledger totals; they do not imply collection beyond the recorded status.</Text>
          </PremiumCard>

          <PremiumCard style={styles.card}>
            <Text style={styles.cardTitle}>{labels.queue}</Text>
            <View style={styles.breakdownRow}>
              <Text style={styles.body}>{data.liveQueue.cancelled} {labels.queueCounts.split(' · ')[0]} · {data.liveQueue.expired} {labels.queueCounts.split(' · ')[1]} · {data.liveQueue.noShow} {labels.queueCounts.split(' · ')[2]}</Text>
            </View>
            <Text style={styles.disclaimer}>Live Queue outcomes are separate from booking cancellation totals.</Text>
          </PremiumCard>

          <PremiumCard style={styles.card}>
            <Text style={styles.cardTitle}>{labels.who}</Text>
            {data.totalCancellations === 0 ? <Text style={styles.muted}>{labels.noData}</Text> : actors.map((key) => (
              <View key={key} style={styles.breakdownRow}><Text style={styles.body}>{actorNames[key]}</Text><Text style={styles.bodyStrong}>{data.byActor[key] ?? 0}</Text></View>
            ))}
            {data.unattributedCount > 0 ? <Text style={styles.disclaimer}>{data.unattributedCount} · {labels.old}</Text> : null}
          </PremiumCard>

          <Buckets title={labels.service} rows={data.byService} empty={labels.noBreakdown} />
          <Buckets title={labels.reasons} rows={data.byReason} empty={labels.noBreakdown} />

          <PremiumCard style={styles.card}>
            <Text style={styles.cardTitle}>{labels.rows}</Text>
            {data.rows.length === 0 ? <Text style={styles.muted}>{labels.noRows}</Text> : data.rows.map((row) => (
              <View key={row.bookingId} style={styles.bookingRow}>
                <Text style={styles.bodyStrong}>{row.serviceNames.join(' + ') || '—'}</Text>
                <Text style={styles.meta}>{labels.cancelled}: {dateLabel(row.cancelledAt, locale)}</Text>
                <Text style={styles.meta}>{labels.appointment}: {dateLabel(row.slotStart, locale)}</Text>
                <Text style={styles.meta}>{labels.byColumn}: {actorNames[row.actor]} · {labels.reason}: {row.reason ?? '—'}</Text>
                <Text style={styles.meta}>{labels.charge}: {row.chargeStatus === null ? labels.none : `${money(row.chargeAmount ?? 0)} · ${row.chargeStatus === 'WAIVED' ? labels.waived : row.chargeStatus === 'SETTLED' ? labels.settled : labels.outstanding}`}</Text>
              </View>
            ))}
            {data.rows.length >= 200 ? <Text style={styles.disclaimer}>{labels.latest}</Text> : null}
          </PremiumCard>
        </>
      )}
    </PremiumScreen>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text>{detail ? <Text style={styles.metricDetail}>{detail}</Text> : null}</View>;
}

function Buckets({ title, rows, empty }: { title: string; rows: CancellationAnalyticsDto['byService']; empty: string }) {
  return <PremiumCard style={styles.card}><Text style={styles.cardTitle}>{title}</Text>{rows.length === 0 ? <Text style={styles.muted}>{empty}</Text> : rows.map((row) => (
    <View key={row.key} style={styles.breakdownRow}><Text style={styles.body}>{row.label}</Text><Text style={styles.bodyStrong}>{row.count}</Text></View>
  ))}</PremiumCard>;
}

const styles = StyleSheet.create({
  filterBlock: { gap: space[2], marginBottom: space[4] },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  filterLabel: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: fontSize.xs, marginTop: space[1] },
  chip: { minHeight: 38, paddingHorizontal: space[3], borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.pill, justifyContent: 'center' },
  chipSelected: { borderColor: fastQue.borderStrong, backgroundColor: fastQue.card },
  chipText: { color: fastQue.textMuted, fontFamily: font.bodyMedium, fontSize: fontSize.xs },
  chipTextSelected: { color: fastQue.text, fontFamily: font.bodyBold },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[4] },
  metric: { flexBasis: '47%', flexGrow: 1, minHeight: 88, justifyContent: 'center', backgroundColor: fastQue.card, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.md, padding: space[3] },
  metricValue: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.xl, lineHeight: lineHeightFor(fontSize.xl) },
  metricLabel: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: fontSize.xs, marginTop: space[1] },
  metricDetail: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: 11, marginTop: 2 },
  card: { marginBottom: space[3] },
  cardTitle: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.lg, marginBottom: space[3] },
  breakdownRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: fastQue.border },
  body: { flex: 1, color: fastQue.textSecondary, fontFamily: font.bodyRegular, fontSize: fontSize.sm },
  bodyStrong: { color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  disclaimer: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), marginTop: space[2] },
  muted: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: fontSize.sm },
  bookingRow: { paddingVertical: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fastQue.border, gap: 3 },
  meta: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: fontSize.xs },
  loading: { gap: space[3] },
  skeleton: { height: 110, borderRadius: radius.lg },
});
