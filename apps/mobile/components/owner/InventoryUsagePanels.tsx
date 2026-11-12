import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  INVENTORY_PATHS,
  SERVICE_USAGE_PATHS,
  type InventoryCategoryDto,
  type InventoryProductDto,
  type InventoryUnit,
  type ServiceRecipeDto,
  type ServiceVisitsDto,
  type UsageRecordDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { trimDecimal, unitShort, UNIT_OPTIONS } from '../../lib/inventory-shared';
import { inventoryBase, loadAll } from '../../lib/use-inventory-lookups';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';
import { ServiceUsageSheet } from './ServiceUsageSheet';

/**
 * Website parity for apps/web/components/owner/inventory/ServiceUsageViews.tsx: service recipes
 * (which products each service uses and how much, with suggested product types and an optional
 * "take it off stock automatically" usual product) and product usage (completed visits, what was
 * recorded, record a missed visit, or correct a mistake by putting the stock back with a reason).
 */
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message || fallback : fallback);
const RECIPE_UNITS: readonly InventoryUnit[] = ['MILLILITER', 'LITER', 'GRAM', 'KILOGRAM', 'EACH', 'PACK', 'BOX'];
type Line = { inventoryCategoryId: string; quantity: string; unit: InventoryUnit; defaultProductId: string; autoDeduct: boolean };

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

const usageText = (u: UsageRecordDto) => u.items.map((i) => `${i.productName} ${trimDecimal(i.enteredQuantity)} ${unitShort(i.enteredUnit)}`).join(', ');

