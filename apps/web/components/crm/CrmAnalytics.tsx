"use client";

import Link from "next/link";
import { useState } from "react";
import { CRM_KPI_DEFINITIONS, CrmLeadSource, SUPPORT_CATEGORY_LABEL, type CrmAnalyticsDto, type CrmEmployeeRefDto, type CrmKpiKey, type CrmNotificationDto } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { errorText, pretty, useCrmData, when } from "../../lib/crm";
import { useMe } from "./CrmShell";
import { Empty, Field, Pill } from "./ui";
import s from "./crm.module.css";

const HEADLINE: Array<[keyof CrmAnalyticsDto["kpis"], string, string?]> = [
  ["leadsGenerated", "Leads generated"],
  ["callsCompleted", "Calls completed"],
  ["callsConnected", "Calls connected"],
  ["meetingsCompleted", "Meetings completed"],
  ["visitsCompleted", "Salon visits"],
  ["onboardingSubmitted", "Onboardings submitted"],
  ["approved", "Approved"],
  ["activated", "Activated"],
  ["rejected", "Rejected"],
  ["meetingConversion", "Meeting conversion", "%"],
  ["approvalRate", "Approval rate", "%"],
  ["activationRate", "Activation rate", "%"],
  ["leadConversion", "Lead conversion", "%"],
  ["openTickets", "Open tickets"],
];
const EXTRA_DEFS: Record<string, string> = {
  leadsGenerated: "Leads created in the period (in scope).",
  meetingConversion: "Meetings completed ÷ meetings scheduled in the period.",
  approvalRate: "Applications approved ÷ (approved + rejected) in the period.",
  activationRate: "Leads activated ÷ applications approved in the period.",
  leadConversion: "Leads activated in the period ÷ leads generated in the period.",
};

