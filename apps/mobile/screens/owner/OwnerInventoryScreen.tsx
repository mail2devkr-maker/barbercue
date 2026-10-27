import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  formatMoney,
  INVENTORY_PATHS,
  type InventoryMovementDto,
  type InventoryPageDto,
  type InventoryProductDto,
  type InventoryReportDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { dateLocaleFor } from '../../lib/date-locale';
import { useLanguage } from '../../lib/language-context';
import { useSalon } from '../../lib/salon-context';
import { fastQue, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumCard, PremiumScreen, PremiumSectionHeader, Skeleton } from '../../components/ui';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

type Props = NativeStackScreenProps<OwnerShopStackParamList, 'OwnerInventory'>;
type ProductMode = 'all' | 'low-stock';
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
  const requestId = useRef(0);

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
  const movementLabel = (kind: InventoryMovementDto['kind']) => {
    switch (kind) {
      case 'OPENING': return labels.opening;
      case 'PURCHASE': return labels.purchase;
      case 'CONSUMPTION': return labels.consumption;
      default: return labels.adjustment;
    }
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
          {products.length === 0 ? <Text style={styles.muted}>{labels.emptyProducts}</Text> : products.map((product) => (
            <View key={product.id} style={styles.productRow}>
              <View style={styles.productMain}>
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.productMeta}>{product.category?.name ?? product.sku ?? product.unit}</Text>
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
                  <Text style={styles.productMeta}>{movementLabel(movement.kind)} · {new Date(movement.recordedAt).toLocaleDateString(dateLocaleFor(language))}</Text>
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
  moreText: { color: fastQue.coral, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
});
