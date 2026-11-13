import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  FORECAST_PATHS,
  INVENTORY_PATHS,
  type ForecastSettingsInput,
  type InventoryPredictionsDto,
  type ProductPredictionDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { quantityText } from '../../lib/inventory-shared';
import { inventoryBase } from '../../lib/use-inventory-lookups';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';

/**
 * Website parity for apps/web/components/owner/inventory/ForecastViews.tsx (PredictionsView): the
 * server's per-product predictions (estimates, not guarantees), reorder alerts with dismiss and
 * "check now", and the assumptions behind them (delivery days, cushion, order cover, per-supplier
 * delivery time, daily alert notifications). Nothing here is computed on the phone.
 */
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message || fallback : fallback);
const STATUS: Record<ProductPredictionDto['status'], string> = { OUT_OF_STOCK: 'Out of stock', ORDER_NOW: 'Order now', ORDER_SOON: 'Order soon', OK: 'OK', NO_DATA: 'No prediction' };
const CONFIDENCE: Record<ProductPredictionDto['confidence'], string> = { NOT_ENOUGH_DATA: 'Not enough data', LOW: 'Low confidence', MEDIUM: 'Medium confidence', HIGH: 'High confidence' };
const TREND: Record<ProductPredictionDto['trend'], string> = { UP: '↑ rising', DOWN: '↓ falling', STEADY: '→ steady', UNKNOWN: '' };

function Settings({ salonId, data, onSaved }: { salonId: string; data: InventoryPredictionsDto; onSaved: () => void }) {
  const [form, setForm] = useState({ leadTimeDays: String(data.settings.leadTimeDays), safetyDays: String(data.settings.safetyDays), coverDays: String(data.settings.coverDays), alertsEnabled: data.settings.alertsEnabled });
  const [leadTimes, setLeadTimes] = useState<Record<string, string>>(Object.fromEntries(data.suppliers.map((s) => [s.id, s.leadTimeDays == null ? '' : String(s.leadTimeDays)])));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const int = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);

  const save = async () => {
    const body: ForecastSettingsInput = { leadTimeDays: int(form.leadTimeDays), safetyDays: int(form.safetyDays), coverDays: int(form.coverDays), alertsEnabled: form.alertsEnabled };
    if ([body.leadTimeDays, body.safetyDays, body.coverDays].some((n) => !Number.isInteger(n)) || body.coverDays < 1) {
      setMessage({ ok: false, text: 'Use whole days (an order must cover at least 1 day).' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch(`${inventoryBase(salonId)}/${FORECAST_PATHS.settings}`, { method: 'PUT', body: JSON.stringify(body) });
      for (const s of data.suppliers) {
        const v = leadTimes[s.id]?.trim() ?? '';
        const next = v === '' ? null : int(v);
        if (next !== null && !Number.isInteger(next)) throw new Error(`Lead time for ${s.name} must be whole days.`);
        if (next !== s.leadTimeDays) await apiFetch(`${inventoryBase(salonId)}/${INVENTORY_PATHS.suppliers}/${s.id}/${FORECAST_PATHS.leadTime}`, { method: 'PUT', body: JSON.stringify({ leadTimeDays: next }) });
      }
      setMessage({ ok: true, text: 'Saved. Predictions are updated.' });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error && !(err instanceof ApiError) ? err.message : errorText(err, 'Not saved — try again.') });
    } finally {
      setBusy(false);
    }
  };

  const num = (key: 'leadTimeDays' | 'safetyDays' | 'coverDays', label: string) => (
    <View key={key} style={styles.flex}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} value={form[key]} onChangeText={(v) => setForm({ ...form, [key]: v })} keyboardType="number-pad" style={styles.input} />
    </View>
  );
  return (
    <Card>
      <Text style={styles.heading}>Assumptions</Text>
      <Text style={styles.muted}>Predictions use these. A supplier's own delivery time wins over the shop's default.</Text>
      <View style={styles.row}>{num('leadTimeDays', 'Delivery takes (days)')}{num('safetyDays', 'Cushion (days)')}{num('coverDays', 'Order covers (days)')}</View>
      {data.suppliers.map((s) => (
        <View key={s.id}>
          <Text style={styles.label}>{`${s.name}: delivery days (empty = shop default)`}</Text>
          <TextInput accessibilityLabel={`${s.name} delivery days`} value={leadTimes[s.id] ?? ''} onChangeText={(v) => setLeadTimes({ ...leadTimes, [s.id]: v })} keyboardType="number-pad" style={styles.input} />
        </View>
      ))}
      <View style={styles.switchRow}>
        <Text style={styles.small}>Notify me when something needs reordering or is about to expire (checked once a day)</Text>
        <Switch accessibilityLabel="Reorder notifications" value={form.alertsEnabled} onValueChange={(v) => setForm({ ...form, alertsEnabled: v })} />
      </View>
      {message && (message.ok ? <Text style={styles.ok}>{message.text}</Text> : <InlineError message={message.text} />)}
      <Button title={busy ? 'Saving…' : 'Save'} onPress={() => void save()} disabled={busy} />
    </Card>
  );
}

