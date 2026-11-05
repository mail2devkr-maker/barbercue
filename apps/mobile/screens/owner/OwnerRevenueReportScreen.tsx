import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  formatMoney,
  type OwnerRevenueReportDto,
  type OwnerRevenueReportMetricDto,
  type SalonTimezoneResultDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { dateLocaleFor } from '../../lib/date-locale';
import { useLanguage } from '../../lib/language-context';
import { useSalon } from '../../lib/salon-context';
import { shareOwnerFile } from '../../lib/owner-file-share';
import {
  dateKeyInTimezone,
  ownerRevenueCsvPath,
  ownerRevenueReportPath,
  ownerRevenueTimezonePath,
  REVENUE_SOURCES,
  revenuePresetRange,
  type RevenueGranularity,
  type RevenuePreset,
  type RevenueReportQuery,
  type RevenueSource,
  validateRevenueRange,
} from '../../lib/owner-revenue-report';
import { fastQue, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumCard, PremiumScreen, PremiumSectionHeader, Skeleton } from '../../components/ui';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

type Props = NativeStackScreenProps<OwnerShopStackParamList, 'OwnerRevenueReport'>;

const copy = {
  EN: {
    title: 'Revenue report', subtitle: 'Recorded invoice payments and service estimates for this shop.',
    collected: 'Recorded collections', refunds: 'Recorded refunds', net: 'Net recorded collections',
    invoiced: 'Invoiced', discounts: 'Invoice discounts', estimated: 'Estimated service value',
    estimateNote: 'Listed-price estimate for completed services; it is not money collected.',
    dateRange: 'Date range', from: 'From (YYYY-MM-DD)', to: 'To (YYYY-MM-DD)', apply: 'Show report',
    sevenDays: '7 days', thirtyDays: '30 days', thisMonth: 'This month',
    daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', source: 'Booking source', allSources: 'All sources',
    byPeriod: 'By period', byService: 'By service', byStaff: 'By staff', visits: 'Visits',
    noData: 'No recorded activity in this date range.', noSalon: 'Choose a shop to view its revenue report.',
    timezone: 'Set the shop timezone before running a date report.', retry: 'Could not load the revenue report. Please try again.',
    invalidRange: 'Enter valid dates in YYYY-MM-DD format.', rangeOrder: 'The end date must be on or after the start date.',
    rangeLimit: 'Choose a date range of 366 days or fewer.', loading: 'Loading revenue report…', notLinked: 'Not linked',
    today: 'Today', period: 'Period', service: 'Service', staff: 'Staff', completed: 'Completed',
    channel: 'Source', unknown: 'Not recorded', showAll: 'Show all periods', showLess: 'Show fewer periods', collectionNote: 'Collections and refunds come only from shop-recorded invoice ledger events. Invoices, QR display and completed services do not prove payment.',
    exportCsv: 'Share CSV export', exporting: 'Preparing export…', exportError: 'Could not prepare the revenue export. Please try again.',
  },
  HI: {
    title: 'आय रिपोर्ट', subtitle: 'इस दुकान के दर्ज इनवॉइस भुगतान और सेवा अनुमान।',
    collected: 'दर्ज प्राप्त भुगतान', refunds: 'दर्ज रिफंड', net: 'शुद्ध दर्ज भुगतान',
    invoiced: 'इनवॉइस राशि', discounts: 'इनवॉइस छूट', estimated: 'अनुमानित सेवा मूल्य',
    estimateNote: 'पूरी हुई सेवाओं की सूचीबद्ध कीमत का अनुमान; यह प्राप्त भुगतान नहीं है।',
    dateRange: 'तिथि सीमा', from: 'से (YYYY-MM-DD)', to: 'तक (YYYY-MM-DD)', apply: 'रिपोर्ट दिखाएँ',
    sevenDays: '7 दिन', thirtyDays: '30 दिन', thisMonth: 'इस माह',
    daily: 'दैनिक', weekly: 'साप्ताहिक', monthly: 'मासिक', source: 'बुकिंग स्रोत', allSources: 'सभी स्रोत',
    byPeriod: 'अवधि अनुसार', byService: 'सेवा अनुसार', byStaff: 'स्टाफ अनुसार', visits: 'विज़िट',
    noData: 'इस तिथि सीमा में कोई दर्ज गतिविधि नहीं है।', noSalon: 'आय रिपोर्ट देखने के लिए दुकान चुनें।',
    timezone: 'तिथि रिपोर्ट से पहले दुकान का समय क्षेत्र सेट करें।', retry: 'आय रिपोर्ट लोड नहीं हो सकी। फिर से प्रयास करें।',
    invalidRange: 'YYYY-MM-DD प्रारूप में सही तिथियाँ डालें।', rangeOrder: 'अंतिम तिथि शुरुआती तिथि के बराबर या बाद की होनी चाहिए।',
    rangeLimit: '366 दिन या उससे कम की तिथि सीमा चुनें।', loading: 'आय रिपोर्ट लोड हो रही है…', notLinked: 'लिंक नहीं है',
    today: 'आज', period: 'अवधि', service: 'सेवा', staff: 'स्टाफ', completed: 'पूरी हुई',
    channel: 'स्रोत', unknown: 'दर्ज नहीं', showAll: 'सभी अवधि दिखाएँ', showLess: 'कम अवधि दिखाएँ',
    collectionNote: 'प्राप्त भुगतान और रिफंड केवल दुकान के दर्ज इनवॉइस लेजर से आते हैं। इनवॉइस, QR दिखना या पूरी सेवा भुगतान का प्रमाण नहीं है।',
    exportCsv: 'CSV साझा करें', exporting: 'एक्सपोर्ट तैयार हो रहा है…', exportError: 'आय एक्सपोर्ट तैयार नहीं हो सका। फिर से प्रयास करें।',
  },
} as const;

