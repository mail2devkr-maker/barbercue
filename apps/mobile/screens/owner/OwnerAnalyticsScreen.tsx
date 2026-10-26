import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  formatMoney,
  type OwnerAnalyticsDto,
  type OwnerAnalyticsRange,
  type SalonTimezoneResultDto,
  type UiStrings,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import {
  ANALYTICS_VIEWS,
  MOBILE_ANALYTICS_RANGES,
  analyticsPath,
  formatHour,
  formatHourList,
  formatMinutes,
  timezonePath,
  type AnalyticsView,
} from '../../lib/owner/analytics';
import { fastQue, font, fontSize, radius, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumButton, PremiumCard, PremiumScreen, PremiumSectionHeader, Skeleton } from '../../components/ui';
import { SalonSwitcher } from '../../components/owner/SalonSwitcher';
import { ColumnChart, HeatGrid, RankedBars, SplitBar, buildHeatCells } from '../../components/owner/charts';

const RANGE_LABEL_KEY = {
  today: 'analyticsRangeToday',
  '7d': 'analyticsRange7d',
  '30d': 'analyticsRange30d',
} as const satisfies Record<string, keyof UiStrings>;

const VIEW_LABEL_KEY = {
  overview: 'analyticsViewOverview',
  value: 'analyticsViewValue',
  operations: 'analyticsViewOperations',
} as const satisfies Record<AnalyticsView, keyof UiStrings>;

/**
 * Native owner analytics — the mobile counterpart of the website's Analytics page, reading the very
 * same endpoint and DTO, so totals for one shop and one range match the website exactly. Money is
 * formatted with the shop's own currency and country locale; dates and hours arrive already in the
 * shop's IANA time zone, which is shown so an owner travelling in another zone is not misled.
 * Nothing here is recomputed or invented: service value stays an "estimate from listed prices".
 */
