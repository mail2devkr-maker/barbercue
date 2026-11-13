import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import {
  CATALOG_PATHS,
  INVENTORY_LOSS_KINDS,
  INVENTORY_PATHS,
  normalizeBarcode,
  type CatalogLinkCandidateDto,
  type CatalogLookupResultDto,
  type CatalogProductDto,
  type InventoryMovementDto,
  type InventoryProductDto,
  type InventoryUnit,
  type ProductType,
  type StockUsage,
} from '@barbercue/shared';
import { apiFetch, apiUploadImage, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { kindLabel, quantityText, unitShort, UNIT_OPTIONS } from '../../lib/inventory-shared';
import { inventoryBase, useInventoryLookups } from '../../lib/use-inventory-lookups';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';

/**
 * Website parity for apps/web/components/owner/inventory/ScanAddStock.tsx: scan (phone camera) or type a
 * barcode (a Bluetooth scanner types it too), look it up in the FastQue product catalog, then add the
 * stock received, link the barcode to a product added by hand earlier, write stock off, or submit a
 * new catalog product (with an optional photo) for FastQue review. The camera is only opened on
 * request, reads barcodes on the phone, and saves or uploads no picture.
 */
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message || fallback : fallback);
const num = (text: string) => (text.trim() === '' ? null : Number(text.trim().replace(/[₹,\s]/g, '')));
const SHELF: Record<StockUsage, string> = { PROFESSIONAL: 'Used on services', RETAIL: 'Sold to customers' };
const linkedText = (name: string) => `Barcode linked to "${name}". Scans now find it — add stock below.`;
type Lookup = CatalogLookupResultDto & { hint?: 'UPC_E' };

function Chips<T extends string>({ value, onPick, options }: { value: T; onPick: (v: T) => void; options: ReadonlyArray<{ value: T; label: string }> }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => (
        <Pressable key={o.value || 'none'} accessibilityRole="button" accessibilityState={{ selected: value === o.value }} onPress={() => onPick(o.value)} style={[styles.chip, value === o.value && styles.chipOn]}>
          <Text style={styles.chipText}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Field({ label, value, onChange, keyboard, max }: { label: string; value: string; onChange: (v: string) => void; keyboard?: 'decimal-pad' | 'number-pad'; max?: number }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} keyboardType={keyboard} maxLength={max} style={styles.input} />
    </View>
  );
}

async function linkBarcode(salonId: string, inventoryProductId: string, globalProductId: string) {
  await apiFetch<InventoryProductDto>(`${inventoryBase(salonId)}/${INVENTORY_PATHS.products}/${inventoryProductId}/${CATALOG_PATHS.linkCatalog}`, { method: 'POST', body: JSON.stringify({ globalProductId }) });
}

