import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import {
  DASHBOARD_PATHS,
  Language,
  type OwnerRevenueReportDto,
  type OwnerRevenueReportMetricDto,
  type SalonTimezoneResultDto,
} from '@barbercue/shared';
import { apiDownloadFile, apiFetch, ApiError } from '../../lib/api';
import {
  csvFallbackName,
  describeSemantics,
  EXCEL_EXPORT_NOTE,
  excelFallbackName,
  filterByLabel,
  isEmptyReport,
  periodLabel,
  presetRange,
  RANGE_ERROR_TEXT,
  reportQueryString,
  SOURCE_FILTERS,
  sortByValue,
  todayInZone,
  validateRange,
  type Granularity,
  type PresetId,
  type ReportQuery,
} from '../../lib/revenue-report';
import { sourceLabel } from '../../lib/booking-sources';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, EmptyState, InlineError } from '../ui';

/**
 * Website parity for apps/web/components/owner/RevenueReport.tsx: a revenue report for ANY date range
 * (presets or custom From/To in the shop's time zone), daily/weekly/monthly periods, a booking-source
 * filter, breakdowns by service / staff / source / customer, and the same CSV and Excel-compatible
 * downloads — shared from the phone. Every figure comes from the server report; nothing is computed
 * or estimated here. The date/query rules are the website's own (lib/revenue-report.ts).
 */
const PRESETS: ReadonlyArray<{ id: PresetId; en: string; hi: string }> = [
  { id: 'today', en: 'Today', hi: 'आज' },
  { id: 'last7', en: 'Last 7 days', hi: 'पिछले 7 दिन' },
  { id: 'last30', en: 'Last 30 days', hi: 'पिछले 30 दिन' },
  { id: 'thisMonth', en: 'This month', hi: 'इस महीने' },
  { id: 'lastMonth', en: 'Last month', hi: 'पिछले महीने' },
];
const ROW_LIMIT = 20;

