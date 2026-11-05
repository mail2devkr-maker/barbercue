import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  createInventoryCategorySchema,
  createInventoryMovementSchema,
  createInventoryProductSchema,
  createInventorySupplierSchema,
  formatMoney,
  INVENTORY_PATHS,
  InventoryMovementKind,
  InventoryUnit,
  type InventoryUnit as InventoryUnitValue,
  type InventoryCategoryDto,
  type CreateInventoryMovementInput,
  type InventorySupplierDto,
  type InventoryMovementDto,
  type InventoryPageDto,
  type InventoryProductDto,
  updateInventoryProductSchema,
  type InventoryReportDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { dateLocaleFor } from '../../lib/date-locale';
import { useLanguage } from '../../lib/language-context';
import { newIdempotencyKey } from '../../lib/idempotency';
import { useSalon } from '../../lib/salon-context';
import { fastQue, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumCard, PremiumScreen, PremiumSectionHeader, Skeleton } from '../../components/ui';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

type Props = NativeStackScreenProps<OwnerShopStackParamList, 'OwnerInventory'>;
type ProductMode = 'all' | 'low-stock';
type ManagementMode = 'product' | 'category' | 'supplier' | null;
type MovementFormState = {
  product: InventoryProductDto;
  kind: InventoryMovementDto['kind'];
  quantity: string;
  unitCost: string;
  adjustmentDirection: 'INCREASE' | 'DECREASE';
  reason: string;
  reference: string;
};
type MovementRequestSnapshot = { fingerprint: string; key: string };
const PAGE_SIZE = 25;

const copy = {
  EN: {
    title: 'Inventory', subtitle: 'Stock and recorded movement history for this shop.',
    products: 'Products', lowStock: 'Low stock', history: 'Recent stock history',
    value: 'Estimated stock value', valuation: 'Weighted-average cost; an inventory estimate, not revenue.',
    productCount: 'Products', lowCount: 'Low stock', emptyProducts: 'No inventory products are recorded for this shop.',
    emptyHistory: 'No stock movements have been recorded.', loadMore: 'Load more', loading: 'Loading…',
    lowBadge: 'Low stock', inactive: 'Inactive', currentStock: 'On hand', after: 'Stock after',
    opening: 'Opening stock', purchase: 'Purchase', consumption: 'Consumption', adjustment: 'Adjustment',
    retry: 'Could not load inventory. Please try again.', selectedShop: 'Choose a shop to view its inventory.',
    recordMovement: 'Record stock movement', movementTitle: 'Record stock movement', movementType: 'Movement type',
    quantity: 'Quantity', unitCost: 'Cost per unit', direction: 'Direction', increase: 'Increase', decrease: 'Decrease',
    reason: 'Reason', reference: 'Reference (optional)', reviewMovement: 'Review movement', saving: 'Recording…',
    cancel: 'Cancel', confirmTitle: 'Confirm stock movement', confirmPrefix: 'Record this stock change for',
    saved: 'Stock movement recorded. Inventory refreshed.', invalidMovement: 'Check the stock movement details.',
    alreadyRecorded: 'This stock movement was already recorded. Inventory refreshed.', costRequired: 'Enter a unit cost, or enter 0 explicitly.',
    addProduct: 'Add product', addCategory: 'Add category', addSupplier: 'Add supplier',
    editProduct: 'Edit product', productUpdated: 'Product details updated.', active: 'Active', inactiveStatus: 'Inactive',
    productName: 'Product name', sku: 'SKU (optional)', unit: 'Unit', category: 'Category', supplier: 'Supplier',
    none: 'None', reorderThreshold: 'Low-stock threshold', save: 'Save', creating: 'Saving…',
    productCreated: 'Product created. Record opening stock to set its on-hand quantity.',
    productHelp: 'New products start at zero stock. Record opening stock to set the on-hand quantity.',
    categoryCreated: 'Category created.', supplierCreated: 'Supplier created.',
    managementInvalid: 'Check the inventory details.', lookupRetry: 'Could not load inventory categories and suppliers.',
    contactName: 'Contact name (optional)', phone: 'Phone (optional)', email: 'Email (optional)', notes: 'Notes (optional)',
    loadMoreCategories: 'Load more categories', loadMoreSuppliers: 'Load more suppliers',
  },
  HI: {
    title: 'इन्वेंटरी', subtitle: 'इस दुकान का स्टॉक और दर्ज गतिविधि इतिहास।',
    products: 'उत्पाद', lowStock: 'कम स्टॉक', history: 'हाल की स्टॉक गतिविधि',
    value: 'अनुमानित स्टॉक मूल्य', valuation: 'भारित औसत लागत; यह इन्वेंटरी का अनुमान है, आय नहीं।',
    productCount: 'उत्पाद', lowCount: 'कम स्टॉक', emptyProducts: 'इस दुकान के लिए इन्वेंटरी उत्पाद दर्ज नहीं हैं।',
    emptyHistory: 'स्टॉक गतिविधि दर्ज नहीं की गई है।', loadMore: 'और देखें', loading: 'लोड हो रहा है…',
    lowBadge: 'कम स्टॉक', inactive: 'निष्क्रिय', currentStock: 'मौजूदा स्टॉक', after: 'बाद का स्टॉक',
    opening: 'आरंभिक स्टॉक', purchase: 'खरीद', consumption: 'उपयोग', adjustment: 'समायोजन',
    retry: 'इन्वेंटरी लोड नहीं हो सकी। फिर से प्रयास करें।', selectedShop: 'इन्वेंटरी देखने के लिए दुकान चुनें।',
    recordMovement: 'स्टॉक गतिविधि दर्ज करें', movementTitle: 'स्टॉक गतिविधि दर्ज करें', movementType: 'गतिविधि का प्रकार',
    quantity: 'मात्रा', unitCost: 'प्रति इकाई लागत', direction: 'दिशा', increase: 'बढ़ाएँ', decrease: 'घटाएँ',
    reason: 'कारण', reference: 'संदर्भ (वैकल्पिक)', reviewMovement: 'गतिविधि की समीक्षा', saving: 'दर्ज हो रहा है…',
    cancel: 'रद्द करें', confirmTitle: 'स्टॉक गतिविधि की पुष्टि करें', confirmPrefix: 'इस उत्पाद के लिए स्टॉक परिवर्तन दर्ज करें:',
    saved: 'स्टॉक गतिविधि दर्ज हुई। इन्वेंटरी रीफ़्रेश की गई।', invalidMovement: 'स्टॉक गतिविधि का विवरण जाँचें।',
    alreadyRecorded: 'यह स्टॉक गतिविधि पहले से दर्ज है। इन्वेंटरी रीफ़्रेश की गई।', costRequired: 'प्रति इकाई लागत दर्ज करें, या स्पष्ट रूप से 0 लिखें।',
    addProduct: 'उत्पाद जोड़ें', addCategory: 'श्रेणी जोड़ें', addSupplier: 'आपूर्तिकर्ता जोड़ें',
    editProduct: 'उत्पाद संपादित करें', productUpdated: 'उत्पाद का विवरण अपडेट हुआ।', active: 'सक्रिय', inactiveStatus: 'निष्क्रिय',
    productName: 'उत्पाद का नाम', sku: 'SKU (वैकल्पिक)', unit: 'इकाई', category: 'श्रेणी', supplier: 'आपूर्तिकर्ता',
    none: 'कोई नहीं', reorderThreshold: 'कम-स्टॉक सीमा', save: 'सहेजें', creating: 'सहेज रहा है…',
    productCreated: 'उत्पाद बनाया गया। मौजूदा स्टॉक तय करने के लिए आरंभिक स्टॉक दर्ज करें।',
    productHelp: 'नए उत्पाद का स्टॉक शून्य से शुरू होता है। मौजूदा मात्रा तय करने के लिए आरंभिक स्टॉक दर्ज करें।',
    categoryCreated: 'श्रेणी बनाई गई।', supplierCreated: 'आपूर्तिकर्ता बनाया गया।',
    managementInvalid: 'इन्वेंटरी का विवरण जाँचें।', lookupRetry: 'इन्वेंटरी की श्रेणियाँ और आपूर्तिकर्ता लोड नहीं हो सके।',
    contactName: 'संपर्क नाम (वैकल्पिक)', phone: 'फ़ोन (वैकल्पिक)', email: 'ईमेल (वैकल्पिक)', notes: 'नोट्स (वैकल्पिक)',
    loadMoreCategories: 'और श्रेणियाँ देखें', loadMoreSuppliers: 'और आपूर्तिकर्ता देखें',
  },
} as const;

function rootPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${INVENTORY_PATHS.root}`;
}

function queryPath(path: string, query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  return `${path}?${params.toString()}`;
}

function movementPath(salonId: string, productId: string): string {
  return `${rootPath(salonId)}/${INVENTORY_PATHS.products}/${encodeURIComponent(productId)}/${INVENTORY_PATHS.movements}`;
}

function movementLabel(kind: InventoryMovementDto['kind'], labels: (typeof copy)['EN'] | (typeof copy)['HI']): string {
  switch (kind) {
    case 'OPENING': return labels.opening;
    case 'PURCHASE': return labels.purchase;
    case 'CONSUMPTION': return labels.consumption;
    default: return labels.adjustment;
  }
}

export default function OwnerInventoryScreen(_props: Props) {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { language } = useLanguage();
  const labels = language === 'HI' ? copy.HI : copy.EN;
  const [mode, setMode] = useState<ProductMode>('all');
  const [report, setReport] = useState<InventoryReportDto | null>(null);
  const [products, setProducts] = useState<InventoryProductDto[]>([]);
  const [movements, setMovements] = useState<InventoryMovementDto[]>([]);
  const [productCursor, setProductCursor] = useState<string | null>(null);
  const [movementCursor, setMovementCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState<'products' | 'movements' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [movementForm, setMovementForm] = useState<MovementFormState | null>(null);
  const [movementError, setMovementError] = useState<string | null>(null);
  const [movementNotice, setMovementNotice] = useState<string | null>(null);
  const [movementBusy, setMovementBusy] = useState(false);
  const [managementMode, setManagementMode] = useState<ManagementMode>(null);
  const [managementBusy, setManagementBusy] = useState(false);
  const [managementLoading, setManagementLoading] = useState(false);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [managementNotice, setManagementNotice] = useState<string | null>(null);
  const [categories, setCategories] = useState<InventoryCategoryDto[]>([]);
  const [suppliers, setSuppliers] = useState<InventorySupplierDto[]>([]);
  const [categoryCursor, setCategoryCursor] = useState<string | null>(null);
  const [supplierCursor, setSupplierCursor] = useState<string | null>(null);
  const [productName, setProductName] = useState('');
  const [productSku, setProductSku] = useState('');
  const [productUnit, setProductUnit] = useState<InventoryUnitValue>(InventoryUnit.EACH);
  const [productCategoryId, setProductCategoryId] = useState('');
  const [productSupplierId, setProductSupplierId] = useState('');
  const [productThreshold, setProductThreshold] = useState('0');
  const [productActive, setProductActive] = useState(true);
  const [editingProduct, setEditingProduct] = useState<InventoryProductDto | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierContactName, setSupplierContactName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierEmail, setSupplierEmail] = useState('');
  const [supplierNotes, setSupplierNotes] = useState('');
  const managementRequest = useRef(0);
  const movementRequest = useRef<MovementRequestSnapshot | null>(null);
  const requestId = useRef(0);
  const selectedSalonIdRef = useRef(selectedSalonId);
  selectedSalonIdRef.current = selectedSalonId;

  useEffect(() => {
    setMovementForm(null);
    setMovementError(null);
    setMovementNotice(null);
    setMovementBusy(false);
    movementRequest.current = null;
    managementRequest.current += 1;
    setManagementMode(null);
    setManagementError(null);
    setManagementNotice(null);
    setManagementBusy(false);
    setCategories([]);
    setSuppliers([]);
    setCategoryCursor(null);
    setSupplierCursor(null);
    setProductActive(true);
    setEditingProduct(null);
  }, [selectedSalonId]);

  const openManagement = async (mode: Exclude<ManagementMode, null>, product?: InventoryProductDto) => {
    const request = ++managementRequest.current;
    setManagementMode(mode);
    setManagementError(null);
    setManagementNotice(null);
    setEditingProduct(product ?? null);
    setProductName(product?.name ?? '');
    setProductSku(product?.sku ?? '');
    setProductUnit(product?.unit ?? InventoryUnit.EACH);
    setProductCategoryId(product?.category?.id ?? '');
    setProductSupplierId(product?.supplier?.id ?? '');
    setProductThreshold(product?.reorderThreshold ?? '0');
    setProductActive(product?.isActive ?? true);
    setCategoryName('');
    setSupplierName('');
    setSupplierContactName('');
    setSupplierPhone('');
    setSupplierEmail('');
    setSupplierNotes('');
    if (mode !== 'product' || !selectedSalonId) return;
    setCategories([]);
    setSuppliers([]);
    setCategoryCursor(null);
    setSupplierCursor(null);
    const salonId = selectedSalonId;
    setManagementLoading(true);
    try {
      const [categoryPage, supplierPage] = await Promise.all([
        apiFetch<InventoryPageDto<InventoryCategoryDto>>(queryPath(`${rootPath(salonId)}/${INVENTORY_PATHS.categories}`, { limit: String(PAGE_SIZE) })),
        apiFetch<InventoryPageDto<InventorySupplierDto>>(queryPath(`${rootPath(salonId)}/${INVENTORY_PATHS.suppliers}`, { limit: String(PAGE_SIZE) })),
      ]);
      if (request !== managementRequest.current || salonId !== selectedSalonIdRef.current) return;
      setCategories(categoryPage.items);
      setSuppliers(supplierPage.items);
      setCategoryCursor(categoryPage.nextCursor);
      setSupplierCursor(supplierPage.nextCursor);
    } catch (err) {
      if (request !== managementRequest.current || salonId !== selectedSalonIdRef.current) return;
      setManagementError(err instanceof ApiError ? err.message : labels.lookupRetry);
    } finally {
      if (request === managementRequest.current) setManagementLoading(false);
    }
  };

  const loadMoreLookup = async (kind: 'category' | 'supplier') => {
    if (!selectedSalonId || managementLoading) return;
    const cursor = kind === 'category' ? categoryCursor : supplierCursor;
    if (!cursor) return;
    const salonId = selectedSalonId;
    const request = ++managementRequest.current;
    setManagementLoading(true);
    setManagementError(null);
    try {
      const resource = kind === 'category' ? INVENTORY_PATHS.categories : INVENTORY_PATHS.suppliers;
      if (kind === 'category') {
        const page = await apiFetch<InventoryPageDto<InventoryCategoryDto>>(queryPath(`${rootPath(salonId)}/${resource}`, { limit: String(PAGE_SIZE), cursor }));
        if (request !== managementRequest.current || salonId !== selectedSalonIdRef.current) return;
        setCategories((current) => { const known = new Set(current.map((item) => item.id)); return [...current, ...page.items.filter((item) => !known.has(item.id))]; });
        setCategoryCursor(page.nextCursor);
      } else {
        const page = await apiFetch<InventoryPageDto<InventorySupplierDto>>(queryPath(`${rootPath(salonId)}/${resource}`, { limit: String(PAGE_SIZE), cursor }));
        if (request !== managementRequest.current || salonId !== selectedSalonIdRef.current) return;
        setSuppliers((current) => { const known = new Set(current.map((item) => item.id)); return [...current, ...page.items.filter((item) => !known.has(item.id))]; });
        setSupplierCursor(page.nextCursor);
      }
    } catch (err) {
      if (request === managementRequest.current && salonId === selectedSalonIdRef.current) setManagementError(err instanceof ApiError ? err.message : labels.lookupRetry);
    } finally {
      if (request === managementRequest.current) setManagementLoading(false);
    }
  };

  const submitManagement = async () => {
    if (!selectedSalonId || !managementMode || managementBusy || managementLoading) return;
    const salonId = selectedSalonId;
    const requestAtSubmit = requestId.current;
    const mode = managementMode;
    let path: string;
    let body: unknown;
    let successText: string;
    if (mode === 'category') {
      const parsed = createInventoryCategorySchema.safeParse({ name: categoryName });
      if (!parsed.success) { setManagementError(parsed.error.issues[0]?.message ?? labels.managementInvalid); return; }
      path = `${rootPath(salonId)}/${INVENTORY_PATHS.categories}`;
      body = parsed.data;
      successText = labels.categoryCreated;
    } else if (mode === 'supplier') {
      const parsed = createInventorySupplierSchema.safeParse({
        name: supplierName,
        contactName: supplierContactName.trim() || null,
        phone: supplierPhone.trim() || null,
        email: supplierEmail.trim() || null,
        notes: supplierNotes.trim() || null,
      });
      if (!parsed.success) { setManagementError(parsed.error.issues[0]?.message ?? labels.managementInvalid); return; }
      path = `${rootPath(salonId)}/${INVENTORY_PATHS.suppliers}`;
      body = parsed.data;
      successText = labels.supplierCreated;
    } else {
      const parsed = createInventoryProductSchema.safeParse({
        name: productName,
        sku: productSku.trim() || null,
        unit: productUnit,
        categoryId: productCategoryId || null,
        supplierId: productSupplierId || null,
        isActive: editingProduct ? productActive : undefined,
        reorderThreshold: Number(productThreshold),
      });
      if (!parsed.success) { setManagementError(parsed.error.issues[0]?.message ?? labels.managementInvalid); return; }
      path = `${rootPath(salonId)}/${INVENTORY_PATHS.products}${editingProduct ? `/${encodeURIComponent(editingProduct.id)}` : ''}`;
      if (editingProduct) {
        const update = updateInventoryProductSchema.safeParse({
          name: parsed.data.name,
          sku: parsed.data.sku,
          categoryId: parsed.data.categoryId,
          supplierId: parsed.data.supplierId,
          isActive: parsed.data.isActive,
          reorderThreshold: parsed.data.reorderThreshold,
        });
        if (!update.success) { setManagementError(update.error.issues[0]?.message ?? labels.managementInvalid); return; }
        body = update.data;
      } else {
        body = parsed.data;
      }
      successText = editingProduct ? labels.productUpdated : labels.productCreated;
    }
    setManagementBusy(true);
    setManagementError(null);
    try {
      const result = await apiFetch<InventoryProductDto | InventoryCategoryDto | InventorySupplierDto>(path, { method: editingProduct && mode === 'product' ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      if (salonId !== selectedSalonIdRef.current || requestAtSubmit !== requestId.current) return;
      if (mode === 'category') setCategories((current) => [...current, result as InventoryCategoryDto]);
      if (mode === 'supplier') setSuppliers((current) => [...current, result as InventorySupplierDto]);
      setManagementMode(null);
      setEditingProduct(null);
      setManagementNotice(successText);
      await load(true);
    } catch (err) {
      if (salonId !== selectedSalonIdRef.current || requestAtSubmit !== requestId.current) return;
      setManagementError(err instanceof ApiError ? err.message : labels.managementInvalid);
    } finally {
      setManagementBusy(false);
    }
  };

  const load = useCallback(async (refresh = false) => {
    const currentRequest = ++requestId.current;
    if (!selectedSalonId) {
      setReport(null);
      setProducts([]);
      setMovements([]);
      setError(null);
      setLoading(false);
      return;
    }
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    setLoadingMore(null);
    const root = rootPath(selectedSalonId);
    try {
      const [nextReport, productPage, movementPage] = await Promise.all([
        apiFetch<InventoryReportDto>(`${root}/${INVENTORY_PATHS.report}`),
        apiFetch<InventoryPageDto<InventoryProductDto>>(queryPath(`${root}/${INVENTORY_PATHS.products}`, {
          limit: String(PAGE_SIZE), ...(mode === 'low-stock' ? { lowStock: 'true' } : {}),
        })),
        apiFetch<InventoryPageDto<InventoryMovementDto>>(queryPath(`${root}/${INVENTORY_PATHS.movements}`, { limit: String(PAGE_SIZE) })),
      ]);
      if (currentRequest !== requestId.current) return;
      setReport(nextReport);
      setProducts(productPage.items);
      setProductCursor(productPage.nextCursor);
      setMovements(movementPage.items);
      setMovementCursor(movementPage.nextCursor);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      setReport(null);
      setProducts([]);
      setMovements([]);
      setError(err instanceof ApiError ? err.message : labels.retry);
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [labels.retry, mode, selectedSalonId]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]));

  const loadMore = useCallback(async (kind: 'products' | 'movements') => {
    if (!selectedSalonId || loadingMore) return;
    const cursor = kind === 'products' ? productCursor : movementCursor;
    if (!cursor) return;
    const selectedRequestId = requestId.current;
    setLoadingMore(kind);
    setError(null);
    const root = rootPath(selectedSalonId);
    const path = kind === 'products' ? `${root}/${INVENTORY_PATHS.products}` : `${root}/${INVENTORY_PATHS.movements}`;
    const query = kind === 'products' && mode === 'low-stock'
      ? { limit: String(PAGE_SIZE), cursor, lowStock: 'true' }
      : { limit: String(PAGE_SIZE), cursor };
    try {
      if (kind === 'products') {
        const page = await apiFetch<InventoryPageDto<InventoryProductDto>>(queryPath(path, query));
        if (selectedRequestId !== requestId.current) return;
        setProducts((current) => {
          const known = new Set(current.map((item) => item.id));
          return [...current, ...page.items.filter((item) => !known.has(item.id))];
        });
        setProductCursor(page.nextCursor);
      } else {
        const page = await apiFetch<InventoryPageDto<InventoryMovementDto>>(queryPath(path, query));
        if (selectedRequestId !== requestId.current) return;
        setMovements((current) => {
          const known = new Set(current.map((item) => item.id));
          return [...current, ...page.items.filter((item) => !known.has(item.id))];
        });
        setMovementCursor(page.nextCursor);
      }
    } catch (err) {
      if (selectedRequestId !== requestId.current) return;
      setError(err instanceof ApiError ? err.message : labels.retry);
    } finally {
      if (selectedRequestId === requestId.current) setLoadingMore(null);
    }
  }, [labels.retry, loadingMore, mode, movementCursor, productCursor, selectedSalonId]);

  const stockValue = report ? Number(report.estimatedStockValue) : NaN;
  const openMovement = (product: InventoryProductDto) => {
    setMovementError(null);
    setMovementNotice(null);
    movementRequest.current = null;
    setMovementForm({ product, kind: InventoryMovementKind.PURCHASE, quantity: '', unitCost: '', adjustmentDirection: 'INCREASE', reason: '', reference: '' });
  };

  const recordMovement = async (salonId: string, productId: string, input: CreateInventoryMovementInput, key: string, requestAtSubmit: number) => {
    if (salonId !== selectedSalonIdRef.current || requestAtSubmit !== requestId.current) return;
    setMovementBusy(true);
    setMovementError(null);
    try {
      const result = await apiFetch<{ movement: InventoryMovementDto; created: boolean }>(movementPath(salonId, productId), {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(input),
      });
      if (salonId !== selectedSalonId || requestAtSubmit !== requestId.current) return;
      setMovementForm(null);
      setMovementNotice(result.created ? labels.saved : labels.alreadyRecorded);
      movementRequest.current = null;
      await load(true);
    } catch (err) {
      if (salonId !== selectedSalonId || requestAtSubmit !== requestId.current) return;
      setMovementError(err instanceof ApiError ? err.message : labels.retry);
    } finally {
      setMovementBusy(false);
    }
  };

  const submitMovement = () => {
    if (!selectedSalonId || !movementForm) return;
    const isIncoming = movementForm.kind === InventoryMovementKind.OPENING || movementForm.kind === InventoryMovementKind.PURCHASE;
    const isAdjustment = movementForm.kind === InventoryMovementKind.ADJUSTMENT;
    if (isIncoming && !movementForm.unitCost.trim()) {
      setMovementError(labels.costRequired);
      return;
    }
    const parsed = createInventoryMovementSchema.safeParse({
      kind: movementForm.kind,
      quantity: Number(movementForm.quantity),
      ...(isIncoming ? { unitCost: Number(movementForm.unitCost) } : {}),
      ...(isAdjustment ? { adjustmentDirection: movementForm.adjustmentDirection, reason: movementForm.reason } : {}),
      ...(movementForm.reference.trim() ? { reference: movementForm.reference.trim() } : {}),
    });
    if (!parsed.success) {
      setMovementError(parsed.error.issues[0]?.message ?? labels.invalidMovement);
      return;
    }
    const fingerprint = JSON.stringify(parsed.data);
    const key = movementRequest.current?.fingerprint === fingerprint
      ? movementRequest.current.key
      : newIdempotencyKey();
    movementRequest.current = { fingerprint, key };
    const salonId = selectedSalonId;
    const requestAtSubmit = requestId.current;
    const kindText = movementLabel(movementForm.kind, labels);
    const description = `${movementForm.product.name} · ${kindText} · ${movementForm.quantity} ${movementForm.product.unit}`;
    Alert.alert(
      labels.confirmTitle,
      `${labels.confirmPrefix} ${movementForm.product.name}: ${description}`,
      [
        { text: labels.cancel, style: 'cancel' },
        { text: labels.reviewMovement, onPress: () => { void recordMovement(salonId, movementForm.product.id, parsed.data, key, requestAtSubmit); } },
      ],
    );
  };

  return (
    <PremiumScreen refreshing={refreshing} onRefresh={() => void load(true)}>
      <PremiumSectionHeader eyebrow={selectedSalon?.name} title={labels.title} subtitle={labels.subtitle} />
      {!selectedSalonId ? <EmptyState title={labels.title} message={labels.selectedShop} /> : loading ? (
        <View style={styles.loading}><Text style={styles.muted}>{labels.loading}</Text><Skeleton style={styles.skeleton} /><Skeleton style={styles.skeleton} /></View>
      ) : error && !report ? <InlineError message={error} /> : !report ? <EmptyState title={labels.title} message={labels.retry} /> : (
        <>
          {error ? <InlineError message={error} /> : null}
          <View style={styles.metrics}>
            <Metric label={labels.productCount} value={report.productCount} />
            <Metric label={labels.lowCount} value={report.lowStockCount} warning={report.lowStockCount > 0} />
          </View>
          <PremiumCard strong style={styles.card}>
            <Text style={styles.cardTitle}>{labels.value}</Text>
            <Text style={styles.money}>{Number.isFinite(stockValue) ? formatMoney(stockValue, report.currency) : '—'}</Text>
            <Text style={styles.muted}>{labels.valuation}</Text>
          </PremiumCard>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{labels.products}</Text>
            <View style={styles.modeRow} accessibilityRole="tablist">
              {(['all', 'low-stock'] as const).map((option) => {
                const selected = mode === option;
                return <Pressable key={option} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => setMode(option)} style={[styles.modeButton, selected && styles.modeSelected]}>
                  <Text style={[styles.modeText, selected && styles.modeTextSelected]}>{option === 'all' ? labels.products : labels.lowStock}</Text>
                </Pressable>;
              })}
            </View>
          </View>
          <View style={styles.managementActions}>
            <ActionButton label={labels.addProduct} disabled={managementBusy} onPress={() => void openManagement('product')} />
            <ActionButton label={labels.addCategory} disabled={managementBusy} onPress={() => void openManagement('category')} />
            <ActionButton label={labels.addSupplier} disabled={managementBusy} onPress={() => void openManagement('supplier')} />
          </View>
          {managementNotice ? <Text accessibilityRole="alert" style={styles.notice}>{managementNotice}</Text> : null}
          {managementMode ? (
            <PremiumCard strong style={styles.formCard}>
              <Text style={styles.cardTitle}>{managementMode === 'product' ? (editingProduct ? labels.editProduct : labels.addProduct) : managementMode === 'category' ? labels.addCategory : labels.addSupplier}</Text>
              {managementError ? <InlineError message={managementError} /> : null}
              {managementLoading ? <Text style={styles.muted}>{labels.loading}</Text> : null}
              {managementMode === 'product' ? <>
                <Text style={styles.inputLabel}>{labels.productName}</Text>
                <TextInput accessibilityLabel={labels.productName} editable={!managementBusy} value={productName} onChangeText={setProductName} maxLength={120} style={styles.input} />
                <Text style={styles.inputLabel}>{labels.sku}</Text>
                <TextInput accessibilityLabel={labels.sku} editable={!managementBusy} value={productSku} onChangeText={setProductSku} maxLength={80} style={styles.input} />
                <Text style={styles.inputLabel}>{labels.unit}</Text>
                <View style={styles.modeRow} accessibilityRole="tablist">
                  {(Object.values(InventoryUnit) as InventoryUnitValue[]).map((unit) => {
                    const selected = productUnit === unit;
                    return <Pressable key={unit} accessibilityRole="tab" accessibilityState={{ selected }} disabled={managementBusy} onPress={() => setProductUnit(unit)} style={[styles.modeButton, selected && styles.modeSelected]}>
                      <Text style={[styles.modeText, selected && styles.modeTextSelected]}>{unit}</Text>
                    </Pressable>;
                  })}
                </View>
                <Text style={styles.inputLabel}>{labels.category}</Text>
                <View style={styles.modeRow} accessibilityRole="tablist">
                  <LookupOption label={labels.none} selected={!productCategoryId} onPress={() => setProductCategoryId('')} />
                  {editingProduct?.category && !categories.some((item) => item.id === editingProduct.category?.id) ? <LookupOption label={editingProduct.category.name} selected={productCategoryId === editingProduct.category.id} onPress={() => setProductCategoryId(editingProduct.category!.id)} /> : null}
                  {categories.map((item) => <LookupOption key={item.id} label={item.name} selected={productCategoryId === item.id} onPress={() => setProductCategoryId(item.id)} />)}
                </View>
                {categoryCursor ? <MoreButton label={labels.loadMoreCategories} loading={managementLoading} onPress={() => void loadMoreLookup('category')} /> : null}
                <Text style={styles.inputLabel}>{labels.supplier}</Text>
                <View style={styles.modeRow} accessibilityRole="tablist">
                  <LookupOption label={labels.none} selected={!productSupplierId} onPress={() => setProductSupplierId('')} />
                  {editingProduct?.supplier && !suppliers.some((item) => item.id === editingProduct.supplier?.id) ? <LookupOption label={editingProduct.supplier.name} selected={productSupplierId === editingProduct.supplier.id} onPress={() => setProductSupplierId(editingProduct.supplier!.id)} /> : null}
                  {suppliers.map((item) => <LookupOption key={item.id} label={item.name} selected={productSupplierId === item.id} onPress={() => setProductSupplierId(item.id)} />)}
                </View>
                {supplierCursor ? <MoreButton label={labels.loadMoreSuppliers} loading={managementLoading} onPress={() => void loadMoreLookup('supplier')} /> : null}
                <Text style={styles.inputLabel}>{labels.reorderThreshold}</Text>
                <TextInput accessibilityLabel={labels.reorderThreshold} editable={!managementBusy} value={productThreshold} onChangeText={setProductThreshold} keyboardType="decimal-pad" style={styles.input} />
                {editingProduct ? <>
                  <Text style={styles.inputLabel}>{labels.unit}: {productUnit}</Text>
                  <Text style={styles.muted}>{labels.unit} is unchanged so existing stock history keeps its original meaning.</Text>
                  <Pressable accessibilityRole="button" accessibilityState={{ selected: productActive }} disabled={managementBusy} onPress={() => setProductActive((active) => !active)} style={styles.modeButton}>
                    <Text style={styles.moreText}>{productActive ? labels.active : labels.inactiveStatus}</Text>
                  </Pressable>
                </> : null}
                <Text style={styles.muted}>{labels.productHelp}</Text>
              </> : managementMode === 'category' ? <>
                <Text style={styles.inputLabel}>{labels.category}</Text>
                <TextInput accessibilityLabel={labels.category} editable={!managementBusy} value={categoryName} onChangeText={setCategoryName} maxLength={80} style={styles.input} />
              </> : <>
                <Text style={styles.inputLabel}>{labels.supplier}</Text>
                <TextInput accessibilityLabel={labels.supplier} editable={!managementBusy} value={supplierName} onChangeText={setSupplierName} maxLength={120} style={styles.input} />
                <Text style={styles.inputLabel}>{labels.contactName}</Text>
                <TextInput accessibilityLabel={labels.contactName} editable={!managementBusy} value={supplierContactName} onChangeText={setSupplierContactName} maxLength={120} style={styles.input} />
                <Text style={styles.inputLabel}>{labels.phone}</Text>
                <TextInput accessibilityLabel={labels.phone} editable={!managementBusy} value={supplierPhone} onChangeText={setSupplierPhone} maxLength={40} keyboardType="phone-pad" style={styles.input} />
                <Text style={styles.inputLabel}>{labels.email}</Text>
                <TextInput accessibilityLabel={labels.email} editable={!managementBusy} value={supplierEmail} onChangeText={setSupplierEmail} maxLength={254} keyboardType="email-address" autoCapitalize="none" style={styles.input} />
                <Text style={styles.inputLabel}>{labels.notes}</Text>
                <TextInput accessibilityLabel={labels.notes} editable={!managementBusy} value={supplierNotes} onChangeText={setSupplierNotes} maxLength={500} multiline style={[styles.input, styles.multiline]} />
              </>}
              <View style={styles.formActions}>
                <Pressable accessibilityRole="button" disabled={managementBusy} onPress={() => { managementRequest.current += 1; setManagementMode(null); setManagementError(null); }} style={styles.modeButton}><Text style={styles.modeText}>{labels.cancel}</Text></Pressable>
                <Pressable accessibilityRole="button" disabled={managementBusy || managementLoading} onPress={() => void submitManagement()} style={[styles.modeButton, styles.actionSelected]}><Text style={[styles.modeText, styles.actionText]}>{managementBusy ? labels.creating : labels.save}</Text></Pressable>
              </View>
            </PremiumCard>
          ) : null}
          {movementNotice ? <Text accessibilityRole="alert" style={styles.notice}>{movementNotice}</Text> : null}
          {movementForm ? (
            <PremiumCard strong style={styles.formCard}>
              <Text style={styles.cardTitle}>{labels.movementTitle}: {movementForm.product.name}</Text>
              {movementError ? <InlineError message={movementError} /> : null}
              <Text style={styles.inputLabel}>{labels.movementType}</Text>
              <View style={styles.modeRow} accessibilityRole="tablist">
                {Object.values(InventoryMovementKind).map((kind) => {
                  const selected = movementForm.kind === kind;
                  return <Pressable key={kind} accessibilityRole="tab" accessibilityState={{ selected }} disabled={movementBusy} onPress={() => { setMovementError(null); setMovementForm((current) => current ? { ...current, kind } : current); movementRequest.current = null; }} style={[styles.modeButton, selected && styles.modeSelected]}>
                    <Text style={[styles.modeText, selected && styles.modeTextSelected]}>{movementLabel(kind, labels)}</Text>
                  </Pressable>;
                })}
              </View>
              <Text style={styles.inputLabel}>{labels.quantity} ({movementForm.product.unit})</Text>
              <TextInput accessibilityLabel={labels.quantity} editable={!movementBusy} value={movementForm.quantity} onChangeText={(value) => { setMovementError(null); movementRequest.current = null; setMovementForm((current) => current ? { ...current, quantity: value } : current); }} keyboardType="decimal-pad" style={styles.input} />
              {movementForm.kind === InventoryMovementKind.OPENING || movementForm.kind === InventoryMovementKind.PURCHASE ? <>
                <Text style={styles.inputLabel}>{labels.unitCost}</Text>
                <TextInput accessibilityLabel={labels.unitCost} editable={!movementBusy} value={movementForm.unitCost} onChangeText={(value) => { setMovementError(null); movementRequest.current = null; setMovementForm((current) => current ? { ...current, unitCost: value } : current); }} keyboardType="decimal-pad" style={styles.input} />
              </> : null}
              {movementForm.kind === InventoryMovementKind.ADJUSTMENT ? <>
                <Text style={styles.inputLabel}>{labels.direction}</Text>
                <View style={styles.modeRow}>
                  {(['INCREASE', 'DECREASE'] as const).map((direction) => {
                    const selected = movementForm.adjustmentDirection === direction;
                    return <Pressable key={direction} accessibilityRole="button" accessibilityState={{ selected }} disabled={movementBusy} onPress={() => { setMovementError(null); movementRequest.current = null; setMovementForm((current) => current ? { ...current, adjustmentDirection: direction } : current); }} style={[styles.modeButton, selected && styles.modeSelected]}>
                      <Text style={[styles.modeText, selected && styles.modeTextSelected]}>{direction === 'INCREASE' ? labels.increase : labels.decrease}</Text>
                    </Pressable>;
                  })}
                </View>
                <Text style={styles.inputLabel}>{labels.reason}</Text>
                <TextInput accessibilityLabel={labels.reason} editable={!movementBusy} value={movementForm.reason} onChangeText={(value) => { setMovementError(null); movementRequest.current = null; setMovementForm((current) => current ? { ...current, reason: value } : current); }} maxLength={300} multiline style={[styles.input, styles.multiline]} />
              </> : null}
              <Text style={styles.inputLabel}>{labels.reference}</Text>
              <TextInput accessibilityLabel={labels.reference} editable={!movementBusy} value={movementForm.reference} onChangeText={(value) => { setMovementError(null); movementRequest.current = null; setMovementForm((current) => current ? { ...current, reference: value } : current); }} maxLength={120} style={styles.input} />
              <Text style={styles.muted}>{labels.valuation}</Text>
              <View style={styles.formActions}>
                <Pressable accessibilityRole="button" disabled={movementBusy} onPress={() => { setMovementForm(null); setMovementError(null); movementRequest.current = null; }} style={styles.modeButton}><Text style={styles.modeText}>{labels.cancel}</Text></Pressable>
                <Pressable accessibilityRole="button" disabled={movementBusy} onPress={submitMovement} style={[styles.modeButton, styles.actionSelected]}><Text style={[styles.modeText, styles.actionText]}>{movementBusy ? labels.saving : labels.reviewMovement}</Text></Pressable>
              </View>
            </PremiumCard>
          ) : null}
          {products.length === 0 ? <Text style={styles.muted}>{labels.emptyProducts}</Text> : products.map((product) => (
            <View key={product.id} style={styles.productRow}>
              <View style={styles.productMain}>
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.productMeta}>{product.category?.name ?? product.sku ?? product.unit}</Text>
                <Pressable accessibilityRole="button" disabled={movementBusy} onPress={() => openMovement(product)} style={styles.recordButton}><Text style={styles.moreText}>{labels.recordMovement}</Text></Pressable>
                <Pressable accessibilityRole="button" disabled={movementBusy || managementBusy} onPress={() => void openManagement('product', product)} style={styles.recordButton}><Text style={styles.moreText}>{labels.editProduct}</Text></Pressable>
              </View>
              <View style={styles.stockValue}>
                <Text style={[styles.stockNumber, product.isLowStock && styles.warning]}>{product.stockOnHand}</Text>
                <Text style={styles.productMeta}>{product.unit}</Text>
                {product.isLowStock ? <Text style={styles.warning}>{labels.lowBadge}</Text> : null}
                {!product.isActive ? <Text style={styles.muted}>{labels.inactive}</Text> : null}
              </View>
            </View>
          ))}
          {productCursor ? <MoreButton label={labels.loadMore} loading={loadingMore === 'products'} onPress={() => void loadMore('products')} /> : null}

          <PremiumCard style={styles.card}>
            <Text style={styles.cardTitle}>{labels.history}</Text>
            {movements.length === 0 ? <Text style={styles.muted}>{labels.emptyHistory}</Text> : movements.map((movement) => (
              <View key={movement.id} style={styles.movementRow}>
                <View style={styles.productMain}>
                  <Text style={styles.productName}>{movement.productName}</Text>
                    <Text style={styles.productMeta}>{movementLabel(movement.kind, labels)} · {new Date(movement.recordedAt).toLocaleDateString(dateLocaleFor(language))}</Text>
                </View>
                <View style={styles.stockValue}>
                  <Text style={styles.stockNumber}>{movement.quantityDelta}</Text>
                  <Text style={styles.productMeta}>{labels.after}: {movement.stockAfter}</Text>
                </View>
              </View>
            ))}
            {movementCursor ? <MoreButton label={labels.loadMore} loading={loadingMore === 'movements'} onPress={() => void loadMore('movements')} /> : null}
          </PremiumCard>
        </>
      )}
    </PremiumScreen>
  );
}

function Metric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <View style={styles.metric}><Text style={[styles.metricValue, warning && styles.warning]}>{value.toLocaleString()}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function MoreButton({ label, loading, onPress }: { label: string; loading: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={loading} onPress={onPress} style={styles.moreButton}><Text style={styles.moreText}>{loading ? '…' : label}</Text></Pressable>;
}

function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={styles.modeButton}><Text style={styles.moreText}>{label}</Text></Pressable>;
}

function LookupOption({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={[styles.modeButton, selected && styles.modeSelected]}><Text style={[styles.modeText, selected && styles.modeTextSelected]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  loading: { gap: space[3] },
  skeleton: { height: 104, borderRadius: radius.lg },
  muted: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), marginTop: space[2] },
  metrics: { flexDirection: 'row', gap: space[3], marginBottom: space[3] },
  metric: { flex: 1, minHeight: 84, justifyContent: 'center', backgroundColor: fastQue.card, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.md, padding: space[3] },
  metricValue: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.xl },
  metricLabel: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: fontSize.xs, marginTop: space[1] },
  warning: { color: fastQue.coral },
  card: { marginBottom: space[4] },
  cardTitle: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.lg },
  money: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize['2xl'], marginTop: space[2] },
  sectionHeader: { gap: space[3], marginBottom: space[3] },
  managementActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[3] },
  sectionTitle: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.lg },
  modeRow: { flexDirection: 'row', gap: space[2] },
  modeButton: { minHeight: 40, paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1, borderColor: fastQue.border, justifyContent: 'center' },
  modeSelected: { backgroundColor: fastQue.card, borderColor: fastQue.borderStrong },
  modeText: { color: fastQue.textMuted, fontFamily: font.bodyMedium, fontSize: fontSize.xs },
  modeTextSelected: { color: fastQue.text },
  productRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3], backgroundColor: fastQue.card, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.md, padding: space[3], marginBottom: space[2] },
  movementRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3], paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: fastQue.border },
  productMain: { flex: 1, justifyContent: 'center' },
  productName: { color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  productMeta: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: 11, marginTop: space[1] },
  stockValue: { alignItems: 'flex-end', justifyContent: 'center' },
  stockNumber: { color: fastQue.text, fontFamily: font.bodyBold, fontSize: fontSize.sm },
  moreButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  formCard: { marginBottom: space[4], gap: space[2] },
  inputLabel: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: fontSize.xs, marginTop: space[2] },
  input: { minHeight: 44, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.sm, paddingHorizontal: space[3], color: fastQue.text, fontFamily: font.bodyRegular, fontSize: fontSize.sm },
  multiline: { minHeight: 76, paddingVertical: space[3], textAlignVertical: 'top' },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[2], marginTop: space[3] },
  actionSelected: { backgroundColor: fastQue.coral, borderColor: fastQue.coral },
  actionText: { color: '#FFFFFF' },
  recordButton: { alignSelf: 'flex-start', paddingVertical: space[2] },
  notice: { color: fastQue.success, fontFamily: font.bodyMedium, fontSize: fontSize.xs, marginBottom: space[3] },
  moreText: { color: fastQue.coral, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
});