export default function OwnerAnalyticsScreen() {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { t } = useLanguage();
  const [range, setRange] = useState<Exclude<OwnerAnalyticsRange, 'custom'>>('today');
  const [view, setView] = useState<AnalyticsView>('overview');
  const [data, setData] = useState<OwnerAnalyticsDto | null>(null);
  const [zone, setZone] = useState<{ timezone: string | null; countryCode: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Every load takes a number; only the newest may write state, so switching shop or range quickly
  // can never leave one shop's (or range's) figures on screen under another's.
  const requestRef = useRef(0);

  const load = useCallback(
    async (salonId: string, targetRange: Exclude<OwnerAnalyticsRange, 'custom'>, isRefresh: boolean) => {
      const request = ++requestRef.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [analytics, tz] = await Promise.all([
          apiFetch<OwnerAnalyticsDto>(analyticsPath(salonId, targetRange)),
          apiFetch<SalonTimezoneResultDto>(timezonePath(salonId)).catch(() => null),
        ]);
        if (request !== requestRef.current) return;
        setData(analytics);
        setZone(tz ? { timezone: tz.timezone, countryCode: tz.countryCode } : null);
      } catch (err) {
        if (request !== requestRef.current) return;
        setData(null);
        setError(err instanceof ApiError ? err.message : t.analyticsLoadFailed);
      } finally {
        if (request === requestRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      // A different shop starts from nothing: stale numbers are never kept while the new ones load.
      setData(null);
      setZone(null);
      if (selectedSalonId) void load(selectedSalonId, range, false);
      else requestRef.current += 1;
    }, [selectedSalonId, range, load]),
  );

  if (!selectedSalonId) {
    return (
      <PremiumScreen scroll={false}>
        <EmptyState title={t.selectShopTitle} message={t.chooseShopHint} />
      </PremiumScreen>
    );
  }

  const money = (value: number) => formatMoney(value, data?.currency ?? null, zone?.countryCode);

  return (
    <PremiumScreen refreshing={refreshing} onRefresh={() => void load(selectedSalonId, range, true)}>
      <PremiumSectionHeader eyebrow={selectedSalon?.name ?? t.ownerEyebrow} title={t.analyticsTitle} subtitle={t.analyticsSubtitle} />
      <SalonSwitcher />

      <View style={styles.pillRow}>
        {MOBILE_ANALYTICS_RANGES.map((item) => (
          <Pill key={item} testID={`analytics-range-${item}`} label={t[RANGE_LABEL_KEY[item]]} active={range === item} onPress={() => setRange(item)} />
        ))}
      </View>
      <View style={styles.pillRow}>
        {ANALYTICS_VIEWS.map((item) => (
          <Pill key={item} testID={`analytics-view-${item}`} label={t[VIEW_LABEL_KEY[item]]} active={view === item} onPress={() => setView(item)} strong />
        ))}
      </View>
      {zone?.timezone ? (
        <Text testID="analytics-timezone" style={styles.zoneNote}>
          {t.analyticsTimesIn.replace('{zone}', zone.timezone)}
        </Text>
      ) : null}

      {error ? (
        <View testID="analytics-error">
          <InlineError message={error} />
          <PremiumButton title={t.analyticsRetry} onPress={() => void load(selectedSalonId, range, false)} style={styles.retry} />
        </View>
      ) : null}

      {loading && !data ? (
        <View testID="analytics-loading">
          <Skeleton style={styles.skeleton} />
          <Skeleton style={styles.skeleton} />
        </View>
      ) : null}

      {data ? (
        view === 'overview' ? (
          <Overview data={data} t={t} money={money} />
        ) : view === 'value' ? (
          <Value data={data} t={t} money={money} />
        ) : (
          <Operations data={data} t={t} money={money} />
        )
      ) : null}
    </PremiumScreen>
  );
}

type SectionProps = { data: OwnerAnalyticsDto; t: UiStrings; money: (value: number) => string };

function Overview({ data, t, money }: SectionProps) {
  const tiles: Array<{ id: string; label: string; value: string | number; hint?: string }> = [
    { id: 'appointments', label: t.analyticsAppointments, value: data.appointmentsBooked },
    { id: 'completed', label: t.analyticsCompleted, value: data.completedCount },
    { id: 'confirmed', label: t.analyticsConfirmed, value: data.confirmedCount },
    { id: 'pending-payment', label: t.analyticsPendingPayment, value: data.pendingPaymentCount },
    { id: 'cancelled', label: t.analyticsCancelled, value: data.cancelledCount },
    { id: 'no-show', label: t.analyticsNoShow, value: data.noShowCount },
    { id: 'expired', label: t.analyticsExpired, value: data.expiredCount },
    { id: 'walk-ins', label: t.analyticsWalkIns, value: data.walkInCount },
    { id: 'new-customers', label: t.analyticsNewCustomers, value: data.newCustomerCount },
    { id: 'returning-customers', label: t.analyticsReturningCustomers, value: data.repeatCustomerCount },
    { id: 'avg-wait', label: t.analyticsAvgWait, value: formatMinutes(data.averageWaitMinutes) },
    { id: 'avg-service', label: t.analyticsAvgService, value: formatMinutes(data.averageServiceDurationMinutes) },
    { id: 'service-value', label: t.analyticsServiceValue, value: money(data.estimatedServiceValue), hint: t.analyticsServiceValueHint },
  ];
  return (
    <View>
      <View style={styles.tileGrid}>
        {tiles.map((tile) => (
          <Tile key={tile.id} testID={`analytics-tile-${tile.id}`} {...tile} />
        ))}
      </View>
      <Card title={t.analyticsServicePopularity}>
        {data.servicePopularity.length === 0 ? (
          <Text style={styles.empty}>{t.analyticsNoCompletedServices}</Text>
        ) : (
          data.servicePopularity.slice(0, 8).map((service) => (
            <ListLine key={service.serviceId} name={service.name} meta={t.analyticsCompletedCount.replace('{count}', String(service.completedCount))} />
          ))
        )}
      </Card>
      <Card title={t.analyticsBarberActivity}>
        {data.barberUtilization.length === 0 ? (
          <Text style={styles.empty}>{t.analyticsNoCompletedSessions}</Text>
        ) : (
          data.barberUtilization.map((row) => (
            <ListLine key={row.id} name={row.displayName} meta={t.analyticsSessionsLine.replace('{count}', String(row.completedSessions)).replace('{minutes}', formatMinutes(row.totalServiceMinutes))} />
          ))
        )}
      </Card>
      <Card title={t.analyticsChairActivity}>
        {data.chairUtilization.length === 0 ? (
          <Text style={styles.empty}>{t.analyticsNoCompletedSessions}</Text>
        ) : (
          data.chairUtilization.map((row) => (
            <ListLine key={row.id} name={row.displayName} meta={t.analyticsSessionsLine.replace('{count}', String(row.completedSessions)).replace('{minutes}', formatMinutes(row.totalServiceMinutes))} />
          ))
        )}
      </Card>
    </View>
  );
}

function Value({ data, t, money }: SectionProps) {
  return (
    <View>
      <Card title={t.analyticsValueTrend} subtitle={t.analyticsValueTrendSub}>
        <ColumnChart rows={data.dailyServiceValue} formatValue={money} emptyText={t.analyticsNoServiceValue} accessibilityLabel={t.analyticsValueTrend} />
      </Card>
      <Card title={t.analyticsValueByService} subtitle={t.analyticsValueByServiceSub}>
        <RankedBars
          emptyText={t.analyticsNoCompletedServices}
          rows={data.serviceValue.slice(0, 10).map((row) => ({
            key: row.serviceId,
            name: row.name,
            value: row.estimatedServiceValue,
            meta: `${money(row.estimatedServiceValue)} · ${t.analyticsCompletedCount.replace('{count}', String(row.completedCount))}`,
          }))}
        />
      </Card>
      <Card title={t.analyticsValueByBarber} subtitle={t.analyticsValueByBarberSub}>
        <RankedBars
          emptyText={t.analyticsNoCompletedSessions}
          rows={data.barberValue.slice(0, 10).map((row) => ({
            key: row.staffId,
            name: row.displayName,
            value: row.estimatedServiceValue,
            meta: `${money(row.estimatedServiceValue)} · ${t.analyticsCompletedCount.replace('{count}', String(row.completedSessions))}`,
          }))}
        />
      </Card>
      <Card title={t.analyticsBookingsVsWalkIns} subtitle={t.analyticsBookingsVsWalkInsSub}>
        <SplitBar
          leftLabel={t.analyticsBookings}
          leftValue={data.sourceMix.bookingCompletedCount}
          leftText={String(data.sourceMix.bookingCompletedCount)}
          rightLabel={t.analyticsWalkInsLabel}
          rightValue={data.sourceMix.walkInCompletedCount}
          rightText={String(data.sourceMix.walkInCompletedCount)}
        />
      </Card>
      <Card title={t.analyticsNewVsRepeat} subtitle={t.analyticsNewVsRepeatSub}>
        <SplitBar
          leftLabel={t.analyticsNew}
          leftValue={data.newCustomerEstimatedServiceValue}
          leftText={money(data.newCustomerEstimatedServiceValue)}
          rightLabel={t.analyticsRepeat}
          rightValue={data.repeatCustomerEstimatedServiceValue}
          rightText={money(data.repeatCustomerEstimatedServiceValue)}
        />
      </Card>
    </View>
  );
}

function Operations({ data, t, money }: SectionProps) {
  const lost = data.lostOpportunity;
  const totalLost = lost.cancelledEstimatedServiceValue + lost.noShowEstimatedServiceValue;
  return (
    <View>
      <Card title={t.analyticsPeakValueHours} subtitle={t.analyticsPeakValueHoursSub}>
        <HeatGrid
          cells={buildHeatCells(data.hourlyServiceValue, {
            hour: formatHour,
            money,
            done: (count) => t.analyticsHourDone.replace('{count}', String(count)),
          })}
        />
      </Card>
      <Card title={t.analyticsLostOpportunity} subtitle={t.analyticsLostOpportunitySub}>
        <View style={styles.tileGrid}>
          <Tile testID="analytics-tile-cancelled-value" label={t.analyticsCancelledValue} value={money(lost.cancelledEstimatedServiceValue)} />
          <Tile testID="analytics-tile-no-show-value" label={t.analyticsNoShowValue} value={money(lost.noShowEstimatedServiceValue)} />
          <Tile testID="analytics-tile-lost-total" label={t.analyticsCancelledNoShowValue} value={money(totalLost)} hint={t.analyticsCancelledNoShowHint} />
          <Tile
            testID="analytics-tile-idle-chair"
            label={t.analyticsIdleChairTime}
            value={lost.idleChairPercent === null ? '—' : `${Math.round((lost.idleChairMinutes ?? 0) / 60)}h`}
            hint={lost.idleChairPercent === null ? t.analyticsIdleNeedsHours : t.analyticsIdlePercentOfCapacity.replace('{percent}', String(lost.idleChairPercent))}
          />
        </View>
      </Card>
      <Card title={t.analyticsBookingDemandHours}>
        {data.peakHours.length === 0 ? (
          <Text style={styles.empty}>{t.analyticsNotEnoughBookings}</Text>
        ) : (
          <View>
            <Text style={styles.line}>{t.analyticsBusiest.replace('{hours}', formatHourList(data.peakHours))}</Text>
            <Text style={styles.line}>{t.analyticsSlowest.replace('{hours}', formatHourList(data.slowHours))}</Text>
          </View>
        )}
      </Card>
      <Card title={t.analyticsChairActivity}>
        {data.chairUtilization.length === 0 ? (
          <Text style={styles.empty}>{t.analyticsNoCompletedSessions}</Text>
        ) : (
          data.chairUtilization.map((row) => (
            <ListLine key={row.id} name={row.displayName} meta={t.analyticsSessionsLine.replace('{count}', String(row.completedSessions)).replace('{minutes}', formatMinutes(row.totalServiceMinutes))} />
          ))
        )}
      </Card>
    </View>
  );
}

function Pill({ label, active, onPress, testID, strong }: { label: string; active: boolean; onPress: () => void; testID: string; strong?: boolean }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.pill, active && (strong ? styles.pillStrongActive : styles.pillActive)]}
    >
      <Text style={[styles.pillText, active && (strong ? styles.pillTextStrongActive : styles.pillTextActive)]}>{label}</Text>
    </Pressable>
  );
}

