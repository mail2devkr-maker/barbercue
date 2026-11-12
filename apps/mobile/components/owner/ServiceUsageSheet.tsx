import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  SERVICE_USAGE_PATHS,
  type InventoryUnit,
  type RecordServiceUsageResultDto,
  type UsageProductOptionDto,
  type VisitUsageOptionsDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { quantityText, trimDecimal, unitShort } from '../../lib/inventory-shared';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, InlineError } from '../ui';

/**
 * Website parity for apps/web/components/owner/inventory/ServiceUsageDialog.tsx: "Which products did
 * you use?" for one visit. In "complete" mode it is the step before completing a service — with no
 * recipes for these services it completes straight away, exactly as before, and staff can always
 * complete without recording. Only a salon-approved default product is pre-chosen. Saving is ONE
 * request for the whole visit and is safe to repeat (the server de-duplicates per service).
 */
type Pick = { key: string; ruleId: string | null; label: string; choices: string[]; productId: string | null; quantity: string; unit: InventoryUnit };

export const visitUsagePath = (queueEntryId: string) => `dashboard/${SERVICE_USAGE_PATHS.queueEntries}/${queueEntryId}/${SERVICE_USAGE_PATHS.productUsage}`;
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message || fallback : fallback);

export function initialPicks(options: VisitUsageOptionsDto): Record<string, Pick[]> {
  const stocked = new Set(options.products.map((p) => p.productId));
  return Object.fromEntries(options.services.filter((s) => !s.recorded).map((s) => [
    s.serviceId,
    s.lines.map((l) => ({
      key: l.id, ruleId: l.id, label: `${l.categoryName} · ${trimDecimal(l.quantity)} ${unitShort(l.unit)}`, choices: l.productIds,
      productId: l.defaultProductId && stocked.has(l.defaultProductId) ? l.defaultProductId : null,
      quantity: trimDecimal(l.quantity), unit: l.unit,
    })),
  ]));
}

function unitChoices(product: UsageProductOptionDto | undefined, current: InventoryUnit): InventoryUnit[] {
  const set = new Set<InventoryUnit>([current]);
  if (product) { set.add(product.unit); if (product.contentUnit) set.add(product.contentUnit); }
  return [...set];
}

