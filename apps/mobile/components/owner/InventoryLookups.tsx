import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { INVENTORY_PATHS, type InventoryCategoryDto, type InventoryProductDto, type InventorySupplierDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import {
  buildProductPatch,
  buildSupplier,
  COUNTED_UNITS,
  EMPTY_SUPPLIER,
  entityErrorText,
  productFormFrom,
  UNIT_OPTIONS,
  unitShort,
  validateCategoryName,
  type ProductErrors,
  type ProductForm,
  type SupplierErrors,
  type SupplierForm,
} from '../../lib/inventory-shared';
import { useCursorList } from '../../lib/use-cursor-list';
import { inventoryBase, useInventoryLookups } from '../../lib/use-inventory-lookups';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';

/**
 * Website parity for apps/web/components/owner/inventory/LookupViews.tsx (categories, suppliers) and
 * ProductsView's edit dialog. Same server endpoints, same validation (lib/inventory-shared.ts is the
 * website's lib/inventory.ts). The server offers no rename/delete for categories or suppliers, so
 * none is shown; a product is never deleted — "stop using" keeps its history.
 */
function created(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Footer({ list }: { list: { nextCursor?: string | null; hasMore?: boolean; loadMore?: () => void; loadingMore?: boolean; error?: string | null } }) {
  return (
    <>
      {!!list.error && <InlineError message={list.error} />}
      {list.hasMore && list.loadMore && <Button title={list.loadingMore ? 'Loading…' : 'Load more'} variant="outline" onPress={() => list.loadMore?.()} disabled={list.loadingMore} />}
    </>
  );
}

export function CategoriesPanel({ salonId }: { salonId: string }) {
  const path = `${inventoryBase(salonId)}/${INVENTORY_PATHS.categories}`;
  const list = useCursorList<InventoryCategoryDto>(path, {});
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const add = async () => {
    setError(null); setNotice(null);
    const problem = validateCategoryName(name);
    setFieldError(problem);
    if (problem) return;
    setSaving(true);
    try {
      await apiFetch<InventoryCategoryDto>(path, { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      setNotice(`${name.trim()} added.`);
      setName('');
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? entityErrorText(err.code, err.message) : 'Could not add the category. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <Text style={styles.heading}>Categories</Text>
      <Text style={styles.muted}>Groups for your products, such as Hair colour or Skin care.</Text>
      <TextInput accessibilityLabel="New category" placeholder="New category" value={name} onChangeText={setName} maxLength={80} style={styles.input} />
      {!!fieldError && <Text style={styles.warn}>{fieldError}</Text>}
      <Button title={saving ? 'Adding…' : 'Add category'} onPress={() => void add()} disabled={saving} />
      {!!error && <InlineError message={error} />}
      {!!notice && <Text style={styles.ok}>{notice}</Text>}
      {list.loading ? <Text style={styles.muted}>Loading…</Text> : list.items.length === 0 && !list.error ? <Text style={styles.muted}>No categories yet. Add one above to group your products.</Text>
        : list.items.map((c) => <Row key={c.id} title={c.name} note={`Added ${created(c.createdAt)}`} />)}
      <Footer list={list} />
    </Card>
  );
}

export function SuppliersPanel({ salonId }: { salonId: string }) {
  const path = `${inventoryBase(salonId)}/${INVENTORY_PATHS.suppliers}`;
  const list = useCursorList<InventorySupplierDto>(path, {});
  const [form, setForm] = useState<SupplierForm>(EMPTY_SUPPLIER);
  const [errors, setErrors] = useState<SupplierErrors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const set = (patch: Partial<SupplierForm>) => setForm((f) => ({ ...f, ...patch }));

  const add = async () => {
    setError(null); setNotice(null);
    const { body, errors: found } = buildSupplier(form);
    setErrors(found);
    if (!body) return;
    setSaving(true);
    try {
      await apiFetch<InventorySupplierDto>(path, { method: 'POST', body: JSON.stringify(body) });
      setNotice(`${body.name} added.`);
      setForm(EMPTY_SUPPLIER);
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? entityErrorText(err.code, err.message) : 'Could not add the supplier. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof SupplierForm, label: string, extra: object = {}) => (
    <View key={key}>
      <TextInput accessibilityLabel={label} placeholder={label} value={form[key]} onChangeText={(v) => set({ [key]: v } as Partial<SupplierForm>)} style={styles.input} {...extra} />
      {!!errors[key] && <Text style={styles.warn}>{errors[key]}</Text>}
    </View>
  );

  return (
    <Card>
      <Text style={styles.heading}>Suppliers</Text>
      <Text style={styles.muted}>Who you buy from. A supplier can be named on a purchase.</Text>
      {field('name', 'Name', { maxLength: 120 })}
      {field('contactName', 'Contact person (optional)', { maxLength: 120 })}
      {field('phone', 'Phone (optional)', { maxLength: 40, keyboardType: 'phone-pad' })}
      {field('email', 'Email (optional)', { maxLength: 254, keyboardType: 'email-address', autoCapitalize: 'none' })}
      {field('notes', 'Notes (optional)', { maxLength: 500, multiline: true })}
      <Button title={saving ? 'Adding…' : 'Add supplier'} onPress={() => void add()} disabled={saving} />
      <Text style={styles.muted}>Nothing is sent to a supplier from here. This is only a list for your own records.</Text>
      {!!error && <InlineError message={error} />}
      {!!notice && <Text style={styles.ok}>{notice}</Text>}
      {list.loading ? <Text style={styles.muted}>Loading…</Text> : list.items.length === 0 && !list.error ? <Text style={styles.muted}>No suppliers yet.</Text>
        : list.items.map((s) => <Row key={s.id} title={s.name} note={[[s.contactName, s.phone, s.email].filter(Boolean).join(' · ') || '—', s.notes, `Added ${created(s.createdAt)}`].filter(Boolean).join(' · ')} />)}
      <Footer list={list} />
    </Card>
  );
}

/** Edit one product with every field the website's product dialog has. */
export function ProductEditor({ salonId, product, onSaved, onCancel }: {
  salonId: string;
  product: InventoryProductDto;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const lookups = useInventoryLookups(salonId);
  const [form, setForm] = useState<ProductForm>(() => productFormFrom(product));
  const [errors, setErrors] = useState<ProductErrors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ProductForm>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setError(null);
    const { body, errors: found, changed } = buildProductPatch(product, form);
    setErrors(found);
    if (!body) return;
    if (!changed) { onCancel(); return; }
    setSaving(true);
    try {
      await apiFetch<InventoryProductDto>(`${inventoryBase(salonId)}/${INVENTORY_PATHS.products}/${product.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      onSaved(`${form.name.trim() || product.name} saved.`);
    } catch (err) {
      setError(err instanceof ApiError ? entityErrorText(err.code, err.message) : 'Could not save the product. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  const chips = (options: ReadonlyArray<{ value: string; label: string }>, value: string, onPick: (v: string) => void, label: string) => (
    <View style={styles.chips} accessibilityLabel={label}>
      {options.map((o) => (
        <Pressable key={o.value || 'none'} accessibilityRole="button" accessibilityState={{ selected: value === o.value }} onPress={() => onPick(o.value)} style={[styles.chip, value === o.value && styles.chipOn]}>
          <Text style={[styles.chipText, value === o.value && styles.chipTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={styles.editor}>
      <Text style={styles.heading}>{`Edit ${product.name}`}</Text>
      <Text style={styles.label}>Name</Text>
      <TextInput accessibilityLabel="Product name" value={form.name} onChangeText={(v) => set({ name: v })} maxLength={120} style={styles.input} />
      {!!errors.name && <Text style={styles.warn}>{errors.name}</Text>}
      <Text style={styles.label}>SKU or code (optional)</Text>
      <TextInput accessibilityLabel="SKU" value={form.sku} onChangeText={(v) => set({ sku: v })} maxLength={80} style={styles.input} />
      <Text style={styles.label}>{`Unit: ${unitShort(product.unit)} (cannot be changed once a product exists)`}</Text>
      <Text style={styles.label}>{`Warn me when stock is at or below (in ${unitShort(form.unit)}; empty = no warning)`}</Text>
      <TextInput accessibilityLabel="Low stock threshold" value={form.reorderThreshold} onChangeText={(v) => set({ reorderThreshold: v })} keyboardType="decimal-pad" style={styles.input} />
      {!!errors.reorderThreshold && <Text style={styles.warn}>{errors.reorderThreshold}</Text>}
      {COUNTED_UNITS.includes(product.unit) && (
        <>
          <Text style={styles.label}>{`One ${unitShort(product.unit)} contains (optional, e.g. 195 ml)`}</Text>
          <TextInput accessibilityLabel="Contents size" value={form.contentSize} onChangeText={(v) => set({ contentSize: v })} keyboardType="decimal-pad" style={styles.input} />
          {!!errors.contentSize && <Text style={styles.warn}>{errors.contentSize}</Text>}
          {chips([{ value: '', label: 'No contents unit' }, ...UNIT_OPTIONS.filter((u) => !COUNTED_UNITS.includes(u.value))], form.contentUnit, (v) => set({ contentUnit: v }), 'Contents unit')}
        </>
      )}
      <Text style={styles.label}>Category (optional)</Text>
      {chips([{ value: '', label: 'None' }, ...lookups.categories.map((c) => ({ value: c.id, label: c.name }))], form.categoryId, (v) => set({ categoryId: v }), 'Category')}
      <Text style={styles.label}>Usual supplier (optional)</Text>
      {chips([{ value: '', label: 'None' }, ...lookups.suppliers.map((s) => ({ value: s.id, label: s.name }))], form.supplierId, (v) => set({ supplierId: v }), 'Supplier')}
      <View style={styles.switchRow}>
        <Text style={styles.lineStrong}>In use (off = stop using; history stays)</Text>
        <Switch accessibilityLabel="In use" value={form.isActive} onValueChange={(v) => set({ isActive: v })} />
      </View>
      {!!error && <InlineError message={error} />}
      <View style={styles.row}>
        <Button title={saving ? 'Saving…' : 'Save product'} onPress={() => void save()} disabled={saving} style={styles.flex} />
        <Button title="Cancel" variant="outline" onPress={onCancel} disabled={saving} style={styles.flex} />
      </View>
    </View>
  );
}

function Row({ title, note }: { title: string; note?: string }) {
  return <View style={styles.line}><Text style={styles.lineStrong}>{title}</Text>{note ? <Text style={styles.muted}>{note}</Text> : null}</View>;
}

const styles = StyleSheet.create({
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[1] },
  label: { fontFamily: font.bodyMedium, color: color.muted, fontSize: fontSize.xs, marginTop: space[2] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  warn: { fontFamily: font.bodyMedium, color: color.warn, fontSize: fontSize.xs },
  ok: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.successSoft, padding: space[3], borderRadius: radius.sm, marginVertical: space[2] },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular, marginVertical: space[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginVertical: space[1] },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: 16, paddingHorizontal: space[3], paddingVertical: space[2], backgroundColor: color.surface },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  chipText: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.xs },
  chipTextOn: { color: color.accent, fontFamily: font.bodyBold },
  line: { paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  lineStrong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm, flex: 1 },
  editor: { gap: space[1], padding: space[3], borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, marginTop: space[2] },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[2] },
  row: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  flex: { flex: 1 },
});
