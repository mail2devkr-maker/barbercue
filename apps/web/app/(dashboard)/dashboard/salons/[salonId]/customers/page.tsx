"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS, formatMoney } from "@barbercue/shared";
import type { OwnerCustomerSummaryDto, PaginatedResult } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { Button } from "../../../../../../components/ui/Button";
import { CustomerFilterBar } from "../../../../../../components/dashboard/CustomerFilterBar";
import {
  filterCustomers,
  loadCustomerPages,
  repeatVisits,
  segmentCounts,
  serverSearchTerm,
  sortCustomers,
  CUSTOMER_PAGE_SIZE,
  type CustomerSegmentFilter,
  type CustomerSort,
} from "../../../../../../lib/customer-directory";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

const SEGMENT_LABEL: Record<string, string> = {
  new: "New",
  repeat: "Repeat",
  frequent: "Frequent",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function customersPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.customers}`;
}

/**
 * Owner customer history/CRM (Phase 8) — derived entirely from this salon's own Booking/QueueEntry
 * rows (no separate "customer" record exists). The server pages by offset (see the backend's own comment on
 * why groupBy results can't use the usual cursor convention). This page loads batches of up to 1,000 customers,
 * then searches, filters and sorts those loaded rows; it always says how many are loaded and offers the next
 * batch. Names and total spend are not available from the API yet, so none are shown.
 */
export default function DashboardCustomersPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = use(params);
  const [items, setItems] = useState<OwnerCustomerSummaryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // The server is asked only after the owner pauses typing, so each keystroke does not start a search.
  const [searchTerm, setSearchTerm] = useState<string | null>(null);
  const [segment, setSegment] = useState<CustomerSegmentFilter>("all");
  const [sort, setSort] = useState<CustomerSort>("lastVisit");

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(serverSearchTerm(search)), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchPage = useCallback(
    (cursor: string | undefined) => {
      const query = new URLSearchParams({ limit: String(CUSTOMER_PAGE_SIZE) });
      if (searchTerm) query.set("q", searchTerm);
      if (cursor) query.set("offset", cursor);
      return apiFetch<PaginatedResult<OwnerCustomerSummaryDto>>(`${customersPath(salonId)}?${query}`);
    },
    [salonId, searchTerm],
  );

  useEffect(() => {
    let cancelled = false;
    // Deferred a tick so this effect body never calls setState synchronously.
    void Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setLoading(true);
        setError(null);
        return loadCustomerPages(fetchPage);
      })
      .then((result) => {
        if (cancelled || !result) return;
        setItems(result.items);
        setNextCursor(result.nextCursor);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setItems([]);
        setNextCursor(null);
        setError(err instanceof ApiError ? err.message : "Could not load customers.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await loadCustomerPages(fetchPage, nextCursor);
      setItems((prev) => [...prev, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load more customers.");
    } finally {
      setLoadingMore(false);
    }
  }

  const counts = useMemo(() => segmentCounts(items), [items]);
  const visible = useMemo(() => sortCustomers(filterCustomers(items, segment), sort), [items, segment, sort]);
  const searching = searchTerm !== null;

  return (
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Customers</h1>
      <p className={styles.pageSubtitle}>
        Everyone who has booked at your shop, with visit history and repeat/frequent markers based
        on completed visits here — never inferred from anything else about them. Search covers your whole shop by
        phone number or email; the type filter and sorting apply to the customers loaded below.
      </p>

      {error && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</p>}
      {loading && <p className={styles.loadingText}>Loading…</p>}
      {!loading && items.length === 0 && !error && (
        <p className={styles.emptyState}>{searching ? "No customer matches this phone number or email." : "No one has booked at your shop yet."}</p>
      )}

      {(items.length > 0 || searching) && (
        <CustomerFilterBar
          search={search}
          onSearchChange={setSearch}
          segment={segment}
          onSegmentChange={setSegment}
          counts={counts}
          sort={sort}
          onSortChange={setSort}
          shown={visible.length}
          loaded={items.length}
        />
      )}

      {items.length > 0 && visible.length === 0 && (
        <p className={styles.emptyState}>No loaded customer matches this filter.{nextCursor ? " Load more customers to search further." : ""}</p>
      )}

      {visible.length > 0 && (
        <ul className={styles.rowList} style={{ margin: "16px 0" }}>
          {visible.map((c) => (
            <li key={c.customerId} className={styles.row}>
              <Link
                href={`/${customersPath(salonId)}/${c.customerId}`}
                style={{ minWidth: 0, flex: "1 1 220px", textDecoration: "none", color: "inherit" }}
              >
                <span className={styles.rowTitle}>{c.phone ?? c.email ?? "No contact on file"}</span>
                <div className={styles.rowMeta}>
                  {c.completedCount} completed · {repeatVisits(c)} repeat visit{repeatVisits(c) === 1 ? "" : "s"} · {c.cancelledCount} cancelled · {c.noShowCount} no-show
                  {c.preferredServiceName && ` · Usually books ${c.preferredServiceName}`}
                  {c.preferredStaffName && ` · With ${c.preferredStaffName}`}
                  {c.outstandingTotalAmount > 0 && ` · ${formatMoney(c.outstandingTotalAmount, c.currency)} outstanding`}
                </div>
                <div className={styles.rowMeta}>
                  First visit {formatDate(c.firstVisitAt)} · Last visit {formatDate(c.lastVisitAt)}
                </div>
              </Link>
              {c.segment && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                    padding: "3px 10px",
                    borderRadius: 999,
                    color: c.segment === "frequent" ? "var(--bc-success)" : "var(--bc-muted)",
                    background:
                      c.segment === "frequent" ? "color-mix(in srgb, var(--bc-success) 14%, transparent)" : "var(--bc-surface)",
                    border: "1px solid var(--bc-border)",
                  }}
                >
                  {SEGMENT_LABEL[c.segment]}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <div>
          <p className={styles.rowMeta}>More customers are available. Search and filters cover the {items.length} loaded so far.</p>
          <Button type="button" variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more customers"}
          </Button>
        </div>
      )}
    </main>
  );
}