export function PredictionsPanel({ salonId }: { salonId: string }) {
  const [data, setData] = useState<InventoryPredictionsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let cancelled = false;
    apiFetch<InventoryPredictionsDto>(`${inventoryBase(salonId)}/${FORECAST_PATHS.predictions}`)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((err) => { if (!cancelled) setError(errorText(err, 'Could not load predictions.')); });
    return () => { cancelled = true; };
  }, [salonId, version]);

  if (!data && !error) return <Text style={styles.muted}>Loading…</Text>;
  if (error || !data) return <><InlineError message={error ?? 'No predictions.'} /><Button title="Try again" variant="outline" onPress={reload} /></>;

  const checkNow = async () => {
    setBusy(true);
    try {
      const r = await apiFetch<{ created: number; resolved: number }>(`${inventoryBase(salonId)}/${FORECAST_PATHS.runAlerts}`, { method: 'POST' });
      setNotice(r.created || r.resolved ? `${r.created} new alert${r.created === 1 ? '' : 's'}, ${r.resolved} cleared.` : 'Nothing new.');
      reload();
    } catch (err) {
      setNotice(errorText(err, 'Could not check now.'));
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async (id: string) => {
    try {
      await apiFetch(`${inventoryBase(salonId)}/${FORECAST_PATHS.alerts}/${id}/${FORECAST_PATHS.dismiss}`, { method: 'POST' });
      reload();
    } catch (err) {
      setNotice(errorText(err, 'Could not dismiss.'));
    }
  };
  const s = data.summary;
  return (
    <>
      <Card>
        <Text style={styles.heading}>Predictions</Text>
        <Text style={styles.muted}>{`Worked out from your recorded use (last 8 weeks, recent weeks count more), upcoming bookings and delivery times, as of ${data.asOf}. Estimates, not guarantees.`}</Text>
        <Line title="Order now" value={String(s.orderNow + s.outOfStock)} />
        <Line title="Order within a week" value={String(s.orderSoon)} />
        <Line title="Expiring stock at risk" value={String(s.expiringAtRisk)} />
        <Line title="Not enough data yet" value={String(s.notEnoughData)} />
        <Button title={busy ? 'Checking…' : 'Check for alerts now'} variant="outline" onPress={() => void checkNow()} disabled={busy} />
        {!!notice && <Text style={styles.ok}>{notice}</Text>}
      </Card>
      {data.alerts.length > 0 && (
        <Card>
          <Text style={styles.heading}>Alerts</Text>
          <Text style={styles.muted}>Each problem is raised once and clears itself when it is fixed.</Text>
          {data.alerts.map((a) => (
            <View key={a.id} style={styles.item}>
              <Text style={styles.strong}>{`${a.kind === 'REORDER' ? 'Reorder' : a.kind === 'STOCK_OUT' ? 'Out of stock' : a.kind === 'EXPIRED' ? 'Expired' : 'Expiring'} · ${a.title}`}</Text>
              <Text style={styles.muted}>{a.detail}</Text>
              <Button title={`Dismiss ${a.title}`} variant="outline" onPress={() => void dismiss(a.id)} />
            </View>
          ))}
        </Card>
      )}
      <Card>
        <Text style={styles.heading}>Products</Text>
        {data.products.length === 0 ? <Text style={styles.muted}>No products yet.</Text> : data.products.map((p) => (
          <View key={p.productId} style={styles.item}>
            <Text style={styles.strong}>{`${p.name} · ${STATUS[p.status]}`}</Text>
            <Text style={styles.muted}>{[p.categoryName, p.supplierName ? `${p.supplierName} · ${p.leadTimeDays} days delivery` : `${p.leadTimeDays} days delivery`].filter(Boolean).join(' · ')}</Text>
            <Text style={styles.small}>{`In stock ${quantityText(p.stockOnHand, p.unit)} · use/day ${p.dailyRate != null ? `${quantityText(String(p.dailyRate), p.unit)} ${TREND[p.trend]}` : '—'} · days left ${p.daysLeft != null ? Math.floor(p.daysLeft) : '—'}`}</Text>
            <Text style={styles.small}>{`Runs out ${p.stockOutDate ?? '—'} · order by ${p.reorderDate ?? '—'} · suggested ${p.suggestedOrderQuantity ? quantityText(String(p.suggestedOrderQuantity), p.unit) : '—'}`}</Text>
            {p.expiry.map((e) => (
              <Text key={`${e.batchNumber}-${e.expiryDate}`} style={styles.warn}>
                {`${e.daysToExpiry < 0 ? 'Expired' : `Expires ${e.expiryDate}`}: ${e.batchNumber ? `batch ${e.batchNumber}, ` : ''}about ${quantityText(String(e.remaining), p.unit)} left${e.atRisk > 0 ? `, ~${quantityText(String(e.atRisk), p.unit)} may not be used in time` : ''}`}
              </Text>
            ))}
            <Text style={styles.muted}>{`${CONFIDENCE[p.confidence]} · ${p.explanation}`}</Text>
          </View>
        ))}
      </Card>
      <Settings salonId={salonId} data={data} onSaved={reload} />
    </>
  );
}

function Line({ title, value }: { title: string; value: string }) {
  return <View style={styles.line}><Text style={styles.small}>{title}</Text><Text style={styles.strong}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[1] },
  label: { fontFamily: font.bodyMedium, color: color.muted, fontSize: fontSize.xs, marginTop: space[2] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  small: { fontFamily: font.bodyRegular, color: color.ink, fontSize: fontSize.sm, flexShrink: 1 },
  strong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  warn: { fontFamily: font.bodyMedium, color: color.warn, fontSize: fontSize.xs },
  ok: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.successSoft, padding: space[3], borderRadius: radius.sm, marginVertical: space[2] },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular, marginVertical: space[1] },
  row: { flexDirection: 'row', gap: space[2] },
  flex: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginVertical: space[2] },
  item: { paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border, gap: space[1] },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space[1] },
});
