import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { OwnerOverviewDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { getRealtimeSocket, joinSalonRoom, onReconnect } from '../../lib/realtime';
import { formatChange, formatMoney, formatShopTime, initialsOf, CANCELLATION_ACTOR_LABEL, ownerOpsPaths } from '../../lib/owner/ops';
import { greetingFor, labelEvery, revenueBars, revenueSeries, shopHour, type RevenueRange } from '../../lib/owner/overview-view';
import { fastQue, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { InlineError, PremiumButton, PremiumCard, Skeleton } from '../ui';

export interface OwnerOverviewActions {
  onNewQueueCustomer: () => void;
  onNewAppointment: () => void;
  onOpenQueue: () => void;
  onOpenBookings: () => void;
  onOpenInvoices: () => void;
  onOpenCancellations: () => void;
  onOpenStaff: () => void;
  onOpenAnalytics: () => void;
}

export interface OwnerOverviewHandle {
  refresh: () => Promise<void>;
}

const REFRESH_DEBOUNCE_MS = 600;

/**
 * The owner's home: real figures for the selected shop only. Every number comes from
 * GET dashboard/salons/:id/overview (trusted records - revenue is money the shop recorded against an
 * invoice, never a guess from completed services). Nothing is hard-coded; an empty shop shows honest
 * empty states instead of invented history.
 */
export function OwnerOverviewPanel({
  salonId,
  actions,
  registerRefresh,
}: {
  salonId: string;
  actions: OwnerOverviewActions;
  registerRefresh?: (refresh: (() => Promise<void>) | null) => void;
}) {
  const [data, setData] = useState<OwnerOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RevenueRange>('daily');
  const requestId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const next = await apiFetch<OwnerOverviewDto>(ownerOpsPaths.overview(salonId));
      if (id !== requestId.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      // A failed background refresh keeps the figures the owner is already reading.
      setError(err instanceof ApiError ? err.message : 'Could not load your shop overview.');
    }
  }, [salonId]);

  useEffect(() => {
    setData(null);
  }, [salonId]);

  useEffect(() => {
    registerRefresh?.(load);
    return () => registerRefresh?.(null);
  }, [load, registerRefresh]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);
    const schedule = (payload: { salonId?: string }) => {
      if (payload?.salonId && payload.salonId !== salonId) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), REFRESH_DEBOUNCE_MS);
    };
    const events = ['queue.updated', 'booking.created', 'booking.cancelled'];
    for (const event of events) socket.on(event, schedule);
    const unsubscribeReconnect = onReconnect(() => void load());
    return () => {
      for (const event of events) socket.off(event, schedule);
      unsubscribeReconnect();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [salonId, load]);

  if (!data) {
    return error ? (
      <View>
        <InlineError message={error} />
        <PremiumButton title="Try again" variant="secondary" onPress={() => void load()} />
      </View>
    ) : (
      <View testID="overview-loading">
        <Skeleton style={styles.skeletonHero} />
        <Skeleton style={styles.skeletonRow} />
        <Skeleton style={styles.skeletonRow} />
      </View>
    );
  }

  const { kpis, revenue, queueSummary: queue, cancellationSummary: cancellations } = data;
  const money = (n: number) => formatMoney(n, data.currency);
  const hour = shopHour(data.timezone);
  const series = revenueSeries(revenue, range);
  const bars = revenueBars(series);
  const everyN = labelEvery(bars.length);
  const periods = [
    { label: 'Today', value: revenue.today },
    { label: 'This week', value: revenue.thisWeek },
    { label: 'This month', value: revenue.thisMonth },
  ];

  const tiles: { id: string; label: string; value: string; foot: string }[] = [
    { id: 'appointments', label: 'Today’s appointments', value: String(kpis.appointmentsToday), foot: 'Booked for today' },
    { id: 'served', label: 'Customers served', value: String(kpis.customersServedToday), foot: 'Finished today' },
    { id: 'waiting', label: 'Waiting in Live Queue', value: String(kpis.waitingInQueue), foot: 'Waiting for available staff' },
    { id: 'inservice', label: 'In service now', value: String(kpis.inService), foot: 'Service started' },
    { id: 'revenue', label: 'Revenue recorded today', value: money(kpis.recordedRevenueToday), foot: `${kpis.recordedPaymentsToday} payment${kpis.recordedPaymentsToday === 1 ? '' : 's'} recorded` },
    { id: 'available', label: 'Barbers available', value: String(kpis.availableBarbers), foot: 'On duty and free' },
    { id: 'busy', label: 'Barbers busy', value: String(kpis.busyBarbers), foot: 'With a customer' },
    { id: 'active', label: 'Active staff', value: String(kpis.activeStaff), foot: 'Clocked in' },
    { id: 'completed', label: 'Services completed', value: String(kpis.completedServicesToday), foot: 'Today' },
    { id: 'cancelled', label: 'Cancelled today', value: String(kpis.cancelledToday), foot: 'Bookings cancelled' },
  ];

  return (
    <View>
      {error && <InlineError message={`Showing the last loaded figures. ${error}`} />}

      <PremiumCard strong style={styles.welcome} testID="overview-welcome">
        <Text style={styles.welcomeDate}>{data.localDate}</Text>
        <Text style={styles.welcomeTitle}>
          {greetingFor(hour)}, {data.salonName}
        </Text>
        <Text style={styles.welcomeSub}>
          {queue.waiting} customer{queue.waiting === 1 ? ' is' : 's are'} waiting · {kpis.availableBarbers} barber{kpis.availableBarbers === 1 ? '' : 's'} free
        </Text>
        <View style={styles.actionStack}>
          <PremiumButton title="New Live Queue customer" onPress={actions.onNewQueueCustomer} />
          <PremiumButton title="New in-shop appointment" variant="secondary" onPress={actions.onNewAppointment} />
          <PremiumButton title="Open Live Queue" variant="secondary" onPress={actions.onOpenQueue} />
        </View>
      </PremiumCard>

      <View style={styles.tileGrid}>
        {tiles.map((tile) => (
          <View key={tile.id} style={styles.tile} testID={`kpi-${tile.id}`} accessible accessibilityLabel={`${tile.label}: ${tile.value}. ${tile.foot}`}>
            <Text style={styles.tileLabel}>{tile.label}</Text>
            <Text style={styles.tileValue}>{tile.value}</Text>
            <Text style={styles.tileFoot}>{tile.foot}</Text>
          </View>
        ))}
      </View>

      <PremiumCard style={styles.section} testID="overview-revenue">
        <Text style={styles.sectionTitle}>Revenue overview</Text>
        <Text style={styles.sectionSub}>Money your shop recorded as received, after recorded refunds</Text>
        <View style={styles.segment}>
          {(['daily', 'weekly', 'monthly'] as const).map((r) => (
            <Pressable key={r} accessibilityRole="button" accessibilityState={{ selected: range === r }} style={[styles.segmentItem, range === r && styles.segmentItemActive]} onPress={() => setRange(r)}>
              <Text style={[styles.segmentText, range === r && styles.segmentTextActive]}>{r === 'daily' ? 'Daily' : r === 'weekly' ? 'Weekly' : 'Monthly'}</Text>
            </Pressable>
          ))}
        </View>
        {!revenue.hasRecordedPayments ? (
          <Text style={styles.empty} testID="revenue-empty">
            No payments have been recorded yet. When you record a payment on an invoice, your revenue appears here.
          </Text>
        ) : (
          <View accessible accessibilityRole="image" accessibilityLabel={`Revenue, ${range}`} testID="revenue-bars">
            <View style={styles.bars}>
              {bars.map((bar) => (
                <View key={bar.key} style={styles.barSlot} testID={`bar-${bar.key}`} accessibilityLabel={`${bar.label}: ${money(bar.value)}`}>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { height: `${bar.heightPercent}%` }]} />
                  </View>
                </View>
              ))}
            </View>
            <View style={styles.barLabels}>
              {bars.map((bar, index) => (
                <View key={bar.key} style={styles.barSlot}>
                  {index % everyN === 0 ? (
                    <Text style={styles.barLabel} numberOfLines={1}>
                      {bar.label}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        )}
        <View style={styles.periodRow}>
          {periods.map((p) => {
            const change = formatChange(p.value.changePercent);
            return (
              <View key={p.label} style={styles.periodCell} testID={`period-${p.label}`}>
                <Text style={styles.tileLabel}>{p.label}</Text>
                <Text style={styles.periodValue}>{money(p.value.current)}</Text>
                <Text style={[styles.change, change.tone === 'up' && styles.changeUp, change.tone === 'down' && styles.changeDown]}>{change.text}</Text>
              </View>
            );
          })}
        </View>
        <Text style={styles.disclaimer} testID="estimated-value">
          Estimated value of today’s completed services: {money(revenue.estimatedServiceValueToday)} (listed prices - not revenue until you record the payment).
        </Text>
        {revenue.unpaidInvoiceCount > 0 && (
          <Pressable accessibilityRole="button" style={styles.unpaid} onPress={actions.onOpenInvoices} testID="unpaid-invoices">
            <Text style={styles.unpaidText}>
              {revenue.unpaidInvoiceCount} invoice{revenue.unpaidInvoiceCount === 1 ? '' : 's'} awaiting payment · {money(revenue.unpaidInvoiceTotal)} still due
            </Text>
          </Pressable>
        )}
      </PremiumCard>

      <PremiumCard style={styles.section} testID="overview-queue">
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Live Queue</Text>
          <Pressable accessibilityRole="button" onPress={actions.onOpenQueue}>
            <Text style={styles.link}>Open</Text>
          </Pressable>
        </View>
        <View style={styles.queueGrid}>
          {[
            // Called-to-the-counter customers have no barber yet, so they are still waiting for staff.
            ['Waiting', queue.waiting + queue.called],
            ['Assigned', queue.assigned ?? 0],
            ['In service', queue.inService],
            ['Completed', queue.completedToday],
            ['Cancelled', queue.cancelledToday],
            ['No-show', queue.noShowToday],
          ].map(([label, value]) => (
            <View key={String(label)} style={styles.queueCell}>
              <Text style={styles.tileLabel}>{label}</Text>
              <Text style={styles.queueValue}>{value}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.disclaimer}>Each person is counted once: an assigned customer is not waiting, and is not in service until the barber starts the service.</Text>
      </PremiumCard>

      <PremiumCard style={styles.section} testID="overview-top-services">
        <Text style={styles.sectionTitle}>Top services</Text>
        {data.topServices.length === 0 ? (
          <Text style={styles.empty}>No completed services in the last 30 days yet.</Text>
        ) : (
          data.topServices.map((s) => (
            <View key={s.serviceId ?? s.name} style={styles.listRow}>
              <View style={styles.listMain}>
                <Text style={styles.listTitle}>{s.name}</Text>
                <Text style={styles.listSub}>
                  {s.completedCount} completed · {s.averageChargedAmount === null ? 'no invoiced price yet' : `avg ${money(s.averageChargedAmount)}`}
                </Text>
              </View>
              <Text style={styles.listValue}>{s.recordedRevenue > 0 ? money(s.recordedRevenue) : money(s.estimatedValue)}</Text>
            </View>
          ))
        )}
      </PremiumCard>

      <PremiumCard style={styles.section} testID="overview-staff">
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Staff</Text>
          <Pressable accessibilityRole="button" onPress={actions.onOpenStaff}>
            <Text style={styles.link}>Manage</Text>
          </Pressable>
        </View>
        {data.staffPerformance.length === 0 ? (
          <Text style={styles.empty}>No barbers added yet.</Text>
        ) : (
          data.staffPerformance.map((s) => (
            <View key={s.staffId} style={styles.listRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsOf(s.displayName)}</Text>
              </View>
              <View style={styles.listMain}>
                <Text style={styles.listTitle}>{s.displayName}</Text>
                <Text style={styles.listSub}>
                  {s.availabilityState === 'AVAILABLE' ? 'Available' : s.availabilityState === 'IN_SERVICE' ? 'With a customer' : s.availabilityState === 'RESERVED' ? 'Booked soon' : 'Off duty'} · {s.completedLast30Days} in 30 days
                </Text>
              </View>
              <Text style={styles.listValue}>{s.completedToday} today</Text>
            </View>
          ))
        )}
      </PremiumCard>

      <PremiumCard style={styles.section} testID="overview-schedule">
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Today’s schedule</Text>
          <Pressable accessibilityRole="button" onPress={actions.onOpenBookings}>
            <Text style={styles.link}>All bookings</Text>
          </Pressable>
        </View>
        {data.todaysSchedule.length === 0 ? (
          <Text style={styles.empty}>No appointments are booked for today.</Text>
        ) : (
          data.todaysSchedule.map((item) => (
            <View key={item.id} style={styles.listRow}>
              <View style={styles.timePill}>
                <Text style={styles.timeText}>{formatShopTime(item.slotStart, data.timezone)}</Text>
              </View>
              <View style={styles.listMain}>
                <Text style={styles.listTitle}>{item.customerLabel}</Text>
                <Text style={styles.listSub}>
                  {item.serviceNames.join(' + ')}
                  {item.staffName ? ` · ${item.staffName}` : ''}
                  {item.source === 'IN_SHOP' ? ' · In-shop' : ''}
                </Text>
              </View>
            </View>
          ))
        )}
      </PremiumCard>

      <PremiumCard style={styles.section} testID="overview-cancellations">
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Cancellations</Text>
          <Pressable accessibilityRole="button" onPress={actions.onOpenCancellations}>
            <Text style={styles.link}>Details</Text>
          </Pressable>
        </View>
        <Text style={styles.sectionSub}>Last {cancellations.windowDays} days</Text>
        <Text style={styles.queueValue}>
          {cancellations.total}
          {cancellations.ratePercent === null ? '' : `  ·  ${cancellations.ratePercent}%`}
        </Text>
        <View style={styles.chipRow}>
          {Object.entries(cancellations.byActor)
            .filter(([, count]) => count > 0)
            .map(([actor, count]) => (
              <View key={actor} style={styles.chip}>
                <Text style={styles.chipText}>
                  {CANCELLATION_ACTOR_LABEL[actor] ?? actor} {count}
                </Text>
              </View>
            ))}
        </View>
      </PremiumCard>

      {data.branches.length > 1 && (
        <PremiumCard style={styles.section} testID="overview-branches">
          <Text style={styles.sectionTitle}>Your shops today</Text>
          {data.branches.map((b) => (
            <View key={b.salonId} style={styles.listRow}>
              <View style={styles.listMain}>
                <Text style={styles.listTitle}>{b.name}</Text>
                <Text style={styles.listSub}>
                  {b.waiting} waiting · {b.inService} in service · {b.completedToday} completed
                </Text>
              </View>
              <Text style={styles.listValue}>{formatMoney(b.recordedRevenueToday, b.currency)}</Text>
            </View>
          ))}
        </PremiumCard>
      )}

      <View style={styles.footerLinks}>
        <PremiumButton title="Analytics" variant="secondary" onPress={actions.onOpenAnalytics} />
        <PremiumButton title="Billing & invoices" variant="secondary" onPress={actions.onOpenInvoices} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonHero: { height: 170, borderRadius: radius.lg, marginBottom: space[3] },
  skeletonRow: { height: 90, borderRadius: radius.lg, marginBottom: space[3] },
  welcome: { marginBottom: space[3] },
  welcomeDate: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: fastQue.textMuted },
  welcomeTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.xl, lineHeight: lineHeightFor(fontSize.xl), color: fastQue.text, marginTop: 2 },
  welcomeSub: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.textSecondary, marginTop: space[1], marginBottom: space[3] },
  actionStack: { gap: space[2] },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[3] },
  tile: { flexBasis: '47%', flexGrow: 1, backgroundColor: fastQue.card, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.sm, padding: space[3] },
  tileLabel: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: fastQue.textSecondary },
  tileValue: { fontFamily: font.displaySemiBold, fontSize: fontSize.xl, lineHeight: lineHeightFor(fontSize.xl), color: fastQue.text, marginTop: 2 },
  tileFoot: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: fastQue.textMuted, marginTop: 2 },
  section: { marginBottom: space[3] },
  sectionTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, lineHeight: lineHeightFor(fontSize.lg), color: fastQue.text },
  sectionSub: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted, marginBottom: space[2] },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.pink, paddingVertical: space[1] },
  segment: { flexDirection: 'row', alignSelf: 'flex-start', borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.pill, padding: 3, marginBottom: space[3] },
  segmentItem: { paddingVertical: space[1], paddingHorizontal: space[3], borderRadius: radius.pill, minHeight: 32, justifyContent: 'center' },
  segmentItemActive: { backgroundColor: 'rgba(242,41,125,0.18)' },
  segmentText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: fastQue.textMuted },
  segmentTextActive: { color: fastQue.pink },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 2 },
  barSlot: { flex: 1, alignItems: 'center' },
  barTrack: { width: '100%', height: 120, justifyContent: 'flex-end' },
  barFill: { width: '100%', backgroundColor: fastQue.pink, borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 0 },
  barLabels: { flexDirection: 'row', gap: 2, marginTop: 4 },
  barLabel: { fontFamily: font.bodyRegular, fontSize: 9, color: fastQue.textMuted },
  periodRow: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  periodCell: { flex: 1, backgroundColor: fastQue.backgroundRaised, borderRadius: radius.sm, padding: space[2] },
  periodValue: { fontFamily: font.bodyBold, fontSize: fontSize.sm, color: fastQue.text, marginTop: 2 },
  change: { fontFamily: font.bodyMedium, fontSize: 11, color: fastQue.textMuted, marginTop: 2 },
  changeUp: { color: fastQue.success },
  changeDown: { color: fastQue.error },
  disclaimer: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: fastQue.textMuted, marginTop: space[2] },
  unpaid: { marginTop: space[2], padding: space[3], borderRadius: radius.sm, backgroundColor: 'rgba(255,195,104,0.12)', borderWidth: 1, borderColor: 'rgba(255,195,104,0.35)' },
  unpaidText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: fastQue.warning },
  empty: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: fastQue.textMuted },
  queueGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  queueCell: { flexBasis: '30%', flexGrow: 1, backgroundColor: fastQue.backgroundRaised, borderRadius: radius.sm, padding: space[2] },
  queueValue: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: fastQue.text },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2], borderTopWidth: 1, borderTopColor: fastQue.border },
  listMain: { flex: 1 },
  listTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.text },
  listSub: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: fastQue.textMuted },
  listValue: { fontFamily: font.bodyBold, fontSize: fontSize.sm, color: fastQue.text },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(242,41,125,0.18)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.bodyBold, fontSize: fontSize.xs, color: fastQue.pink },
  timePill: { minWidth: 72, paddingVertical: 4, paddingHorizontal: space[2], borderRadius: radius.sm, backgroundColor: fastQue.backgroundRaised, alignItems: 'center' },
  timeText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: fastQue.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  chip: { paddingVertical: 4, paddingHorizontal: space[2], borderRadius: radius.pill, borderWidth: 1, borderColor: fastQue.border },
  chipText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: fastQue.textSecondary },
  footerLinks: { gap: space[2], marginBottom: space[4] },
});