function Tile({ label, value, hint, testID }: { label: string; value: string | number; hint?: string; testID: string }) {
  return (
    <View style={styles.tile} testID={testID} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
    </View>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <PremiumCard style={styles.card}>
      <Text style={styles.cardTitle} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      <View style={styles.cardBody}>{children}</View>
    </PremiumCard>
  );
}

function ListLine({ name, meta }: { name: string; meta: string }) {
  return (
    <View style={styles.listLine}>
      <Text style={styles.listName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.listMeta}>{meta}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[3] },
  pill: { paddingHorizontal: space[4], minHeight: 38, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: fastQue.border, backgroundColor: fastQue.card },
  pillActive: { borderColor: fastQue.pink, backgroundColor: 'rgba(242,10,131,0.14)' },
  pillStrongActive: { borderColor: fastQue.pink, backgroundColor: fastQue.pink },
  pillText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.textSecondary },
  pillTextActive: { color: fastQue.pink },
  pillTextStrongActive: { color: '#fff' },
  zoneNote: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted, marginBottom: space[3] },
  retry: { marginTop: space[3] },
  skeleton: { height: 90, borderRadius: radius.lg, marginBottom: space[3] },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginBottom: space[4] },
  tile: { width: '47%', flexGrow: 1, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.md, padding: space[3], backgroundColor: fastQue.card },
  tileValue: { fontFamily: font.displaySemiBold, fontSize: fontSize.xl, color: fastQue.text },
  tileLabel: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: fastQue.textMuted, marginTop: 2 },
  tileHint: { fontFamily: font.bodyRegular, fontSize: 10, color: fastQue.textMuted, marginTop: 4 },
  card: { marginBottom: space[4] },
  cardTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: fastQue.text },
  cardSubtitle: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted, marginTop: 2 },
  cardBody: { marginTop: space[3] },
  empty: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.textMuted },
  line: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.textSecondary, marginBottom: space[1] },
  listLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space[3], paddingVertical: space[1] },
  listName: { flex: 1, fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.text },
  listMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted },
});