export function ServiceUsageSheet({ queueEntryId, mode, onClose, onComplete, onSaved }: {
  queueEntryId: string;
  mode: 'complete' | 'record';
  onClose: () => void;
  onComplete?: () => Promise<unknown> | void;
  onSaved?: (message: string) => void;
}) {
  const [options, setOptions] = useState<VisitUsageOptionsDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handedOff = useRef(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<VisitUsageOptionsDto>(visitUsagePath(queueEntryId))
      .then((o) => {
        if (cancelled) return;
        if (mode === 'complete' && !o.hasAnythingToRecord && !handedOff.current) {
          // No recipes for these services: complete exactly as before, with no product step.
          handedOff.current = true;
          onClose();
          void onComplete?.();
          return;
        }
        setOptions(o);
        setPicks(initialPicks(o));
      })
      .catch((err) => { if (!cancelled) setLoadError(errorText(err, 'The products for this visit could not be loaded.')); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per opened sheet
  }, [queueEntryId]);

  const byId = useMemo(() => new Map((options?.products ?? []).map((p) => [p.productId, p])), [options]);
  const chosen = Object.entries(picks).map(([serviceId, items]) => ({ serviceId, items: items.filter((i) => i.productId && Number(i.quantity) > 0) })).filter((s) => s.items.length > 0);
  const pending = options?.services.filter((s) => !s.recorded) ?? [];
  const update = (serviceId: string, key: string, patch: Partial<Pick>) => setPicks((all) => ({ ...all, [serviceId]: all[serviceId].map((p) => (p.key === key ? { ...p, ...patch } : p)) }));
  const addExtra = (serviceId: string) => setPicks((all) => ({
    ...all,
    [serviceId]: [...all[serviceId], { key: `extra-${Date.now()}`, ruleId: null, label: 'Something else', choices: options!.products.map((p) => p.productId), productId: null, quantity: '1', unit: 'EACH' }],
  }));

  const complete = async () => {
    setBusy(true);
    try {
      await onComplete?.();
      onClose();
    } catch (err) {
      setError(errorText(err, 'The service could not be completed — try again.'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!chosen.length) { if (mode === 'complete') return complete(); setError('Tap the products that were used.'); return; }
    if (chosen.flatMap((s) => s.items).some((i) => !Number.isFinite(Number(i.quantity)) || Number(i.quantity) <= 0)) { setError('Amounts must be numbers above 0.'); return; }
    setBusy(true);
    setError(null);
    try {
      await apiFetch<RecordServiceUsageResultDto>(visitUsagePath(queueEntryId), {
        method: 'POST',
        body: JSON.stringify({ services: chosen.map((s) => ({ serviceId: s.serviceId, items: s.items.map((i) => ({ productId: i.productId, quantity: Math.round(Number(i.quantity) * 1000) / 1000, unit: i.unit, ruleId: i.ruleId })) })) }),
      });
      const count = chosen.reduce((n, s) => n + s.items.length, 0);
      onSaved?.(`${count} product${count === 1 ? '' : 's'} taken off stock.`);
      if (mode === 'complete') await onComplete?.();
      onClose();
    } catch (err) {
      setError(errorText(err, 'The products were not saved — try again.'));
    } finally {
      setBusy(false);
    }
  };

  const title = options ? `Products used · #${options.tokenNumber}${options.customerName ? ` ${options.customerName}` : ''}` : 'Products used';
  return (
    <Modal visible animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
      <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{title}</Text>
        {!options && !loadError && <Text style={styles.muted}>Loading the products for this visit…</Text>}
        {!!loadError && <InlineError message={loadError} />}
        {loadError && mode === 'complete' && <Button title="Complete without recording" onPress={() => void complete()} disabled={busy} />}
        {options && (
          <>
            <Text style={styles.muted}>Tap each product you used. Change the amount if you used more or less.</Text>
            {options.services.map((service) => (
              <View key={service.serviceId} style={styles.service} accessibilityLabel={service.serviceName}>
                <Text style={styles.serviceName}>{service.serviceName}</Text>
                {service.recorded ? (
                  <Text style={styles.muted}>{`Already recorded: ${service.recorded.items.map((i) => `${i.productName} ${trimDecimal(i.enteredQuantity)} ${unitShort(i.enteredUnit)}`).join(', ')}.`}</Text>
                ) : (picks[service.serviceId] ?? []).length === 0 ? (
                  <Text style={styles.muted}>No products are set up for this service.</Text>
                ) : (picks[service.serviceId] ?? []).map((pick) => {
                  const product = pick.productId ? byId.get(pick.productId) : undefined;
                  return (
                    <View key={pick.key} style={styles.line}>
                      <Text style={styles.lineHead}>{pick.label}</Text>
                      {pick.choices.length === 0 ? <Text style={styles.muted}>No product in stock for this. Add one under Inventory.</Text> : (
                        <View style={styles.chips} accessibilityLabel={pick.label}>
                          {pick.choices.map((id) => {
                            const p = byId.get(id);
                            if (!p) return null;
                            const selected = pick.productId === id;
                            const empty = Number(p.stockOnHand) <= 0;
                            return (
                              <Pressable key={id} accessibilityRole="button" accessibilityLabel={p.name} accessibilityState={{ selected }} onPress={() => update(service.serviceId, pick.key, { productId: selected ? null : id, unit: selected ? pick.unit : unitChoices(p, pick.unit).includes(pick.unit) ? pick.unit : p.unit })} style={[styles.card, selected && styles.cardOn, empty && styles.cardEmpty]}>
                                <Text style={styles.cardName}>{p.name}</Text>
                                {p.brand ? <Text style={styles.muted}>{p.brand}</Text> : null}
                                <Text style={styles.muted}>{empty ? 'Out of stock' : `In stock: ${quantityText(p.stockOnHand, p.unit)}`}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      )}
                      {pick.productId && (
                        <View style={styles.amountRow}>
                          <TextInput accessibilityLabel={`Amount for ${pick.label}`} value={pick.quantity} onChangeText={(v) => update(service.serviceId, pick.key, { quantity: v })} keyboardType="decimal-pad" style={styles.input} />
                          {unitChoices(product, pick.unit).map((u) => (
                            <Pressable key={u} accessibilityRole="button" accessibilityState={{ selected: pick.unit === u }} onPress={() => update(service.serviceId, pick.key, { unit: u })} style={[styles.unit, pick.unit === u && styles.cardOn]}>
                              <Text style={styles.cardName}>{unitShort(u)}</Text>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
                {!service.recorded && options.products.length > 0 && <Button title="+ Something else was used" variant="outline" onPress={() => addExtra(service.serviceId)} />}
              </View>
            ))}
            {!!error && <InlineError message={error} />}
            {mode === 'complete' ? (
              <View style={styles.row}>
                <Button title="Complete without recording" variant="outline" onPress={() => void complete()} disabled={busy} style={styles.flex} />
                <Button title={busy ? 'Saving…' : pending.length === 0 || chosen.length === 0 ? 'Complete service' : 'Save and complete'} onPress={() => void save()} disabled={busy} style={styles.flex} />
              </View>
            ) : (
              <View style={styles.row}>
                <Button title="Cancel" variant="outline" onPress={onClose} disabled={busy} style={styles.flex} />
                <Button title={busy ? 'Saving…' : 'Save products used'} onPress={() => void save()} disabled={busy || pending.length === 0} style={styles.flex} />
              </View>
            )}
          </>
        )}
        {!options && mode === 'record' && <Button title="Cancel" variant="outline" onPress={onClose} />}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: space[5], paddingTop: space[6], gap: space[3], backgroundColor: color.surface, flexGrow: 1 },
  title: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.lg },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs },
  service: { gap: space[2], paddingVertical: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
  serviceName: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base },
  line: { gap: space[1] },
  lineHead: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  card: { minWidth: 120, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, padding: space[3], backgroundColor: color.surface },
  cardOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  cardEmpty: { opacity: 0.55 },
  cardName: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[1] },
  input: { minWidth: 80, minHeight: 44, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: space[3], color: color.ink, fontFamily: font.bodyRegular },
  unit: { borderWidth: 1, borderColor: color.border, borderRadius: 16, paddingHorizontal: space[3], paddingVertical: space[2] },
  row: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  flex: { flex: 1 },
});
