import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { InvoiceListDto, InvoiceSummaryDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { formatMoney, formatShopDate, ownerOpsPaths } from '../../lib/owner/ops';
import { PAYMENT_FILTERS, paymentStatusView } from '../../lib/owner/invoice-view';
import { fastQue, font, fontSize, radius, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumButton, PremiumCard, PremiumScreen, PremiumSectionHeader, PremiumTextField, Skeleton } from '../../components/ui';
import { Chip, ChipRow, StatusPill } from '../../components/owner/ops-ui';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

type Nav = NativeStackNavigationProp<OwnerShopStackParamList, 'OwnerInvoices'>;

/** Invoices the shop has issued. "Paid" always means a payment the shop recorded - never assumed. */
export default function OwnerInvoicesScreen() {
  const navigation = useNavigation<Nav>();
  const { selectedSalonId } = useSalon();
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<InvoiceSummaryDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(
    async (cursor: string | null = null) => {
      if (!selectedSalonId) return;
      const id = ++requestId.current;
      try {
        const page = await apiFetch<InvoiceListDto>(ownerOpsPaths.invoices(selectedSalonId, { payment: filter, q: query.trim() || undefined, cursor }));
        if (id !== requestId.current) return;
        setItems((current) => (cursor && current ? [...current, ...page.items] : page.items));
        setNext(page.nextCursor);
        setError(null);
      } catch (err) {
        if (id !== requestId.current) return;
        setError(err instanceof ApiError ? err.message : 'Could not load invoices.');
      }
    },
    [selectedSalonId, filter, query],
  );

  useEffect(() => {
    setItems(null);
  }, [selectedSalonId, filter]);

  // The search box refetches shortly after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => void load(), query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!selectedSalonId) {
    return (
      <PremiumScreen scroll={false}>
        <EmptyState title="Choose a shop" message="Select a shop to see its invoices." />
      </PremiumScreen>
    );
  }

  return (
    <PremiumScreen>
      <PremiumSectionHeader eyebrow="Business" title="Billing & invoices" subtitle="Invoices are created from completed services at their real prices. “Paid” always means a payment your shop recorded here." />
      <PremiumTextField testID="invoice-search" value={query} onChangeText={setQuery} placeholder="Search invoice number or customer" accessibilityLabel="Search invoices" autoCapitalize="none" />
      <View style={styles.filters}>
        <ChipRow>
          {PAYMENT_FILTERS.map((f) => (
            <Chip key={f.id} testID={`invoice-filter-${f.id}`} label={f.label} selected={filter === f.id} onPress={() => setFilter(f.id)} />
          ))}
        </ChipRow>
      </View>
      {error && <InlineError message={error} />}
      {items === null && !error ? (
        <Skeleton style={styles.skeleton} />
      ) : items && items.length === 0 ? (
        <EmptyState title="No invoices yet" message="Complete a service and create its invoice from the Live Queue or Bookings." />
      ) : (
        items?.map((inv) => {
          const view = paymentStatusView(inv);
          return (
            <Pressable key={inv.id} testID={`invoice-${inv.number}`} accessibilityRole="button" accessibilityLabel={`Invoice ${inv.number}, ${view.label}`} onPress={() => navigation.navigate('OwnerInvoiceDetail', { invoiceId: inv.id })}>
              <PremiumCard style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.number}>{inv.number}</Text>
                  <StatusPill label={view.label} tone={view.tone} />
                </View>
                <Text style={styles.sub}>
                  {inv.customerName ?? 'Customer'} · {formatShopDate(inv.issuedAt, null)} · {inv.sourceType === 'QUEUE_ENTRY' ? 'Live Queue visit' : 'Appointment'}
                </Text>
                <View style={styles.rowTop}>
                  <Text style={styles.amount}>{formatMoney(inv.total, inv.currency)}</Text>
                  {inv.balanceDue > 0 && inv.status === 'ISSUED' ? <Text style={styles.due}>{formatMoney(inv.balanceDue, inv.currency)} due</Text> : null}
                </View>
              </PremiumCard>
            </Pressable>
          );
        })
      )}
      {next && (
        <PremiumButton
          title="Load more"
          variant="secondary"
          loading={loadingMore}
          onPress={() => {
            setLoadingMore(true);
            void load(next).finally(() => setLoadingMore(false));
          }}
        />
      )}
    </PremiumScreen>
  );
}

const styles = StyleSheet.create({
  filters: { marginVertical: space[3] },
  skeleton: { height: 110, borderRadius: radius.lg },
  row: { marginBottom: space[2], gap: space[1] },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  number: { fontFamily: font.bodyBold, fontSize: fontSize.base, color: fastQue.text },
  sub: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted },
  amount: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: fastQue.text },
  due: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: fastQue.warning },
});
