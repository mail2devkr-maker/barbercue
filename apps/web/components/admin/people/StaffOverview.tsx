"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ADMIN_PATHS, type AdminStaffOverviewDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../lib/api";
import ui from "../../owner/owner.module.css";
import { useAdminFilters } from "../shell/admin-filters";
import { formatRangeLabel } from "../shop-activity-range";
import { formatInr } from "../command-center/format";
import { ExportPanel } from "../exports/ExportPanel";
import css from "./people.module.css";

const ROLE_LABEL: Record<string, string> = { OWNER: "Owner", MANAGER: "Manager", BARBER: "Barber" };
const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "Active", cls: "badgeOk" },
  INACTIVE: { label: "Inactive", cls: "badgeNeutral" },
  REVOKED: { label: "Access removed", cls: "badgeBad" },
};
const num1 = (v: number | null, suffix = "") => (v === null ? "—" : `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(v)}${suffix}`);

/**
 * Salon staff analytics (barbers, stylists — not FastQue employees). Display names and work figures
 * only; no phone, email or address. Contact details exist only in the separately permitted export.
 */
export function StaffOverview() {
  const { range } = useAdminFilters();
  const [data, setData] = useState<AdminStaffOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async (from: string, to: string) => {
    try {
      setData(await apiFetch<AdminStaffOverviewDto>(`${ADMIN_PATHS.admin}/${ADMIN_PATHS.salonStaff}?${new URLSearchParams({ from, to })}`));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not load staff analytics.");
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
    if (ready && view === "export") document.getElementById("staff-export")?.scrollIntoView({ block: "start" });
  }, [ready, view]);
  const rows = useMemo(
    () => (current?.staff ?? []).filter((s) => !search.trim() || `${s.displayName} ${s.salonName} ${s.salonPublicId} ${s.city}`.toLowerCase().includes(search.trim().toLowerCase())),
    [current, search],
  );
  const k = current?.kpis;

  return (
    <main className={ui.grid} aria-labelledby="staff-title">
      <div className={ui.pageHead}>
        <div>
          <div className={ui.eyebrow}>Staff</div>
          <h1 id="staff-title" className={ui.pageTitle}>Salon staff overview</h1>
          <p className={ui.pageSub}>
            {formatRangeLabel(range.from, range.to)} · barbers and stylists working at FastQue shops (not FastQue employees). Each completed service has one staff member, so time and value are never counted twice.
          </p>
        </div>
      </div>

      {error && <p className={`${ui.banner} ${ui.bannerError}`} role="alert">{error}</p>}
      {!current && !error && <div className={`${ui.skeleton} ${css.skeleton}`} role="status" aria-label="Loading staff" />}

      {current && k && (
        <>
          <section className={css.kpis} aria-label="Staff figures">
            {[
              ["Registered staff", k.registeredStaff, `${k.activeStaff} active`],
              ["Shops with staff", k.shopsWithStaff, `${num1(k.averageStaffPerShop)} active per shop`],
              ["Scheduled today", k.scheduledToday, "working hours include today"],
              ["Serving now", k.servingNow, "in an active service"],
              ["Completed services", k.completedServices, "this period"],
              ["Service hours", num1(k.serviceHours, " h"), "actual start-to-end time"],
              ["Average service", num1(k.averageServiceMinutes, " min"), "per completed service"],
              ["Service value", formatInr(k.serviceValuePaise), "menu price (estimate)"],
              ["Utilisation", k.utilizationPercent === null ? "—" : `${k.utilizationPercent.toFixed(1)}%`, k.utilizationPercent === null ? "no staff working hours set" : "service time ÷ scheduled hours"],
              ["Absence / leave", "Not tracked", "leave is not recorded"],
            ].map(([label, value, foot]) => (
              <div key={String(label)} className={`${ui.card} ${ui.cardTight} ${ui.kpi}`}>
                <div className={ui.kpiTop}>{label}</div>
                <div className={ui.kpiValue}>{value}</div>
                <div className={ui.kpiFoot}>{foot}</div>
              </div>
            ))}
          </section>

          <section className={ui.card} aria-labelledby="staff-table-title">
            <div className={ui.cardHead}>
              <div>
                <h2 id="staff-table-title" className={ui.cardTitle}>Staff performance</h2>
                <p className={ui.cardSub}>
                  {current.staffTotal > current.staffLimit ? `Top ${current.staffLimit} of ${current.staffTotal}` : current.staffTotal} staff · most completed services first
                </p>
              </div>
              <label className={css.search}>
                <span className={ui.srOnly}>Search staff</span>
                <input type="search" placeholder="Name, shop or city" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
            </div>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th scope="col">Staff</th>
                    <th scope="col">Shop</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col" className={ui.num}>Services</th>
                    <th scope="col" className={ui.num}>Service types</th>
                    <th scope="col" className={ui.num}>Hours</th>
                    <th scope="col" className={ui.num}>Avg min</th>
                    <th scope="col" className={ui.num}>Value</th>
                    <th scope="col" className={ui.num}>Utilisation</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const status = STATUS[s.status] ?? { label: s.status, cls: "badgeNeutral" };
                    return (
                      <tr key={s.id}>
                        <th scope="row" className={css.cellStack}>
                          <strong>{s.displayName}</strong>
                          {s.servingNow && <small>Serving now</small>}
                        </th>
                        <td className={css.cellStack}>
                          <strong>{s.salonName}</strong>
                          <small>{s.salonPublicId} · {s.city}</small>
                        </td>
                        <td>{ROLE_LABEL[s.role] ?? s.role}</td>
                        <td><span className={`${ui.badge} ${ui[status.cls as keyof typeof ui]}`}>{status.label}</span></td>
                        <td className={ui.num}>{s.completedServices}</td>
                        <td className={ui.num}>{s.distinctServices}</td>
                        <td className={ui.num}>{num1(s.serviceMinutes / 60)}</td>
                        <td className={ui.num}>{num1(s.averageServiceMinutes)}</td>
                        <td className={ui.num}>{formatInr(s.serviceValuePaise)}</td>
                        <td className={ui.num} title={s.scheduledMinutes === null ? "No working hours set" : `${num1(s.scheduledMinutes / 60)} h scheduled`}>
                          {s.utilizationPercent === null ? <span className={ui.mutedCell}>—</span> : `${s.utilizationPercent.toFixed(1)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && <p className={ui.empty}>{current.staff.length === 0 ? "No salon staff registered yet." : "No staff match this search."}</p>}
          </section>

          <ExportPanel
            id="staff-export"
            title="Staff data export"
            from={range.from}
            to={range.to}
            options={[
              {
                id: "staff-performance",
                label: "Staff performance report",
                description: "Every staff member's work figures for the period (services, hours, value, utilisation). No contact details.",
                path: `${ADMIN_PATHS.admin}/${ADMIN_PATHS.exports}/${ADMIN_PATHS.salonStaff}`,
                permission: "exportStaffPerformance",
              },
              {
                id: "staff-contacts",
                label: "Staff contact list",
                description: "Adds each staff member's phone and email. Platform admins and HR only. Deleted accounts are excluded.",
                path: `${ADMIN_PATHS.admin}/${ADMIN_PATHS.exports}/${ADMIN_PATHS.salonStaff}/${ADMIN_PATHS.contact}`,
                permission: "exportStaffContacts",
                personal: true,
              },
            ]}
          />
        </>
      )}
    </main>
  );
}
