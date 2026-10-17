"use client";

import type { CustomerSegmentFilter, CustomerSort } from "../../lib/customer-directory";
import { SEGMENT_FILTERS, SORT_OPTIONS } from "../../lib/customer-directory";
import styles from "./customer-filter.module.css";

/**
 * Search, segment chips (each with the count it will show) and sort for the owner Customers list.
 * Chips are toggle buttons (aria-pressed); the status line is a polite live region.
 */
export function CustomerFilterBar({
  search,
  onSearchChange,
  segment,
  onSegmentChange,
  counts,
  sort,
  onSortChange,
  shown,
  loaded,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  segment: CustomerSegmentFilter;
  onSegmentChange: (value: CustomerSegmentFilter) => void;
  counts: Record<CustomerSegmentFilter, number>;
  sort: CustomerSort;
  onSortChange: (value: CustomerSort) => void;
  shown: number;
  loaded: number;
}) {
  const filtering = search.trim() !== "" || segment !== "all";
  return (
    <div className={styles.bar} role="search" aria-label="Find customers">
      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="customer-search">Search customers</label>
          <input
            id="customer-search"
            type="search"
            className={styles.input}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Phone number or email"
            maxLength={80}
            autoComplete="off"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="customer-sort">Sort by</label>
          <select id="customer-sort" className={styles.input} value={sort} onChange={(e) => onSortChange(e.target.value as CustomerSort)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className={styles.chips} role="group" aria-label="Filter by customer type">
        {SEGMENT_FILTERS.map((s) => (
          <button key={s.id} type="button" className={styles.chip} aria-pressed={segment === s.id} onClick={() => onSegmentChange(s.id)}>
            {s.label} ({counts[s.id]})
          </button>
        ))}
      </div>
      <p className={styles.status} role="status" aria-live="polite">
        {filtering ? `Showing ${shown} of ${loaded} loaded customers` : `${loaded} customer${loaded === 1 ? "" : "s"} loaded`}
        {filtering && (
          <button type="button" className={styles.clear} onClick={() => { onSearchChange(""); onSegmentChange("all"); }}>Clear filters</button>
        )}
      </p>
    </div>
  );
}
