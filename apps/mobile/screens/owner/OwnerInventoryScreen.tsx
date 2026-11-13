import { InventoryHistoryPanel } from '../../components/owner/InventoryHistoryPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  InventoryUnit,
  Language,
  type CreateInventoryProductInput,
  type InventoryMovementDto,
  type InventoryPageDto,
  type InventoryProductDto,
  type InventoryReportDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { buildInventoryMovementInput, inventoryProductPath, inventoryProductsCollectionPath, inventoryProductsPath, inventoryReportPath, inventoryMovementsPath, parseInventoryNumber } from '../../lib/inventory';
import { buildMovement } from '../../lib/inventory-shared';
import { useInventoryLookups } from '../../lib/use-inventory-lookups';
import { CategoriesPanel, ProductEditor, SuppliersPanel } from '../../components/owner/InventoryLookups';
import { ProductUsagePanel, RecipesPanel } from '../../components/owner/InventoryUsagePanels';
import { PredictionsPanel } from '../../components/owner/InventoryPredictions';
import { InventoryAnalyticsPanel, InventoryDashboardPanel } from '../../components/owner/InventoryInsights';
import { ScanStockPanel } from '../../components/owner/ScanStockPanel';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, EmptyState, InlineError, Screen, SectionHeader, Skeleton } from '../../components/ui';

const COPY = {
  en: {
    title: 'Inventory', subtitle: 'Stock and movement history for your selected shop.',
    products: 'Products', addProduct: 'Add product', name: 'Product name', threshold: 'Low-stock threshold',
    unit: 'Unit', units: 'Each, gram, kilogram, milliliter, liter, pack, box or other',
    search: 'Search products', searchHint: 'Name, SKU or barcode', searchAction: 'Search',
    lowStock: 'Show low stock', allStock: 'Show all stock', low: 'Low stock', stock: 'On hand',
    value: 'Estimated stock value', itemCount: 'Products', lowCount: 'Low-stock products',
    purchase: 'Purchase', opening: 'Opening stock', adjustment: 'Adjustment', consumption: 'Used in shop', supplier: 'Supplier (optional)', noSupplier: 'No supplier', reference: 'Bill or invoice number (optional)', note: 'Note (optional)', consumptionHint: 'The server refuses this if there is not enough stock, and then nothing is recorded.', edit: 'Edit', stockTab: 'Stock', categoriesTab: 'Categories', suppliersTab: 'Suppliers', recipesTab: 'Service recipes', usageTab: 'Product usage', predictionsTab: 'Predictions', overviewTab: 'Overview', reportsTab: 'Reports', scanTab: 'Scan / add stock', quantity: 'Quantity',
    unitCost: 'Unit cost', direction: 'Increase or decrease', increase: 'Increase', decrease: 'Decrease',
    reason: 'Reason (required for adjustment)', saveMovement: 'Record stock movement',
    add: 'Save product', more: 'Load more', history: 'Movement history', hideHistory: 'Hide history',
    noProducts: 'No products found', noStock: 'No inventory products have been added.',
    loading: 'Loading inventory…', retry: 'Try again', invalidName: 'Enter a product name.',
    invalidThreshold: 'Enter a valid non-negative threshold.', invalidQuantity: 'Enter a quantity greater than zero.',
    invalidCost: 'Enter a valid non-negative unit cost.', invalidReason: 'Enter a reason for this adjustment.',
    savedProduct: 'Product added. Record its opening stock or a purchase below.',
    savedMovement: 'Stock movement recorded.', error: 'Could not complete the inventory request.',
    noHistory: 'No movements recorded for this product.', failed: 'Could not load inventory.',
  },
  hi: {
    title: 'इन्वेंटरी', subtitle: 'चुनी गई दुकान का स्टॉक और मूवमेंट इतिहास।',
    products: 'उत्पाद', addProduct: 'उत्पाद जोड़ें', name: 'उत्पाद का नाम', threshold: 'कम स्टॉक सीमा',
    unit: 'इकाई', units: 'प्रति, ग्राम, किलोग्राम, मिलीलीटर, लीटर, पैक, बॉक्स या अन्य',
    search: 'उत्पाद खोजें', searchHint: 'नाम, SKU या बारकोड', searchAction: 'खोजें',
    lowStock: 'कम स्टॉक दिखाएँ', allStock: 'सभी स्टॉक दिखाएँ', low: 'कम स्टॉक', stock: 'मौजूद',
    value: 'अनुमानित स्टॉक मूल्य', itemCount: 'उत्पाद', lowCount: 'कम स्टॉक वाले उत्पाद',
    purchase: 'खरीद', opening: 'शुरुआती स्टॉक', adjustment: 'समायोजन', consumption: 'दुकान में उपयोग', supplier: 'सप्लायर (वैकल्पिक)', noSupplier: 'कोई सप्लायर नहीं', reference: 'बिल या इनवॉइस नंबर (वैकल्पिक)', note: 'नोट (वैकल्पिक)', consumptionHint: 'स्टॉक कम हो तो सर्वर इसे मना करता है और कुछ दर्ज नहीं होता।', edit: 'संपादित करें', stockTab: 'स्टॉक', categoriesTab: 'श्रेणियाँ', suppliersTab: 'सप्लायर', recipesTab: 'सेवा रेसिपी', usageTab: 'उत्पाद उपयोग', predictionsTab: 'अनुमान', overviewTab: 'सारांश', reportsTab: 'रिपोर्ट', scanTab: 'स्कैन / स्टॉक जोड़ें', quantity: 'मात्रा',
    unitCost: 'प्रति इकाई लागत', direction: 'बढ़ाएँ या घटाएँ', increase: 'बढ़ाएँ', decrease: 'घटाएँ',
    reason: 'कारण (समायोजन के लिए ज़रूरी)', saveMovement: 'स्टॉक मूवमेंट दर्ज करें',
    add: 'उत्पाद सहेजें', more: 'और लोड करें', history: 'मूवमेंट इतिहास', hideHistory: 'इतिहास छिपाएँ',
    noProducts: 'कोई उत्पाद नहीं मिला', noStock: 'अभी कोई इन्वेंटरी उत्पाद नहीं जोड़ा गया।',
    loading: 'इन्वेंटरी लोड हो रही है…', retry: 'फिर कोशिश करें', invalidName: 'उत्पाद का नाम लिखें।',
    invalidThreshold: 'मान्य शून्य या अधिक सीमा लिखें।', invalidQuantity: 'शून्य से अधिक मात्रा लिखें।',
    invalidCost: 'मान्य शून्य या अधिक लागत लिखें।', invalidReason: 'समायोजन का कारण लिखें।',
    savedProduct: 'उत्पाद जोड़ा गया। नीचे शुरुआती स्टॉक या खरीद दर्ज करें।',
    savedMovement: 'स्टॉक मूवमेंट दर्ज हुआ।', error: 'इन्वेंटरी अनुरोध पूरा नहीं हुआ।',
    noHistory: 'इस उत्पाद के लिए कोई मूवमेंट दर्ज नहीं है।', failed: 'इन्वेंटरी लोड नहीं हो सकी।',
  },
} as const;

