"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkCategoryDto, WorkJobCardDto } from "@barbercue/shared";
import { errorText, workGet } from "../../../lib/work";
import { JobCard, WorkNav } from "./WorkUi";
import styles from "./work.module.css";

interface Filters {
  q: string;
  city: string;
  category: string;
  minPay: string;
  locationType: string;
  instantOnly: boolean;
}

const EMPTY: Filters = { q: "", city: "", category: "", minPay: "", locationType: "", instantOnly: false };

/** Public marketplace. Shows only funded jobs from verified businesses (filtered by the API). */
export default function WorkMarketplacePage() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [categories, setCategories] = useState<WorkCategoryDto[]>([]);
  const [jobs, setJobs] = useState<WorkJobCardDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((f: Filters, after?: string) => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.city) p.set("city", f.city);
    if (f.category) p.set("category", f.category);
    if (f.minPay) p.set("minPayPaise", String(Math.round(Number(f.minPay) * 100)));
    if (f.locationType) p.set("locationType", f.locationType);
    if (f.instantOnly) p.set("instantOnly", "true");
    if (after) p.set("cursor", after);
    setError(null);
    return workGet<{ items: WorkJobCardDto[]; nextCursor: string | null }>(`jobs?${p.toString()}`)
      .then((page) => {
        setJobs((cur) => (after && cur ? [...cur, ...page.items] : page.items));
        setCursor(page.nextCursor);
      })
      .catch((err) => {
        setJobs([]);
        setError(errorText(err, "Couldn’t load jobs right now."));
      });
  }, []);

  useEffect(() => {
    void load(EMPTY);
    workGet<WorkCategoryDto[]>("categories").then(setCategories).catch(() => undefined);
  }, [load]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <main className={styles.page}>
      <WorkNav />
      <section className={styles.hero}>
        <h1>Real paid work, on your schedule.</h1>
        <p>Short assignments from verified businesses near you. You see the pay before you accept, and the money is funded before a job is listed.</p>
        <div className={styles.promises}>
          <div className={styles.promise}>✓ Only verified businesses</div>
          <div className={styles.promise}>✓ Pay shown upfront, funded in advance</div>
          <div className={styles.promise}>✓ Never pay a fee or deposit to work</div>
        </div>
      </section>

      <form
        className={`${styles.card} ${styles.filters}`}
        aria-label="Search jobs"
        onSubmit={(e) => {
          e.preventDefault();
          void load(filters);
        }}
      >
        <label className={styles.field} style={{ flex: "2 1 220px" }}>
          What
          <input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="e.g. stock audit, telecalling, hindi" />
        </label>
        <label className={styles.field} style={{ flex: "1 1 150px" }}>
          City
          <input value={filters.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Noida" />
        </label>
        <label className={styles.field} style={{ flex: "1 1 180px" }}>
          Category
          <select value={filters.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field} style={{ flex: "1 1 120px" }}>
          Min pay (₹)
          <input inputMode="numeric" value={filters.minPay} onChange={(e) => set("minPay", e.target.value.replace(/\D/g, ""))} placeholder="500" />
        </label>
        <label className={styles.field} style={{ flex: "1 1 130px" }}>
          Work type
          <select value={filters.locationType} onChange={(e) => set("locationType", e.target.value)}>
            <option value="">Any</option>
            <option value="ON_SITE">On-site</option>
            <option value="REMOTE">Remote</option>
            <option value="HYBRID">Hybrid</option>
          </select>
        </label>
        <label className={styles.field} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}>
          <input type="checkbox" checked={filters.instantOnly} onChange={(e) => set("instantOnly", e.target.checked)} style={{ width: 20, minHeight: 20 }} />
          Instant accept only
        </label>
        <div className={styles.actions}>
          <button type="submit" className={styles.btnPrimary}>
            Search
          </button>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() => {
              setFilters(EMPTY);
              void load(EMPTY);
            }}
          >
            Clear
          </button>
        </div>
      </form>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {jobs === null && (
        <div className={styles.grid} aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      )}
      {jobs && jobs.length === 0 && !error && (
        <div className={`${styles.card} ${styles.empty}`}>
          <strong>No open jobs match right now.</strong>
          <span>New work is posted by verified businesses every day. Try another city or clear the filters.</span>
        </div>
      )}
      {jobs && jobs.length > 0 && (
        <section aria-label="Open jobs" className={styles.grid}>
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </section>
      )}
      {cursor && (
        <div>
          <button type="button" className={styles.btn} onClick={() => void load(filters, cursor)}>
            Load more jobs
          </button>
        </div>
      )}
    </main>
  );
}
