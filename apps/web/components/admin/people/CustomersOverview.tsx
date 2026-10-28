"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ADMIN_PATHS, type AdminCustomerOverviewDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../lib/api";
import ui from "../../owner/owner.module.css";
import { useAdminFilters } from "../shell/admin-filters";
import { formatRangeLabel } from "../shop-activity-range";
import { formatInr } from "../command-center/format";
import { ExportPanel } from "../exports/ExportPanel";
import css from "./people.module.css";

const date = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso)) : "—";
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

/**
 * Privacy-safe customer analytics: masked IDs and counts only. Contact details are never part of
 * this page's data; they exist only in the separately permitted, audited contact export.
 */
export function CustomersOverview() {
  const { range } = useAdminFilters();
  const [data, setData] = useState<AdminCustomerOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async (from: string, to: string) => {
    try {
      setData(await apiFetch<AdminCustomerOverviewDto>(`${ADMIN_PATHS.admin}/${ADMIN_PATHS.customers}?${new URLSearchParams({ from, to })}`));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not load customer analytics.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(range.from, range.to), 0);
    return () => window.clearTimeout(timer);
  }, [load, range.from, range.to]);

  const current = data && data.from === range.from && data.to === range.to ? data : null;

  // The sidebar's "Data Export" entry opens this page at its export section.
  const view = useSearchParams().get("view");
  const ready = current !== null;
  useEffect(() => {
    if (ready && view === "export") document.getElementById("customer-export")?.scrollIntoView({ block: "start" });
  }, [ready, view]);
  const rows = useMemo(
    () => (current?.customers ?? []).filter((c) => !search.trim() || `${c.maskedId} ${c.preferredCategory ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())),
    [current, search],
  );
  const k = current?.kpis;
  const sourceTotal = (current?.sources ?? []).reduce((s, x) => s + x.count, 0);
  const categoryTotal = (current?.categories ?? []).reduce((s, x) => s + x.visits, 0);

  return (
    <main className={ui.grid} aria-labelledby="customers-title">
      <div className={ui.pageHead}>
        <div>
          <div className={ui.eyebrow}>Customers</div>
          <h1 id="customers-title" className={ui.pageTitle}>Customer overview</h1>
          <p className={ui.pageSub}>
            {formatRangeLabel(range.from, range.to)} · India time · account customers only (guest visits have no stable identity). Customers appear as masked IDs; no contact details are shown here.
          </p>
        </div>
      </div>

      {error && <p className={`${ui.banner} ${ui.bannerError}`} role="alert">{error}</p>}
      {!current && !error && <div className={`${ui.skeleton} ${css.skeleton}`} role="status" aria-label="Loading customers" />}

      {current && k && (
        <>
          <section className={css.kpis} aria-label="Customer figures">
            {[
              ["Customers (all time)", k.customersEver, "with a completed visit"],
              ["Active customers", k.activeCustomers, "completed a visit this period"],
              ["New customers", k.newCustomers, "first-ever visit this period"],
              ["Returning customers", k.returningCustomers, "had visited before"],
              ["Completed visits", k.completedVisits, "by account customers"],
              ["Visits per active customer", k.averageVisitsPerActive ?? "—", "average"],
              ["Average visit value", k.averageVisitValuePaise === null ? "—" : formatInr(k.averageVisitValuePaise), "salon service value"],
              ["Repeat rate", pct(k.repeatRatePercent), "active customers with 2+ visits"],
              ["No-show rate", pct(k.noShowRatePercent), "of resolved appointments"],
            ].map(([label, value, foot]) => (
              <div key={String(label)} className={`${ui.card} ${ui.cardTight} ${ui.kpi}`}>
                <div className={ui.kpiTop}>{label}</div>
                <div className={ui.kpiValue}>{value}</div>
                <div className={ui.kpiFoot}>{foot}</div>
              </div>
            ))}
          </section>

          <div className={css.twoCol}>
            <section className={ui.card} aria-labelledby="sources-title">
              <h2 id="sources-title" className={ui.cardTitle}>How customers booked</h2>
              <p className={ui.cardSub}>Appointments created this period by channel, plus live-queue walk-ins.</p>
              <BarList items={current.sources.map((s) => ({ label: s.label, value: s.count }))} total={sourceTotal} empty="No bookings this period." />
            </section>
            <section className={ui.card} aria-labelledby="categories-title">
              <h2 id="categories-title" className={ui.cardTitle}>Service categories</h2>
              <p className={ui.cardSub}>Completed visits by the shop’s category label (main booked service).</p>
              <BarList items={current.categories.map((c) => ({ label: c.category, value: c.visits }))} total={categoryTotal} empty="No completed visits this period." />
            </section>
          </div>

          <section className={ui.card} aria-labelledby="customer-table-title">
            <div className={ui.cardHead}>
              <div>
                <h2 id="customer-table-title" className={ui.cardTitle}>Customers</h2>
                <p className={ui.cardSub}>
                  {current.customersTotal > current.customersLimit ? `Top ${current.customersLimit} of ${current.customersTotal}` : `${current.customersTotal}`} customers with activity · most visits first
                </p>
              </div>
              <label className={css.search}>
                <span className={ui.srOnly}>Search customers</span>
                <input type="search" placeholder="Masked ID or category" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
            </div>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">First visit</th>
                    <th scope="col">Last visit</th>
                    <th scope="col" className={ui.num}>Visits</th>
                    <th scope="col" className={ui.num}>Cancelled</th>
                    <th scope="col" className={ui.num}>No-shows</th>
                    <th scope="col" className={ui.num}>Service value</th>
                    <th scope="col">Preferred category</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.maskedId}>
                      <th scope="row" className={css.mono}>{c.maskedId}</th>
                      <td>{date(c.firstVisitAt)}</td>
                      <td>{date(c.lastVisitAt)}</td>
                      <td className={ui.num}>{c.completedVisits}</td>
                      <td className={ui.num}>{c.cancelled}</td>
                      <td className={ui.num}>{c.noShow}</td>
                      <td className={ui.num}>{formatInr(c.serviceValuePaise)}</td>
                      <td>{c.preferredCategory ?? <span className={ui.mutedCell}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && <p className={ui.empty}>{current.customers.length === 0 ? "No customer activity in this period." : "No customers match this search."}</p>}
          </section>

          <ExportPanel
            id="customer-export"
            title="Customer data export"
            from={range.from}
            to={range.to}
            options={[
              {
                id: "customer-report",
                label: "Customer report",
                description: "The table above for the whole period: masked IDs, visit dates and counts, service value, preferred category. No contact details.",
                path: `${ADMIN_PATHS.admin}/${ADMIN_PATHS.exports}/${ADMIN_PATHS.customers}`,
                permission: "exportCustomerReport",
              },
              {
                id: "customer-contacts",
                label: "Customer contact list",
                description: "Adds phone, email and account creation date. Platform admins only. Numbers on the contact-suppression list are withheld; deleted accounts are excluded.",
                path: `${ADMIN_PATHS.admin}/${ADMIN_PATHS.exports}/${ADMIN_PATHS.customers}/${ADMIN_PATHS.contact}`,
                permission: "exportCustomerContacts",
                personal: true,
              },
            ]}
          />
        </>
      )}
    </main>
  );
}

export function BarList({ items, total, empty }: { items: Array<{ label: string; value: number }>; total: number; empty: string }) {
  if (items.length === 0) return <p className={ui.empty}>{empty}</p>;
  return (
    <ul className={css.bars}>
      {items.map((item) => {
        const share = total ? (item.value / total) * 100 : 0;
        return (
          <li key={item.label}>
            <div className={css.barLabel}>
              <span>{item.label}</span>
              <span>{item.value} · {share.toFixed(0)}%</span>
            </div>
            <div className={css.track} aria-hidden="true">
              <div className={css.fill} style={{ width: `${share}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
