import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DASHBOARD_PATHS, formatMoney, type OwnerAnalyticsDto, type OwnerAnalyticsRange } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useLanguage } from '../../lib/language-context';
import { useSalon } from '../../lib/salon-context';
import { dateLocaleFor } from '../../lib/date-locale';
import { fastQue, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumCard, PremiumScreen, PremiumSectionHeader, Skeleton } from '../../components/ui';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

type Props = NativeStackScreenProps<OwnerShopStackParamList, 'OwnerAnalytics'>;
type Range = Extract<OwnerAnalyticsRange, 'today' | '7d' | '30d'>;

const ranges: Range[] = ['today', '7d', '30d'];

const copy = {
  EN: {
    title: 'Business analytics', subtitle: 'Salon-local booking and service activity.',
    today: 'Today', sevenDays: '7 days', thirtyDays: '30 days',
    bookings: 'Appointments booked', completed: 'Completed', cancelled: 'Cancelled', noShows: 'No-shows',
    serviceValue: 'Estimated service value', disclaimer: 'Listed-price estimate for completed services. This is not recorded revenue or money collected.',
    daily: 'Daily service value', popular: 'Services completed', customers: 'Customer visits',
    newCustomers: 'New customers', repeatCustomers: 'Repeat customers', walkIns: 'Walk-ins',
    noData: 'No completed service activity in this period.', retry: 'Could not load analytics. Please try again.',
    timezone: 'Set your shop timezone before viewing accurate analytics.', loading: 'Loading analytics…',
  },
  HI: {
    title: 'व्यावसायिक विश्लेषण', subtitle: 'दुकान के स्थानीय समय के अनुसार बुकिंग और सेवा गतिविधि।',
    today: 'आज', sevenDays: '7 दिन', thirtyDays: '30 दिन',
    bookings: 'बुक किए गए अपॉइंटमेंट', completed: 'पूरी हुई सेवाएँ', cancelled: 'रद्द', noShows: 'न आए',
    serviceValue: 'अनुमानित सेवा मूल्य', disclaimer: 'पूरी हुई सेवाओं की सूचीबद्ध कीमतों का अनुमान। यह दर्ज की गई आय या प्राप्त भुगतान नहीं है।',
    daily: 'दैनिक सेवा मूल्य', popular: 'पूरी हुई सेवाएँ', customers: 'ग्राहक विज़िट',
    newCustomers: 'नए ग्राहक', repeatCustomers: 'दोबारा आए ग्राहक', walkIns: 'बिना बुकिंग आए ग्राहक',
    noData: 'इस अवधि में पूरी हुई सेवा गतिविधि नहीं है।', retry: 'विश्लेषण लोड नहीं हो सका। फिर से प्रयास करें।',
    timezone: 'सटीक विश्लेषण के लिए पहले अपनी दुकान का समय क्षेत्र सेट करें।', loading: 'विश्लेषण लोड हो रहा है…',
  },
} as const;

