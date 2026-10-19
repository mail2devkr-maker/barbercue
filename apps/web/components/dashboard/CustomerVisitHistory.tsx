"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OwnerCustomerHistoryPageDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import {
  EMPTY_FILTER,
  HISTORY_SOURCES,
  HISTORY_STATUSES,
  formatCents,
  formatVisitTime,
  historyQueryString,
  invoiceTotals,
  isFiltering,
  methodLabel,
  sourceLabel,
  statusLabel,
  toCents,
  validateHistoryRange,
  visitTitle,
  type HistoryFilter,
} from "../../lib/customer-history";
import { Button } from "../ui/Button";
import styles from "./dashboard.module.css";

/**
 * Visit history for one customer account at this shop (requirement #5): online bookings, in-shop appointments and
 * Live Queue visits, newest first, with the invoices and payments the shop recorded. Every row comes from the server;
 * nothing is merged by name or phone, and a visit's recorded label is shown as recorded, never as the account's name.
 */
export function CustomerVisitHistory({ salonId, customerId }: { salonId: string; customerId: string }) {
  const historyPath = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.customers}/${customerId}/history`;
  const [filter, setFilter] = useState<HistoryFilter>(EMPTY_FILTER);
  const [applied, setApplied] = useState<HistoryFilter>(EMPTY_FILTER);
  const [page, setPage] = useState<OwnerCustomerHistoryPageDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(
    async (next: HistoryFilter) => {
      const mine = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const result = await apiFetch<OwnerCustomerHistoryPageDto>(`${historyPath}?${historyQueryString(next, null)}`);
        if (mine !== request.current) return;
        setPage(result);
        setApplied(next);
      } catch (err) {
        if (mine !== request.current) return;
        setPage(null);
        // The server answers 404 when the account has no visits at this shop at all.
        if (err instanceof ApiError && err.status === 404) setPage({ salonId, customerId, salonTimezone: "UTC", items: [], nextCursor: null });
        else setError(err instanceof ApiError ? err.message : "Could not load this customer's visits.");
      } finally {
        if (mine === request.current) setLoading(false);
      }
    },
    [historyPath, salonId, customerId],
  );

  useEffect(() => {
    void Promise.resolve().then(() => load(EMPTY_FILTER));
  }, [load]);

  async function showMore() {
    if (!page?.nextCursor) return;
    const mine = ++request.current;
    setLoadingMore(true);
    setError(null);
    try {
      // The cursor belongs to the filters it was issued for, so it is always sent with the applied (not the edited) ones.
      const result = await apiFetch<OwnerCustomerHistoryPageDto>(`${historyPath}?${historyQueryString(applied, page.nextCursor)}`);
      if (mine !== request.current) return;
      setPage({ ...result, items: [...page.items, ...result.items] });
    } catch (err) {
      if (mine === request.current) setError(err instanceof ApiError ? err.message : "Could not load more visits.");
    } finally {
      if (mine === request.current) setLoadingMore(false);
    }
  }

  function apply(next: HistoryFilter) {
    const problem = validateHistoryRange(next.from, next.to);
    setRangeError(problem);
    setFilter(next);
    if (problem) return;
    void load(next);
  }

  return (
    <section aria-label="Visit history">
      <h2 className={styles.sectionHeading}>Visit history</h2>
      <p className={styles.rowMeta}>
        Visits by this account at your shop. Amounts are only what your shop recorded in FastQue; cash or refunds not recorded here are not included. This account has no verified name, so none is shown.
      </p>

      <div role="search" aria-label="Filter visits" style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "12px 0" }}>
        <label>
          <span className={styles.rowMeta}>Type</span>
          <select id="history-source" value={filter.source} onChange={(e) => apply({ ...filter, source: e.target.value })} disabled={loading}>
            <option value="">All</option>
            {HISTORY_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={styles.rowMeta}>Status</span>
          <select id="history-status" value={filter.status} onChange={(e) => apply({ ...filter, status: e.target.value })} disabled={loading}>
            <option value="">All</option>
            {HISTORY_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={styles.rowMeta}>From</span>
          <input id="history-from" type="date" value={filter.from} onChange={(e) => apply({ ...filter, from: e.target.value })} />
        </label>
        <label>
          <span className={styles.rowMeta}>To</span>
          <input id="history-to" type="date" value={filter.to} min={filter.from || undefined} onChange={(e) => apply({ ...filter, to: e.target.value })} />
        </label>
        {isFiltering(filter) && (
          <Button type="button" variant="outline" onClick={() => apply(EMPTY_FILTER)} disabled={loading}>Clear filters</Button>
        )}
      </div>

      {rangeError && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{rangeError}</p>}
      {error && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</p>}
      {loading && <p className={styles.loadingText}>Loading visits…</p>}

      {!loading && page && page.items.length === 0 && !error && (
        <p className={styles.emptyState}>{isFiltering(applied) ? "No visits match these filters." : "No visits recorded for this customer at your shop yet."}</p>
      )}

      {page && page.items.length > 0 && (
        <ul className={styles.rowList} aria-busy={loading}>
          {page.items.map((entry) => (
            <li key={`${entry.source}-${entry.id}`} className={styles.row} style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div>
                <span className={styles.rowTitle}>{visitTitle(entry)}</span>{" "}
                <span className={`${styles.statusBadge} ${styles.statusMuted}`}>{statusLabel(entry.status)}</span>
              </div>
              <div className={styles.rowMeta}>
                {sourceLabel(entry.source)} · {formatVisitTime(entry.occurredAt, page.salonTimezone)}
                {entry.staffName && ` · With ${entry.staffName}`}
                {entry.recordedName && ` · Recorded as “${entry.recordedName}”`}
              </div>
              {entry.invoices.length === 0 && entry.status === "COMPLETED" && (
                <div className={styles.rowMeta}>No invoice recorded for this visit.</div>
              )}
              {entry.invoices.map((invoice) => {
                const totals = invoiceTotals(invoice);
                return (
                  <div key={invoice.id} className={styles.rowMeta} data-testid="history-invoice">
                    Invoice {invoice.number}
                    {invoice.status === "VOID" && " (void)"} · Total {formatCents(totals.totalCents, invoice.currency)}
                    {totals.discountCents !== null && totals.discountCents > 0 && ` · Discount ${formatCents(totals.discountCents, invoice.currency)}`}
                    {" · "}Recorded by shop {formatCents(totals.netCents, invoice.currency)}
                    {invoice.payments.length > 0 && (
                      <ul style={{ margin: "4px 0 0 16px" }}>
                        {invoice.payments.map((p, i) => (
                          <li key={i}>
                            {p.kind === "REFUND" ? "Refund" : "Payment"} · {methodLabel(p.method)} · {formatCents(toCents(p.amount), invoice.currency)} · {formatVisitTime(p.recordedAt, page.salonTimezone)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </li>
          ))}
        </ul>
      )}

      {page?.nextCursor && (
        <Button type="button" variant="outline" onClick={() => void showMore()} disabled={loadingMore || loading}>
          {loadingMore ? "Loading…" : "Show more visits"}
        </Button>
      )}
    </section>
  );
}
