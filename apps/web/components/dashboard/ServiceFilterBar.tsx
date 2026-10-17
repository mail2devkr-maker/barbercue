"use client";

import type { CategoryOption } from "../../lib/service-categories";
import styles from "./service-filter.module.css";

/**
 * Search box and category chips for the owner Services list. Chips are real toggle buttons (aria-pressed),
 * every chip shows how many services it will list, and "Clear" appears only when a filter is active.
 */
export function ServiceFilterBar({
  categories,
  visibleTotal,
  shownCount,
  search,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
}: {
  categories: ReadonlyArray<CategoryOption>;
  /** Services the list would show with no search and no category (the "All" count). */
  visibleTotal: number;
  /** Services shown right now. */
  shownCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  selectedCategory: string | null;
  onCategoryChange: (key: string | null) => void;
}) {
  const filtering = search.trim() !== "" || selectedCategory !== null;
  return (
    <div className={styles.bar} role="search" aria-label="Filter services">
      <div className={styles.searchRow}>
        <label className={styles.label} htmlFor="service-filter-search">Search services</label>
        <input
          id="service-filter-search"
          type="search"
          className={styles.search}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Haircut, facial, massage…"
          maxLength={80}
        />
      </div>
      {categories.length > 1 && (
        <div className={styles.chips} role="group" aria-label="Filter by category">
          <button type="button" className={styles.chip} aria-pressed={selectedCategory === null} onClick={() => onCategoryChange(null)}>
            All ({visibleTotal})
          </button>
          {categories.map((c) => (
            <button key={c.key || "none"} type="button" className={styles.chip} aria-pressed={selectedCategory === c.key} onClick={() => onCategoryChange(selectedCategory === c.key ? null : c.key)}>
              {c.label} ({c.count})
            </button>
          ))}
        </div>
      )}
      <p className={styles.status} role="status" aria-live="polite">
        {filtering ? `Showing ${shownCount} of ${visibleTotal} services` : `${visibleTotal} service${visibleTotal === 1 ? "" : "s"}`}
        {filtering && (
          <button type="button" className={styles.clear} onClick={() => { onSearchChange(""); onCategoryChange(null); }}>Clear filters</button>
        )}
      </p>
    </div>
  );
}
