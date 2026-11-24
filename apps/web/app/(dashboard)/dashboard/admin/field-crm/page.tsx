"use client";

import { use, useState } from "react";
import { CrmCalls, CrmMeetings, CrmTasks } from "../../../../../components/crm/CrmActivity";
import { CrmAnalytics } from "../../../../../components/crm/CrmAnalytics";
import { CeoMessageAdmin } from "../../../../../components/crm/CrmAnnouncements";
import { CrmConversations } from "../../../../../components/crm/CrmConversations";
import { CrmDashboard } from "../../../../../components/crm/CrmDashboard";
import { CrmLeads } from "../../../../../components/crm/CrmLeads";
import { CrmEmbedded } from "../../../../../components/crm/CrmShell";
import { CrmSupport } from "../../../../../components/crm/CrmSupport";
import s from "../../../../../components/crm/crm.module.css";

const TABS = [
  ["overview", "Overview"],
  ["leads", "Leads & assignment"],
  ["tasks", "Tasks"],
  ["meetings", "Meetings"],
  ["calls", "Calls"],
  ["conversations", "Conversations & AI coach"],
  ["support", "Support queue"],
  ["analytics", "Team analytics"],
  ["ceo", "CEO message"],
] as const;
type Tab = (typeof TABS)[number][0];

/**
 * Field CRM 2.0 for sales managers and admins: the same modules the field team uses, scoped by the
 * server to the whole team (PLATFORM_VIEWER is read-only). Onboarding decisions stay on the
 * Onboarding Review page.
 */
export default function AdminFieldCrmPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: initial } = use(searchParams);
  const [tab, setTab] = useState<Tab>(() => TABS.find(([v]) => v === initial)?.[0] ?? "overview");
  const pick = (t: Tab) => {
    setTab(t);
    try {
      window.history.replaceState(null, "", `?tab=${t}`);
    } catch {
      /* ignore */
    }
  };
  return (
    <CrmEmbedded>
      <div className={s.head}>
        <div>
          <div className={s.eyebrow}>Regional Sales</div>
          <h1 className={s.title}>Field CRM 2.0</h1>
          <p className={s.sub}>Leads, activity, recorded conversations, support and team performance for the field sales team.</p>
        </div>
      </div>
      <div className={s.tabs} role="tablist" aria-label="Field CRM sections">
        {TABS.map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={tab === v} className={`${s.tab} ${tab === v ? s.tabOn : ""}`} onClick={() => pick(v)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && <CrmDashboard embedded />}
      {tab === "leads" && <CrmLeads />}
      {tab === "tasks" && <CrmTasks />}
      {tab === "meetings" && <CrmMeetings />}
      {tab === "calls" && <CrmCalls />}
      {tab === "conversations" && <CrmConversations />}
      {tab === "support" && <CrmSupport />}
      {tab === "analytics" && <CrmAnalytics />}
      {tab === "ceo" && <CeoMessageAdmin />}
    </CrmEmbedded>
  );
}
