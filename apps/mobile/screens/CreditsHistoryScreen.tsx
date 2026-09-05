import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { CREDITS_PATHS, CreditTransactionType, formatMoney } from '@barbercue/shared';
import type {
  CustomerCreditBalanceDto,
  CustomerCreditTransactionDto,
  PaginatedResult,
  UiStrings,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { dateLocaleFor } from '../lib/date-locale';
import { useLanguage } from '../lib/language-context';
import { color, font, fontSize, lineHeightFor, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Skeleton, EmptyState, InlineError, Button } from '../components/ui';

function loadPage(cursor?: string): Promise<PaginatedResult<CustomerCreditTransactionDto>> {
  const query = cursor ? `?cursor=${cursor}` : '';
  return apiFetch<PaginatedResult<CustomerCreditTransactionDto>>(
    `${CREDITS_PATHS.credits}/${CREDITS_PATHS.history}${query}`,
  );
}

// PROMO_GRANT/RESTORED add to the wallet, REDEEMED subtracts, MANUAL_ADJUSTMENT is reserved
// (never written by any code today) — see CreditTransactionType's own schema.prisma doc comment.
function entryLabel(t: UiStrings, type: CustomerCreditTransactionDto['type']): string {
  switch (type) {
    case CreditTransactionType.PROMO_GRANT:
      return t.promoGrantEntryLabel;
    case CreditTransactionType.REDEEMED:
      return t.redeemedCreditsEntryLabel;
    case CreditTransactionType.RESTORED:
      return t.restoredCreditsEntryLabel;
    case CreditTransactionType.MANUAL_ADJUSTMENT:
      return t.manualAdjustmentEntryLabel;
    default:
      return type;
  }
}

function isCredit(type: CustomerCreditTransactionDto['type']): boolean {
  return type === CreditTransactionType.PROMO_GRANT || type === CreditTransactionType.RESTORED;
}

function TransactionRow({ item }: { item: CustomerCreditTransactionDto }) {
  const { t, language } = useLanguage();
  const credit = isCredit(item.type);
  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{entryLabel(t, item.type)}</Text>
        <Text style={styles.rowMeta}>
          {new Date(item.createdAt).toLocaleDateString(dateLocaleFor(language), {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </Text>
        {item.reason && <Text style={styles.rowMeta}>{item.reason}</Text>}
      </View>
      <Text style={[styles.rowAmount, { color: credit ? color.success : color.accent }]}>
        {credit ? '+' : '−'}
        {formatMoney(item.amount, null)}
      </Text>
    </View>
  );
}

export default function CreditsHistoryScreen() {
  const { t } = useLanguage();
  const [balance, setBalance] = useState<CustomerCreditBalanceDto | null>(null);
  const [items, setItems] = useState<CustomerCreditTransactionDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((isRefresh: boolean) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    return Promise.all([
      apiFetch<CustomerCreditBalanceDto>(`${CREDITS_PATHS.credits}/${CREDITS_PATHS.balance}`),
      loadPage(),
    ])
      .then(([bal, page]) => {
        setBalance(bal);
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : t.couldNotLoadCreditsBalance))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [t.couldNotLoadCreditsBalance]);

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  async function handleLoadMore() {
    if (!nextCursor) return;
    const page = await loadPage(nextCursor);
    setItems((prev) => [...prev, ...page.items]);
    setNextCursor(page.nextCursor);
  }

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <SectionHeader eyebrow={t.fastQueCreditsLabel} title={t.walletBalanceLabel} />
      {loading ? (
        <View style={styles.skeletonStack}>
          <Skeleton style={styles.skeletonCard} />
          <Skeleton style={styles.skeletonCard} />
        </View>
      ) : error ? (
        <InlineError message={error} />
      ) : (
        <>
          <Text style={styles.balance}>{formatMoney(balance?.balance ?? 0, null)}</Text>
          <Text style={styles.sectionTitle}>{t.creditsHistoryTitle}</Text>
          {items.length === 0 ? (
            <EmptyState title={t.noCreditsHistoryYet} />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={color.accent} />}
              renderItem={({ item }) => <TransactionRow item={item} />}
              ListFooterComponent={
                nextCursor ? <Button title={t.loadMore} variant="outline" onPress={() => void handleLoadMore()} style={styles.loadMore} /> : null
              }
            />
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  skeletonStack: { gap: space[3] },
  skeletonCard: { height: 72, borderRadius: radius.lg },
  balance: {
    fontFamily: font.displaySemiBold,
    fontSize: fontSize['2xl'],
    lineHeight: lineHeightFor(fontSize['2xl']),
    color: color.ink,
    marginVertical: space[3],
  },
  sectionTitle: {
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.sm,
    lineHeight: lineHeightFor(fontSize.sm),
    color: color.ink,
    marginBottom: space[2],
  },
  listContent: { paddingTop: space[1] },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space[3],
    marginBottom: space[2],
  },
  rowBody: { flex: 1, marginRight: space[2] },
  rowTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink },
  rowMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.muted, marginTop: 2 },
  rowAmount: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm) },
  loadMore: { marginTop: space[2] },
});
