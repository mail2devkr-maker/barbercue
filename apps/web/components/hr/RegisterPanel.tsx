"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { httpHrRegisterApi, type HrRegisterApi } from "../../lib/hr-register/api";
import { describeHrFailure } from "../../lib/hr-register/errors";
import { formatInstant, normalizeEmployeeCodeInput } from "../../lib/hr-register/format";
import { LIFECYCLE_LABEL, OFFER_STATUS_LABEL } from "../../lib/hr-register/lifecycle";
import {
  OFFER_STATUSES,
  type HrEmployeeOption,
  type HrLifecycleFilter,
  type HrOfferStatus,
  type HrPersonSummary,
  type HrRegisterFilters,
} from "../../lib/hr-register/types";
import { Banner, CodeChip, Facts, LifecycleBadge, OfferStatusBadge } from "./parts";
import styles from "./hr-register.module.css";

export const EMPTY_FILTERS: HrRegisterFilters = {
  q: "",
  employeeCode: "",
  lifecycle: "ALL",
  offerStatus: "ALL",
  city: "",
  managerId: "",
  issuedFrom: "",
  issuedTo: "",
};

const LIFECYCLE_FILTERS = Object.keys(LIFECYCLE_LABEL) as Array<Exclude<HrLifecycleFilter, "ALL">>;

export type RegisterPanelProps = {
  api?: HrRegisterApi;
  selectedPersonId?: string | null;
  /** Bumped by the parent after a change so the list reloads. */
  refreshToken?: number;
  initialFilters?: Partial<HrRegisterFilters>;
  onSelect: (person: HrPersonSummary) => void;
};

/** Other admin pages deep-link with ?code=FQ-FE-00123. Read once, client-side (this panel only mounts after the gate). */
function startingFilters(initial?: Partial<HrRegisterFilters>): HrRegisterFilters {
  const fromUrl = typeof window === "undefined" ? null : normalizeEmployeeCodeInput(new URLSearchParams(window.location.search).get("code") ?? "");
  return { ...EMPTY_FILTERS, ...initial, ...(fromUrl ? { employeeCode: fromUrl } : {}) };
}