export function ScanStockPanel({ salonId }: { salonId: string }) {
  const base = inventoryBase(salonId);
  const [code, setCode] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  const find = async (raw: string, hint?: 'UPC_E') => {
    const normalized = normalizeBarcode(raw, hint);
    if (!normalized.ok) { setError(normalized.reason); return; }
    setBusy(true); setError(null); setDone(null);
    try {
      const params = new URLSearchParams({ barcode: raw.replace(/[\s-]/g, ''), ...(hint ? { hint } : {}) });
      setLookup({ ...(await apiFetch<CatalogLookupResultDto>(`${base}/${CATALOG_PATHS.catalog}/${CATALOG_PATHS.lookup}?${params.toString()}`)), hint });
    } catch (err) {
      setLookup(null);
      setError(errorText(err, 'Could not look that barcode up. Check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async (message: { done?: string; error?: string }) => {
    if (!lookup) return;
    await find(lookup.barcode.display, lookup.hint);
    if (message.done) setDone(message.done);
    if (message.error) setError(message.error);
  };
  const openCamera = async () => {
    setError(null);
    const granted = permission?.granted || (await requestPermission()).granted;
    if (!granted) { setError('Camera permission was not given. Type the barcode instead.'); return; }
    handled.current = false;
    setScanning(true);
  };
  const candidates = lookup?.linkCandidates ?? [];
  const reset = () => { setLookup(null); setError(null); };

  return (
    <>
      <Card>
        <Text style={styles.heading}>Scan a product</Text>
        <Text style={styles.muted}>Scan the barcode on the pack with the camera, or type it (a Bluetooth scanner types it for you), to find it in the FastQue product catalog. Then add the stock you received.</Text>
        <Button title="Scan with camera" onPress={() => void openCamera()} disabled={busy} />
        <TextInput accessibilityLabel="Barcode" placeholder="Or type the barcode, e.g. 8901234567890" value={code} onChangeText={setCode} keyboardType="number-pad" returnKeyType="search" onSubmitEditing={() => void find(code)} style={styles.input} />
        <Button title={busy ? 'Looking up…' : 'Look up'} variant="outline" onPress={() => void find(code)} disabled={busy || !code.trim()} />
        {!!error && <InlineError message={error} />}
        {!!done && <Text style={styles.ok}>{done}</Text>}
      </Card>
      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={styles.cameraWrap}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'itf14'] }}
            onBarcodeScanned={(result) => {
              if (handled.current) return; // one code per opening, like the website scanner
              handled.current = true;
              setScanning(false);
              setCode(result.data);
              void find(result.data, result.type === 'upc_e' ? 'UPC_E' : undefined);
            }}
          />
          <Text style={styles.cameraHint}>Point the camera at the barcode. Nothing is saved or uploaded.</Text>
          <Button title="Close camera" variant="secondary" onPress={() => setScanning(false)} />
        </View>
      </Modal>
      {lookup && (lookup.status === 'FOUND' || lookup.status === 'FOUND_PENDING') && lookup.product && (
        <>
          <ProductCard product={lookup.product} stock={lookup.salonStock} />
          {lookup.salonStock.length === 0 && candidates.length > 0 && <LinkExisting salonId={salonId} candidates={candidates} globalProductId={lookup.product.id} onLinked={(name) => void refresh({ done: linkedText(name) })} />}
          <ReceiveForm key={lookup.product.id} salonId={salonId} catalogProductId={lookup.product.id} needsName={false} onDone={(t) => { setDone(t); reset(); }} />
          {lookup.salonStock.length > 0 && <WriteOffForm salonId={salonId} stock={lookup.salonStock} onDone={(t) => { setDone(t); reset(); }} />}
        </>
      )}
      {lookup?.status === 'PENDING_ELSEWHERE' && lookup.pendingProductId && (
        <>
          <Text style={styles.info}>{`Barcode ${lookup.barcode.display} was added by another salon and is waiting for FastQue to check it. You can still add it to your stock under your own product name.`}</Text>
          {lookup.salonStock.length === 0 && candidates.length > 0 && <LinkExisting salonId={salonId} candidates={candidates} globalProductId={lookup.pendingProductId} onLinked={(name) => void refresh({ done: linkedText(name) })} />}
          <ReceiveForm salonId={salonId} catalogProductId={lookup.pendingProductId} needsName onDone={(t) => { setDone(t); reset(); }} />
        </>
      )}
      {lookup && (lookup.status === 'NOT_FOUND' || lookup.status === 'EXTERNAL') && (
        <NewProductForm salonId={salonId} barcode={lookup.barcode.display} hint={lookup.hint} suggestion={lookup.suggestion} candidates={candidates} onCreated={(r) => void refresh(r)} />
      )}
    </>
  );
}

