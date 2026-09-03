"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OwnerCustomerSummaryDto, PaginatedResult } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { Button } from "../../../../../../components/ui/Button";
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
 * rows (no separate "customer" record exists). Offset-paginated (see the backend's own comment on
 * why groupBy results can't use the usual cursor convention) but the response shape and "Load
 * more" UX are identical to every other dashboard list.
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

  const loadPage = useCallback(
    (offset: string | undefined, append: boolean) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }
      const params2 = new URLSearchParams({ limit: "20" });
      if (offset) params2.set("offset", offset);
      return apiFetch<PaginatedResult<OwnerCustomerSummaryDto>>(`${customersPath(salonId)}?${params2}`)
        .then((result) => {
          setItems((prev) => (append ? [...prev, ...result.items] : result.items));
          setNextCursor(result.nextCursor);
        })
        .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load customers."))
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [salonId],
  );

  useEffect(() => {
    // Deferred a tick so this effect body never calls setState synchronously.
    void Promise.resolve().then(() => loadPage(undefined, false));
  }, [loadPage]);

  return (
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Customers</h1>
      <p className={styles.pageSubtitle}>
        Everyone who has booked at your shop, with visit history and repeat/frequent markers based
        on completed visits here — never inferred from anything else about them.
      </p>

      {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
      {loading && <p className={styles.loadingText}>Loading…</p>}
      {!loading && items.length === 0 && (
        <p className={styles.emptyState}>No one has booked at your shop yet.</p>
      )}

      {items.length > 0 && (
        <ul className={styles.rowList} style={{ margin: "16px 0" }}>
          {items.map((c) => (
            <li key={c.customerId} className={styles.row}>
              <Link
                href={`/${customersPath(salonId)}/${c.customerId}`}
                style={{ minWidth: 0, flex: "1 1 220px", textDecoration: "none", color: "inherit" }}
              >
                <span className={styles.rowTitle}>{c.phone ?? c.email ?? "No contact on file"}</span>
                <div className={styles.rowMeta}>
                  {c.completedCount} completed · {c.cancelledCount} cancelled · {c.noShowCount} no-show
                  {c.preferredServiceName && ` · Usually books ${c.preferredServiceName}`}
                  {c.preferredStaffName && ` · With ${c.preferredStaffName}`}
                  {c.outstandingTotalAmount > 0 && ` · ${c.outstandingTotalAmount} outstanding`}
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
        <Button type="button" variant="outline" onClick={() => void loadPage(nextCursor, true)} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </main>
  );
}
