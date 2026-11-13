import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  analyticsCsv,
  FORECAST_PATHS,
  SERVICE_USAGE_PATHS,
  type InventoryAnalyticsDto,
  type InventoryDashboardDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { moneyText, quantityText } from '../../lib/inventory-shared';
import { inventoryBase } from '../../lib/use-inventory-lookups';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';

/**
 * Website parity for the inventory home (ServiceUsageViews InventoryDashboard) and Reports
 * (ForecastViews AnalyticsView): stock today, products used at cost with a 30-day daily chart, the
 * last 30 days bought / retail / written off, use by service, most used products, expiring stock,
 * and consumption analytics for 7/30/90/365 days with the website's own CSV (shared analyticsCsv).
 * Every number comes from the server.
 */
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message || fallback : fallback);

function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    apiFetch<T>(path).then((d) => { if (!cancelled) { setData(d); setError(null); } }).catch((err) => { if (!cancelled) setError(errorText(err, 'Could not load this section.')); });
    return () => { cancelled = true; };
  }, [path, version]);
  return { data, error, loading: !data && !error, reload: () => setVersion((v) => v + 1) };
}

function Line({ title, value, note }: { title: string; value: string | number; note?: string }) {
  return <View style={styles.line}><View style={styles.flex}><Text style={styles.small}>{title}</Text>{note ? <Text style={styles.muted}>{note}</Text> : null}</View><Text style={styles.strong}>{String(value)}</Text></View>;
}

