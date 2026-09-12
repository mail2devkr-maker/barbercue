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
import { color, fastQue, font, fontSize, lineHeightFor, premiumShadow, radius, space } from '../lib/theme';
import { Skeleton, EmptyState, InlineError, PremiumButton, PremiumCard, PremiumScreen, PremiumSectionHeader } from '../components/ui';

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
      <Text style={[styles.rowAmount, { color: credit ? fastQue.success : fastQue.pink }]}>
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
    <PremiumScreen scroll={false} contentStyle={styles.screenContent}>
      <PremiumSectionHeader eyebrow={t.fastQueCreditsLabel} title={t.walletBalanceLabel} />
      {loading ? (
        <View style={styles.skeletonStack}>
          <Skeleton style={styles.skeletonCard} />
          <Skeleton style={styles.skeletonCard} />
        </View>
      ) : error ? (
        <InlineError message={error} />
      ) : (
        <>
          <PremiumCard strong style={styles.balanceCard}><Text style={styles.balance}>{formatMoney(balance?.balance ?? 0, null)}</Text></PremiumCard>
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
                nextCursor ? <PremiumButton title={t.loadMore} variant="quiet" onPress={() => void handleLoadMore()} style={styles.loadMore} /> : null
              }
            />
          )}
        </>
      )}
    </PremiumScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  skeletonStack: { gap: space[3] },
  skeletonCard: { height: 72, borderRadius: radius.lg },
  balanceCard: { marginBottom: space[4] },
  balance: {
    fontFamily: font.displaySemiBold,
    fontSize: fontSize['2xl'],
    lineHeight: lineHeightFor(fontSize['2xl']),
    color: fastQue.text,
  },
  sectionTitle: {
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.sm,
    lineHeight: lineHeightFor(fontSize.sm),
    color: fastQue.text,
    marginBottom: space[2],
  },
  listContent: { paddingTop: space[1] },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: fastQue.card,
    borderWidth: 1,
    borderColor: fastQue.border,
    borderRadius: radius.lg,
    padding: space[3],
    marginBottom: space[2],
    ...premiumShadow,
  },
  rowBody: { flex: 1, marginRight: space[2] },
  rowTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: fastQue.text },
  rowMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: fastQue.textMuted, marginTop: 2 },
  rowAmount: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm) },
  loadMore: { marginTop: space[2] },
});