/** Analytics: every figure is a database aggregate; definitions are listed at the bottom. */
export function CrmAnalytics() {
  const me = useMe();
  const [f, setF] = useState({ preset: "30d", from: "", to: "", employeeId: "", territory: "", city: "", source: "" });
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v && (f.preset === "custom" || (k !== "from" && k !== "to"))) params.set(k, v);
  const { data, error } = useCrmData<CrmAnalyticsDto>(`crm/analytics?${params}`);
  const team = useCrmData<CrmEmployeeRefDto[]>(me?.can.viewTeam ? "crm/employees" : null).data;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const maxFunnel = Math.max(1, ...(data?.funnel.map((r) => r.leads) ?? [1]));
  const maxTrend = Math.max(1, ...(data?.trend.map((d) => d.calls + d.meetings + d.visits) ?? [1]));

  return (
    <>
      <div className={s.toolbar}>
        <select className={s.select} value={f.preset} onChange={set("preset")} aria-label="Period">
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="month">This month</option>
          <option value="custom">Custom</option>
        </select>
        {f.preset === "custom" && (
          <>
            <input type="date" className={s.input} value={f.from} onChange={set("from")} aria-label="From" />
            <input type="date" className={s.input} value={f.to} onChange={set("to")} aria-label="To" />
          </>
        )}
        {team && (
          <select className={s.select} value={f.employeeId} onChange={set("employeeId")} aria-label="Employee">
            <option value="">All employees</option>
            {team.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
          </select>
        )}
        <input className={s.input} placeholder="Territory" value={f.territory} onChange={set("territory")} aria-label="Territory" />
        <input className={s.input} placeholder="City" value={f.city} onChange={set("city")} aria-label="City" />
        <select className={s.select} value={f.source} onChange={set("source")} aria-label="Source">
          <option value="">All sources</option>
          {Object.keys(CrmLeadSource).map((v) => <option key={v} value={v}>{pretty(v)}</option>)}
        </select>
      </div>
      {error && <p className={`${s.alert} ${s.alertError}`} role="alert">{error}</p>}
      {!data ? <div className={s.skel} /> : (
        <>
          <p className={s.faint}>{data.range.from} → {data.range.to} (IST)</p>
          <section className={s.kpis} aria-label="Headline figures">
            {HEADLINE.map(([k, label, unit]) => (
              <div key={k} className={s.kpi} title={EXTRA_DEFS[k] ?? CRM_KPI_DEFINITIONS[k as CrmKpiKey]}>
                <span>{label}</span>
                <strong>{data.kpis[k]}{unit ?? ""}</strong>
              </div>
            ))}
          </section>
          <div className={s.grid2}>
            <section className={s.card} aria-label="Sales funnel">
              <h2 className={s.cardTitle} style={{ marginBottom: 10 }}>Funnel (leads reaching each stage)</h2>
              {data.funnel.map((r) => (
                <div key={r.stage} className={s.funnelRow}>
                  <span>{r.stage}</span>
                  <div className={s.bar}><i style={{ width: `${(r.leads / maxFunnel) * 100}%` }} /></div>
                  <strong>{r.leads}</strong>
                </div>
              ))}
            </section>
            <section className={s.card} aria-label="Daily trend">
              <h2 className={s.cardTitle} style={{ marginBottom: 10 }}>Daily activity</h2>
              {data.trend.length === 0 ? <p className={s.faint}>No activity in this period.</p> : (
                <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 140 }} role="img" aria-label="Calls, meetings and visits per day">
                  {data.trend.map((d) => {
                    const total = d.calls + d.meetings + d.visits;
                    return <div key={d.day} title={`${d.day}: ${d.calls} calls, ${d.meetings} meetings, ${d.visits} visits, ${d.onboardings} onboardings, ${d.approvals} approvals, ${d.activations} activations`} style={{ flex: 1, minWidth: 3, height: `${Math.max(2, (total / maxTrend) * 100)}%`, background: "var(--c-grad)", borderRadius: 4, opacity: total ? 1 : 0.25 }} />;
                  })}
                </div>
              )}
              <p className={s.faint}>Hover a bar for the day&apos;s breakdown.</p>
            </section>
          </div>
          {data.employees.length > 0 && (
            <section className={s.card} style={{ marginTop: 16 }} aria-label="Employee ranking">
              <h2 className={s.cardTitle} style={{ marginBottom: 10 }}>{me?.can.viewTeam ? "Employee performance" : "Your performance"}</h2>
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th>#</th><th>Employee</th><th>Leads</th><th>Calls</th><th>Connected</th><th>Meetings</th><th>Visits</th><th>Submitted</th><th>Approved</th><th>Activated</th><th>Conversion</th><th>AI pitch</th></tr></thead>
                  <tbody>
                    {data.employees.map((e, i) => (
                      <tr key={e.employee.id}>
                        <td>{i + 1}</td><td>{e.employee.fullName}<div className={s.faint}>{e.employee.territory ?? ""}</div></td>
                        <td>{e.leadsAssigned}</td><td>{e.callsCompleted}</td><td>{e.callsConnected}</td><td>{e.meetingsCompleted}</td><td>{e.visits}</td>
                        <td>{e.onboardingsSubmitted}</td><td>{e.approved}</td><td>{e.activated}</td><td>{e.conversion}%</td>
                        <td>{e.aiPitchScore ?? <span className={s.faint}>{data.ai.configured ? "—" : "Not configured"}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <div className={s.grid2} style={{ marginTop: 16 }}>
            <section className={s.card} aria-label="Lead sources">
              <h2 className={s.cardTitle} style={{ marginBottom: 10 }}>Lead sources</h2>
              {data.sources.length === 0 ? <p className={s.faint}>No leads.</p> : <ul className={s.list}>{data.sources.map((r) => <li key={r.source} className={s.listItem}><span>{pretty(r.source)}</span><span>{r.leads} leads · {r.onboarded} onboarded</span></li>)}</ul>}
            </section>
            <section className={s.card} aria-label="Territories">
              <h2 className={s.cardTitle} style={{ marginBottom: 10 }}>Territories</h2>
              {data.territories.length === 0 ? <p className={s.faint}>No territory data.</p> : <ul className={s.list}>{data.territories.map((r) => <li key={r.territory} className={s.listItem}><span>{r.territory}</span><span>{r.leads} leads · {r.onboarded} onboarded · {r.activated} live</span></li>)}</ul>}
            </section>
            <section className={s.card} aria-label="Onboarding quality">
              <h2 className={s.cardTitle} style={{ marginBottom: 10 }}>Onboarding quality</h2>
              <ul className={s.list}>
                <li className={s.listItem}><span>Missing required photos</span><strong>{data.onboardingQuality.missingPhotos}</strong></li>
                <li className={s.listItem}><span>Missing service menu</span><strong>{data.onboardingQuality.missingMenu}</strong></li>
                <li className={s.listItem}><span>GPS not verified</span><strong>{data.onboardingQuality.gpsUnverified}</strong></li>
                <li className={s.listItem}><span>Incomplete drafts</span><strong>{data.onboardingQuality.incomplete}</strong></li>
                <li className={s.listItem}><span>Average time to approval</span><strong>{data.onboardingQuality.averageApprovalHours != null ? `${data.onboardingQuality.averageApprovalHours} h` : "—"}</strong></li>
              </ul>
              {data.onboardingQuality.rejectionReasons.length > 0 && <p className={s.faint}>Rejections: {data.onboardingQuality.rejectionReasons.map((r) => `${r.reason} (${r.count})`).join(", ")}</p>}
            </section>
            <section className={s.card} aria-label="Support and AI">
              <h2 className={s.cardTitle} style={{ marginBottom: 10 }}>Support &amp; AI coach</h2>
              <ul className={s.list}>
                <li className={s.listItem}><span>Open tickets</span><strong>{data.support.open}</strong></li>
                <li className={s.listItem}><span>Past SLA</span><strong>{data.support.overdue}</strong></li>
                <li className={s.listItem}><span>Average resolution</span><strong>{data.support.averageResolutionHours != null ? `${data.support.averageResolutionHours} h` : "—"}</strong></li>
                <li className={s.listItem}><span>AI analyses</span><strong>{data.ai.configured ? data.ai.analysed : "AI Analysis Not Configured"}</strong></li>
                {data.ai.configured && <li className={s.listItem}><span>Average AI pitch score</span><strong>{data.ai.averageScore ?? "—"}</strong></li>}
              </ul>
              {data.support.byCategory.length > 0 && <p className={s.faint}>{data.support.byCategory.map((c) => `${SUPPORT_CATEGORY_LABEL[c.category as keyof typeof SUPPORT_CATEGORY_LABEL] ?? c.category}: ${c.count}`).join(" · ")}</p>}
            </section>
          </div>
          <details className={s.card} style={{ marginTop: 16 }}>
            <summary className={s.cardTitle} style={{ cursor: "pointer" }}>How each number is counted</summary>
            <ul className={s.list} style={{ marginTop: 10 }}>
              {Object.entries({ ...data.definitions, ...EXTRA_DEFS }).map(([k, v]) => <li key={k} className={s.listItem} style={{ display: "block" }}><strong>{k}</strong> — <span className={s.muted}>{v}</span></li>)}
            </ul>
          </details>
        </>
      )}
    </>
  );
}

// ---------- Notifications ----------

export function CrmNotifications() {
  const { data, error, reload } = useCrmData<{ items: CrmNotificationDto[]; unread: number }>("crm/notifications");
  const [err, setErr] = useState<string | null>(null);
  async function read(id: string) {
    try {
      await apiFetch(`crm/notifications/${id}/read`, { method: "POST", body: "{}" });
      reload();
    } catch (ex) {
      setErr(errorText(ex));
    }
  }
  return (
    <>
      <div className={s.toolbar}>
        <span className={s.muted}>{data ? `${data.unread} unread` : ""}</span>
        {data && data.unread > 0 && <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void read("all")}>Mark all read</button>}
      </div>
      {(error || err) && <p className={`${s.alert} ${s.alertError}`} role="alert">{error ?? err}</p>}
      {!data ? <div className={s.skel} /> : data.items.length === 0 ? <Empty>You&apos;re all caught up.</Empty> : (
        <ul className={s.list}>
          {data.items.map((n) => (
            <li key={n.id} className={s.listItem} style={{ opacity: n.readAt ? 0.6 : 1 }}>
              <span>
                <strong>{n.title}</strong>
                {n.body && <div className={s.muted}>{n.body}</div>}
                <div className={s.faint}>{when(n.createdAt)}</div>
              </span>
              <span className={s.toolbar} style={{ marginBottom: 0 }}>
                {n.deepLink && <Link className={`${s.btn} ${s.btnSm}`} href={n.deepLink} onClick={() => !n.readAt && void read(n.id)}>Open</Link>}
                {!n.readAt && <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void read(n.id)}>Mark read</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------- Profile ----------

export function CrmProfile() {
  const me = useMe();
  if (!me) return <div className={s.skel} />;
  const roleLabel = { FIELD_EMPLOYEE: "Field employee", SALES_MANAGER: "Sales manager", ADMIN: "Administrator", VIEWER: "Viewer (read only)" }[me.role];
  return (
    <section className={s.card}>
      <div className={s.formGrid}>
        <Field label="Name"><span style={{ color: "var(--c-text)" }}>{me.employee?.fullName ?? "—"}</span></Field>
        <Field label="Employee code"><span style={{ color: "var(--c-text)" }}>{me.employee?.employeeCode ?? "—"}</span></Field>
        <Field label="Territory"><span style={{ color: "var(--c-text)" }}>{me.employee?.territory ?? "Not set"}</span></Field>
        <Field label="CRM role"><span><Pill tone="brand">{roleLabel}</Pill></span></Field>
      </div>
      <p className={s.faint} style={{ marginTop: 14 }}>To change your details or territory, contact your sales manager or HR.</p>
    </section>
  );
}