export default function RegisterPanel({ api = httpHrRegisterApi, selectedPersonId = null, refreshToken = 0, initialFilters, onSelect }: RegisterPanelProps) {
  const [filters, setFilters] = useState<HrRegisterFilters>(() => startingFilters(initialFilters));
  const [applied, setApplied] = useState<HrRegisterFilters>(filters);
  const [items, setItems] = useState<HrPersonSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managers, setManagers] = useState<HrEmployeeOption[]>([]);
  const requestId = useRef(0);

  // Only the newest request may write results: a slower, older response is dropped.
  function search(next: HrRegisterFilters, append: boolean, from: string | null) {
    const id = ++requestId.current;
    return api
      .search(next, from)
      .then((page) => {
        if (id !== requestId.current) return;
        setItems((current) => (append ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setTotal(page.total);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (id !== requestId.current) return;
        setError(describeHrFailure(failure, "Could not load the register."));
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }

  useEffect(() => {
    void search(applied, false, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `search` only closes over `api`
  }, [api, applied, refreshToken]);

  useEffect(() => {
    let live = true;
    api.listManagers().then((rows) => live && setManagers(rows)).catch(() => live && setManagers([]));
    return () => {
      live = false;
    };
  }, [api]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const code = normalizeEmployeeCodeInput(filters.employeeCode);
    if (filters.employeeCode.trim() && !code) {
      setError("Enter an employee ID like FQ-FE-00123 (or just the number).");
      return;
    }
    setLoading(true);
    setApplied({ ...filters, employeeCode: code ?? "" });
  }

  function clear() {
    setLoading(true);
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  }

  const set = <K extends keyof HrRegisterFilters>(key: K, value: HrRegisterFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <section id="employee-register" className={styles.panel} aria-labelledby="hr-register-title">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>Permanent register</p>
          <h2 id="hr-register-title">Employee &amp; offer register</h2>
        </div>
        <span className={styles.muted}>{loading ? "Loading…" : `${total} ${total === 1 ? "person" : "people"}`}</span>
      </div>

      <form className={styles.search} onSubmit={submit} role="search" aria-label="Search the register">
        <label className={styles.searchWide}>
          <span>Name, email or phone</span>
          <input type="search" value={filters.q} onChange={(event) => set("q", event.target.value)} placeholder="Search candidates and employees" autoComplete="off" />
        </label>
        <label>
          <span>Employee ID</span>
          <input value={filters.employeeCode} onChange={(event) => set("employeeCode", event.target.value)} placeholder="FQ-FE-00123" autoComplete="off" />
        </label>
        <label>
          <span>Stage</span>
          <select value={filters.lifecycle} onChange={(event) => set("lifecycle", event.target.value as HrLifecycleFilter)}>
            <option value="ALL">All stages</option>
            {LIFECYCLE_FILTERS.map((value) => <option key={value} value={value}>{LIFECYCLE_LABEL[value]}</option>)}
          </select>
        </label>
        <label>
          <span>Latest offer</span>
          <select value={filters.offerStatus} onChange={(event) => set("offerStatus", event.target.value as HrOfferStatus | "ALL")}>
            <option value="ALL">Any status</option>
            {OFFER_STATUSES.map((value) => <option key={value} value={value}>{OFFER_STATUS_LABEL[value]}</option>)}
          </select>
        </label>
        <label>
          <span>City</span>
          <input value={filters.city} onChange={(event) => set("city", event.target.value)} autoComplete="off" />
        </label>
        <label>
          <span>Reporting manager</span>
          <select value={filters.managerId} onChange={(event) => set("managerId", event.target.value)}>
            <option value="">Any manager</option>
            {managers.map((manager) => <option key={manager.id} value={manager.id}>{`${manager.fullName} (${manager.employeeCode})`}</option>)}
          </select>
        </label>
        <label>
          <span>Offer issued from</span>
          <input type="date" value={filters.issuedFrom} onChange={(event) => set("issuedFrom", event.target.value)} />
        </label>
        <label>
          <span>Offer issued to</span>
          <input type="date" value={filters.issuedTo} onChange={(event) => set("issuedTo", event.target.value)} />
        </label>
        <div className={`${styles.actions} ${styles.searchWide}`}>
          <button type="submit" className={styles.primary} disabled={loading}>Search</button>
          <button type="button" className={styles.secondary} onClick={clear}>Clear</button>
        </div>
      </form>

      {error && <Banner kind="error">{error}</Banner>}

      <ul className={styles.list} aria-label="Register results">
        {items.map((person) => (
          <li key={person.id} className={styles.card} aria-current={person.id === selectedPersonId ? "true" : undefined} style={person.id === selectedPersonId ? { borderColor: "#ff6f91" } : undefined}>
            <div className={styles.cardTop}>
              <strong>{person.fullName}</strong>
              <span><CodeChip code={person.employeeCode} /> <LifecycleBadge person={person} /></span>
            </div>
            <Facts
              items={[
                ["Latest offer", <span key="offer">v{person.latestOfferVersion} <OfferStatusBadge status={person.latestOfferStatus} /></span>],
                ["Offers / episodes", `${person.offerCount} / ${person.episodeCount}`],
                ["First offer", formatInstant(person.firstOfferIssuedAt)],
                ["City", person.city ?? "—"],
                ["Manager", person.reportingManager ? person.reportingManager.fullName : "—"],
                ["Contact", [person.maskedEmail, person.maskedPhone].filter(Boolean).join(" · ") || "—"],
              ]}
            />
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => onSelect(person)}>
                Open record &amp; history
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!loading && items.length === 0 && !error && <p className={styles.muted}>No one in the register matches these filters.</p>}
      {cursor && (
        <div className={styles.actions} style={{ marginTop: 12 }}>
          <button type="button" className={styles.secondary} disabled={loading} onClick={() => { setLoading(true); void search(applied, true, cursor); }}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </section>
  );
}