function analyticsPath(salonId: string, range: Range): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${DASHBOARD_PATHS.analytics}?range=${range}`;
}

function money(value: number, currency: string | null): string {
  return formatMoney(value, currency);
}

export default function OwnerAnalyticsScreen(_props: Props) {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { language } = useLanguage();
  const labels = language === 'HI' ? copy.HI : copy.EN;
  const [range, setRange] = useState<Range>('30d');
  const [analytics, setAnalytics] = useState<OwnerAnalyticsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async (refresh = false) => {
    const currentRequest = ++requestId.current;
    if (!selectedSalonId) {
      setAnalytics(null);
      setError(null);
      setLoading(false);
      return;
    }
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<OwnerAnalyticsDto>(analyticsPath(selectedSalonId, range));
      if (currentRequest !== requestId.current) return;
      setAnalytics(result);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      setAnalytics(null);
      setError(err instanceof ApiError && /timezone/i.test(err.message) ? labels.timezone : labels.retry);
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [labels.retry, labels.timezone, range, selectedSalonId]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]));

  const rangeLabel = (value: Range) => value === 'today' ? labels.today : value === '7d' ? labels.sevenDays : labels.thirtyDays;
  const maxDailyValue = Math.max(1, ...(analytics?.dailyServiceValue.map((point) => point.estimatedServiceValue) ?? []));
  const topServices = (analytics?.serviceValue ?? []).slice(0, 5);
  const maxServiceCount = Math.max(1, ...topServices.map((service) => service.completedCount));

  return (
    <PremiumScreen refreshing={refreshing} onRefresh={() => void load(true)}>
      <PremiumSectionHeader
        eyebrow={selectedSalon?.name}
        title={labels.title}
        subtitle={labels.subtitle}
      />

      <View style={styles.rangeRow} accessibilityRole="tablist">
        {ranges.map((option) => {
          const selected = range === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setRange(option)}
              style={[styles.rangeButton, selected && styles.rangeButtonSelected]}
            >
              <Text style={[styles.rangeText, selected && styles.rangeTextSelected]}>{rangeLabel(option)}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loading}><Text style={styles.loadingText}>{labels.loading}</Text><Skeleton style={styles.skeleton} /><Skeleton style={styles.skeleton} /></View>
      ) : error ? (
        <InlineError message={error} />
      ) : !analytics ? (
        <EmptyState title={labels.title} message={labels.retry} />
      ) : (
        <>
          <View style={styles.kpiGrid}>
            <Metric label={labels.bookings} value={analytics.appointmentsBooked} />
            <Metric label={labels.completed} value={analytics.completedCount} />
            <Metric label={labels.cancelled} value={analytics.cancelledCount} />
            <Metric label={labels.noShows} value={analytics.noShowCount} />
          </View>

          <PremiumCard strong style={styles.card}>
            <Text style={styles.cardTitle}>{labels.serviceValue}</Text>
            <Text style={styles.money}>{money(analytics.estimatedServiceValue, analytics.currency)}</Text>
            <Text style={styles.disclaimer}>{labels.disclaimer}</Text>
          </PremiumCard>

          <PremiumCard style={styles.card}>
            <Text style={styles.cardTitle}>{labels.daily}</Text>
            {analytics.dailyServiceValue.length === 0 ? <Text style={styles.muted}>{labels.noData}</Text> : analytics.dailyServiceValue.map((point) => (
              <View key={point.date} style={styles.chartRow}>
                <Text style={styles.dateLabel}>{new Date(`${point.date}T12:00:00`).toLocaleDateString(dateLocaleFor(language), { day: 'numeric', month: 'short' })}</Text>
                <View style={styles.barTrack} accessibilityLabel={`${point.completedCount} completed services`}>
                  <View style={[styles.barFill, { width: `${Math.max(point.estimatedServiceValue > 0 ? 3 : 0, point.estimatedServiceValue / maxDailyValue * 100)}%` }]} />
                </View>
                <Text style={styles.chartValue}>{money(point.estimatedServiceValue, analytics.currency)}</Text>
              </View>
            ))}
          </PremiumCard>

          <PremiumCard style={styles.card}>
            <Text style={styles.cardTitle}>{labels.popular}</Text>
            {topServices.length === 0 ? <Text style={styles.muted}>{labels.noData}</Text> : topServices.map((service) => (
              <View key={service.serviceId} style={styles.serviceRow}>
                <View style={styles.serviceHeading}>
                  <Text style={styles.serviceName} numberOfLines={1}>{service.name}</Text>
                  <Text style={styles.serviceCount}>{service.completedCount}</Text>
                </View>
                <View style={styles.barTrack}><View style={[styles.barFill, { width: `${service.completedCount / maxServiceCount * 100}%` }]} /></View>
                <Text style={styles.serviceValue}>{money(service.estimatedServiceValue, analytics.currency)}</Text>
              </View>
            ))}
          </PremiumCard>

          <PremiumCard style={styles.card}>
            <Text style={styles.cardTitle}>{labels.customers}</Text>
            <Metric label={labels.newCustomers} value={analytics.newCustomerCount} compact />
            <Metric label={labels.repeatCustomers} value={analytics.repeatCustomerCount} compact />
            <Metric label={labels.walkIns} value={analytics.walkInCount} compact />
          </PremiumCard>
        </>
      )}
    </PremiumScreen>
  );
}

function Metric({ label, value, compact = false }: { label: string; value: number; compact?: boolean }) {
  return (
    <View style={[styles.metric, compact && styles.metricCompact]}>
      <Text style={styles.metricValue}>{value.toLocaleString()}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rangeRow: { flexDirection: 'row', gap: space[2], marginBottom: space[4] },
  rangeButton: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  rangeButtonSelected: { backgroundColor: fastQue.card, borderColor: fastQue.borderStrong },
  rangeText: { color: fastQue.textMuted, fontFamily: font.bodyMedium, fontSize: fontSize.xs },
  rangeTextSelected: { color: fastQue.text, fontFamily: font.bodyBold },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[4] },
  metric: { flexBasis: '47%', flexGrow: 1, minHeight: 94, justifyContent: 'center', backgroundColor: fastQue.card, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.md, padding: space[3] },
  metricCompact: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[2] },
  metricValue: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.xl, lineHeight: lineHeightFor(fontSize.xl) },
  metricLabel: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), marginTop: space[1], flexShrink: 1 },
  card: { marginBottom: space[4] },
  cardTitle: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.lg, marginBottom: space[3] },
  money: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize['2xl'], lineHeight: lineHeightFor(fontSize['2xl']) },
  disclaimer: { color: fastQue.textSecondary, fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), marginTop: space[2] },
  muted: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: fontSize.sm },
  chartRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: space[2] },
  dateLabel: { width: 54, color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: 11 },
  barTrack: { flex: 1, height: 9, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: fastQue.coral, borderRadius: radius.pill },
  chartValue: { minWidth: 66, textAlign: 'right', color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  serviceRow: { marginBottom: space[3] },
  serviceHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: space[2], marginBottom: space[2] },
  serviceName: { flex: 1, color: fastQue.text, fontFamily: font.bodyMedium, fontSize: fontSize.sm },
  serviceCount: { color: fastQue.textSecondary, fontFamily: font.bodyBold, fontSize: fontSize.xs },
  serviceValue: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: 11, marginTop: space[1] },
  loading: { gap: space[3] },
  loadingText: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: fontSize.sm },
  skeleton: { height: 110, borderRadius: radius.lg },
});
