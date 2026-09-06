"use client";

import { useEffect, useState } from "react";
import { CREDITS_PATHS, CreditTransactionType, formatMoney } from "@barbercue/shared";
import type { CustomerCreditBalanceDto, CustomerCreditTransactionDto, PaginatedResult } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../lib/api";
import { Card } from "../../../../components/ui/Card";
import { Button } from "../../../../components/ui/Button";
import styles from "./credits.module.css";

function loadPage(cursor?: string): Promise<PaginatedResult<CustomerCreditTransactionDto>> {
  const query = cursor ? `?cursor=${cursor}` : "";
  return apiFetch<PaginatedResult<CustomerCreditTransactionDto>>(`${CREDITS_PATHS.credits}/${CREDITS_PATHS.history}${query}`);
}

// Wording per the Part 10 spec's own examples — deliberately more descriptive than mobile's
// shorter CreditsHistoryScreen labels (mobile is not being redesigned; this is a new web surface).
function entryLabel(type: CustomerCreditTransactionDto["type"]): string {
  switch (type) {
    case CreditTransactionType.PROMO_GRANT:
      return "Promotional credit";
    case CreditTransactionType.REDEEMED:
      return "Used for booking";
    case CreditTransactionType.RESTORED:
      return "Credits restored";
    case CreditTransactionType.MANUAL_ADJUSTMENT:
      return "Account adjustment";
    default:
      return type;
  }
}

// PROMO_GRANT/RESTORED add to the wallet, REDEEMED subtracts — amount itself is always positive
// (see CreditTransactionType's schema.prisma doc comment), so direction always comes from type.
function isCredit(type: CustomerCreditTransactionDto["type"]): boolean {
  return type === CreditTransactionType.PROMO_GRANT || type === CreditTransactionType.RESTORED;
}

function formatEntryDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// A lot with a past expiresAt is already excluded from balance/redemption server-side — this is
// shown for transparency only, never re-derived into a client-side spendability decision.
function expiryLabel(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  return new Date(expiresAt).getTime() < Date.now() ? "Expired" : `Expires ${formatEntryDate(expiresAt)}`;
}

function TransactionRow({ item }: { item: CustomerCreditTransactionDto }) {
  const credit = isCredit(item.type);
  const expiry = expiryLabel(item.expiresAt);
  return (
    <div className={styles.transactionRow}>
      <div className={styles.transactionBody}>
        <p className={styles.transactionTitle}>{entryLabel(item.type)}</p>
        <p className={styles.transactionMeta}>{formatEntryDate(item.createdAt)}</p>
        {item.reason && <p className={styles.transactionMeta}>{item.reason}</p>}
        {item.campaignRef && <p className={styles.transactionMeta}>Promotion: {item.campaignRef}</p>}
        {expiry && <p className={styles.transactionMeta}>{expiry}</p>}
      </div>
      <span className={`${styles.transactionAmount} ${credit ? styles.amountCredit : styles.amountDebit}`}>
        {credit ? "+" : "−"}
        {formatMoney(item.amount, null)}
      </span>
    </div>
  );
}

export default function CreditsPage() {
  const [balance, setBalance] = useState<CustomerCreditBalanceDto | null>(null);
  const [items, setItems] = useState<CustomerCreditTransactionDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        setLoading(true);
        setError(null);
        return Promise.all([
          apiFetch<CustomerCreditBalanceDto>(`${CREDITS_PATHS.credits}/${CREDITS_PATHS.balance}`),
          loadPage(),
        ]);
      })
      .then((result) => {
        if (cancelled || !result) return;
        const [bal, page] = result;
        setBalance(bal);
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load your FastQue Credits.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await loadPage(nextCursor);
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load more history.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.heroEyebrow}>FastQue Credits</p>
        <p className={styles.balanceLabel}>Available balance</p>
        {loading ? (
          <span className={styles.loadingPulse} aria-hidden="true" />
        ) : (
          <p className={styles.balanceValue} role="status">
            {formatMoney(balance?.balance ?? 0, null)}
          </p>
        )}
      </header>

      {error && (
        <div className={styles.errorPanel} role="alert">
          <strong>We couldn&apos;t load everything.</strong>
          <p>{error} Refresh the page to try again.</p>
        </div>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Credit history</h2>
        {loading ? (
          <Card className={styles.loadingCard}>
            <span className={styles.loadingPulse} aria-hidden="true" />
            <p role="status">Loading your credit history…</p>
          </Card>
        ) : items.length === 0 ? (
          <Card className={styles.emptyState}>
            <p className={styles.emptyTitle}>No FastQue Credits activity yet.</p>
            <p className={styles.emptyText}>
              Promotional credits may appear here through eligible FastQue promotions. Completing a
              service does not automatically earn credits.
            </p>
          </Card>
        ) : (
          <>
            {items.map((item) => (
              <TransactionRow key={item.id} item={item} />
            ))}
            {nextCursor && (
              <div className={styles.loadMoreWrap}>
                <Button type="button" variant="outline" onClick={() => void handleLoadMore()} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