function money(value: number, currency: string | null): string {
  if (!currency) return value.toFixed(2);
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function RevenueReportPanel({ salonId, language }: { salonId: string; language: Language }) {
  const hi = language === Language.HI;
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const [zone, setZone] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [source, setSource] = useState<ReportQuery['source']>('');
  const [data, setData] = useState<{ query: ReportQuery; report: OwnerRevenueReportDto } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<null | 'csv' | 'excel'>(null);
  const [search, setSearch] = useState('');
  const seq = useRef(0);

  const run = useCallback(async (query: ReportQuery) => {
    const problem = validateRange(query.from, query.to);
    if (problem) { setError(RANGE_ERROR_TEXT[problem]); return; }
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const report = await apiFetch<OwnerRevenueReportDto>(`${base}/revenue/report?${reportQueryString(query)}`);
      if (id === seq.current) setData({ query, report });
    } catch (err) {
      if (id === seq.current) setError(err instanceof ApiError ? err.message : hi ? 'रिपोर्ट लोड नहीं हो सकी।' : 'Could not load the report.');
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [base, hi]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    apiFetch<SalonTimezoneResultDto>(`${base}/${DASHBOARD_PATHS.timezone}`)
      .then((result) => {
        if (cancelled) return;
        const tz = result.timezone ?? result.suggestion?.timezone ?? (result.countryCode === 'IN' ? 'Asia/Kolkata' : null);
        if (!tz) { setLoading(false); setError(hi ? 'दुकान का समय क्षेत्र सेट नहीं है।' : 'Set the shop time zone first (Settings).'); return; }
        setZone(tz);
        const range = presetRange('last30', todayInZone(tz));
        setFrom(range.from);
        setTo(range.to);
        void run({ ...range, groupBy: 'day', source: '' });
      })
      .catch((err) => { if (!cancelled) { setLoading(false); setError(err instanceof ApiError ? err.message : 'Could not load the shop time zone.'); } });
    return () => { cancelled = true; seq.current += 1; };
  }, [base, hi, run]);

  const current = (): ReportQuery => ({ from: from.trim(), to: to.trim(), groupBy: granularity, source });

  const download = async (kind: 'csv' | 'excel') => {
    if (!data) return;
    setDownloading(kind);
    setError(null);
    try {
      const route = kind === 'csv' ? 'report.csv' : 'report.excel.xml';
      const name = kind === 'csv' ? csvFallbackName(data.query) : excelFallbackName(data.query);
      const uri = await apiDownloadFile(`${base}/revenue/${route}?${reportQueryString(data.query)}`, name);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: kind === 'csv' ? 'text/csv' : 'application/vnd.ms-excel', dialogTitle: name });
      }
      setNotice(kind === 'csv' ? (hi ? 'रिपोर्ट तैयार है।' : 'Report ready to save or share.') : (hi ? 'Excel रिपोर्ट तैयार है।' : 'Excel-compatible report ready. Open it with Excel.'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : hi ? 'रिपोर्ट डाउनलोड नहीं हो सकी।' : 'Could not download the report.');
    } finally {
      setDownloading(null);
    }
  };

  const chip = (selected: boolean, label: string, onPress: () => void, key: string) => (
    <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} disabled={loading} style={[styles.chip, selected && styles.chipOn]}>
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );

  const report = data?.report ?? null;
  const cur = report?.currency ?? null;
  const t: OwnerRevenueReportMetricDto | null = report?.totals ?? null;

  return (
    <>
      <Card>
        <Text style={styles.heading}>{hi ? 'राजस्व रिपोर्ट' : 'Revenue report'}</Text>
        <Text style={styles.muted}>{hi ? 'किसी भी तारीख सीमा के लिए, दुकान के समय क्षेत्र में।' : `Any date range, in the shop's time zone${zone ? ` (${zone})` : ''}.`}</Text>
        <View style={styles.chips}>
          {PRESETS.map((p) => chip(false, hi ? p.hi : p.en, () => {
            if (!zone) return;
            const range = presetRange(p.id, todayInZone(zone));
            setFrom(range.from); setTo(range.to);
            void run({ ...range, groupBy: granularity, source });
          }, p.id))}
        </View>
        <View style={styles.dates}>
          <View style={styles.flex}>
            <Text style={styles.label}>{hi ? 'से (YYYY-MM-DD)' : 'From (YYYY-MM-DD)'}</Text>
            <TextInput accessibilityLabel="From" value={from} onChangeText={setFrom} placeholder="2026-11-01" maxLength={10} style={styles.input} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.label}>{hi ? 'तक (YYYY-MM-DD)' : 'To (YYYY-MM-DD)'}</Text>
            <TextInput accessibilityLabel="To" value={to} onChangeText={setTo} placeholder="2026-11-30" maxLength={10} style={styles.input} />
          </View>
        </View>
        <Text style={styles.label}>{hi ? 'बुकिंग स्रोत' : 'Booking source'}</Text>
        <View style={styles.chips}>
          {SOURCE_FILTERS.map((s) => chip(source === s.value, s.label, () => { setSource(s.value); void run({ ...current(), source: s.value }); }, s.value || 'all'))}
        </View>
        <Button title={loading ? (hi ? 'लोड हो रहा है…' : 'Loading…') : (hi ? 'रिपोर्ट दिखाएँ' : 'Show report')} onPress={() => void run(current())} disabled={loading} />
      </Card>

      {!!error && <InlineError message={error} />}
      {!!notice && <Text style={styles.ok}>{notice}</Text>}

      {report && t && (isEmptyReport(report) ? (
        <EmptyState title={hi ? 'इस सीमा में कोई गतिविधि नहीं' : 'No activity in this range'} message={hi ? 'बड़ी तारीख सीमा चुनें।' : `No completed services, invoices or recorded payments were found for these dates${source ? ' and this source' : ''}. Try a wider range.`} />
      ) : (
        <>
          <Card>
            <Line title={hi ? 'प्राप्त' : 'Collected'} value={money(t.recordedCollections, cur)} />
            <Line title={hi ? 'लौटाया' : 'Refunded'} value={money(t.refunds, cur)} />
            <Line title={hi ? 'शुद्ध प्राप्त' : 'Net collected'} value={money(t.netRecordedCollections, cur)} strong />
            <Line title={`${hi ? 'इनवॉइस' : 'Invoiced'} (${t.invoiceCount})`} value={money(t.invoicedAmount, cur)} />
            <Line title={hi ? 'इनवॉइस छूट' : 'Discounts on invoices'} value={money(t.invoiceDiscounts, cur)} />
            <Line title={hi ? 'अनुमानित सेवा मूल्य' : 'Estimated service value'} value={money(t.estimatedServiceValue, cur)} />
            <Line title={hi ? 'पूरी सेवाएँ' : 'Completed services'} value={String(t.completedVisits)} />
          </Card>

          <Card>
            <Text style={styles.heading}>{hi ? 'अवधि के अनुसार' : 'By period'}</Text>
            <View style={styles.chips}>
              {(['day', 'week', 'month'] as const).map((g) => chip(granularity === g, g === 'day' ? (hi ? 'दैनिक' : 'Daily') : g === 'week' ? (hi ? 'साप्ताहिक' : 'Weekly') : (hi ? 'मासिक' : 'Monthly'), () => { setGranularity(g); void run({ ...data!.query, groupBy: g }); }, g))}
            </View>
            <Text style={styles.muted}>{`${report.from} → ${report.to} (${report.timeZone})`}</Text>
            {report.periods.map((p) => (
              <Line key={p.period} title={periodLabel(p.period, report.groupBy)} value={money(p.netRecordedCollections, cur)} note={`${hi ? 'अनुमान' : 'Estimated'} ${money(p.estimatedServiceValue, cur)} · ${p.completedVisits} ${hi ? 'सेवाएँ' : 'services'}`} />
            ))}
            <View style={styles.chips}>
              <Button title={downloading === 'csv' ? '…' : hi ? 'CSV डाउनलोड' : 'Download CSV'} variant="outline" onPress={() => void download('csv')} disabled={downloading !== null || loading} style={styles.flex} />
              <Button title={downloading === 'excel' ? '…' : hi ? 'Excel डाउनलोड' : 'Download Excel'} variant="outline" onPress={() => void download('excel')} disabled={downloading !== null || loading} style={styles.flex} />
            </View>
            <Text style={styles.muted}>{EXCEL_EXPORT_NOTE}</Text>
          </Card>

          <TextInput accessibilityLabel={hi ? 'खोजें' : 'Search services, staff or customers'} placeholder={hi ? 'सेवा, कर्मचारी या ग्राहक खोजें' : 'Search services, staff or customers'} value={search} onChangeText={setSearch} style={styles.input} />
          <Breakdown title={hi ? 'सेवा के अनुसार' : 'By service'} rows={sortByValue(filterByLabel(report.byService, search))} cur={cur} hi={hi} />
          <Breakdown title={hi ? 'कर्मचारी के अनुसार' : 'By staff'} rows={sortByValue(filterByLabel(report.byStaff, search))} cur={cur} hi={hi} />
          <Breakdown title={hi ? 'स्रोत के अनुसार' : 'By source'} rows={(report.bySource ?? []).map((s) => ({ ...s, label: sourceLabel(s.source) }))} cur={cur} hi={hi} />
          <Breakdown title={hi ? 'ग्राहक के अनुसार' : 'By customer'} rows={sortByValue(filterByLabel(report.byCustomer, search))} cur={cur} hi={hi} />
          <Card>
            <Text style={styles.heading}>{hi ? 'ये आँकड़े कैसे बनते हैं' : 'How these numbers are made'}</Text>
            {describeSemantics(report.dataSemantics).map((line) => <Text key={line} style={styles.muted}>{`• ${line}`}</Text>)}
          </Card>
        </>
      ))}
    </>
  );
}

