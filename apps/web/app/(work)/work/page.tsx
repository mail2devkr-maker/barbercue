"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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

/** Quick picks students search for most. Slugs match the seeded work categories. */
const QUICK_PICKS: { slug: string; label: string }[] = [
  { slug: "event-assistance", label: "🎪 Event crew" },
  { slug: "brand-promotion", label: "📣 Brand promotion" },
  { slug: "telecalling", label: "📞 Telecalling" },
  { slug: "data-entry", label: "⌨️ Data entry" },
  { slug: "surveys-research", label: "📋 Surveys" },
  { slug: "tutoring", label: "📚 Tutoring" },
  { slug: "content-creation", label: "🎬 Content creation" },
  { slug: "retail-assistance", label: "🛍️ Retail shifts" },
];

const STEPS = [
  { title: "Make your profile", body: "Two minutes, free. Add your city, skills and UPI ID. You must be 18 or older." },
  { title: "Pick a gig", body: "See the exact pay, hours and tasks before you say yes. Instant-accept gigs are yours in one tap." },
  { title: "Get paid to UPI", body: "Do the work, upload proof, and you’re paid once the business approves — automatically if they don’t respond in time." },
];

const PERKS = [
  { icon: "🕒", title: "Fits your timetable", body: "Short shifts and remote tasks you can fit around lectures and exams." },
  { icon: "🔒", title: "Pay locked in", body: "The amount is fixed when you accept and the business funds it before the job goes live." },
  { icon: "🛡️", title: "Verified businesses", body: "Every employer is checked by the FastQue team before they can post." },
  { icon: "🚀", title: "Build your record", body: "Completed gigs and your reliability score show up on your profile for future work." },
];