function Chips<T extends string>({ options, value, onPick, label }: { options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>; value: T; onPick: (v: T) => void; label: string }) {
  return (
    <View style={styles.chips} accessibilityLabel={label}>
      {options.map((o) => (
        <Pressable key={o.value || 'none'} accessibilityRole="button" accessibilityState={{ selected: value === o.value, disabled: o.disabled }} disabled={o.disabled} onPress={() => onPick(o.value)} style={[styles.chip, value === o.value && styles.chipOn, o.disabled && styles.chipOff]}>
          <Text style={[styles.chipText, value === o.value && styles.chipTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function RecipeEditor({ salonId, recipe, categories, products, onCategoryCreated }: {
  salonId: string;
  recipe: ServiceRecipeDto;
  categories: InventoryCategoryDto[];
  products: InventoryProductDto[];
  onCategoryCreated: (c: InventoryCategoryDto) => void;
}) {
  const [lines, setLines] = useState<Line[]>(recipe.lines.map((l) => ({ inventoryCategoryId: l.inventoryCategoryId, quantity: trimDecimal(l.quantity), unit: l.unit, defaultProductId: l.defaultProductId ?? '', autoDeduct: l.autoDeduct })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (i: number, patch: Partial<Line>) => { setSaved(false); setLines((all) => all.map((l, n) => (n === i ? { ...l, ...patch } : l))); };
  const used = new Set(lines.map((l) => l.inventoryCategoryId));

  const addSuggestion = async (name: string) => {
    setError(null);
    let category = categories.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
    if (!category) {
      try {
        category = await apiFetch<InventoryCategoryDto>(`${inventoryBase(salonId)}/${INVENTORY_PATHS.categories}`, { method: 'POST', body: JSON.stringify({ name }) });
        onCategoryCreated(category);
      } catch (err) {
        setError(errorText(err, `The category "${name}" could not be added.`));
        return;
      }
    }
    const id = category.id;
    if (!used.has(id)) setLines((all) => [...all, { inventoryCategoryId: id, quantity: '1', unit: 'EACH', defaultProductId: '', autoDeduct: false }]);
  };

  const save = async () => {
    setError(null);
    const body = { lines: lines.filter((l) => l.inventoryCategoryId).map((l) => ({
      inventoryCategoryId: l.inventoryCategoryId, quantity: Math.round(Number(l.quantity) * 1000) / 1000, unit: l.unit,
      defaultProductId: l.defaultProductId || null, autoDeduct: Boolean(l.defaultProductId) && l.autoDeduct,
    })) };
    if (body.lines.some((l) => !Number.isFinite(l.quantity) || l.quantity <= 0)) { setError('Each amount must be a number above 0.'); return; }
    if (new Set(body.lines.map((l) => l.inventoryCategoryId)).size !== body.lines.length) { setError('Use each product category once per service.'); return; }
    setBusy(true);
    try {
      await apiFetch<ServiceRecipeDto>(`${inventoryBase(salonId)}/${SERVICE_USAGE_PATHS.recipes}/${recipe.serviceId}`, { method: 'PUT', body: JSON.stringify(body) });
      setSaved(true);
    } catch (err) {
      setError(errorText(err, 'The recipe was not saved — try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>{recipe.serviceName}</Text>
      <Text style={styles.muted}>{recipe.isActive ? recipe.serviceCategory ?? '' : 'This service is not offered at the moment.'}</Text>
      {lines.length === 0 && <Text style={styles.muted}>No products set up. Barbers won't be asked which products they used for this service.</Text>}
      {lines.map((line, i) => {
        const inCategory = products.filter((p) => p.isActive && p.category?.id === line.inventoryCategoryId && (p.usage ?? 'PROFESSIONAL') === 'PROFESSIONAL');
        return (
          <View key={i} style={styles.recipeLine}>
            <Text style={styles.label}>Product type</Text>
            <Chips label="Product type" value={line.inventoryCategoryId} onPick={(v) => set(i, { inventoryCategoryId: v, defaultProductId: '', autoDeduct: false })}
              options={categories.map((c) => ({ value: c.id, label: c.name, disabled: c.id !== line.inventoryCategoryId && used.has(c.id) }))} />
            <View style={styles.row}>
              <TextInput accessibilityLabel={`Amount per service ${i + 1}`} value={line.quantity} onChangeText={(v) => set(i, { quantity: v })} keyboardType="decimal-pad" style={[styles.input, styles.qty]} />
              <Chips label="Unit" value={line.unit} onPick={(v) => set(i, { unit: v as InventoryUnit })} options={UNIT_OPTIONS.filter((u) => RECIPE_UNITS.includes(u.value as InventoryUnit)).map((u) => ({ value: u.value as string, label: u.label }))} />
            </View>
            <Text style={styles.label}>Usual product (optional)</Text>
            <Chips label="Usual product" value={line.defaultProductId} onPick={(v) => set(i, { defaultProductId: v, autoDeduct: v ? line.autoDeduct : false })}
              options={[{ value: '', label: 'None — barber chooses' }, ...inCategory.map((p) => ({ value: p.id, label: p.name }))]} />
            <View style={styles.switchRow}>
              <Text style={styles.small}>Take it off stock automatically when the service is completed</Text>
              <Switch accessibilityLabel={`Automatic ${i + 1}`} value={line.autoDeduct} disabled={!line.defaultProductId} onValueChange={(v) => set(i, { autoDeduct: v })} />
            </View>
            <Button title="Remove" variant="outline" onPress={() => setLines((all) => all.filter((_, n) => n !== i))} />
          </View>
        );
      })}
      <View style={styles.chips}>
        <Button title="+ Add a product type" variant="outline" onPress={() => setLines((all) => [...all, { inventoryCategoryId: '', quantity: '1', unit: 'EACH', defaultProductId: '', autoDeduct: false }])} />
        {recipe.suggestions.filter((name) => !categories.some((c) => used.has(c.id) && c.name.trim().toLowerCase() === name.toLowerCase())).map((name) => (
          <Button key={name} title={`+ ${name}`} variant="outline" onPress={() => void addSuggestion(name)} />
        ))}
      </View>
      {lines.some((l) => l.autoDeduct) && <Text style={styles.muted}>Automatic deduction only happens when every line of this service has a usual product ticked. Otherwise the barber is asked.</Text>}
      {!!error && <InlineError message={error} />}
      {saved && <Text style={styles.ok}>Saved.</Text>}
      <Button title={busy ? 'Saving…' : 'Save'} onPress={() => void save()} disabled={busy} />
    </Card>
  );
}

export function RecipesPanel({ salonId }: { salonId: string }) {
  const recipes = useResource<ServiceRecipeDto[]>(`${inventoryBase(salonId)}/${SERVICE_USAGE_PATHS.recipes}`);
  const [categories, setCategories] = useState<InventoryCategoryDto[]>([]);
  const [products, setProducts] = useState<InventoryProductDto[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const base = inventoryBase(salonId);
    void loadAll<InventoryCategoryDto>(`${base}/${INVENTORY_PATHS.categories}`).then((r) => setCategories(r.items)).catch(() => undefined);
    void loadAll<InventoryProductDto>(`${base}/${INVENTORY_PATHS.products}`).then((r) => setProducts(r.items)).catch(() => undefined);
  }, [salonId]);

  if (recipes.loading) return <Text style={styles.muted}>Loading…</Text>;
  if (recipes.error || !recipes.data) return <><InlineError message={recipes.error ?? 'Could not load recipes.'} /><Button title="Try again" variant="outline" onPress={recipes.reload} /></>;
  const shown = recipes.data.filter((r) => r.serviceName.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <>
      <Card>
        <Text style={styles.heading}>Service recipes</Text>
        <Text style={styles.muted}>Say which products each service uses and how much. When a service is completed, the barber taps the products actually used and they are taken off stock.</Text>
        <TextInput accessibilityLabel="Find a service" placeholder="Find a service" value={query} onChangeText={setQuery} style={styles.input} />
      </Card>
      {recipes.data.length === 0 && <Text style={styles.muted}>This shop has no services yet.</Text>}
      {shown.map((r) => <RecipeEditor key={r.serviceId} salonId={salonId} recipe={r} categories={categories} products={products} onCategoryCreated={(c) => setCategories((all) => [...all, c])} />)}
    </>
  );
}

export function ProductUsagePanel({ salonId }: { salonId: string }) {
  const [filter, setFilter] = useState<'all' | 'missing' | 'recorded'>('all');
  const visits = useResource<ServiceVisitsDto>(`${inventoryBase(salonId)}/${SERVICE_USAGE_PATHS.visits}?filter=${filter}`);
  const [recordFor, setRecordFor] = useState<string | null>(null);
  const [correct, setCorrect] = useState<UsageRecordDto | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reverse = async () => {
    if (!correct) return;
    if (reason.trim().length < 3) { setError('Say briefly why (at least 3 characters).'); return; }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${inventoryBase(salonId)}/${SERVICE_USAGE_PATHS.usage}/${correct.id}/${SERVICE_USAGE_PATHS.reverse}`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      setNotice('Stock put back. You can now record the right products.');
      setCorrect(null);
      setReason('');
      visits.reload();
    } catch (err) {
      setError(errorText(err, 'The correction was not saved — try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={styles.heading}>Product usage</Text>
      <Text style={styles.muted}>{visits.data ? `Completed visits from ${visits.data.range.from} to ${visits.data.range.to}.` : 'Completed visits in the last 7 days.'}</Text>
      <Chips label="Show" value={filter} onPick={setFilter} options={[{ value: 'all', label: 'All visits' }, { value: 'missing', label: 'Products not recorded' }, { value: 'recorded', label: 'Products recorded' }]} />
      {visits.data && visits.data.missingCount > 0 && filter !== 'missing' && (
        <Text style={styles.warn}>{`${visits.data.missingCount} visit${visits.data.missingCount === 1 ? '' : 's'} with a recipe have no products recorded.`}</Text>
      )}
      {!!notice && <Text style={styles.ok}>{notice}</Text>}
      {visits.loading ? <Text style={styles.muted}>Loading…</Text> : visits.error ? <InlineError message={visits.error} /> : visits.data!.items.length === 0 ? (
        <Text style={styles.muted}>{filter === 'missing' ? 'Nothing missing.' : 'No completed visits in this period.'}</Text>
      ) : visits.data!.items.flatMap((v) => v.services.map((s, i) => (
        <View key={`${v.queueEntryId}-${s.serviceId}`} style={styles.visit}>
          {i === 0 && <Text style={styles.lineStrong}>{`#${v.tokenNumber}${v.customerName ? ` ${v.customerName}` : ''}${v.staffName ? ` · ${v.staffName}` : ''}`}</Text>}
          <Text style={styles.small}>{s.serviceName}</Text>
          <Text style={styles.muted}>{s.usage ? `${usageText(s.usage)}${s.usage.source === 'AUTO' ? ' · Automatic' : ''}` : s.hasRecipe ? 'Not recorded' : 'No recipe'}</Text>
          {s.usage
            ? <Button title="Correct" variant="outline" onPress={() => { setNotice(null); setError(null); setCorrect(s.usage); }} />
            : s.hasRecipe ? <Button title="Record" variant="outline" onPress={() => { setNotice(null); setRecordFor(v.queueEntryId); }} /> : null}
        </View>
      )))}
      {correct && (
        <View style={styles.correct}>
          <Text style={styles.lineStrong}>Correct products used</Text>
          <Text style={styles.muted}>{`This puts back ${usageText(correct)} into stock and keeps a record of the correction. Then record the right products.`}</Text>
          <TextInput accessibilityLabel="Why?" placeholder="Why? e.g. wrong shade chosen" value={reason} onChangeText={setReason} maxLength={300} style={styles.input} />
          {!!error && <InlineError message={error} />}
          <View style={styles.row}>
            <Button title="Cancel" variant="outline" onPress={() => setCorrect(null)} disabled={busy} style={styles.flex} />
            <Button title={busy ? 'Saving…' : 'Put stock back'} onPress={() => void reverse()} disabled={busy} style={styles.flex} />
          </View>
        </View>
      )}
      {recordFor && <ServiceUsageSheet queueEntryId={recordFor} mode="record" onClose={() => setRecordFor(null)} onSaved={(m) => { setNotice(m); visits.reload(); }} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space[3] },
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[1] },
  label: { fontFamily: font.bodyMedium, color: color.muted, fontSize: fontSize.xs, marginTop: space[2] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  small: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, flex: 1 },
  warn: { fontFamily: font.bodyMedium, color: color.warn, fontSize: fontSize.sm, marginVertical: space[1] },
  ok: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.successSoft, padding: space[3], borderRadius: radius.sm, marginVertical: space[2] },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular, marginVertical: space[1] },
  qty: { width: 90 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginVertical: space[1], flexShrink: 1 },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: 16, paddingHorizontal: space[3], paddingVertical: space[2], backgroundColor: color.surface },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  chipOff: { opacity: 0.4 },
  chipText: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.xs },
  chipTextOn: { color: color.accent, fontFamily: font.bodyBold },
  recipeLine: { gap: space[1], paddingVertical: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  visit: { paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border, gap: space[1] },
  lineStrong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  correct: { gap: space[2], marginTop: space[3], padding: space[3], borderRadius: radius.sm, borderWidth: 1, borderColor: color.border },
  flex: { flex: 1 },
});