function ProductCard({ product, stock }: { product: CatalogProductDto; stock: CatalogLookupResultDto['salonStock'] }) {
  return (
    <Card>
      <Text style={styles.heading}>{`${product.name} · ${product.verificationStatus === 'VERIFIED' ? 'Verified' : 'Waiting for FastQue review'}`}</Text>
      <Text style={styles.muted}>{[product.brand, product.packSize && product.packUnit ? quantityText(product.packSize, product.packUnit) : null, product.mrp ? `MRP ₹${Number(product.mrp)}` : null, product.barcodes[0] ? `Barcode ${product.barcodes[0].display}` : null].filter(Boolean).join(' · ')}</Text>
      <Text style={styles.small}>{stock.length === 0 ? 'Not in your stock yet.' : stock.map((s) => `${SHELF[s.usage]}: ${quantityText(s.stockOnHand, s.unit)}`).join(' · ')}</Text>
    </Card>
  );
}

function LinkExisting({ salonId, candidates, globalProductId, onLinked }: { salonId: string; candidates: CatalogLinkCandidateDto[]; globalProductId: string; onLinked: (name: string) => void }) {
  const [choice, setChoice] = useState(candidates.find((c) => c.likelyMatch)?.inventoryProductId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = async () => {
    const chosen = candidates.find((c) => c.inventoryProductId === choice);
    if (!chosen) return;
    setBusy(true); setError(null);
    try { await linkBarcode(salonId, chosen.inventoryProductId, globalProductId); onLinked(chosen.name); }
    catch (err) { setError(errorText(err, 'The barcode was not linked — try again.')); }
    finally { setBusy(false); }
  };
  return (
    <Card>
      <Text style={styles.heading}>Already in your Products?</Text>
      <Text style={styles.muted}>If you added this product by hand before, link the barcode to it. Its stock and history stay as they are, and scans will find it.</Text>
      <Chips value={choice} onPick={setChoice} options={candidates.map((c) => ({ value: c.inventoryProductId, label: [c.name, c.sku ? `code ${c.sku}` : null, `${quantityText(c.stockOnHand, c.unit)} in stock`, c.likelyMatch ? 'looks like this barcode' : null].filter(Boolean).join(' · ') }))} />
      {!!error && <InlineError message={error} />}
      <Button title={busy ? 'Linking…' : 'Link barcode'} onPress={() => void link()} disabled={!choice || busy} />
    </Card>
  );
}

function ReceiveForm({ salonId, catalogProductId, needsName, onDone }: { salonId: string; catalogProductId: string; needsName: boolean; onDone: (text: string) => void }) {
  const lookups = useInventoryLookups(salonId);
  const keyRef = useRef(newIdempotencyKey());
  const [form, setForm] = useState({ name: '', usage: 'PROFESSIONAL' as StockUsage, unit: 'EACH' as InventoryUnit, quantity: '', unitCost: '', sellingPrice: '', supplierId: '', batchNumber: '', expiryDate: '', storageLocation: '', reorderThreshold: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    const quantity = num(form.quantity);
    const unitCost = num(form.unitCost);
    if (needsName && !form.name.trim()) { setError('Enter the product name you use in your shop.'); return; }
    if (!quantity || quantity <= 0) { setError('Enter how many you received.'); return; }
    if (unitCost === null || unitCost < 0 || Number.isNaN(unitCost)) { setError('Enter the price you paid for one unit.'); return; }
    const sellingPrice = num(form.sellingPrice);
    const reorder = num(form.reorderThreshold);
    if ([sellingPrice, reorder].some((v) => v !== null && (Number.isNaN(v) || v < 0))) { setError('Prices and the reorder level must be numbers.'); return; }
    if (form.expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.expiryDate)) { setError('Enter the expiry date as YYYY-MM-DD.'); return; }
    setBusy(true); setError(null);
    try {
      const result = await apiFetch<{ product: InventoryProductDto; movement: InventoryMovementDto }>(`${inventoryBase(salonId)}/${CATALOG_PATHS.receive}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': keyRef.current },
        body: JSON.stringify({
          globalProductId: catalogProductId,
          ...(needsName ? { name: form.name.trim() } : {}),
          usage: form.usage, unit: form.unit,
          quantity: Math.round(quantity * 1000) / 1000, unitCost: Math.round(unitCost * 100) / 100,
          ...(sellingPrice !== null ? { sellingPrice: Math.round(sellingPrice * 100) / 100 } : {}),
          ...(form.supplierId ? { supplierId: form.supplierId } : {}),
          ...(form.batchNumber.trim() ? { batchNumber: form.batchNumber.trim() } : {}),
          ...(form.expiryDate ? { expiryDate: form.expiryDate } : {}),
          ...(form.storageLocation.trim() ? { storageLocation: form.storageLocation.trim() } : {}),
          ...(reorder !== null ? { reorderThreshold: reorder } : {}),
        }),
      });
      keyRef.current = newIdempotencyKey();
      onDone(`Added ${quantityText(String(quantity), result.product.unit)} of ${result.product.name} (${SHELF[form.usage].toLowerCase()}). You now have ${quantityText(result.product.stockOnHand, result.product.unit)}.`);
    } catch (err) {
      setError(errorText(err, 'The stock was not added. Nothing changed — try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={styles.heading}>Add stock</Text>
      <Text style={styles.muted}>Stock goes up as a recorded entry in your stock history.</Text>
      {needsName && <Field label="Product name in your shop" value={form.name} onChange={(v) => set({ name: v })} max={120} />}
      <Chips value={form.usage} onPick={(v) => set({ usage: v })} options={(Object.keys(SHELF) as StockUsage[]).map((u) => ({ value: u, label: SHELF[u] }))} />
      <Text style={styles.label}>Counted in</Text>
      <Chips value={form.unit} onPick={(v) => set({ unit: v })} options={UNIT_OPTIONS.map((u) => ({ value: u.value as InventoryUnit, label: u.label }))} />
      <Field label={`How many (${unitShort(form.unit)})`} value={form.quantity} onChange={(v) => set({ quantity: v })} keyboard="decimal-pad" />
      <Field label={`Paid for one ${unitShort(form.unit)} (₹)`} value={form.unitCost} onChange={(v) => set({ unitCost: v })} keyboard="decimal-pad" />
      {form.usage === 'RETAIL' && <Field label="Selling price (₹, optional)" value={form.sellingPrice} onChange={(v) => set({ sellingPrice: v })} keyboard="decimal-pad" />}
      <Text style={styles.label}>Supplier (optional)</Text>
      <Chips value={form.supplierId} onPick={(v) => set({ supplierId: v })} options={[{ value: '', label: 'No supplier' }, ...lookups.suppliers.map((s) => ({ value: s.id, label: s.name }))]} />
      <Field label="Batch number (optional)" value={form.batchNumber} onChange={(v) => set({ batchNumber: v })} max={60} />
      <Field label="Expiry date YYYY-MM-DD (optional)" value={form.expiryDate} onChange={(v) => set({ expiryDate: v })} max={10} />
      <Field label="Storage place (optional)" value={form.storageLocation} onChange={(v) => set({ storageLocation: v })} max={80} />
      <Field label="Warn me at or below (optional)" value={form.reorderThreshold} onChange={(v) => set({ reorderThreshold: v })} keyboard="decimal-pad" />
      {!!error && <InlineError message={error} />}
      <Button title={busy ? 'Adding…' : 'Add stock'} onPress={() => void submit()} disabled={busy} />
    </Card>
  );
}

function WriteOffForm({ salonId, stock, onDone }: { salonId: string; stock: CatalogLookupResultDto['salonStock']; onDone: (text: string) => void }) {
  const [productId, setProductId] = useState(stock[0]?.inventoryProductId ?? '');
  const [kind, setKind] = useState<(typeof INVENTORY_LOSS_KINDS)[number]>('DAMAGE');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef(newIdempotencyKey());
  const chosen = stock.find((s) => s.inventoryProductId === productId) ?? stock[0];
  const submit = async () => {
    const q = num(quantity);
    if (!chosen || !q || q <= 0 || Number.isNaN(q)) { setError('Enter how much to write off.'); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch(`${inventoryBase(salonId)}/${INVENTORY_PATHS.products}/${chosen.inventoryProductId}/${INVENTORY_PATHS.movements}`, {
        method: 'POST', headers: { 'Idempotency-Key': keyRef.current },
        body: JSON.stringify({ kind, quantity: Math.round(q * 1000) / 1000, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      });
      keyRef.current = newIdempotencyKey();
      onDone(`Recorded ${quantityText(String(q), chosen.unit)} as ${kindLabel(kind).toLowerCase()}.`);
    } catch (err) {
      setError(errorText(err, 'Nothing was written off — try again.'));
    } finally {
      setBusy(false);
    }
  };
  if (!chosen) return null;
  return (
    <Card>
      <Text style={styles.heading}>Write off stock</Text>
      {stock.length > 1 && <Chips value={productId} onPick={setProductId} options={stock.map((s) => ({ value: s.inventoryProductId, label: `${SHELF[s.usage]} · ${quantityText(s.stockOnHand, s.unit)}` }))} />}
      <Chips value={kind} onPick={setKind} options={INVENTORY_LOSS_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))} />
      <Field label={`Quantity (${unitShort(chosen.unit)})`} value={quantity} onChange={setQuantity} keyboard="decimal-pad" />
      <Field label="Note (optional)" value={reason} onChange={setReason} max={300} />
      {!!error && <InlineError message={error} />}
      <Button title={busy ? 'Saving…' : 'Write off'} variant="outline" onPress={() => void submit()} disabled={busy} />
    </Card>
  );
}

function NewProductForm({ salonId, barcode, hint, suggestion, candidates, onCreated }: {
  salonId: string;
  barcode: string;
  hint?: 'UPC_E';
  suggestion: CatalogLookupResultDto['suggestion'];
  candidates: CatalogLinkCandidateDto[];
  onCreated: (r: { done?: string; error?: string }) => void;
}) {
  const likely = candidates.find((c) => c.likelyMatch);
  const [linkTo, setLinkTo] = useState(likely?.inventoryProductId ?? '');
  const [form, setForm] = useState({ name: suggestion?.name ?? likely?.name ?? '', brand: suggestion?.brand ?? '', category: suggestion?.category ?? '', packSize: '', packUnit: '' as InventoryUnit | '', mrp: '', productType: 'BOTH' as ProductType });
  const [photos, setPhotos] = useState<string[]>(suggestion?.imageUrl ? [suggestion.imageUrl] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const addPhoto = async () => {
    setError(null);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return;
    try {
      const { url } = await apiUploadImage<{ url: string }>(`${inventoryBase(salonId)}/${CATALOG_PATHS.catalog}/${CATALOG_PATHS.images}`, { uri: asset.uri, name: asset.fileName ?? 'product.jpg', type: asset.mimeType ?? 'image/jpeg' });
      setPhotos((p) => [...p, url]);
    } catch (err) {
      setError(errorText(err, 'The photo was not uploaded.'));
    }
  };

  const save = async () => {
    if (!form.name.trim()) { setError('Enter the product name.'); return; }
    const packSize = num(form.packSize);
    const mrp = num(form.mrp);
    if ([packSize, mrp].some((v) => v !== null && (Number.isNaN(v) || v <= 0))) { setError('Pack size and MRP must be numbers above 0.'); return; }
    setBusy(true); setError(null);
    try {
      const product = await apiFetch<CatalogProductDto>(`${inventoryBase(salonId)}/${CATALOG_PATHS.catalog}/${CATALOG_PATHS.products}`, {
        method: 'POST',
        body: JSON.stringify({
          barcode, ...(hint ? { barcodeHint: hint } : {}), name: form.name.trim(), brand: form.brand.trim() || null, category: form.category.trim() || null,
          packSize, packUnit: form.packUnit || null, mrp, productType: form.productType,
          dataSource: suggestion ? 'OPEN_BEAUTY_FACTS' : 'SALON_SUBMITTED', ...(suggestion ? { sourceReference: suggestion.sourceUrl } : {}), imageUrls: photos,
        }),
      });
      const chosen = candidates.find((c) => c.inventoryProductId === linkTo);
      if (!chosen) { onCreated({}); return; }
      try { await linkBarcode(salonId, chosen.inventoryProductId, product.id); onCreated({ done: linkedText(chosen.name) }); }
      catch (err) { onCreated({ error: errorText(err, `The product was saved, but the barcode wasn't linked to "${chosen.name}" — link it below.`) }); }
    } catch (err) {
      setError(errorText(err, 'The product was not saved — try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={styles.heading}>New product</Text>
      <Text style={styles.muted}>{`Barcode ${barcode} is not in the FastQue catalog yet. Add it; FastQue reviews it before other salons see it.`}</Text>
      <Field label="Product name" value={form.name} onChange={(v) => set({ name: v })} max={160} />
      <Field label="Brand (optional)" value={form.brand} onChange={(v) => set({ brand: v })} max={120} />
      <Field label="Category (optional)" value={form.category} onChange={(v) => set({ category: v })} max={80} />
      <Field label="Pack size (optional)" value={form.packSize} onChange={(v) => set({ packSize: v })} keyboard="decimal-pad" />
      <Chips value={form.packUnit} onPick={(v) => set({ packUnit: v })} options={[{ value: '' as InventoryUnit | '', label: 'No pack unit' }, ...UNIT_OPTIONS.map((u) => ({ value: u.value as InventoryUnit, label: u.label }))]} />
      <Field label="MRP (₹, optional)" value={form.mrp} onChange={(v) => set({ mrp: v })} keyboard="decimal-pad" />
      <Chips value={form.productType} onPick={(v) => set({ productType: v })} options={[{ value: 'PROFESSIONAL' as ProductType, label: 'Used on services' }, { value: 'RETAIL' as ProductType, label: 'Sold to customers' }, { value: 'BOTH' as ProductType, label: 'Both' }]} />
      <Button title={`Add a photo (${photos.length})`} variant="outline" onPress={() => void addPhoto()} disabled={busy} />
      {candidates.length > 0 && (
        <>
          <Text style={styles.label}>Link to one of your products (optional)</Text>
          <Chips value={linkTo} onPick={setLinkTo} options={[{ value: '', label: "Don't link" }, ...candidates.map((c) => ({ value: c.inventoryProductId, label: c.name }))]} />
        </>
      )}
      {!!error && <InlineError message={error} />}
      <Button title={busy ? 'Saving…' : 'Save product'} onPress={() => void save()} disabled={busy} />
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[1] },
  label: { fontFamily: font.bodyMedium, color: color.muted, fontSize: fontSize.xs, marginTop: space[2] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  small: { fontFamily: font.bodyRegular, color: color.ink, fontSize: fontSize.sm },
  info: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.accentSoft, padding: space[3], borderRadius: radius.sm, marginVertical: space[2] },
  ok: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.successSoft, padding: space[3], borderRadius: radius.sm, marginVertical: space[2] },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular, marginVertical: space[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginVertical: space[1] },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: 16, paddingHorizontal: space[3], paddingVertical: space[2], backgroundColor: color.surface },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  chipText: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.xs },
  cameraWrap: { flex: 1, backgroundColor: '#000', padding: space[4], gap: space[3], justifyContent: 'center' },
  camera: { flex: 1, borderRadius: radius.sm, overflow: 'hidden' },
  cameraHint: { color: '#fff', fontFamily: font.bodyMedium, fontSize: fontSize.sm, textAlign: 'center' },
});