function Breakdown({ title, rows, cur, hi }: { title: string; rows: ReadonlyArray<OwnerRevenueReportMetricDto & { key?: string; label: string }>; cur: string | null; hi: boolean }) {
  return (
    <Card>
      <Text style={styles.heading}>{title}</Text>
      {rows.length === 0 ? <Text style={styles.muted}>{hi ? 'कुछ नहीं' : 'Nothing in this range'}</Text> : rows.slice(0, ROW_LIMIT).map((r, i) => (
        <Line key={r.key ?? `${r.label}-${i}`} title={r.label} value={money(r.netRecordedCollections, cur)} note={`${r.completedVisits} ${hi ? 'सेवाएँ' : 'done'} · ${hi ? 'अनुमान' : 'est.'} ${money(r.estimatedServiceValue, cur)}`} />
      ))}
      {rows.length > ROW_LIMIT && <Text style={styles.muted}>{hi ? `पहली ${ROW_LIMIT} पंक्तियाँ; पूरी सूची CSV/Excel में।` : `First ${ROW_LIMIT} rows; the full list is in the CSV/Excel download.`}</Text>}
    </Card>
  );
}

function Line({ title, value, note, strong }: { title: string; value: string; note?: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <View style={styles.flex}>
        <Text style={[styles.lineText, strong && styles.strong]}>{title}</Text>
        {note ? <Text style={styles.muted}>{note}</Text> : null}
      </View>
      <Text style={[styles.lineText, styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[1] },
  label: { fontFamily: font.bodyMedium, color: color.muted, fontSize: fontSize.xs, marginTop: space[2] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  ok: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.successSoft, padding: space[3], borderRadius: radius.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginVertical: space[2] },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: 16, paddingHorizontal: space[3], paddingVertical: space[2], backgroundColor: color.surface },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  chipText: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.xs },
  chipTextOn: { color: color.accent, fontFamily: font.bodyBold },
  dates: { flexDirection: 'row', gap: space[2] },
  flex: { flex: 1 },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular, marginTop: space[1] },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  lineText: { fontFamily: font.bodyRegular, color: color.ink, fontSize: fontSize.sm },
  strong: { fontFamily: font.bodySemiBold },
});