const sourceLabels: Record<RevenueSource, string> = {
  FASTQUE_WEB: 'FastQue Web', FASTQUE_APP: 'FastQue App', WALK_IN: 'Walk-in', IN_SHOP: 'In-shop',
  FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', CHATGPT: 'ChatGPT', OTHER: 'Other', UNKNOWN: 'Not recorded',
};

const granularityOptions: readonly RevenueGranularity[] = ['day', 'week', 'month'];
const presets: readonly RevenuePreset[] = ['7d', '30d', 'this-month'];

function validQuery(query: RevenueReportQuery, labels: typeof copy.EN | typeof copy.HI): string | null {
  const issue = validateRevenueRange(query.from, query.to);
  if (!issue) return null;
  if (issue.includes('on or after')) return labels.rangeOrder;
  if (issue.includes('366 days')) return labels.rangeLimit;
  return labels.invalidRange;
}

function localPeriodLabel(period: string, granularity: RevenueGranularity, locale: string): string {
  const date = new Date(`${period}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return period;
  return date.toLocaleDateString(locale, granularity === 'month'
    ? { month: 'short', year: 'numeric', timeZone: 'UTC' }
    : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function reportHasActivity(report: OwnerRevenueReportDto): boolean {
  const { totals } = report;
  return totals.completedVisits > 0 || totals.invoiceCount > 0 || totals.recordedCollections !== 0 || totals.refunds !== 0;
}

export default function OwnerRevenueReportScreen(_props: Props) {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { language } = useLanguage();
  const labels = language === 'HI' ? copy.HI : copy.EN;
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [granularity, setGranularity] = useState<RevenueGranularity>('day');
  const [source, setSource] = useState<RevenueSource | ''>('');
  const [report, setReport] = useState<OwnerRevenueReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [showAllPeriods, setShowAllPeriods] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const requestId = useRef(0);

  const loadReport = useCallback(async (query: RevenueReportQuery, refresh = false) => {
    if (!selectedSalonId) return;
    const validation = validQuery(query, labels);
    setRangeError(validation);
    if (validation) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    setRefreshing(refresh);
    setReport(null);
    setError(null);
    try {
      const result = await apiFetch<OwnerRevenueReportDto>(ownerRevenueReportPath(selectedSalonId, query));
      if (currentRequest !== requestId.current) return;
      setReport(result);
      setShowAllPeriods(false);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      setReport(null);
      setError(err instanceof ApiError && /timezone/i.test(err.message) ? labels.timezone : labels.retry);
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [labels, selectedSalonId]);

  useFocusEffect(useCallback(() => {
    let active = true;
    requestId.current += 1;
    setTimeZone(null);
    setReport(null);
    setError(null);
    setLoading(true);
    if (!selectedSalonId) {
      setLoading(false);
      return () => { active = false; requestId.current += 1; };
    }
    apiFetch<SalonTimezoneResultDto>(ownerRevenueTimezonePath(selectedSalonId))
      .then((result) => {
        if (!active) return;
        if (!result.timezone) {
          setTimeZone(null);
          setError(labels.timezone);
          setLoading(false);
          return;
        }
        setTimeZone(result.timezone);
        const today = dateKeyInTimezone(result.timezone);
        const range = revenuePresetRange('30d', today);
        setFrom(range.from);
        setTo(range.to);
        void loadReport({ ...range, groupBy: 'day', source: '' });
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof ApiError && /timezone/i.test(err.message) ? labels.timezone : labels.retry);
        setLoading(false);
      });
    return () => { active = false; requestId.current += 1; };
  }, [labels.retry, labels.timezone, loadReport, selectedSalonId]));

  const money = useCallback((amount: number, currency: string | null) => formatMoney(amount, currency), []);
  const apply = () => { void loadReport({ from, to, groupBy: granularity, source }); };
  const choosePreset = (preset: RevenuePreset) => {
    if (!timeZone) return;
    const range = revenuePresetRange(preset, dateKeyInTimezone(timeZone));
    setFrom(range.from);
    setTo(range.to);
    void loadReport({ ...range, groupBy: granularity, source });
  };
  const chooseGranularity = (value: RevenueGranularity) => {
    setGranularity(value);
    if (from && to) void loadReport({ from, to, groupBy: value, source });
  };
  const chooseSource = (value: RevenueSource | '') => {
    setSource(value);
    if (from && to) void loadReport({ from, to, groupBy: granularity, source: value });
  };
  const exportCsv = async () => {
    if (!selectedSalonId) return;
    const query = { from, to, groupBy: granularity, source };
    const validation = validQuery(query, labels);
    setRangeError(validation);
    if (validation) return;
    setExporting(true);
    setExportError(null);
    try {
      await shareOwnerFile({
        kind: 'text',
        path: ownerRevenueCsvPath(selectedSalonId, query),
        fileName: `fastque-revenue-${from}-${to}.csv`,
        contentType: 'text/csv',
      });
    } catch {
      setExportError(labels.exportError);
    } finally {
      setExporting(false);
    }
  };
  const metricMoney = (metric: OwnerRevenueReportMetricDto, field: 'recordedCollections' | 'refunds' | 'netRecordedCollections' | 'invoicedAmount' | 'invoiceDiscounts' | 'estimatedServiceValue') => money(metric[field], report?.currency ?? null);

  return (
    <PremiumScreen refreshing={refreshing} onRefresh={() => { if (from && to) void loadReport({ from, to, groupBy: granularity, source }, true); }}>
      <PremiumSectionHeader eyebrow={selectedSalon?.name} title={labels.title} subtitle={labels.subtitle} />

      {!selectedSalonId ? <EmptyState title={labels.title} message={labels.noSalon} /> : null}
      {error ? <InlineError message={error} /> : null}
      {rangeError ? <InlineError message={rangeError} /> : null}
      {selectedSalonId && !timeZone && loading ? <View style={styles.skeletons}><Text style={styles.loadingText}>{labels.loading}</Text><Skeleton style={styles.skeleton} /></View> : null}

      {selectedSalonId && timeZone ? (
        <>
          <PremiumCard style={styles.card}>
            <Text style={styles.cardTitle}>{labels.dateRange} · {timeZone}</Text>
            <View style={styles.dateRow}>
              <View style={styles.dateField}>
                <Text style={styles.fieldLabel}>{labels.from}</Text>
                <TextInput accessibilityLabel={labels.from} value={from} onChangeText={setFrom} placeholder="2026-10-01" placeholderTextColor={fastQue.textMuted} autoCapitalize="none" autoCorrect={false} style={styles.input} />
              </View>
              <View style={styles.dateField}>
                <Text style={styles.fieldLabel}>{labels.to}</Text>
                <TextInput accessibilityLabel={labels.to} value={to} onChangeText={setTo} placeholder="2026-10-28" placeholderTextColor={fastQue.textMuted} autoCapitalize="none" autoCorrect={false} style={styles.input} />
              </View>
            </View>
            <View style={styles.chipWrap}>
              {presets.map((preset) => {
                const title = preset === '7d' ? labels.sevenDays : preset === '30d' ? labels.thirtyDays : labels.thisMonth;
                return <FilterChip key={preset} title={title} selected={false} onPress={() => choosePreset(preset)} />;
              })}
            </View>
            <ActionButton title={labels.apply} onPress={apply} disabled={loading} />
            {Platform.OS === 'ios' ? <ActionButton title={exporting ? labels.exporting : labels.exportCsv} onPress={() => { void exportCsv(); }} disabled={loading || exporting} /> : null}
            {exportError ? <InlineError message={exportError} /> : null}
          </PremiumCard>

          <View style={styles.filterSection}>
            <Text style={styles.fieldLabel}>{labels.byPeriod}</Text>
            <View style={styles.chipWrap} accessibilityRole="tablist">
              {granularityOptions.map((option) => {
                const title = option === 'day' ? labels.daily : option === 'week' ? labels.weekly : labels.monthly;
                return <FilterChip key={option} title={title} selected={granularity === option} onPress={() => chooseGranularity(option)} accessibilityRole="tab" />;
              })}
            </View>
            <Text style={styles.fieldLabel}>{labels.source}</Text>
            <View style={styles.chipWrap}>
              <FilterChip title={labels.allSources} selected={source === ''} onPress={() => chooseSource('')} />
              {REVENUE_SOURCES.map((item) => <FilterChip key={item} title={sourceLabels[item]} selected={source === item} onPress={() => chooseSource(item)} />)}
            </View>
          </View>

          {loading && !report ? <View style={styles.skeletons}><Text style={styles.loadingText}>{labels.loading}</Text><Skeleton style={styles.skeleton} /><Skeleton style={styles.skeleton} /></View> : null}

          {report ? (
            <View accessibilityState={{ busy: loading }}>
              {!reportHasActivity(report) ? <EmptyState title={labels.noData} /> : null}
              <View style={styles.metricGrid}>
                <Metric title={labels.collected} value={metricMoney(report.totals, 'recordedCollections')} />
                <Metric title={labels.refunds} value={metricMoney(report.totals, 'refunds')} />
                <Metric title={labels.net} value={metricMoney(report.totals, 'netRecordedCollections')} strong />
                <Metric title={labels.invoiced} value={`${metricMoney(report.totals, 'invoicedAmount')} · ${report.totals.invoiceCount}`} />
                <Metric title={labels.discounts} value={metricMoney(report.totals, 'invoiceDiscounts')} />
                <Metric title={labels.estimated} value={metricMoney(report.totals, 'estimatedServiceValue')} note={labels.estimateNote} />
              </View>
              <Text style={styles.disclaimer}>{labels.collectionNote}</Text>

              <PremiumCard style={styles.card}>
                <Text style={styles.cardTitle}>{labels.byPeriod}</Text>
                {report.periods.length === 0 ? <Text style={styles.muted}>{labels.noData}</Text> : report.periods.slice(0, showAllPeriods ? undefined : 14).map((period) => (
                  <View key={period.period} style={styles.dataRow}>
                    <View style={styles.periodHeading}>
                      <Text style={styles.rowTitle}>{localPeriodLabel(period.period, report.groupBy, dateLocaleFor(language))}</Text>
                      <Text style={styles.rowMeta}>{period.completedVisits} {labels.visits}</Text>
                    </View>
                    <Text style={styles.rowValue}>{labels.net}: {metricMoney(period, 'netRecordedCollections')}</Text>
                    <Text style={styles.rowMeta}>{labels.estimated}: {metricMoney(period, 'estimatedServiceValue')}</Text>
                  </View>
                ))}
                {report.periods.length > 14 ? <Pressable accessibilityRole="button" onPress={() => setShowAllPeriods((value) => !value)} style={styles.moreButton}><Text style={styles.moreText}>{showAllPeriods ? labels.showLess : `${labels.showAll} (+${report.periods.length - 14})`}</Text></Pressable> : null}
              </PremiumCard>

              <PremiumCard style={styles.card}>
                <Text style={styles.cardTitle}>{labels.byService}</Text>
                {report.byService.length === 0 ? <Text style={styles.muted}>{labels.noData}</Text> : report.byService.slice(0, 20).map((item) => (
                  <View key={`${item.key}:${item.serviceId ?? ''}`} style={styles.dataRow}>
                    <Text style={styles.rowTitle}>{item.label}</Text>
                    <Text style={styles.rowMeta}>{item.completedVisits} {labels.completed}</Text>
                    <Text style={styles.rowValue}>{labels.estimated}: {metricMoney(item, 'estimatedServiceValue')}</Text>
                    <Text style={styles.rowMeta}>{labels.net}: {metricMoney(item, 'netRecordedCollections')}</Text>
                  </View>
                ))}
              </PremiumCard>

              <PremiumCard style={styles.card}>
                <Text style={styles.cardTitle}>{labels.byStaff}</Text>
                {report.byStaff.length === 0 ? <Text style={styles.muted}>{labels.noData}</Text> : report.byStaff.slice(0, 20).map((item) => (
                  <View key={`${item.key}:${item.staffId ?? ''}`} style={styles.dataRow}>
                    <Text style={styles.rowTitle}>{item.label}{item.identityVerified ? '' : ` · ${labels.notLinked}`}</Text>
                    <Text style={styles.rowMeta}>{item.completedVisits} {labels.completed}</Text>
                    <Text style={styles.rowValue}>{labels.net}: {metricMoney(item, 'netRecordedCollections')}</Text>
                  </View>
                ))}
              </PremiumCard>

              <PremiumCard style={styles.card}>
                <Text style={styles.cardTitle}>{labels.source}</Text>
                {report.bySource.length === 0 ? <Text style={styles.muted}>{labels.noData}</Text> : report.bySource.map((item) => (
                  <View key={item.key} style={styles.sourceRow}>
                    <Text style={styles.rowTitle}>{sourceLabels[item.source] ?? labels.unknown}</Text>
                    <Text style={styles.rowValue}>{item.completedVisits} {labels.visits} · {metricMoney(item, 'netRecordedCollections')}</Text>
                  </View>
                ))}
              </PremiumCard>
            </View>
          ) : null}
        </>
      ) : null}
    </PremiumScreen>
  );
}

function Metric({ title, value, note, strong = false }: { title: string; value: string; note?: string; strong?: boolean }) {
  return (
    <PremiumCard strong={strong} style={styles.metric}>
      <Text style={styles.metricLabel}>{title}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {note ? <Text style={styles.metricNote}>{note}</Text> : null}
    </PremiumCard>
  );
}

function FilterChip({ title, selected, onPress, accessibilityRole }: { title: string; selected: boolean; onPress: () => void; accessibilityRole?: 'tab' }) {
  return (
    <Pressable accessibilityRole={accessibilityRole ?? 'button'} accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{title}</Text>
    </Pressable>
  );
}

function ActionButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={[styles.actionButton, disabled && styles.disabled]}><Text style={styles.actionText}>{title}</Text></Pressable>;
}

const styles = StyleSheet.create({
  card: { marginBottom: space[4] },
  cardTitle: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.lg, lineHeight: lineHeightFor(fontSize.lg), marginBottom: space[3] },
  dateRow: { flexDirection: 'row', gap: space[2] },
  dateField: { flex: 1 },
  fieldLabel: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: fontSize.xs, marginBottom: space[2] },
  input: { minHeight: 46, borderRadius: radius.md, borderWidth: 1, borderColor: fastQue.border, backgroundColor: fastQue.input, color: fastQue.text, paddingHorizontal: space[3], fontFamily: font.bodyRegular, fontSize: fontSize.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[3], marginBottom: space[2] },
  chip: { minHeight: 38, borderRadius: radius.pill, borderWidth: 1, borderColor: fastQue.border, backgroundColor: fastQue.glass, paddingHorizontal: space[3], alignItems: 'center', justifyContent: 'center' },
  chipSelected: { borderColor: fastQue.borderStrong, backgroundColor: fastQue.cardStrong },
  chipText: { color: fastQue.textMuted, fontFamily: font.bodyMedium, fontSize: 11 },
  chipTextSelected: { color: fastQue.text, fontFamily: font.bodyBold },
  actionButton: { minHeight: 48, borderRadius: radius.md, backgroundColor: fastQue.pink, alignItems: 'center', justifyContent: 'center', marginTop: space[2] },
  actionText: { color: fastQue.text, fontFamily: font.bodyBold, fontSize: fontSize.sm },
  disabled: { opacity: 0.55 },
  filterSection: { marginBottom: space[4] },
  skeletons: { gap: space[3], marginBottom: space[4] },
  skeleton: { height: 100, borderRadius: radius.lg },
  loadingText: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: fontSize.sm },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginBottom: space[3] },
  metric: { width: '47%', flexGrow: 1, minHeight: 94, justifyContent: 'center', padding: space[3] },
  metricLabel: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, lineHeight: lineHeightFor(11) },
  metricValue: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.lg, lineHeight: lineHeightFor(fontSize.lg), marginTop: space[1] },
  metricNote: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: 10, lineHeight: lineHeightFor(10), marginTop: space[1] },
  disclaimer: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: 11, lineHeight: lineHeightFor(11), marginBottom: space[4] },
  dataRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fastQue.border, paddingVertical: space[3], gap: space[1] },
  periodHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: space[2] },
  rowTitle: { flex: 1, color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm) },
  rowValue: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, lineHeight: lineHeightFor(11) },
  rowMeta: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: 11, lineHeight: lineHeightFor(11) },
  sourceRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fastQue.border },
  moreButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  moreText: { color: fastQue.pink, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  muted: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: fontSize.sm },
});