export function InventoryDashboardPanel({ salonId, onOpenUsage }: { salonId: string; onOpenUsage?: () => void }) {
  const { data, error, loading, reload } = useResource<InventoryDashboardDto>(`${inventoryBase(salonId)}/${SERVICE_USAGE_PATHS.dashboard}`);
  // Refresh every minute while open, as the website does (the server computes everything).
  useEffect(() => { const t = setInterval(reload, 60_000); return () => clearInterval(t); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (loading) return <Text style={styles.muted}>Loading…</Text>;
  if (error || !data) return <><InlineError message={error ?? 'No dashboard.'} /><Button title="Try again" variant="outline" onPress={reload} /></>;
  const money = (v: string) => moneyText(v, data.currency);
  const max = Math.max(...data.usageByDay.map((d) => Number(d.value)), 0);
  return (
    <>
      <Card>
        <Text style={styles.heading}>Stock today</Text>
        <Line title="Products in use" value={data.totals.activeProducts} />
        <Line title="Low on stock" value={data.totals.lowStock} />
        <Line title="Out of stock" value={data.totals.outOfStock} />
        <Line title="Expiring within 30 days" value={data.totals.expiringSoon} />
        <Line title="Stock value (at cost)" value={money(data.totals.stockValue)} />
        {data.visitsMissingUsage7Days > 0 && (
          <View style={styles.warnBox}>
            <Text style={styles.small}>{`${data.visitsMissingUsage7Days} visit${data.visitsMissingUsage7Days === 1 ? '' : 's'} in the last 7 days have no products recorded.`}</Text>
            {onOpenUsage && <Button title="Record them" variant="outline" onPress={onOpenUsage} />}
          </View>
        )}
      </Card>
      <Card>
        <Text style={styles.heading}>Products used (at cost)</Text>
        <Text style={styles.muted}>What the stock used cost you, at the average cost when it was used.</Text>
        <Line title="Today" value={money(data.usage.today)} />
        <Line title="Last 7 days" value={money(data.usage.last7Days)} />
        <Line title="Last 30 days" value={money(data.usage.last30Days)} />
        <View style={styles.bars} accessibilityLabel={`Daily use over 30 days, highest ${money(String(max))}`}>
          {data.usageByDay.map((d) => (
            <View key={d.day} style={[styles.bar, { height: `${max > 0 ? Math.max(3, (Number(d.value) / max) * 100) : 3}%` }, Number(d.value) === 0 && styles.barEmpty]} />
          ))}
        </View>
        <View style={styles.axis}><Text style={styles.muted}>{data.usageByDay[0]?.day}</Text><Text style={styles.muted}>{data.asOf}</Text></View>
      </Card>
      <Card>
        <Text style={styles.heading}>Last 30 days</Text>
        <Line title="Bought" value={money(data.purchases30Days.value)} note={`${data.purchases30Days.entries} entries`} />
        <Line title="Sold / used from the retail shelf" value={money(data.retailOut30Days.value)} note={`${data.retailOut30Days.entries} entries, at cost`} />
        <Line title="Damaged, expired or wasted" value={money(data.wastage30Days.value)} note={`${data.wastage30Days.entries} entries, at cost`} />
      </Card>
      <Card>
        <Text style={styles.heading}>Use by service (30 days)</Text>
        {data.byService30Days.length === 0 ? <Text style={styles.muted}>No products recorded for services yet. Set up service recipes; barbers then pick the products used when they complete a service.</Text>
          : data.byService30Days.map((s) => <Line key={s.serviceId} title={s.serviceName} note={`${s.visits} visits`} value={money(s.value)} />)}
      </Card>
      <Card>
        <Text style={styles.heading}>Most used products (30 days)</Text>
        {data.topProducts30Days.length === 0 ? <Text style={styles.muted}>Nothing used yet.</Text>
          : data.topProducts30Days.map((p) => <Line key={p.productId} title={p.name} note={quantityText(p.quantity, p.unit)} value={money(p.value)} />)}
      </Card>
      {data.expiring.length > 0 && (
        <Card>
          <Text style={styles.heading}>Expiring soon</Text>
          <Text style={styles.muted}>Stock received with an expiry date in the next 30 days (or already past) that is still in stock.</Text>
          {data.expiring.map((e) => (
            <Line key={`${e.productId}-${e.batchNumber}-${e.expiryDate}`} title={e.name} note={`${e.batchNumber ? `Batch ${e.batchNumber} · ` : ''}${e.expiryDate < data.asOf ? `${e.expiryDate} (past)` : e.expiryDate}`} value={quantityText(e.stockOnHand, e.unit)} />
          ))}
        </Card>
      )}
    </>
  );
}

export function InventoryAnalyticsPanel({ salonId }: { salonId: string }) {
  const [days, setDays] = useState(30);
  // The server counts back from the shop's own today (its time zone), not this phone's date.
  const { data, error, loading } = useResource<InventoryAnalyticsDto>(`${inventoryBase(salonId)}/${FORECAST_PATHS.analytics}?days=${days}`);
  const [shareError, setShareError] = useState<string | null>(null);
  const money = (v: string) => moneyText(v, data?.currency ?? null);

  const download = async () => {
    if (!data) return;
    setShareError(null);
    try {
      const uri = `${FileSystem.cacheDirectory ?? ''}inventory-${data.range.from}-to-${data.range.to}.csv`;
      await FileSystem.writeAsStringAsync(uri, analyticsCsv(data));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Inventory analytics' });
    } catch {
      setShareError('Could not prepare the CSV.');
    }
  };

  return (
    <Card>
      <Text style={styles.heading}>Consumption analytics</Text>
      {data && <Text style={styles.muted}>{`${data.range.from} to ${data.range.to}. Values at cost.`}</Text>}
      <View style={styles.chips}>
        {([7, 30, 90, 365] as const).map((d) => (
          <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: days === d }} onPress={() => setDays(d)} style={[styles.chip, days === d && styles.chipOn]}>
            <Text style={styles.chipText}>{d === 365 ? 'Last 12 months' : `Last ${d} days`}</Text>
          </Pressable>
        ))}
      </View>
      <Button title="Download CSV" variant="outline" onPress={() => void download()} disabled={!data} />
      {!!shareError && <InlineError message={shareError} />}
      {loading ? <Text style={styles.muted}>Loading…</Text> : error || !data ? <InlineError message={error ?? 'No analytics.'} /> : (
        <>
          <Line title="Bought" value={money(data.totals.receivedValue)} />
          <Line title="Used" value={money(data.totals.usedValue)} />
          <Line title="Damaged / expired / wasted" value={money(data.totals.lostValue)} />
          <Line title="Stock now" value={money(data.totals.stockValue)} />
          {data.byWeek.length > 0 && <Text style={styles.sub}>By week (weeks start on Monday)</Text>}
          {data.byWeek.map((w) => <Line key={w.weekStart} title={w.weekStart} note={`Used ${money(w.usedValue)} · written off ${money(w.lostValue)}`} value={`Bought ${money(w.receivedValue)}`} />)}
          {data.byCategory.length > 0 && <Text style={styles.sub}>By category</Text>}
          {data.byCategory.map((c) => <Line key={c.categoryName} title={c.categoryName} note={`Used ${money(c.usedValue)}`} value={`Bought ${money(c.receivedValue)}`} />)}
          {data.products.length > 0 && <Text style={styles.sub}>By product</Text>}
          {data.products.map((p) => (
            <Line key={p.productId} title={p.name} note={`Bought ${quantityText(p.receivedQuantity, p.unit)} · used ${quantityText(p.usedQuantity, p.unit)} · written off ${quantityText(p.lostQuantity, p.unit)}`} value={`Now ${quantityText(p.stockOnHand, p.unit)}`} />
          ))}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[1] },
  sub: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm, marginTop: space[3] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  small: { fontFamily: font.bodyRegular, color: color.ink, fontSize: fontSize.sm },
  strong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  flex: { flex: 1 },
  warnBox: { marginTop: space[2], padding: space[3], borderRadius: radius.sm, backgroundColor: color.goldSoft, gap: space[2] },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 80, gap: 2, marginTop: space[3] },
  bar: { flex: 1, backgroundColor: color.accent, borderRadius: 2 },
  barEmpty: { backgroundColor: color.border },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginVertical: space[2] },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: 16, paddingHorizontal: space[3], paddingVertical: space[2], backgroundColor: color.surface },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  chipText: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.xs },
});
