import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DASHBOARD_PATHS, formatMoney, type OwnerCustomerSummaryDto, type PaginatedResult } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { color, font, fontSize, space } from '../../lib/theme';
import { Screen, SectionHeader, Button, EmptyState, Skeleton, InlineError } from '../../components/ui';
import { useLanguage } from '../../lib/language-context';
import type { UiStrings } from '@barbercue/shared';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

function segmentLabel(t: UiStrings, segment: string): string {
  const labels: Record<string, string> = { new: t.segmentNew, repeat: t.segmentRepeat, frequent: t.segmentFrequent };
  return labels[segment] ?? segment;
}

function customersPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.customers}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Issue 1 (Manage Shop parity) — the owner customer CRM/ledger surface already fully built for
 * web (dashboard/salons/:salonId/customers) reused via the same backend contract, not
 * reimplemented. List here, waive/restore lives on the detail screen (OwnerCustomerDetailScreen).
 */
export default function OwnerCustomersScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OwnerShopStackParamList>>();
  const { selectedSalonId } = useSalon();
  const { t } = useLanguage();
  const [items, setItems] = useState<OwnerCustomerSummaryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(
    (offset: string | undefined, append: boolean) => {
      if (!selectedSalonId) return Promise.resolve();
      if (append) setLoadingMore(true);
      const params = new URLSearchParams({ limit: '20' });
      if (offset) params.set('offset', offset);
      return apiFetch<PaginatedResult<OwnerCustomerSummaryDto>>(`${customersPath(selectedSalonId)}?${params}`)
        .then((result) => {
          setItems((prev) => (append ? [...prev, ...result.items] : result.items));
          setNextCursor(result.nextCursor);
        })
        .catch((err: unknown) => setError(err instanceof ApiError ? err.message : t.couldNotLoadCustomers))
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        });
    },
    [selectedSalonId],
  );

  useFocusEffect(
    useCallback(() => {
      void loadPage(undefined, false);
    }, [loadPage]),
  );

  if (!selectedSalonId) {
    return (
      <Screen scroll={false}>
        <EmptyState title={t.selectShopTitle} message={t.chooseShopHint} />
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadPage(undefined, false); }}>
      <SectionHeader eyebrow={t.ownerEyebrow} title={t.customersTitle} subtitle={t.customersSubtitle} />
      {error && <InlineError message={error} />}
      {loading ? (
        <Skeleton style={styles.skeleton} />
      ) : items.length === 0 ? (
        <EmptyState title={t.noCustomersYetTitle} message={t.noCustomersYetHint} />
      ) : (
        items.map((c) => (
          <Pressable
            key={c.customerId}
            style={styles.row}
            onPress={() => navigation.navigate('OwnerCustomerDetail', { customerId: c.customerId })}
          >
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>{c.phone ?? c.email ?? t.noContactOnFile}</Text>
              <Text style={styles.rowMeta}>
                {c.completedCount} {t.statusCompleted} · {c.cancelledCount} {t.statusCancelled} · {c.noShowCount} {t.statusNoShow}
              </Text>
              {c.outstandingTotalAmount > 0 && (
                <Text style={styles.dueText}>{formatMoney(c.outstandingTotalAmount, c.currency)}{t.outstandingSuffix}</Text>
              )}
            </View>
            {c.segment && <Text style={styles.segmentBadge}>{segmentLabel(t, c.segment)}</Text>}
          </Pressable>
        ))
      )}
      {nextCursor && (
        <Button
          title={loadingMore ? t.loading : t.loadMore}
          variant="outline"
          onPress={() => void loadPage(nextCursor, true)}
          loading={loadingMore}
          style={styles.loadMoreButton}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeleton: { height: 90, borderRadius: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 12,
    padding: space[4],
    marginBottom: space[3],
  },
  rowBody: { flex: 1, paddingRight: space[2] },
  rowTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  rowMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  dueText: { fontFamily: font.bodyBold, fontSize: fontSize.xs, color: color.gold, marginTop: 4 },
  segmentBadge: {
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: color.muted,
  },
  loadMoreButton: { marginTop: space[2], marginBottom: space[6] },
});