type MovementKind = 'OPENING' | 'PURCHASE' | 'CONSUMPTION' | 'ADJUSTMENT';
type Direction = 'INCREASE' | 'DECREASE';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function OwnerInventoryScreen() {
  const { selectedSalonId } = useSalon();
  const { language } = useLanguage();
  const copy = COPY[language === Language.HI ? 'hi' : 'en'];
  const requestSequence = useRef(0);
  const [tab, setTab] = useState<'overview' | 'scan' | 'stock' | 'categories' | 'suppliers' | 'recipes' | 'usage' | 'predictions' | 'reports' | 'history'>('stock');
  const [editing, setEditing] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const lookups = useInventoryLookups(selectedSalonId ?? '');
  const [report, setReport] = useState<InventoryReportDto | null>(null);
  const [products, setProducts] = useState<InventoryProductDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [productName, setProductName] = useState('');
  const [unit, setUnit] = useState<CreateInventoryProductInput['unit']>(InventoryUnit.EACH);
  const [threshold, setThreshold] = useState('0');
  const [movementProductId, setMovementProductId] = useState<string | null>(null);
  const [movementKind, setMovementKind] = useState<MovementKind>('PURCHASE');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [adjustmentDirection, setAdjustmentDirection] = useState<Direction>('INCREASE');
  const [reason, setReason] = useState('');
  const [movementKey, setMovementKey] = useState(newIdempotencyKey());
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<InventoryMovementDto[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedSalonId) {
      setLoading(false);
      setReport(null);
      setProducts([]);
      return;
    }
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const [nextReport, page] = await Promise.all([
        apiFetch<InventoryReportDto>(inventoryReportPath(selectedSalonId)),
        apiFetch<InventoryPageDto<InventoryProductDto>>(inventoryProductsPath(selectedSalonId, { q: search, lowStock: lowStockOnly })),
      ]);
      if (sequence !== requestSequence.current) return;
      setReport(nextReport);
      setProducts(page.items);
      setNextCursor(page.nextCursor);
    } catch (loadError) {
      if (sequence === requestSequence.current) setError(errorMessage(loadError, copy.failed));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [selectedSalonId, search, lowStockOnly, copy.failed]);

  useEffect(() => {
    setHistory([]);
    setHistoryFor(null);
    setHistoryError(null);
    setMovementProductId(null);
    setFormError(null);
  }, [selectedSalonId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        requestSequence.current += 1;
      };
    }, [load]),
  );

  const loadMore = useCallback(async () => {
    if (!selectedSalonId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const requestSequenceAtStart = requestSequence.current;
      const page = await apiFetch<InventoryPageDto<InventoryProductDto>>(
        inventoryProductsPath(selectedSalonId, { q: search, lowStock: lowStockOnly, cursor: nextCursor }),
      );
      if (requestSequenceAtStart !== requestSequence.current) return;
      setProducts((current) => {
        const seen = new Set(current.map((product) => product.id));
        return [...current, ...page.items.filter((product) => !seen.has(product.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (loadError) {
      setError(errorMessage(loadError, copy.failed));
    } finally {
      setLoadingMore(false);
    }
  }, [selectedSalonId, nextCursor, loadingMore, search, lowStockOnly, copy.failed]);

  const addProduct = useCallback(async () => {
    setFormError(null);
    if (!selectedSalonId) return;
    const name = productName.trim();
    const reorderThreshold = parseInventoryNumber(threshold, true);
    if (!name) return setFormError(copy.invalidName);
    if (reorderThreshold === null) return setFormError(copy.invalidThreshold);
    setSavingProduct(true);
    try {
      const created = await apiFetch<InventoryProductDto>(
        inventoryProductsCollectionPath(selectedSalonId),
        {
          method: 'POST',
          body: JSON.stringify({ name, unit, reorderThreshold } satisfies CreateInventoryProductInput),
        },
      );
      setProductName('');
      setThreshold('0');
      setMovementProductId(created.id);
      setMovementKind('OPENING');
      setQuantity('');
      setUnitCost('');
      setMovementKey(newIdempotencyKey());
      await load();
    } catch (saveError) {
      setFormError(errorMessage(saveError, copy.error));
    } finally {
      setSavingProduct(false);
    }
  }, [productName, threshold, unit, selectedSalonId, copy, load]);

  const openMovement = (productId: string) => {
    setMovementProductId((current) => current === productId ? null : productId);
    setMovementKind('PURCHASE');
    setQuantity('');
    setUnitCost('');
    setReason('');
    setMovementKey(newIdempotencyKey());
    setFormError(null);
  };

  const loadHistory = useCallback(async (productId: string) => {
    if (!selectedSalonId) return;
    setHistoryError(null);
    const sequence = requestSequence.current;
    try {
      const page = await apiFetch<InventoryPageDto<InventoryMovementDto>>(
        inventoryMovementsPath(selectedSalonId, productId),
      );
      if (sequence !== requestSequence.current) return;
      setHistory(page.items);
      setHistoryFor(productId);
    } catch (historyLoadError) {
      setHistoryError(errorMessage(historyLoadError, copy.failed));
    }
  }, [selectedSalonId, copy.failed]);

  const saveMovement = useCallback(async () => {
    if (!selectedSalonId || !movementProductId) return;
    setFormError(null);
    // Website rules (lib/inventory-shared buildMovement): every kind the website records, with the
    // optional supplier and bill number on a purchase and a note/reference on consumption.
    const { body: input, errors: found } = buildMovement(movementKind, { quantity, unitCost, supplierId, direction: movementKind === 'ADJUSTMENT' ? adjustmentDirection : '', reason, reference });
    if (!input) {
      if (found.quantity) return setFormError(copy.invalidQuantity);
      if (found.unitCost) return setFormError(copy.invalidCost);
      return setFormError(found.reason ?? found.reference ?? found.direction ?? copy.invalidReason);
    }
    setSavingMovement(true);
    try {
      await apiFetch<unknown>(
        inventoryProductPath(selectedSalonId, movementProductId),
        {
          method: 'POST',
          headers: { 'Idempotency-Key': movementKey },
          body: JSON.stringify(input),
        },
      );
      setQuantity('');
      setUnitCost('');
      setReason('');
      setReference('');
      setSupplierId('');
      setMovementKey(newIdempotencyKey());
      await load();
      if (historyFor === movementProductId) await loadHistory(movementProductId);
      Alert.alert(copy.title, copy.savedMovement);
    } catch (saveError) {
      // Keep the same key after a failed attempt so a retry cannot duplicate a movement that the
      // server committed before a connection failure.
      setFormError(errorMessage(saveError, copy.error));
    } finally {
      setSavingMovement(false);
    }
  }, [selectedSalonId, movementProductId, movementKind, quantity, unitCost, adjustmentDirection, reason, reference, supplierId, movementKey, copy, load, historyFor, loadHistory]);

  if (!selectedSalonId) {
    return <Screen scroll={false}><EmptyState title={copy.title} message="Select an owner shop to manage stock." /></Screen>;
  }
  if (loading) {
    return <Screen><Skeleton style={styles.skeleton} /><Skeleton style={styles.skeleton} /></Screen>;
  }
  if (error && !report) {
    return <Screen scroll={false}><InlineError message={error} /><Button title={copy.retry} onPress={() => void load()} variant="outline" /></Screen>;
  }

  const unitOptions = Object.values(InventoryUnit);

  return (
    <Screen contentStyle={styles.content} refreshing={loading} onRefresh={() => void load()}>
      <SectionHeader eyebrow="OWNER" title={copy.title} subtitle={copy.subtitle} />
      <View style={styles.filterRow}>
        {(['overview', 'scan', 'stock', 'history', 'categories', 'suppliers', 'recipes', 'usage', 'predictions', 'reports'] as const).map((id) => (
          <Button key={id} title={id === 'history' ? 'History' : id === 'overview' ? copy.overviewTab : id === 'scan' ? copy.scanTab : id === 'reports' ? copy.reportsTab : id === 'stock' ? copy.stockTab : id === 'categories' ? copy.categoriesTab : id === 'suppliers' ? copy.suppliersTab : id === 'recipes' ? copy.recipesTab : id === 'usage' ? copy.usageTab : copy.predictionsTab} variant={tab === id ? 'secondary' : 'outline'} onPress={() => setTab(id)} style={styles.filterButton} />
        ))}
      </View>
      {tab === 'categories' && <CategoriesPanel salonId={selectedSalonId} />}
      {tab === 'suppliers' && <SuppliersPanel salonId={selectedSalonId} />}
      {tab === 'recipes' && <RecipesPanel salonId={selectedSalonId} />}
      {tab === 'usage' && <ProductUsagePanel salonId={selectedSalonId} />}
      {tab === 'predictions' && <PredictionsPanel salonId={selectedSalonId} />}
      {tab === 'overview' && <InventoryDashboardPanel salonId={selectedSalonId} onOpenUsage={() => setTab('usage')} />}
      {tab === 'reports' && <InventoryAnalyticsPanel salonId={selectedSalonId} />}
      {tab === 'scan' && <ScanStockPanel salonId={selectedSalonId} />}
      {tab === 'history' && <InventoryHistoryPanel salonId={selectedSalonId} currency={report?.currency ?? null} />}
      {tab === 'stock' && (<>
      {error ? <InlineError message={error} /> : null}
      {report ? (
        <View style={styles.metrics}>
          <Card style={styles.metric}><Text style={styles.metricValue}>{report.productCount}</Text><Text style={styles.metricLabel}>{copy.itemCount}</Text></Card>
          <Card style={styles.metric}><Text style={styles.metricValue}>{report.lowStockCount}</Text><Text style={styles.metricLabel}>{copy.lowCount}</Text></Card>
          <Card style={styles.metric}><Text style={styles.metricValue}>{report.currency ?? ''} {report.estimatedStockValue}</Text><Text style={styles.metricLabel}>{copy.value}</Text></Card>
        </View>
      ) : null}

      <Card style={styles.form}>
        <Text style={styles.sectionTitle}>{copy.addProduct}</Text>
        <TextInput testID="inventory-create-name" accessibilityLabel={copy.name} value={productName} onChangeText={setProductName} placeholder={copy.name} style={styles.input} maxLength={120} />
        <Text style={styles.label}>{copy.unit}: {unit}</Text>
        <View style={styles.wrap}>
          {unitOptions.map((option) => (
            <Button key={option} title={option} variant={unit === option ? 'secondary' : 'outline'} onPress={() => setUnit(option)} style={styles.choice} />
          ))}
        </View>
        <TextInput testID="inventory-create-threshold" accessibilityLabel={copy.threshold} value={threshold} onChangeText={setThreshold} placeholder={copy.threshold} keyboardType="decimal-pad" style={styles.input} />
        {formError ? <InlineError message={formError} /> : null}
        <Button title={copy.add} onPress={() => void addProduct()} loading={savingProduct} style={styles.action} />
      </Card>

      <Card style={styles.form}>
        <Text style={styles.sectionTitle}>{copy.products}</Text>
        <TextInput testID="inventory-search" accessibilityLabel={copy.searchHint} value={searchDraft} onChangeText={setSearchDraft} placeholder={copy.searchHint} style={styles.input} returnKeyType="search" onSubmitEditing={() => setSearch(searchDraft.trim())} />
        <View style={styles.filterRow}>
          <Button title={copy.searchAction} variant="outline" onPress={() => setSearch(searchDraft.trim())} style={styles.filterButton} />
          <Button title={lowStockOnly ? copy.allStock : copy.lowStock} variant="outline" onPress={() => setLowStockOnly((value) => !value)} style={styles.filterButton} />
        </View>
        {products.length === 0 ? <Text style={styles.empty}>{copy.noProducts}</Text> : products.map((product) => (
          <View key={product.id} style={styles.product}>
            <View style={styles.productHeading}>
              <View style={styles.productBody}>
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.meta}>{product.sku ?? product.category?.name ?? product.unit}</Text>
              </View>
              {product.isLowStock ? <Text style={styles.lowBadge}>{copy.low}</Text> : null}
            </View>
            <Text style={styles.stock}>{copy.stock}: {product.stockOnHand} {product.unit}</Text>
            <View style={styles.filterRow}>
              <Button title={copy.purchase} variant="outline" onPress={() => openMovement(product.id)} style={styles.filterButton} />
              <Button title={historyFor === product.id ? copy.hideHistory : copy.history} variant="outline" onPress={() => historyFor === product.id ? setHistoryFor(null) : void loadHistory(product.id)} style={styles.filterButton} />
              <Button title={copy.edit} variant="outline" onPress={() => setEditing(editing === product.id ? null : product.id)} style={styles.filterButton} />
            </View>
            {editing === product.id ? <ProductEditor salonId={selectedSalonId} product={product} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
            {movementProductId === product.id ? (
              <View style={styles.movementForm}>
                <Text style={styles.label}>{copy.adjustment}: {movementKind}</Text>
                <View style={styles.wrap}>
                  {(['OPENING', 'PURCHASE', 'CONSUMPTION', 'ADJUSTMENT'] as const).map((kind) => (
                    <Button key={kind} title={kind === 'OPENING' ? copy.opening : kind === 'PURCHASE' ? copy.purchase : kind === 'CONSUMPTION' ? copy.consumption : copy.adjustment} variant={movementKind === kind ? 'secondary' : 'outline'} onPress={() => setMovementKind(kind)} style={styles.choice} />
                  ))}
                </View>
                <TextInput testID="inventory-movement-quantity" accessibilityLabel={copy.quantity} value={quantity} onChangeText={setQuantity} placeholder={copy.quantity} keyboardType="decimal-pad" style={styles.input} />
                {movementKind === 'PURCHASE' ? (
                  <>
                    <Text style={styles.label}>{copy.supplier}</Text>
                    <View style={styles.wrap}>
                      {[{ id: '', name: copy.noSupplier }, ...lookups.suppliers].map((s) => (
                        <Button key={s.id || 'none'} title={s.name} variant={supplierId === s.id ? 'secondary' : 'outline'} onPress={() => setSupplierId(s.id)} style={styles.choice} />
                      ))}
                    </View>
                  </>
                ) : null}
                {movementKind === 'PURCHASE' || movementKind === 'CONSUMPTION' ? (
                  <>
                    <TextInput accessibilityLabel={copy.note} value={reason} onChangeText={setReason} placeholder={copy.note} style={styles.input} maxLength={300} />
                    <TextInput accessibilityLabel={copy.reference} value={reference} onChangeText={setReference} placeholder={copy.reference} style={styles.input} maxLength={120} />
                  </>
                ) : null}
                {movementKind === 'CONSUMPTION' ? <Text style={styles.meta}>{copy.consumptionHint}</Text> : null}
                {movementKind === 'CONSUMPTION' ? null : movementKind !== 'ADJUSTMENT' ? <TextInput testID="inventory-movement-cost" accessibilityLabel={copy.unitCost} value={unitCost} onChangeText={setUnitCost} placeholder={copy.unitCost} keyboardType="decimal-pad" style={styles.input} /> : (
                  <>
                    <Text style={styles.label}>{copy.direction}</Text>
                    <View style={styles.filterRow}>
                      <Button title={copy.increase} variant={adjustmentDirection === 'INCREASE' ? 'secondary' : 'outline'} onPress={() => setAdjustmentDirection('INCREASE')} style={styles.filterButton} />
                      <Button title={copy.decrease} variant={adjustmentDirection === 'DECREASE' ? 'secondary' : 'outline'} onPress={() => setAdjustmentDirection('DECREASE')} style={styles.filterButton} />
                    </View>
                    <TextInput testID="inventory-movement-reason" accessibilityLabel={copy.reason} value={reason} onChangeText={setReason} placeholder={copy.reason} style={styles.input} maxLength={300} />
                  </>
                )}
                {formError ? <InlineError message={formError} /> : null}
                <Button title={copy.saveMovement} onPress={() => void saveMovement()} loading={savingMovement} style={styles.action} />
              </View>
            ) : null}
            {historyFor === product.id ? (
              <View style={styles.history}>
                <Text style={styles.label}>{copy.history}</Text>
                {historyError ? <InlineError message={historyError} /> : history.length === 0 ? <Text style={styles.empty}>{copy.noHistory}</Text> : history.map((movement) => (
                  <View key={movement.id} style={styles.historyRow}>
                    <Text style={styles.meta}>{movement.kind} · {movement.recordedAt.slice(0, 10)}</Text>
                    <Text style={styles.stock}>{movement.quantityDelta} → {movement.stockAfter} {product.unit}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}
        {nextCursor ? <Button title={copy.more} onPress={() => void loadMore()} loading={loadingMore} variant="outline" style={styles.action} /> : null}
      </Card>
      </>)}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space[5] },
  skeleton: { height: 110, borderRadius: radius.lg, marginBottom: space[3] },
  metrics: { gap: space[3], marginBottom: space[4] },
  metric: { padding: space[4] },
  metricValue: { color: color.ink, fontFamily: font.bodyBold, fontSize: fontSize.lg },
  metricLabel: { color: color.muted, fontFamily: font.bodyRegular, fontSize: fontSize.xs, marginTop: space[1] },
  form: { marginBottom: space[4] },
  sectionTitle: { color: color.ink, fontFamily: font.bodyBold, fontSize: fontSize.base, marginBottom: space[3] },
  label: { color: color.ink, fontFamily: font.bodyMedium, fontSize: fontSize.sm, marginBottom: space[2] },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: space[3], marginBottom: space[3], color: color.ink, backgroundColor: '#fff' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[3] },
  choice: { minHeight: 40, paddingHorizontal: space[3] },
  action: { marginTop: space[3] },
  filterRow: { flexDirection: 'row', gap: space[2], marginTop: space[2], marginBottom: space[2] },
  filterButton: { flex: 1 },
  empty: { color: color.muted, fontFamily: font.bodyRegular, fontSize: fontSize.sm, paddingVertical: space[3] },
  product: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border, paddingTop: space[3], marginTop: space[3] },
  productHeading: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  productBody: { flex: 1 },
  productName: { color: color.ink, fontFamily: font.bodyBold, fontSize: fontSize.base },
  meta: { color: color.muted, fontFamily: font.bodyRegular, fontSize: fontSize.xs, marginTop: space[1] },
  stock: { color: color.ink, fontFamily: font.bodyMedium, fontSize: fontSize.sm, marginTop: space[2] },
  lowBadge: { color: '#8f302d', backgroundColor: color.accentSoft, borderRadius: radius.sm, overflow: 'hidden', paddingHorizontal: space[2], paddingVertical: space[1], fontFamily: font.bodyBold, fontSize: fontSize.xs },
  movementForm: { backgroundColor: color.surface, borderRadius: radius.md, padding: space[3], marginTop: space[3] },
  history: { backgroundColor: color.surface, borderRadius: radius.md, padding: space[3], marginTop: space[3] },
  historyRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border, paddingVertical: space[2] },
});
