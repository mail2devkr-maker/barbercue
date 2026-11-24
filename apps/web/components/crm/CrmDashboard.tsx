"use client";

import Link from "next/link";
import { useState } from "react";
import { CRM_KPI_DEFINITIONS, type CrmDashboardDto, type CrmKpiKey } from "@barbercue/shared";
import { pretty, useCrmData, when } from "../../lib/crm";
import { CeoMessage } from "./CrmAnnouncements";
import { useMe } from "./CrmShell";
import s from "./crm.module.css";

const PRESETS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["month", "This month"],
] as const;

const KPI_CARDS: Array<[CrmKpiKey, string, string?]> = [
  ["leadsAssigned", "Assigned leads"],
  ["newLeads", "New leads"],
  ["leadsContacted", "Leads contacted"],
  ["callsCompleted", "Calls completed"],
  ["callsPending", "Calls pending"],
  ["meetingsScheduled", "Meetings scheduled"],
  ["meetingsCompleted", "Meetings completed"],
  ["visitsCompleted", "Salon visits"],
  ["onboardingInProgress", "Onboarding in progress"],
  ["onboardingSubmitted", "Submitted for approval"],
  ["approved", "Approved salons"],
  ["activated", "Activated salons"],
  ["pendingFollowUps", "Pending follow-ups"],
  ["overdueTasks", "Overdue tasks"],
  ["leadToOnboarding", "Lead → onboarding", "%"],
  ["onboardingToActivation", "Onboarding → activation", "%"],
];

