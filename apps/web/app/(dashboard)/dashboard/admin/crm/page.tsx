"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ADMIN_PATHS,
  CrmFollowUpStatus,
  CrmLeadStatus,
  type AdminCrmFollowUpDto,
  type AdminCrmLeadDto,
  type AdminCrmOverviewDto,
  type AdminCrmVisitDto,
} from "@barbercue/shared";
import { ApiError, apiFetch } from "../../../../../lib/api";
import { LinkButton } from "../../../../../components/ui/Button";
import styles from "../admin.module.css";

function pretty(value: string): string {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not load CRM activity.";
}

const crmBase = `${ADMIN_PATHS.admin}/${ADMIN_PATHS.crm}`;

export default function AdminCrmPage() {
  const [overview, setOverview] = useState<AdminCrmOverviewDto | null>(null);
  const [leads, setLeads] = useState<AdminCrmLeadDto[]>([]);
  const [visits, setVisits] = useState<AdminCrmVisitDto[]>([]);
  const [followUps, setFollowUps] = useState<AdminCrmFollowUpDto[]>([]);
  const [employeeId, setEmployeeId] = useState("ALL");
  const [leadStatus, setLeadStatus] = useState<"ALL" | CrmLeadStatus>("ALL");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextOverview, nextLeads, nextVisits, nextFollowUps] = await Promise.all([
        apiFetch<AdminCrmOverviewDto>(`${crmBase}/${ADMIN_PATHS.overview}`),
        apiFetch<AdminCrmLeadDto[]>(`${crmBase}/${ADMIN_PATHS.leads}`),
        apiFetch<AdminCrmVisitDto[]>(`${crmBase}/${ADMIN_PATHS.visits}`),
        apiFetch<AdminCrmFollowUpDto[]>(`${crmBase}/${ADMIN_PATHS.followUps}`),
      ]);
      setOverview(nextOverview);
      setLeads(nextLeads);
      setVisits(nextVisits);
      setFollowUps(nextFollowUps);
      setError(null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const filteredLeads = useMemo(
    () =>
      leads.filter(
        (lead) =>
          (employeeId === "ALL" || lead.employee.id === employeeId) &&
          (leadStatus === "ALL" || lead.status === leadStatus) &&
          (!q ||
            `${lead.shopName} ${lead.contactName ?? ""} ${lead.phone ?? ""} ${lead.email ?? ""} ${lead.city ?? ""} ${lead.locality ?? ""} ${lead.employee.fullName} ${lead.employee.employeeCode}`
              .toLowerCase()
              .includes(q)),
      ),
    [employeeId, leadStatus, leads, q],
  );

  const filteredVisits = useMemo(
    () =>
      visits.filter(
        (visit) =>
          (employeeId === "ALL" || visit.employee.id === employeeId) &&
          (!q ||
            `${visit.shopName} ${visit.employee.fullName} ${visit.employee.employeeCode} ${visit.outcome}`
              .toLowerCase()
              .includes(q)),
      ),
    [employeeId, q, visits],
  );

  const filteredFollowUps = useMemo(
    () =>
      followUps.filter(
        (item) =>
          (employeeId === "ALL" || item.employee.id === employeeId) &&
          (!q ||
            `${item.leadShopName} ${item.employee.fullName} ${item.employee.employeeCode} ${item.channel} ${item.status}`
              .toLowerCase()
              .includes(q)),
      ),
    [employeeId, followUps, q],
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>FastQue field operations</p>
          <h1>CRM control center</h1>
          <p>Leads, visits, follow-ups, employee performance and shop onboarding attribution.</p>
        </div>
        <div className={styles.headerActions}>
          <LinkButton href="/dashboard/admin/employees" variant="outline">Employees</LinkButton>
          <LinkButton href="/dashboard/admin" variant="outline">Platform operations</LinkButton>
        </div>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {loading && !overview && <p className={styles.loading}>Loading field CRM…</p>}

      {overview && (
        <>
          <section className={styles.metrics} aria-label="CRM totals">
            <article><strong>{overview.counts.employees}</strong><span>Employees</span></article>
            <article><strong>{overview.counts.leads}</strong><span>Leads</span></article>
            <article><strong>{overview.counts.onboarded}</strong><span>Onboarded</span></article>
            <article><strong>{overview.counts.visitsLast30Days}</strong><span>Visits · 30 days</span></article>
            <article><strong>{overview.counts.openFollowUps}</strong><span>Open follow-ups</span></article>
            <article><strong>{overview.counts.overdueFollowUps}</strong><span>Overdue</span></article>
            <article><strong>{overview.conversionRatePercent}%</strong><span>Conversion</span></article>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>Employee performance</h2>
              <span>Field sales/onboarding activity</span>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Territory</th>
                    <th>Leads</th>
                    <th>Onboarded</th>
                    <th>Conversion</th>
                    <th>Visits · 30d</th>
                    <th>Open follow-ups</th>
                    <th>Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.performance.map((row) => (
                    <tr key={row.employee.id}>
                      <td><strong>{row.employee.fullName}</strong><small>{row.employee.employeeCode} · {row.employee.status}</small></td>
                      <td>{row.employee.territory ?? "Not assigned"}</td>
                      <td>{row.leads}</td>
                      <td>{row.onboarded}</td>
                      <td>{row.conversionRatePercent}%</td>
                      <td>{row.visitsLast30Days}</td>
                      <td>{row.openFollowUps}</td>
                      <td>{row.overdueFollowUps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {overview.performance.length === 0 && <p className={styles.empty}>No field employees configured yet.</p>}
          </section>

          <section className={styles.filters} aria-label="CRM filters">
            <div>
              <label htmlFor="crm-search">Search CRM</label>
              <input id="crm-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Shop, contact, employee, city…" />
            </div>
            <div>
              <label htmlFor="crm-employee">Employee</label>
              <select id="crm-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="ALL">All employees</option>
                {overview.performance.map((row) => (
                  <option key={row.employee.id} value={row.employee.id}>
                    {row.employee.employeeCode} · {row.employee.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="crm-status">Lead status</label>
              <select id="crm-status" value={leadStatus} onChange={(e) => setLeadStatus(e.target.value as "ALL" | CrmLeadStatus)}>
                <option value="ALL">All lead stages</option>
                {Object.values(CrmLeadStatus).map((value) => <option key={value} value={value}>{pretty(value)}</option>)}
              </select>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><h2>Lead pipeline</h2><span>{filteredLeads.length} shown</span></div>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Shop</th><th>Employee</th><th>Contact</th><th>Location</th><th>Stage</th><th>Attribution</th><th>Updated</th></tr></thead>
                <tbody>{filteredLeads.map((lead) => (
                  <tr key={lead.id}>
                    <td><strong>{lead.shopName}</strong><small>{pretty(lead.source)}</small></td>
                    <td><strong>{lead.employee.fullName}</strong><small>{lead.employee.employeeCode}</small></td>
                    <td>{lead.contactName ?? "—"}<small>{lead.phone ?? lead.email ?? "No contact"}</small></td>
                    <td>{[lead.locality, lead.city].filter(Boolean).join(", ") || "—"}</td>
                    <td><span className={styles.status}>{pretty(lead.status)}</span></td>
                    <td>{lead.onboardedSalon ? <><strong>{lead.onboardedSalon.publicId}</strong><small>{lead.onboardedSalon.name}</small></> : "—"}</td>
                    <td>{dateTime(lead.updatedAt)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {filteredLeads.length === 0 && <p className={styles.empty}>No leads match these filters.</p>}
          </section>

          <div className={styles.twoColumn}>
            <section className={styles.section}>
              <div className={styles.sectionHeader}><h2>Field visits</h2><span>{filteredVisits.length} shown</span></div>
              <div className={styles.activityGrid}>
                {filteredVisits.slice(0, 100).map((visit) => (
                  <article key={visit.id}>
                    <strong>{visit.shopName}</strong>
                    <span>{visit.employee.employeeCode} · {visit.employee.fullName}</span>
                    <small>{pretty(visit.outcome)} · {dateTime(visit.visitedAt)}</small>
                    {visit.notes && <small>{visit.notes}</small>}
                  </article>
                ))}
              </div>
              {filteredVisits.length === 0 && <p className={styles.empty}>No visits match these filters.</p>}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}><h2>Follow-ups</h2><span>{filteredFollowUps.length} shown</span></div>
              <div className={styles.activityGrid}>
                {filteredFollowUps.slice(0, 100).map((item) => {
                  const overdue = item.status === CrmFollowUpStatus.OPEN && new Date(item.dueAt).getTime() < Date.now();
                  return (
                    <article key={item.id} style={overdue ? { borderColor: "rgba(255,111,145,.48)" } : undefined}>
                      <strong>{item.leadShopName}</strong>
                      <span>{item.employee.employeeCode} · {item.employee.fullName}</span>
                      <small>{pretty(item.channel)} · {pretty(item.status)} · {dateTime(item.dueAt)}</small>
                      {overdue && <small style={{ color: "#ffb7c9", fontWeight: 700 }}>OVERDUE</small>}
                    </article>
                  );
                })}
              </div>
              {filteredFollowUps.length === 0 && <p className={styles.empty}>No follow-ups match these filters.</p>}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
