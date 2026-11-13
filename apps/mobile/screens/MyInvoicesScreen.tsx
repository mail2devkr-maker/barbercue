import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '@barbercue/shared';
import type { InvoiceListDto, InvoiceSummaryDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { customerInvoicesRequestPath } from '../lib/customer-commerce';
import { dateLocaleFor } from '../lib/date-locale';
import { useLanguage } from '../lib/language-context';
import { color, font, fontSize, lineHeightFor, radius, space } from '../lib/theme';
import { EmptyState, InlineError, Screen, SectionHeader, Skeleton } from '../components/ui';
import type { BookingsStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<BookingsStackParamList, 'MyInvoices'>;

function paymentLabel(status: InvoiceSummaryDto['paymentStatus']): string {
  switch (status) {
    case 'PAID': return 'Paid';
    case 'PARTIALLY_PAID': return 'Partially paid';
    case 'REFUNDED': return 'Refunded';
    case 'VOID': return 'Void';
    default: return 'Awaiting payment';
  }
}

export default function MyInvoicesScreen({ navigation }: Props) {
  const { t, language } = useLanguage();
  const [items, setItems] = useState<InvoiceSummaryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const page = await apiFetch<InvoiceListDto>(customerInvoicesRequestPath());
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load invoices. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(false); }, [load]));

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<InvoiceListDto>(customerInvoicesRequestPath(nextCursor));
      setItems((current) => {
        const known = new Set(current.map((invoice) => invoice.id));
        return [...current, ...page.items.filter((invoice) => !known.has(invoice.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more invoices. Please try again.');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor]);

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <SectionHeader eyebrow="Account" title="My invoices" subtitle="Invoices issued for your own bookings and visits." />
      {loading ? (
        <View style={styles.skeletons}><Skeleton style={styles.skeleton} /><Skeleton style={styles.skeleton} /></View>
      ) : error && items.length === 0 ? (
        <InlineError message={error} />
      ) : items.length === 0 ? (
        <EmptyState title="No invoices yet" message="Invoices recorded for your bookings and shop visits will appear here." />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={color.accent} />}
          ListHeaderComponent={error ? <InlineError message={error} /> : null}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Invoice ${item.number}, ${paymentLabel(item.paymentStatus)}, ${formatMoney(item.total, item.currency)}. View details.`}
              onPress={() => navigation.navigate('InvoiceDetail', { invoiceId: item.id })}
              style={({ pressed }) => [styles.invoiceCard, pressed && styles.pressed]}
            >
              <View style={styles.row}>
                <Text style={styles.number}>{item.number}</Text>
                <Text style={styles.total}>{formatMoney(item.total, item.currency)}</Text>
              </View>
              <Text style={styles.meta}>Service date {new Date(item.serviceDate).toLocaleDateString(dateLocaleFor(language))}</Text>
              <View style={styles.row}>
                <Text style={styles.meta}>{paymentLabel(item.paymentStatus)}</Text>
                {item.balanceDue > 0 && <Text style={styles.due}>Due {formatMoney(item.balanceDue, item.currency)}</Text>}
              </View>
            </Pressable>
          )}
          ListFooterComponent={nextCursor ? (
            <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void loadMore()} style={styles.loadMore}>
              <Text style={styles.loadMoreText}>{loadingMore ? 'Loading…' : t.loadMore}</Text>
            </Pressable>
          ) : null}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  skeletons: { gap: space[3] },
  skeleton: { height: 88, borderRadius: radius.lg },
  listContent: { paddingTop: space[2], paddingBottom: space[5] },
  invoiceCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space[4], marginBottom: space[3] },
  pressed: { opacity: 0.82 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[2] },
  number: { flex: 1, fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink },
  total: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink },
  meta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.muted, marginTop: space[2] },
  due: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.warn, marginTop: space[2] },
  loadMore: { alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  loadMoreText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.accent },
});