/** CRM dashboard: real KPIs (formulas in CRM_KPI_DEFINITIONS), quick actions and today's work. */
/** `embedded` (manager/admin view): no quick-action links into the employee portal. */
export function CrmDashboard({ base = "/employee", embedded = false }: { base?: string; embedded?: boolean }) {
  const me = useMe();
  const [preset, setPreset] = useState<(typeof PRESETS)[number][0]>("today");
  const { data, error } = useCrmData<CrmDashboardDto>(`crm/dashboard?preset=${preset}`);
  const actions: Array<[string, string, boolean]> = [
    ["+ Add lead", `${base}/leads?new=1`, true],
    ["Import leads", `${base}/leads?import=1`, !!me?.can.importLeads],
    ["Schedule call", `${base}/activity/calls?new=1`, true],
    ["Schedule meeting", `${base}/activity/meetings?new=1`, true],
    ["Create task", `${base}/activity/tasks?new=1`, true],
    ["Start onboarding", "/employee/onboarding/new", me?.role === "FIELD_EMPLOYEE"],
    ["Record conversation", `${base}/conversations?new=1`, me?.role === "FIELD_EMPLOYEE"],
    ["Create ticket", `${base}/support?new=1`, true],
  ];
  return (
    <>
      {!embedded && <CeoMessage />}
      {me?.role === "FIELD_EMPLOYEE" && (
        <section className={s.hero} aria-label="Your next move">
          <div>
            <div className={s.eyebrow}>Your next move</div>
            <h2>Every salon starts with one great visit.</h2>
            <p className={s.sub}>Capture location, photos, services and owner consent in one guided flow.</p>
          </div>
          <Link href="/employee/onboarding/new" className={`${s.btn} ${s.btnPrimary}`}>+ Onboard a salon</Link>
        </section>
      )}
      <div className={s.toolbar} role="tablist" aria-label="Period">
        {PRESETS.map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={preset === v} className={`${s.tab} ${preset === v ? s.tabOn : ""}`} onClick={() => setPreset(v)}>{label}</button>
        ))}
      </div>
      {error && <p className={`${s.alert} ${s.alertError}`} role="alert">{error}</p>}
      <section className={s.kpis} aria-label="Key figures">
        {KPI_CARDS.map(([key, label, unit]) => (
          <div key={key} className={s.kpi} title={CRM_KPI_DEFINITIONS[key]}>
            <span>{label}</span>
            <strong>{data ? `${data.kpis[key]}${unit ?? ""}` : "…"}</strong>
          </div>
        ))}
      </section>
      {!embedded && (
      <section className={s.card} style={{ marginBottom: 16 }} aria-label="Quick actions">
        <h2 className={s.cardTitle} style={{ marginBottom: 10 }}>Quick actions</h2>
        <div className={s.toolbar} style={{ marginBottom: 0 }}>
          {actions.filter(([, , show]) => show).map(([label, href]) => (
            <Link key={label} href={href} className={s.btn}>{label}</Link>
          ))}
        </div>
      </section>
      )}
      <div className={s.grid2}>
        <section className={s.card} aria-label="Upcoming meetings">
          <div className={s.cardHead}><h2 className={s.cardTitle}>Upcoming meetings</h2><Link className={s.link} href={`${base}/activity/meetings`} hidden={embedded}>All →</Link></div>
          {!data ? <div className={s.skel} /> : data.upcomingMeetings.length === 0 ? <p className={s.faint}>No meetings coming up.</p> : (
            <ul className={s.list}>{data.upcomingMeetings.map((m) => <li key={m.id} className={s.listItem}><span><strong>{m.lead.shopName}</strong><div className={s.faint}>{pretty(m.mode)} · {m.purpose ?? "Meeting"}</div></span><span>{when(m.startsAt)}</span></li>)}</ul>
          )}
        </section>
        <section className={s.card} aria-label="Pending callbacks">
          <div className={s.cardHead}><h2 className={s.cardTitle}>Pending calls</h2><Link className={s.link} href={`${base}/activity/calls`} hidden={embedded}>Queue →</Link></div>
          {!data ? <div className={s.skel} /> : data.pendingCallbacks.length === 0 ? <p className={s.faint}>Nothing due.</p> : (
            <ul className={s.list}>{data.pendingCallbacks.map((c) => <li key={c.id} className={s.listItem}><span><strong>{c.lead.shopName}</strong><div className={s.faint}>{c.lead.phone ?? "No phone"}</div></span><span className={c.overdue ? `${s.status} ${s.statusBad}` : s.status}>{c.overdue ? "Overdue" : when(c.scheduledAt)}</span></li>)}</ul>
          )}
        </section>
        <section className={s.card} aria-label="Overdue tasks">
          <div className={s.cardHead}><h2 className={s.cardTitle}>Overdue tasks</h2><Link className={s.link} href={`${base}/activity/tasks?overdue=1`} hidden={embedded}>All →</Link></div>
          {!data ? <div className={s.skel} /> : data.overdueTasks.length === 0 ? <p className={s.faint}>No overdue tasks. 🎉</p> : (
            <ul className={s.list}>{data.overdueTasks.map((t) => <li key={t.id} className={s.listItem}><span><strong>{t.subject}</strong><div className={s.faint}>{t.code}{t.lead ? ` · ${t.lead.shopName}` : ""}</div></span><span className={`${s.status} ${s.statusBad}`}>{when(t.dueAt)}</span></li>)}</ul>
          )}
        </section>
        <section className={s.card} aria-label="Onboarding progress">
          <div className={s.cardHead}><h2 className={s.cardTitle}>Onboarding progress</h2><Link className={s.link} href={embedded ? "/dashboard/admin/onboarding-review" : "/employee/onboarding"}>All →</Link></div>
          {!data ? <div className={s.skel} /> : data.onboarding.length === 0 ? <p className={s.faint}>No onboarding in progress.</p> : (
            <ul className={s.list}>{data.onboarding.map((o) => <li key={o.id} className={s.listItem}><span><strong>{o.salonName}</strong><div className={s.faint}>{o.reference}</div></span><span className={s.status}>{pretty(o.status)}</span></li>)}</ul>
          )}
        </section>
      </div>
      <section className={s.card} style={{ marginTop: 16 }} aria-label="Recent activity">
        <h2 className={s.cardTitle} style={{ marginBottom: 10 }}>Recent lead activity</h2>
        {!data ? <div className={s.skel} /> : data.recentActivity.length === 0 ? <p className={s.faint}>No activity yet.</p> : (
          <ul className={s.timeline}>{data.recentActivity.map((r) => <li key={r.id}><span><strong>{r.lead.shopName}</strong> — {r.summary}<div className={s.faint}>{when(r.createdAt)}{r.actor ? ` · ${r.actor}` : ""}</div></span></li>)}</ul>
        )}
      </section>
      <p className={s.faint} style={{ marginTop: 14 }}>All figures come from your CRM records. Hover a number to see how it is counted. Targets are not configured yet.</p>
    </>
  );
}