/** Public marketplace. Shows only funded jobs from verified businesses (filtered by the API). */
export default function WorkMarketplacePage() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [categories, setCategories] = useState<WorkCategoryDto[]>([]);
  const [jobs, setJobs] = useState<WorkJobCardDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLElement>(null);

  const load = useCallback((f: Filters, after?: string) => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.city) p.set("city", f.city);
    if (f.category) p.set("category", f.category);
    if (f.minPay) p.set("minPayPaise", String(Math.round(Number(f.minPay) * 100)));
    if (f.locationType) p.set("locationType", f.locationType);
    if (f.instantOnly) p.set("instantOnly", "true");
    if (after) p.set("cursor", after);
    return workGet<{ items: WorkJobCardDto[]; nextCursor: string | null }>(`jobs?${p.toString()}`)
      .then((page) => {
        setError(null);
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

  /** Apply filters, reload and bring the results into view (used by the hero search and chips). */
  const search = (next: Filters) => {
    setFilters(next);
    void load(next);
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const knownSlugs = new Set(categories.map((c) => c.slug));
  const picks = categories.length ? QUICK_PICKS.filter((p) => knownSlugs.has(p.slug)) : QUICK_PICKS;
  const openCount = jobs ? `${jobs.length}${cursor ? "+" : ""}` : null;

  return (
    <main className={styles.page}>
      <WorkNav />

      <section className={styles.lpHero} aria-labelledby="work-hero-title">
        <div className={styles.lpHeroMain}>
          <span className={styles.lpEyebrow}>🎓 FastQue Work · for students &amp; freshers</span>
          <h1 id="work-hero-title" className={styles.lpTitle}>
            Earn <span className={styles.lpTitleAccent}>between classes.</span>
          </h1>
          <p className={styles.lpLead}>
            Short, paid gigs from verified businesses near your college — event crew, telecalling, surveys, store audits and more. Pay is shown upfront and funded before you
            accept.
          </p>

          <form
            className={styles.lpSearch}
            role="search"
            aria-label="Find gigs"
            onSubmit={(e) => {
              e.preventDefault();
              search(filters);
            }}
          >
            <input aria-label="What kind of work" value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="What? e.g. event, telecalling, hindi" />
            <input aria-label="City" value={filters.city} onChange={(e) => set("city", e.target.value)} placeholder="City, e.g. Noida" />
            <button type="submit" className={styles.lpSearchBtn}>
              Find gigs →
            </button>
          </form>

          <div className={styles.lpChips} aria-label="Popular gig types">
            {picks.map((p) => {
              const active = filters.category === p.slug;
              return (
                <button
                  key={p.slug}
                  type="button"
                  aria-pressed={active}
                  className={`${styles.lpChip} ${active ? styles.lpChipActive : ""}`}
                  onClick={() => search({ ...filters, category: active ? "" : p.slug })}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className={styles.lpTrust}>
            <span>₹0 to join</span>
            <span>Never pay a fee or deposit</span>
            <span>Paid to your UPI</span>
          </div>
        </div>

        <div className={styles.lpVisual} aria-hidden="true">
          <div className={styles.lpTicket}>
            <div className={styles.lpTicketTop}>
              <span>Example gig</span>
              <span>⚡ Instant accept</span>
            </div>
            <div className={styles.lpTicketTitle}>College fest event crew</div>
            <div className={styles.lpTicketPay}>₹800</div>
            <div className={styles.lpTicketMeta}>
              <span>📍 On campus</span>
              <span>🗓 Sat · 10 am – 4 pm</span>
              <span>✓ Pay funded</span>
            </div>
            <div className={styles.lpTicketBtn}>Take this gig</div>
          </div>
          <div className={styles.lpBadges}>
            <div className={styles.lpBadge}>
              <strong>Pay locked</strong>
              the moment you accept
            </div>
            <div className={styles.lpBadge}>
              <strong>Auto-approved</strong>
              if the business goes quiet
            </div>
          </div>
        </div>
      </section>

      <section className={styles.lpSection} aria-labelledby="work-how">
        <div className={styles.lpSectionHead}>
          <div>
            <p className={styles.lpKicker}>How it works</p>
            <h2 id="work-how">From sign-up to payout in three steps</h2>
          </div>
        </div>
        <ol className={styles.lpSteps} style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {STEPS.map((s) => (
            <li key={s.title} className={styles.lpStep}>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section ref={resultsRef} className={styles.lpSection} aria-labelledby="work-open" style={{ scrollMarginTop: 16 }}>
        <div className={styles.lpSectionHead}>
          <div>
            <p className={styles.lpKicker}>Open now</p>
            <h2 id="work-open">Find your next gig</h2>
          </div>
          {openCount !== null && !error && (
            <span className={styles.lpLive} aria-live="polite">
              {openCount} open {openCount === "1" ? "gig" : "gigs"}
            </span>
          )}
        </div>

        <form
          className={styles.lpToolbar}
          aria-label="Filter gigs"
          onSubmit={(e) => {
            e.preventDefault();
            void load(filters);
          }}
        >
          <label className={styles.field}>
            What
            <input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="e.g. stock audit, telecalling" />
          </label>
          <label className={styles.field}>
            City
            <input value={filters.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Noida" />
          </label>
          <label className={styles.field}>
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

          <details className={styles.lpMore}>
            <summary>More filters</summary>
            <div className={styles.lpMoreBody}>
              <label className={styles.field}>
                Min pay (₹)
                <input inputMode="numeric" value={filters.minPay} onChange={(e) => set("minPay", e.target.value.replace(/\D/g, ""))} placeholder="500" />
              </label>
              <label className={styles.field}>
                Work type
                <select value={filters.locationType} onChange={(e) => set("locationType", e.target.value)}>
                  <option value="">Any</option>
                  <option value="ON_SITE">On-site</option>
                  <option value="REMOTE">Remote</option>
                  <option value="HYBRID">Hybrid</option>
                </select>
              </label>
              <label className={styles.lpCheck}>
                <input type="checkbox" checked={filters.instantOnly} onChange={(e) => set("instantOnly", e.target.checked)} />
                Instant accept only
              </label>
            </div>
          </details>
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
            <strong>No open gigs match right now.</strong>
            <span>Verified businesses post new work regularly. Try another city or clear the filters.</span>
          </div>
        )}
        {jobs && jobs.length > 0 && (
          <div className={styles.grid}>
            {jobs.map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
          </div>
        )}
        {cursor && (
          <div>
            <button type="button" className={styles.btn} onClick={() => void load(filters, cursor)}>
              Load more gigs
            </button>
          </div>
        )}
      </section>

      <section className={styles.lpSection} aria-labelledby="work-why">
        <div className={styles.lpSectionHead}>
          <div>
            <p className={styles.lpKicker}>Why students use it</p>
            <h2 id="work-why">Real work, without the runaround</h2>
          </div>
        </div>
        <div className={styles.lpPerks}>
          {PERKS.map((p) => (
            <div key={p.title} className={styles.lpPerk}>
              <span className={styles.lpPerkIcon} aria-hidden="true">
                {p.icon}
              </span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <aside className={styles.lpSafety}>
        <span className={styles.lpSafetyIcon} aria-hidden="true">
          ⚠️
        </span>
        <p>
          <strong>You never pay to work.</strong> FastQue never asks for a registration fee, deposit, OTP or your documents. If a gig does, don’t pay — report it.
        </p>
      </aside>

      <section className={styles.lpBiz} aria-labelledby="work-biz">
        <div>
          <h2 id="work-biz">Hiring students?</h2>
          <p>Post verified, pre-funded gigs and approve the work before anyone is paid.</p>
        </div>
        <Link href="/work/business" className={styles.lpBizBtn}>
          Post a gig →
        </Link>
      </section>
    </main>
  );
}
