"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OwnerCustomerDirectoryItemDto } from "@barbercue/shared";
import { Button } from "../ui/Button";
import { useCursorList } from "../../lib/use-cursor-list";
import {
  DIRECTORY_SEGMENTS,
  DIRECTORY_SORTS,
  EMPTY_DIRECTORY_FILTER,
  contactLine,
  directoryErrorText,
  directoryParams,
  isFilteringDirectory,
  minVisitsProblem,
  moneyText,
  repeatText,
  segmentLabel,
  spendNote,
  visitsText,
  type DirectoryFilter,
  type DirectorySort,
} from "../../lib/customer-crm";
import styles from "./dashboard.module.css";
import filterStyles from "./customer-filter.module.css";

const MISMATCH_CODES = ["INVALID_FILTER"] as const;
const OPTIONS = { mismatchCodes: MISMATCH_CODES, errorText: directoryErrorText };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * The owner Customers directory on the server-side directory API: search, segment, sort and a minimum number of completed
 * visits are all answered by the server for the whole shop, and "Show more customers" continues with the signed cursor the
 * server issued for exactly those filters. If the server does not have the directory route (an older backend), it tells the
 * page so the older list can be shown instead.
 */
export function CustomerDirectory({ salonId, onRouteMissing }: { salonId: string; onRouteMissing?: () => void }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.customers}`;
  const [draft, setDraft] = useState<DirectoryFilter>(EMPTY_DIRECTORY_FILTER);
  const [applied, setApplied] = useState<DirectoryFilter>(EMPTY_DIRECTORY_FILTER);
  const minVisitsError = minVisitsProblem(draft.minVisits);

  // The server is asked only after the owner pauses typing, and never with a value it would reject.
  useEffect(() => {
    const timer = setTimeout(() => setApplied({ ...draft, minVisits: minVisitsProblem(draft.minVisits) ? "" : draft.minVisits }), 400);
    return () => clearTimeout(timer);
  }, [draft]);

  const list = useCursorList<OwnerCustomerDirectoryItemDto>(`${base}/directory`, directoryParams(applied), true, OPTIONS);
  const missing = useRef(false);
  useEffect(() => {
    if (list.errorStatus === 404 && !missing.current) {
      missing.current = true;
      onRouteMissing?.();
    }
  }, [list.errorStatus, onRouteMissing]);

  const filtering = isFilteringDirectory(draft);
  const pending = JSON.stringify(directoryParams(draft)) !== JSON.stringify(directoryParams(applied));

  return (
    <>
      <div className={filterStyles.bar} role="search" aria-label="Find customers">
        <div className={filterStyles.row}>
          <div className={filterStyles.field}>
            <label className={filterStyles.label} htmlFor="customer-search">Search customers</label>
            <input
              id="customer-search"
              type="search"
              className={filterStyles.input}
              value={draft.search}
              onChange={(e) => setDraft({ ...draft, search: e.target.value })}
              placeholder="Phone number or email"
              maxLength={120}
              autoComplete="off"
            />
          </div>
          <div className={filterStyles.field}>
            <label className={filterStyles.label} htmlFor="customer-sort">Sort by</label>
            <select
              id="customer-sort"
              className={filterStyles.input}
              value={draft.sort}
              onChange={(e) => setDraft({ ...draft, sort: e.target.value as DirectorySort })}
            >
              {DIRECTORY_SORTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className={filterStyles.field}>
            <label className={filterStyles.label} htmlFor="customer-min-visits">At least this many completed visits</label>
            <input
              id="customer-min-visits"
              type="text"
              inputMode="numeric"
              className={filterStyles.input}
              value={draft.minVisits}
              onChange={(e) => setDraft({ ...draft, minVisits: e.target.value })}
              placeholder="Any"
              maxLength={5}
              aria-invalid={minVisitsError ? true : undefined}
              aria-describedby={minVisitsError ? "customer-min-visits-error" : undefined}
            />
            {minVisitsError && <span id="customer-min-visits-error" className={styles.rowMeta} role="alert">{minVisitsError}</span>}
          </div>
        </div>
        <div className={filterStyles.chips} role="group" aria-label="Filter by customer type">
          {DIRECTORY_SEGMENTS.map((s) => (
            <button
              key={s.value || "all"}
              type="button"
              className={filterStyles.chip}
              aria-pressed={draft.segment === s.value}
              title={s.help}
              onClick={() => setDraft({ ...draft, segment: s.value })}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className={filterStyles.status} role="status" aria-live="polite">
          {list.loading || pending
            ? "Searching your whole shop…"
            : `${list.items.length} customer${list.items.length === 1 ? "" : "s"} shown${list.hasMore ? ", more available" : ""}`}
          {filtering && (
            <button type="button" className={filterStyles.clear} onClick={() => setDraft(EMPTY_DIRECTORY_FILTER)}>Clear filters</button>
          )}
        </p>
      </div>

      {list.notice && <p className={`${styles.banner} ${styles.bannerNotice}`} role="status">{list.notice}</p>}
      {list.error && list.errorStatus !== 404 && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{list.error}</p>}
      {list.loading && <p className={styles.loadingText}>Loading…</p>}
      {!list.loading && !list.error && list.items.length === 0 && (
        <p className={styles.emptyState}>
          {isFilteringDirectory(applied) ? "No customer matches these filters." : "No one has booked or joined the Live Queue at your shop yet."}
        </p>
      )}

      {list.items.length > 0 && (
        <ul className={styles.rowList} style={{ margin: "16px 0" }} aria-busy={list.loading}>
          {list.items.map((c) => {
            const segment = segmentLabel(c.segment);
            return (
              <li key={c.customerId} className={styles.row}>
                <Link href={`/${base}/${c.customerId}`} style={{ minWidth: 0, flex: "1 1 220px", textDecoration: "none", color: "inherit" }}>
                  <span className={styles.rowTitle}>{contactLine(c)}</span>
                  <div className={styles.rowMeta}>
                    {visitsText(c.completedVisitCount)} · {repeatText(c.repeatVisitCount)} · {c.cancelledCount} cancelled · {c.noShowCount} no-show
                  </div>
                  <div className={styles.rowMeta} title={spendNote(c, c.currency)}>
                    Recorded spend {moneyText(c.totalSpent, c.currency)}
                    {c.recordedRefunds > 0 && ` (after ${moneyText(c.recordedRefunds, c.currency)} refunded)`}
                    {" · "}Last visit {formatDate(c.lastVisitAt)}
                  </div>
                </Link>
                {segment && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.03em",
                      padding: "3px 10px",
                      borderRadius: 999,
                      color: c.segment === "frequent" ? "var(--bc-success)" : "var(--bc-muted)",
                      background: c.segment === "frequent" ? "color-mix(in srgb, var(--bc-success) 14%, transparent)" : "var(--bc-surface)",
                      border: "1px solid var(--bc-border)",
                    }}
                  >
                    {segment}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {list.hasMore && (
        <div>
          <Button type="button" variant="outline" onClick={list.loadMore} disabled={list.loadingMore || list.loading}>
            {list.loadingMore ? "Loading…" : "Show more customers"}
          </Button>
        </div>
      )}
    </>
  );
}
