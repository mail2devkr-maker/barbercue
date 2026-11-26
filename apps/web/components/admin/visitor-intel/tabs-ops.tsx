"use client";

import { useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
  VI_ALERT_KINDS,
  VI_ALERT_KIND_LABELS,
  VI_CAMPAIGN_KINDS,
  VI_CAMPAIGN_KIND_LABELS,
  VI_CHANNEL_LABELS,
  VI_PATHS,
  VI_PERIODS,
  VI_PERIOD_LABELS,
  VI_REPORT_FORMATS,
  VI_REPORT_TYPES,
  VI_SEGMENT_KEYS,
  VI_STAFF_ROLES,
  type ViAlertKind,
  type ViCampaignKind,
  type ViChannel,
  type ViPeriod,
  type ViTrackingSettings,
} from "@barbercue/shared";
import { AreaChart, BarChart } from "../../owner/charts";
import { DataTable, Drawer, Empty, ErrorBox, HBars, Kpi, LevelPill, Panel, Skeleton } from "./parts";
import { fmtAgo, fmtDateTime, fmtInr, fmtNum, fmtPct, useVi, viDownload, viPath, viSend } from "./vi-api";
import { useViContext } from "./VisitorIntelligence";
import s from "./vi.module.css";

const errMsg = (e: unknown, d = "That did not work.") => (e instanceof Error ? e.message : d);

// ================= Marketing: campaigns, QR, channels, segments =================

interface CampaignStats { visits: number; uniqueVisitors: number; registrations: number; searches: number; bookings: number; purchases: number; revenueInr: number; firstTouchConversions: number; firstTouchValueInr: number; spendInr: number; cacInr: number | null; roiPct: number | null; conversionPct: number | null }
interface Campaign { id: string; code: string; name: string; kind: ViCampaignKind; kindLabel: string; status: string; landingPath: string; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; city: string | null; salonId: string | null; budgetInr: number | null; channel: ViChannel; shortUrl: string; fullUrl: string; linkedExpenses: number; stats: CampaignStats; createdAt: string }
interface CampaignList { items: Campaign[]; channels: Array<{ channel: string; campaigns: number; visits: number; bookings: number; revenueInr: number; spendInr: number; roiPct: number | null; conversionPct: number | null }>; note?: string }

function QrCard({ value, label }: { value: string; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const download = () => {
    const canvas = wrap.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `fastque-qr-${label}.png`;
    a.click();
  };
  return (
    <div className={s.stack}>
      <div className={s.qr} ref={wrap}>
        <QRCodeCanvas value={value} size={196} level="M" includeMargin />
        <span className={s.code}>{value.replace(/^https?:\/\//, "")}</span>
      </div>
      <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={download}>
        Download PNG (print-ready)
      </button>
    </div>
  );
}

function CampaignDrawer({ campaign, onClose, onChanged }: { campaign: Campaign; onClose: () => void; onChanged: () => void }) {
  const { query, can } = useViContext();
  const detail = useVi<{ series: Array<{ date: string; sessions: number; bookings: number }>; expenses: Array<{ id: string; number: string; expenseDate: string; description: string; amount: number; status: string; counted: boolean }> }>(viPath(`${VI_PATHS.campaigns}/${campaign.id}?${query()}`), `${campaign.id}|${query()}`);
  const [search, setSearch] = useState("");
  const candidates = useVi<Array<{ id: string; number: string; expenseDate: string; description: string; amount: number; status: string; project: string | null }>>(can("manageCampaigns") ? viPath(`${VI_PATHS.campaigns}/finance-expenses?q=${encodeURIComponent(search)}`) : null, search);
  const [err, setErr] = useState<string | null>(null);
  const link = async (id: string, remove = false) => {
    setErr(null);
    try {
      if (remove) await viSend(viPath(`${VI_PATHS.campaigns}/${campaign.id}/expenses/${id}`), "DELETE");
      else await viSend(viPath(`${VI_PATHS.campaigns}/${campaign.id}/expenses`), "POST", { financeExpenseId: id });
      detail.reload();
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  const setStatus = async (status: string) => {
    try {
      await viSend(viPath(`${VI_PATHS.campaigns}/${campaign.id}`), "PATCH", { status });
      onChanged();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  const st = campaign.stats;
  return (
    <Drawer title={campaign.name} onClose={onClose}>
      {err && <ErrorBox message={err} />}
      <div className={s.grid2}>
        <QrCard value={campaign.shortUrl} label={campaign.code} />
        <div className={s.stack}>
          <p className={s.muted}>{campaign.kindLabel} · {VI_CHANNEL_LABELS[campaign.channel]} · {campaign.status}</p>
          <label className={s.field}>
            Short link (for QR, print, WhatsApp)
            <input className={s.input} readOnly value={campaign.shortUrl} onFocus={(e) => e.target.select()} />
          </label>
          <label className={s.field}>
            Full UTM link (for ads)
            <input className={s.input} readOnly value={campaign.fullUrl} onFocus={(e) => e.target.select()} />
          </label>
          {can("manageCampaigns") && (
            <div className={s.row}>
              {campaign.status !== "ACTIVE" && <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void setStatus("ACTIVE")}>Activate</button>}
              {campaign.status === "ACTIVE" && <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void setStatus("PAUSED")}>Pause</button>}
              {campaign.status !== "ARCHIVED" && <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnDanger}`} onClick={() => void setStatus("ARCHIVED")}>Archive (link goes to home)</button>}
            </div>
          )}
        </div>
      </div>
      <div className={s.kpiGrid} style={{ margin: "14px 0" }}>
        <Kpi label="Visits" value={st.visits} />
        <Kpi label="Unique visitors" value={st.uniqueVisitors} />
        <Kpi label="Registrations" value={st.registrations} />
        <Kpi label="Bookings" value={st.bookings} />
        <Kpi label="Value" value={st.revenueInr} format={(v) => fmtInr(v)} />
        <Kpi label="Spend (Finance)" value={st.spendInr} format={(v) => fmtInr(v)} />
        <Kpi label="CAC" value={st.cacInr} format={(v) => fmtInr(v)} />
        <Kpi label="ROI" value={st.roiPct} format={fmtPct} />
      </div>
      <Panel title="Daily visits">
        {detail.data?.series.length ? <AreaChart points={detail.data.series.map((p) => ({ label: p.date.slice(5), value: p.sessions }))} formatValue={fmtNum} ariaLabel="Campaign visits per day" height={180} /> : <Skeleton height={180} />}
      </Panel>
      <Panel title="Linked Finance expenses" subtitle="Spend is never entered here: link expenses already recorded in Finance → Expenses.">
        {detail.data?.expenses.length ? (
          <DataTable searchable={false} rows={detail.data.expenses} columns={[
            { key: "n", label: "Expense", value: (r) => r.number },
            { key: "d", label: "Date", value: (r) => r.expenseDate.slice(0, 10) },
            { key: "desc", label: "Description", value: (r) => r.description },
            { key: "a", label: "Amount", value: (r) => r.amount, render: (r) => fmtInr(r.amount), num: true },
            { key: "s", label: "Status", value: (r) => `${r.status}${r.counted ? "" : " (not counted)"}` },
            ...(can("manageCampaigns") ? [{ key: "x", label: "", value: () => "", render: (r: { id: string }) => (<button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void link(r.id, true)}>Unlink</button>) }] : []),
          ]} />
        ) : (
          <Empty title="No expenses linked" />
        )}
        {can("manageCampaigns") && (
          <div className={s.stack} style={{ marginTop: 12 }}>
            <input className={s.input} placeholder="Find a Finance expense (number, description, project)" value={search} onChange={(e) => setSearch(e.target.value)} />
            {(candidates.data ?? []).slice(0, 8).map((c) => (
              <div key={c.id} className={s.row}>
                <span style={{ flex: 1 }}>
                  {c.number} · {c.description} <span className={s.muted}>({fmtInr(c.amount)}, {c.status})</span>
                </span>
                <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void link(c.id)}>Link</button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </Drawer>
  );
}

function NewCampaign({ onCreated }: { onCreated: () => void }) {
  const [f, setF] = useState({ name: "", kind: "UTM_LINK" as ViCampaignKind, landingPath: "/", utmSource: "", utmMedium: "", utmCampaign: "", city: "", salonId: "", employeeProfileId: "", budgetInr: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const people = useVi<Array<{ id: string; fullName: string }>>(f.kind === "EMPLOYEE_QR" ? viPath("crm/assignees") : null, f.kind);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await viSend(viPath(VI_PATHS.campaigns), "POST", {
        name: f.name,
        kind: f.kind,
        landingPath: f.landingPath || "/",
        utmSource: f.utmSource || null,
        utmMedium: f.utmMedium || null,
        utmCampaign: f.utmCampaign || null,
        city: f.city || null,
        salonId: f.salonId || null,
        employeeProfileId: f.employeeProfileId || null,
        budgetInr: f.budgetInr ? Number(f.budgetInr) : null,
      });
      setF((x) => ({ ...x, name: "", utmCampaign: "" }));
      onCreated();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Create campaign link / QR" subtitle="Generates a unique short link and QR code with UTM tags. Launching or paying for ads always stays with you.">
      {err && <ErrorBox message={err} />}
      <div className={s.form}>
        <label className={s.field}>Name<input className={s.input} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Indore society drive – Nov" /></label>
        <label className={s.field}>Type
          <select className={s.select} value={f.kind} onChange={(e) => set("kind", e.target.value)}>
            {VI_CAMPAIGN_KINDS.map((k) => <option key={k} value={k}>{VI_CAMPAIGN_KIND_LABELS[k]}</option>)}
          </select>
        </label>
        <label className={s.field}>Landing page<input className={s.input} value={f.landingPath} onChange={(e) => set("landingPath", e.target.value)} placeholder="/search?service=haircut" /></label>
        <label className={s.field}>City<input className={s.input} value={f.city} onChange={(e) => set("city", e.target.value)} /></label>
        {f.kind === "SALON_QR" && <label className={s.field}>Salon id<input className={s.input} value={f.salonId} onChange={(e) => set("salonId", e.target.value)} /></label>}
        {f.kind === "EMPLOYEE_QR" && (
          <label className={s.field}>Sales employee
            <select className={s.select} value={f.employeeProfileId} onChange={(e) => set("employeeProfileId", e.target.value)}>
              <option value="">Choose…</option>
              {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
          </label>
        )}
        <label className={s.field}>utm_source<input className={s.input} value={f.utmSource} onChange={(e) => set("utmSource", e.target.value)} placeholder="auto for QR/influencer" /></label>
        <label className={s.field}>utm_medium<input className={s.input} value={f.utmMedium} onChange={(e) => set("utmMedium", e.target.value)} /></label>
        <label className={s.field}>utm_campaign<input className={s.input} value={f.utmCampaign} onChange={(e) => set("utmCampaign", e.target.value)} placeholder="defaults to the code" /></label>
        <label className={s.field}>Planned budget (₹, reference only)<input className={s.input} type="number" min="0" value={f.budgetInr} onChange={(e) => set("budgetInr", e.target.value)} /></label>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy || f.name.trim().length < 2} onClick={() => void submit()}>{busy ? "Creating…" : "Create"}</button>
      </div>
    </Panel>
  );
}

interface Segment { id: string; name: string; description: string | null; isSystem: boolean; total: number; marketingConsented: number; registered: number; reachableRegistered: number; frequencyCapPerWeek: number }

function Segments() {
  const { can } = useViContext();
  const res = useVi<{ segments: Segment[]; note: string }>(viPath(VI_PATHS.segments), "segments");
  const [audience, setAudience] = useState<{ seg: Segment; channel: string } | null>(null);
  const [f, setF] = useState({ name: "", base: "abandoned_booking", city: "", serviceCategory: "", lookbackDays: "30" });
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setErr(null);
    try {
      await viSend(viPath(VI_PATHS.segments), "POST", { name: f.name, rule: { base: f.base, city: f.city || null, serviceCategory: f.serviceCategory || null, lookbackDays: Number(f.lookbackDays) || 30 }, frequencyCapPerWeek: 2 });
      setF((x) => ({ ...x, name: "" }));
      res.reload();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <Panel title="Audience segments" subtitle={res.data?.note} help="First-party only. Reachable = marketing consent, not opted out, not suppressed. Frequency cap applies when activated.">
      {res.error && <ErrorBox message={res.error} />}
      {!res.data ? <Skeleton height={200} /> : (
        <DataTable rows={res.data.segments} columns={[
          { key: "n", label: "Segment", value: (r) => r.name, render: (r) => (<span title={r.description ?? ""}>{r.name} {r.isSystem && <span className={s.pill}>system</span>}</span>) },
          { key: "t", label: "Members", value: (r) => r.total, num: true },
          { key: "c", label: "Marketing consent", value: (r) => r.marketingConsented, num: true },
          { key: "r", label: "Registered", value: (r) => r.registered, num: true },
          { key: "rr", label: "Reachable registered", value: (r) => r.reachableRegistered, num: true },
          { key: "cap", label: "Cap / week", value: (r) => r.frequencyCapPerWeek, num: true },
          ...(can("manageSegments") ? [{ key: "a", label: "", value: () => "", render: (r: Segment) => (<span className={s.row}>
            <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setAudience({ seg: r, channel: "WHATSAPP" })}>Audience</button>
            {!r.isSystem && <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnDanger}`} onClick={() => void viSend(viPath(`${VI_PATHS.segments}/${r.id}`), "DELETE").then(res.reload)}>Delete</button>}
          </span>) }] : []),
        ]} />
      )}
      {can("manageSegments") && (
        <>
          {err && <ErrorBox message={err} />}
          <div className={s.form} style={{ marginTop: 12 }}>
            <label className={s.field}>New segment name<input className={s.input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className={s.field}>Based on<select className={s.select} value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })}>{VI_SEGMENT_KEYS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}</select></label>
            <label className={s.field}>City (optional)<input className={s.input} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
            <label className={s.field}>Service interest (optional)<input className={s.input} value={f.serviceCategory} onChange={(e) => setF({ ...f, serviceCategory: e.target.value })} placeholder="haircut, facial…" /></label>
            <label className={s.field}>Lookback (days)<input className={s.input} type="number" min="1" max="730" value={f.lookbackDays} onChange={(e) => setF({ ...f, lookbackDays: e.target.value })} /></label>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={f.name.trim().length < 2} onClick={() => void create()}>Save segment</button>
          </div>
        </>
      )}
      {audience && <AudienceDrawer seg={audience.seg} onClose={() => setAudience(null)} />}
    </Panel>
  );
}

function AudienceDrawer({ seg, onClose }: { seg: Segment; onClose: () => void }) {
  const [channel, setChannel] = useState("WHATSAPP");
  const res = useVi<{ rows: Array<{ visitor: string; city: string | null; registered: boolean; contact: string | null }> }>(viPath(`${VI_PATHS.segments}/${seg.id}/audience?channel=${channel}`), channel);
  return (
    <Drawer title={`${seg.name} · reachable audience`} onClose={onClose}>
      <p className={s.muted}>Only visitors with marketing consent who have not opted out of this channel. Viewing is audited. Sending is not automated: use an approved channel provider.</p>
      <select className={s.select} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
        {["WHATSAPP", "EMAIL", "SMS", "PUSH", "GOOGLE_ADS", "META_ADS"].map((c) => <option key={c}>{c}</option>)}
      </select>
      {res.error && <ErrorBox message={res.error} />}
      {!res.data ? <Skeleton height={200} /> : (
        <DataTable rows={res.data.rows} exportName={`fastque-audience-${channel.toLowerCase()}`} columns={[
          { key: "v", label: "Visitor", value: (r) => r.visitor },
          { key: "c", label: "City", value: (r) => r.city ?? "—" },
          { key: "r", label: "Registered", value: (r) => (r.registered ? "Yes" : "No") },
          { key: "ct", label: "Contact (held by FastQue)", value: (r) => r.contact ?? "—" },
        ]} />
      )}
    </Drawer>
  );
}

export function MarketingTab() {
  const { query, can } = useViContext();
  const res = useVi<CampaignList>(viPath(`${VI_PATHS.campaigns}?${query()}`), query());
  const [open, setOpen] = useState<Campaign | null>(null);
  const [compare, setCompare] = useState<Set<string>>(new Set());
  const d = res.data;
  const compared = d?.items.filter((c) => compare.has(c.id)) ?? [];
  return (
    <>
      {can("manageCampaigns") && <NewCampaign onCreated={res.reload} />}
      {res.error && <ErrorBox message={res.error} onRetry={res.reload} />}
      {!d ? <Skeleton height={300} /> : (
        <>
          <Panel title="Campaigns" subtitle={d.note} help="Tick up to 4 campaigns to compare them.">
            <DataTable rows={d.items} exportName="fastque-campaigns" onRowClick={(r) => setOpen(r)} columns={[
              { key: "cmp", label: "", value: () => "", render: (r) => (<input type="checkbox" aria-label={`Compare ${r.name}`} checked={compare.has(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => setCompare((c) => { const n = new Set(c); if (n.has(r.id)) n.delete(r.id); else if (n.size < 4) n.add(r.id); return n; })} />) },
              { key: "n", label: "Campaign", value: (r) => r.name },
              { key: "k", label: "Type", value: (r) => r.kindLabel },
              { key: "st", label: "Status", value: (r) => r.status },
              { key: "v", label: "Visits", value: (r) => r.stats.visits, num: true },
              { key: "u", label: "Uniques", value: (r) => r.stats.uniqueVisitors, num: true },
              { key: "r", label: "Registrations", value: (r) => r.stats.registrations, num: true },
              { key: "se", label: "Searches", value: (r) => r.stats.searches, num: true, hidden: true },
              { key: "b", label: "Bookings", value: (r) => r.stats.bookings, num: true },
              { key: "p", label: "Purchases", value: (r) => r.stats.purchases, num: true, hidden: true },
              { key: "rev", label: "Value", value: (r) => r.stats.revenueInr, render: (r) => fmtInr(r.stats.revenueInr), num: true },
              { key: "sp", label: "Spend", value: (r) => r.stats.spendInr, render: (r) => fmtInr(r.stats.spendInr), num: true },
              { key: "cac", label: "CAC", value: (r) => r.stats.cacInr, render: (r) => fmtInr(r.stats.cacInr), num: true },
              { key: "roi", label: "ROI", value: (r) => r.stats.roiPct, render: (r) => fmtPct(r.stats.roiPct), num: true },
            ]} emptyText="No campaigns yet. Create one above." />
          </Panel>
          {compared.length > 1 && (
            <Panel title="Comparison">
              <BarChart points={compared.map((c) => ({ label: c.name.slice(0, 16), value: c.stats.bookings }))} formatValue={fmtNum} ariaLabel="Bookings by campaign" height={180} />
              <div className={s.tableWrap} style={{ marginTop: 10 }}>
                <table className={s.table}>
                  <thead><tr><th>Metric</th>{compared.map((c) => <th key={c.id} className={s.num}>{c.name}</th>)}</tr></thead>
                  <tbody>
                    {(["visits", "uniqueVisitors", "registrations", "bookings", "revenueInr", "spendInr", "cacInr", "roiPct", "conversionPct"] as const).map((m) => (
                      <tr key={m}><td>{m}</td>{compared.map((c) => <td key={c.id} className={s.num}>{m.endsWith("Inr") ? fmtInr(c.stats[m]) : m.endsWith("Pct") ? fmtPct(c.stats[m]) : fmtNum(c.stats[m])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
          <Panel title="Channel ranking (campaign traffic)">
            <DataTable searchable={false} rows={d.channels} columns={[
              { key: "c", label: "Channel", value: (r) => VI_CHANNEL_LABELS[r.channel as ViChannel] ?? r.channel },
              { key: "n", label: "Campaigns", value: (r) => r.campaigns, num: true },
              { key: "v", label: "Visits", value: (r) => r.visits, num: true },
              { key: "b", label: "Bookings", value: (r) => r.bookings, num: true },
              { key: "cv", label: "Conversion", value: (r) => r.conversionPct, render: (r) => fmtPct(r.conversionPct), num: true },
              { key: "rev", label: "Value", value: (r) => r.revenueInr, render: (r) => fmtInr(r.revenueInr), num: true },
              { key: "sp", label: "Spend", value: (r) => r.spendInr, render: (r) => fmtInr(r.spendInr), num: true },
              { key: "roi", label: "ROI", value: (r) => r.roiPct, render: (r) => fmtPct(r.roiPct), num: true },
            ]} />
          </Panel>
        </>
      )}
      {can("segments") && <Segments />}
      {open && <CampaignDrawer campaign={open} onClose={() => setOpen(null)} onChanged={res.reload} />}
    </>
  );
}

// ================= AI: insights, Ask, alerts =================

interface Insight { id: string; kind: string; title: string; summary: string; supportingData: unknown; periodFrom: string; periodTo: string; impact: string; confidencePct: number; priority: string; action: string; department: string; source: string; status: string; crmTaskId: string | null; createdAt: string }

function InsightCard({ i, onChanged }: { i: Insight; onChanged: () => void }) {
  const { can } = useViContext();
  const [task, setTask] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (status: string) => {
    try {
      await viSend(viPath(`${VI_PATHS.insights}/${i.id}/decision`), "POST", { status });
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <article className={s.insight}>
      <div className={s.insightMeta}>
        <LevelPill level={i.priority} />
        <span className={s.pill}>{i.department}</span>
        <span>{i.kind.replace(/_/g, " ").toLowerCase()}</span>
        <span>· confidence {i.confidencePct}%</span>
        <span>· {i.source === "LLM_SUMMARY" ? "AI-written summary of aggregates" : "rule-based"}</span>
        {i.status !== "NEW" && <span className={`${s.pill} ${i.status === "ACCEPTED" ? s.pillGood : ""}`}>{i.status}</span>}
      </div>
      <h3>{i.title}</h3>
      <p style={{ margin: 0, fontSize: "0.86rem" }}>{i.summary}</p>
      <p style={{ margin: 0, fontSize: "0.84rem" }}><strong>Action:</strong> {i.action}</p>
      <p className={s.muted} style={{ margin: 0, fontSize: "0.78rem" }}>Impact: {i.impact} · {fmtDateTime(i.periodFrom)} – {fmtDateTime(i.periodTo)}</p>
      <details>
        <summary>Supporting data</summary>
        <pre>{JSON.stringify(i.supportingData, null, 2)}</pre>
      </details>
      {err && <ErrorBox message={err} />}
      {can("decideInsights") && (
        <div className={s.row}>
          {i.status === "NEW" && <>
            <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void decide("ACCEPTED")}>Accept</button>
            <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void decide("REJECTED")}>Reject</button>
            <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void decide("DISMISSED")}>Dismiss</button>
          </>}
          {i.crmTaskId ? <span className={`${s.pill} ${s.pillGood}`}>CRM task created</span> : <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setTask(true)}>Create CRM task</button>}
        </div>
      )}
      {task && <InsightTaskDrawer insight={i} onClose={() => setTask(false)} onDone={onChanged} />}
    </article>
  );
}

function InsightTaskDrawer({ insight, onClose, onDone }: { insight: Insight; onClose: () => void; onDone: () => void }) {
  const people = useVi<Array<{ id: string; fullName: string; territory: string | null }>>(viPath("crm/assignees"), "assignees");
  const [who, setWho] = useState("");
  const [due, setDue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    try {
      await viSend(viPath(`${VI_PATHS.insights}/${insight.id}/task`), "POST", { assigneeEmployeeId: who, dueAt: due ? new Date(`${due}T18:00:00+05:30`).toISOString() : null });
      onDone();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <Drawer title="Create CRM task" onClose={onClose}>
      <p className={s.muted}>{insight.title}</p>
      {err && <ErrorBox message={err} />}
      <div className={s.form}>
        <label className={s.field}>Owner<select className={s.select} value={who} onChange={(e) => setWho(e.target.value)}><option value="">Choose…</option>{(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.fullName}{p.territory ? ` (${p.territory})` : ""}</option>)}</select></label>
        <label className={s.field}>Due<input className={s.input} type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={!who} onClick={() => void submit()}>Create task</button>
      </div>
    </Drawer>
  );
}

interface AskAnswer { question: string; answer: string; tool: string | null; routedBy: string | null; periodLabel?: string; metrics: Array<{ label: string; value: string | number | null }>; table: { columns: string[]; rows: Array<Array<string | number | null>> } | null; chart: { type: "bar" | "line"; points: Array<{ label: string; value: number }> } | null; examples?: string[] }

function AskAi() {
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState<ViPeriod | "">("");
  const [log, setLog] = useState<AskAnswer[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const examples = ["How many visitors today?", "Which city has the most demand?", "Where should we onboard the next 100 salons?", "Why are bookings abandoned?", "Compare Delhi-NCR vs Indore", "What are people searching for this week?"];
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const a = await viSend<AskAnswer>(viPath(VI_PATHS.ask), "POST", { question, ...(period ? { period } : {}) });
      setLog((l) => [...l, a]);
      setQ("");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Ask FastQue AI" subtitle="Answers come from whitelisted, read-only analytics tools run with your role and scope. No AI-written SQL, ever.">
      <div className={s.chat}>
        <div className={s.chatLog} aria-live="polite">
          {log.length === 0 && (
            <div className={s.row}>
              {examples.map((e) => <button key={e} type="button" className={s.chip} onClick={() => void ask(e)}>{e}</button>)}
            </div>
          )}
          {log.map((a, i) => (
            <div key={i} className={s.stack}>
              <div className={s.msgUser}>{a.question}</div>
              <div className={s.msgBot}>
                <p style={{ margin: 0 }}>{a.answer}</p>
                {a.metrics.length > 0 && <div className={s.metrics}>{a.metrics.map((m) => <span key={m.label} className={s.metric}><strong>{typeof m.value === "number" ? fmtNum(m.value) : (m.value ?? "—")}</strong>{m.label}</span>)}</div>}
                {a.chart && a.chart.points.length > 0 && (a.chart.type === "bar" ? <BarChart points={a.chart.points} formatValue={fmtNum} ariaLabel="Answer chart" height={170} /> : <AreaChart points={a.chart.points.map((p) => ({ ...p, label: p.label.slice(5) || p.label }))} formatValue={fmtNum} ariaLabel="Answer chart" height={170} />)}
                {a.table && a.table.rows.length > 0 && (
                  <div className={s.tableWrap} style={{ marginTop: 8 }}>
                    <table className={s.table}><thead><tr>{a.table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                      <tbody>{a.table.rows.slice(0, 15).map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{typeof c === "number" ? fmtNum(c) : (c ?? "—")}</td>)}</tr>)}</tbody></table>
                  </div>
                )}
                {a.examples && <div className={s.row} style={{ marginTop: 8 }}>{a.examples.map((e) => <button key={e} type="button" className={s.chip} onClick={() => void ask(e)}>{e}</button>)}</div>}
                <p className={s.note}>{a.periodLabel ? `Period: ${a.periodLabel}. ` : ""}{a.tool ? `Tool: ${a.tool} (${a.routedBy === "ai" ? "chosen by AI" : "matched by rules"}).` : ""}</p>
              </div>
            </div>
          ))}
        </div>
        {err && <ErrorBox message={err} />}
        <form className={s.chatInput} onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
          <input className={s.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about visitors, demand, searches, channels, conversion…" maxLength={500} aria-label="Question" />
          <select className={s.select} value={period} onChange={(e) => setPeriod(e.target.value as ViPeriod | "")} aria-label="Period">
            <option value="">Auto period</option>
            {VI_PERIODS.filter((p) => p !== "custom").map((p) => <option key={p} value={p}>{VI_PERIOD_LABELS[p]}</option>)}
          </select>
          <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={busy || !q.trim()}>{busy ? "…" : "Ask"}</button>
        </form>
      </div>
    </Panel>
  );
}

function AlertsFeed() {
  const res = useVi<{ open: number; items: Array<{ id: string; kind: string; severity: string; message: string; firedAt: string; acknowledgedAt: string | null }> }>(viPath(`${VI_PATHS.alerts}/events?pageSize=50`), "alerts", { pollMs: 60_000 });
  const ack = async (id: string) => {
    await viSend(viPath(`${VI_PATHS.alerts}/events/${id}/ack`), "POST");
    res.reload();
  };
  return (
    <Panel title={`Alerts${res.data ? ` (${res.data.open} open)` : ""}`} subtitle="Checked every 15 minutes. Thresholds, recipients and channels are in Tracking Settings.">
      {res.error && <ErrorBox message={res.error} />}
      {!res.data ? <Skeleton height={120} /> : res.data.items.length ? (
        <div className={s.stack}>
          {res.data.items.map((a) => (
            <div key={a.id} className={s.row} style={{ opacity: a.acknowledgedAt ? 0.55 : 1 }}>
              <LevelPill level={a.severity === "CRITICAL" ? "HIGH" : a.severity === "WARNING" ? "MEDIUM" : "LOW"} />
              <span style={{ flex: 1, minWidth: 200 }}><strong>{VI_ALERT_KIND_LABELS[a.kind as ViAlertKind] ?? a.kind}</strong> — {a.message} <span className={s.muted}>{fmtAgo(a.firedAt)}</span></span>
              {!a.acknowledgedAt && <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void ack(a.id)}>Acknowledge</button>}
            </div>
          ))}
        </div>
      ) : <Empty title="No alerts" />}
    </Panel>
  );
}

export function AiTab() {
  const { can } = useViContext();
  const [status, setStatus] = useState("NEW");
  const [dept, setDept] = useState("");
  const res = useVi<{ items: Insight[]; total: number; counts: Record<string, number> }>(viPath(`${VI_PATHS.insights}?status=${status}${dept ? `&department=${dept}` : ""}&pageSize=60`), `${status}|${dept}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const generate = async () => {
    setBusy(true);
    try {
      const r = await viSend<{ created: number; total: number }>(viPath(`${VI_PATHS.insights}/generate`), "POST");
      setMsg(`${r.created} new recommendations (${r.total} checked).`);
      res.reload();
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const summary = res.data?.items.find((i) => i.kind === "WEEKLY_SUMMARY");
  return (
    <>
      {can("ask") && <AskAi />}
      <Panel
        title="FastQue Intelligence Agent"
        subtitle="Statistics and explicit rules produce every recommendation; an LLM (if enabled) only rewrites summaries of aggregate numbers. Nothing is executed without a person."
        actions={can("decideInsights") ? <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={() => void generate()}>{busy ? "Analysing…" : "Run analysis now"}</button> : undefined}
      >
        {msg && <div className={s.banner}>{msg}</div>}
        <div className={s.row} style={{ marginBottom: 12 }}>
          {["NEW", "ACCEPTED", "REJECTED", "DISMISSED", "ALL"].map((st) => (
            <button key={st} type="button" className={`${s.chip} ${status === st ? s.chipOn : ""}`} onClick={() => setStatus(st)}>
              {st.toLowerCase()} {res.data?.counts?.[st] != null ? `(${res.data.counts[st]})` : ""}
            </button>
          ))}
          <select className={s.select} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
            <option value="">All departments</option>
            {["MARKETING", "SALES", "OPERATIONS", "PRODUCT", "SEO", "LEADERSHIP"].map((d) => <option key={d}>{d}</option>)}
          </select>
        </div>
        {res.error && <ErrorBox message={res.error} />}
        {summary && <div className={s.banner}><strong>{summary.title}:</strong> {summary.summary}</div>}
        {!res.data ? <Skeleton height={140} count={2} /> : res.data.items.filter((i) => i.kind !== "WEEKLY_SUMMARY").length ? (
          <div className={s.cards}>{res.data.items.filter((i) => i.kind !== "WEEKLY_SUMMARY").map((i) => <InsightCard key={i.id} i={i} onChanged={res.reload} />)}</div>
        ) : (
          <Empty title="No recommendations here">The agent runs daily at 07:00 IST and needs enough tracked traffic to say anything with confidence.</Empty>
        )}
      </Panel>
      {can("alerts") && <AlertsFeed />}
    </>
  );
}

// ================= Reports =================

export function ReportsTab() {
  const { can, filters } = useViContext();
  const [type, setType] = useState<(typeof VI_REPORT_TYPES)[number]>("activity");
  const [period, setPeriod] = useState<ViPeriod>(filters.period ?? "30d");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const schedules = useVi<Array<{ id: string; reportType: string; format: string; frequency: string; period: string; nextRunAt: string; lastRunAt: string | null; lastStatus: string | null }>>(viPath(`${VI_PATHS.reports}/schedules`), "schedules");
  const staff = useVi<Array<{ userId: string; role: string; email: string | null }>>(can("staffRoles") ? viPath(`${VI_PATHS.staffRoles}/candidates`) : null, "cand");
  const [sched, setSched] = useState({ format: "xlsx", frequency: "WEEKLY", recipients: "" });
  const download = async (format: string) => {
    setErr(null);
    setBusy(format);
    try {
      await viDownload(viPath(`${VI_PATHS.reports}/export?type=${type}&format=${format}&period=${period}`), `fastque-${type}.${format}`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  const schedule = async () => {
    setErr(null);
    try {
      const ids = sched.recipients.split(",").map((x) => x.trim()).filter(Boolean);
      await viSend(viPath(`${VI_PATHS.reports}/schedules`), "POST", { reportType: type, format: sched.format, frequency: sched.frequency, recipientUserIds: ids, period });
      schedules.reload();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <>
      <Panel title="Export a report" subtitle="Aggregates only, no contact details. Every export is recorded in the audit log.">
        {err && <ErrorBox message={err} />}
        <div className={s.form}>
          <label className={s.field}>Report<select className={s.select} value={type} onChange={(e) => setType(e.target.value as typeof type)}>{VI_REPORT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label className={s.field}>Period<select className={s.select} value={period} onChange={(e) => setPeriod(e.target.value as ViPeriod)}>{VI_PERIODS.filter((p) => p !== "custom").map((p) => <option key={p} value={p}>{VI_PERIOD_LABELS[p]}</option>)}</select></label>
          {can("export") ? VI_REPORT_FORMATS.map((f) => (
            <button key={f} type="button" className={`${s.btn} ${f === "xlsx" ? s.btnPrimary : ""}`} disabled={!!busy} onClick={() => void download(f)}>{busy === f ? "Preparing…" : `Download ${f.toUpperCase()}`}</button>
          )) : <span className={s.muted}>Your role can view but not export.</span>}
        </div>
      </Panel>
      <Panel title="Scheduled delivery" subtitle="Daily, weekly (Monday) or monthly at 08:00 IST, run with the creator's current permissions. Email needs VI email configuration; otherwise the run is recorded as not emailed.">
        {schedules.data?.length ? (
          <DataTable searchable={false} rows={schedules.data} columns={[
            { key: "t", label: "Report", value: (r) => r.reportType },
            { key: "f", label: "Format", value: (r) => r.format },
            { key: "q", label: "Frequency", value: (r) => r.frequency },
            { key: "n", label: "Next run", value: (r) => r.nextRunAt, render: (r) => fmtDateTime(r.nextRunAt) },
            { key: "l", label: "Last result", value: (r) => r.lastStatus ?? "—" },
            ...(can("export") ? [{ key: "x", label: "", value: () => "", render: (r: { id: string }) => <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void viSend(viPath(`${VI_PATHS.reports}/schedules/${r.id}`), "DELETE").then(schedules.reload)}>Remove</button> }] : []),
          ]} />
        ) : <Empty title="No schedules" />}
        {can("export") && (
          <div className={s.form} style={{ marginTop: 12 }}>
            <label className={s.field}>Format<select className={s.select} value={sched.format} onChange={(e) => setSched({ ...sched, format: e.target.value })}>{VI_REPORT_FORMATS.map((f) => <option key={f}>{f}</option>)}</select></label>
            <label className={s.field}>Frequency<select className={s.select} value={sched.frequency} onChange={(e) => setSched({ ...sched, frequency: e.target.value })}>{["DAILY", "WEEKLY", "MONTHLY"].map((f) => <option key={f}>{f}</option>)}</select></label>
            <label className={s.field}>Recipient user ids (comma-separated)<input className={s.input} value={sched.recipients} onChange={(e) => setSched({ ...sched, recipients: e.target.value })} list="vi-staff" /></label>
            <datalist id="vi-staff">{(staff.data ?? []).map((c) => <option key={c.userId} value={c.userId}>{c.email ?? c.role}</option>)}</datalist>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={!sched.recipients.trim()} onClick={() => void schedule()}>Schedule {type}</button>
          </div>
        )}
      </Panel>
    </>
  );
}

// ================= Tracking settings =================

interface SettingsDto {
  settings: ViTrackingSettings;
  env: { trackingEnabled: boolean; integrationsEnabled: boolean; geoipDatabase: boolean; geminiKey: boolean; ollamaUrl: string | null; emailConfigured: boolean };
  health: { accepted: number; processed: number; dropped: number; bots: number; noConsent: number; sampledOut: number; errors: number; lastError: string | null; lastFlushAt: string | null; queueLength: number };
  demo: { allowed: boolean; demoVisitors: number };
}

function TrackingSettings() {
  const res = useVi<SettingsDto>(viPath(VI_PATHS.settings), "settings");
  const [draft, setDraft] = useState<ViTrackingSettings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const cur = draft ?? res.data?.settings ?? null;
  const set = <K extends keyof ViTrackingSettings>(k: K, v: ViTrackingSettings[K]) => cur && setDraft({ ...cur, [k]: v });
  const save = async () => {
    if (!cur) return;
    try {
      await viSend(viPath(VI_PATHS.settings), "PUT", cur);
      setDraft(null);
      setMsg("Saved.");
      res.reload();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  const demo = async (seed: boolean) => {
    try {
      const r = seed ? await viSend<{ visitors: number; sessions: number }>(viPath(`${VI_PATHS.demo}/seed?visitors=400`), "POST") : await viSend<{ removed: number }>(viPath(VI_PATHS.demo), "DELETE");
      setMsg(seed ? `Demo data created (DEV ONLY, labelled): ${JSON.stringify(r)}` : `Demo data removed: ${JSON.stringify(r)}`);
      res.reload();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  if (res.error) return <ErrorBox message={res.error} />;
  if (!res.data || !cur) return <Skeleton height={300} />;
  const { env, health, demo: demoState } = res.data;
  return (
    <>
      {demoState.demoVisitors > 0 && <div className={s.banner}>⚠ {fmtNum(demoState.demoVisitors)} DEMO visitors are loaded (development only). Every dashboard includes them until you remove them below.</div>}
      {msg && <div className={s.banner}>{msg}</div>}
      <Panel title="Tracking" subtitle="Changes apply to the website within 30 seconds.">
        <div className={s.form}>
          <label className={s.check}><input type="checkbox" checked={cur.trackingEnabled} onChange={(e) => set("trackingEnabled", e.target.checked)} /> Tracking on {env.trackingEnabled ? "" : "(server kill switch VI_TRACKING_ENABLED=false is active)"}</label>
          <label className={s.field}>Sampling (1 = every consented visitor)<input className={s.input} type="number" step="0.05" min="0.01" max="1" value={cur.samplingRate} onChange={(e) => set("samplingRate", Number(e.target.value))} /></label>
          <label className={s.field}>Live activity window (minutes)<input className={s.input} type="number" min="1" max="120" value={cur.activityWindowMinutes} onChange={(e) => set("activityWindowMinutes", Number(e.target.value))} /></label>
          <label className={s.field}>Raw event retention (days)<input className={s.input} type="number" min="7" max="1095" value={cur.rawEventRetentionDays} onChange={(e) => set("rawEventRetentionDays", Number(e.target.value))} /></label>
          <label className={s.field}>Session retention (days)<input className={s.input} type="number" min="30" max="1095" value={cur.sessionRetentionDays} onChange={(e) => set("sessionRetentionDays", Number(e.target.value))} /></label>
          <label className={s.field}>Daily totals retention (days)<input className={s.input} type="number" min="90" max="3650" value={cur.aggregateRetentionDays} onChange={(e) => set("aggregateRetentionDays", Number(e.target.value))} /></label>
          <label className={s.check}><input type="checkbox" checked={cur.storeLocality} onChange={(e) => set("storeLocality", e.target.checked)} /> Show locality (visitor-chosen only)</label>
          <label className={s.field}>AI provider
            <select className={s.select} value={cur.aiProvider} onChange={(e) => set("aiProvider", e.target.value as ViTrackingSettings["aiProvider"])}>
              <option value="none">None (rules only)</option>
              <option value="gemini">Gemini {env.geminiKey ? "" : "(GEMINI_API_KEY missing)"}</option>
              <option value="ollama">Local Ollama {env.ollamaUrl ? `(${env.ollamaUrl})` : "(default http://127.0.0.1:11434)"}</option>
            </select>
          </label>
          <label className={s.check}><input type="checkbox" checked={cur.aiSummariesEnabled} onChange={(e) => set("aiSummariesEnabled", e.target.checked)} /> Allow AI to phrase summaries (aggregates only)</label>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={!draft} onClick={() => void save()}>Save settings</button>
        </div>
      </Panel>
      <Panel title="Pipeline health" subtitle="Since this server started.">
        <div className={s.kpiGrid}>
          <Kpi label="Batches accepted" value={health.accepted} />
          <Kpi label="Processed" value={health.processed} />
          <Kpi label="Queue" value={health.queueLength} />
          <Kpi label="Without consent (dropped)" value={health.noConsent} />
          <Kpi label="Bots filtered" value={health.bots} />
          <Kpi label="Sampled out" value={health.sampledOut} />
          <Kpi label="Overload drops" value={health.dropped} />
          <Kpi label="Errors" value={health.errors} help={health.lastError ?? undefined} />
        </div>
        <p className={s.note}>Last flush {health.lastFlushAt ? fmtDateTime(health.lastFlushAt) : "—"} · IP database: {env.geoipDatabase ? "configured" : "not configured (CDN headers / visitor choice only)"} · Email: {env.emailConfigured ? "configured" : "not configured"}</p>
        <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void viSend<{ rows: number }>(viPath(`${VI_PATHS.settings}/rollup`), "POST").then((r) => setMsg(`Rebuilt daily totals for 7 days (${r.rows} rows).`))}>Rebuild daily totals (7 days)</button>
      </Panel>
      {demoState.allowed && (
        <Panel title="Demo data (development only)" subtitle="Synthetic, labelled visitors for reviewing dashboards locally. Unavailable in production.">
          <div className={s.row}>
            <button type="button" className={s.btn} onClick={() => void demo(true)}>Load demo data</button>
            <button type="button" className={`${s.btn} ${s.btnDanger}`} disabled={!demoState.demoVisitors} onClick={() => void demo(false)}>Remove demo data</button>
          </div>
        </Panel>
      )}
    </>
  );
}

interface IntegrationsDto { globallyEnabled: boolean; encryptionConfigured: boolean; providers: Array<{ provider: string; enabled: boolean; fields: Array<{ key: string; label: string; secret: boolean; optional: boolean; value: string | null; isSet: boolean }>; lastSyncAt: string | null; lastStatus: string | null; lastError: string | null }> }
const PROVIDER_LABEL: Record<string, string> = { GA4: "Google Analytics 4", SEARCH_CONSOLE: "Google Search Console", GOOGLE_ADS: "Google Ads", META: "Meta Pixel & Conversions API" };

function Integrations() {
  const res = useVi<IntegrationsDto>(viPath(VI_PATHS.integrations), "integrations");
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const save = async (provider: string, enabled: boolean) => {
    try {
      await viSend(viPath(`${VI_PATHS.integrations}/${provider}`), "PUT", { enabled, values: values[provider] ?? {} });
      setValues((v) => ({ ...v, [provider]: {} }));
      setMsg((m) => ({ ...m, [provider]: "Saved." }));
      res.reload();
    } catch (e) {
      setMsg((m) => ({ ...m, [provider]: errMsg(e) }));
    }
  };
  const sync = async (provider: string) => {
    const r = await viSend<{ message: string }>(viPath(`${VI_PATHS.integrations}/${provider}/sync`), "POST").catch((e: unknown) => ({ message: errMsg(e) }));
    setMsg((m) => ({ ...m, [provider]: r.message }));
    res.reload();
  };
  if (res.error) return <ErrorBox message={res.error} />;
  if (!res.data) return <Skeleton height={200} />;
  return (
    <Panel title="Integrations" subtitle="All off by default. Core first-party analytics never depends on them.">
      {!res.data.globallyEnabled && <div className={s.banner}>Outbound integrations are switched off on the server (VI_INTEGRATIONS_ENABLED is not &quot;true&quot;). You can save credentials; nothing is sent until it is switched on.</div>}
      {!res.data.encryptionConfigured && <div className={s.banner}>TOTP_ENCRYPTION_KEY is not set on the server, so secrets cannot be stored.</div>}
      <div className={s.cards}>
        {res.data.providers.map((p) => (
          <article key={p.provider} className={s.insight}>
            <h3>{PROVIDER_LABEL[p.provider] ?? p.provider} {p.enabled ? <span className={`${s.pill} ${s.pillGood}`}>On</span> : <span className={s.pill}>Off</span>}</h3>
            {p.fields.map((f) => (
              <label key={f.key} className={s.field}>
                {f.label}{f.optional ? " (optional)" : ""}{f.secret && f.isSet ? " · saved (hidden)" : ""}
                <input className={s.input} type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.secret ? (f.isSet ? "•••••••• (leave blank to keep)" : "") : ""} defaultValue={f.secret ? "" : (f.value ?? "")} onChange={(e) => setValues((v) => ({ ...v, [p.provider]: { ...(v[p.provider] ?? {}), [f.key]: e.target.value } }))} />
              </label>
            ))}
            <div className={s.row}>
              <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnPrimary}`} onClick={() => void save(p.provider, true)}>Save & enable</button>
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void save(p.provider, false)}>Save disabled</button>
              {p.provider !== "GA4" && <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void sync(p.provider)}>Sync now</button>}
            </div>
            <p className={s.note}>{msg[p.provider] ?? (p.lastStatus ? `${p.lastStatus}${p.lastError ? `: ${p.lastError}` : ""} · last sync ${fmtDateTime(p.lastSyncAt)}` : "Never used.")}</p>
          </article>
        ))}
      </div>
      <p className={s.note}>Browser tags: set NEXT_PUBLIC_GA4_ID / NEXT_PUBLIC_META_PIXEL_ID on the website. They load only after consent; Meta browser and server events share an event id so Meta deduplicates them. No names, emails or phone numbers are sent to Google.</p>
    </Panel>
  );
}

function AlertRules() {
  const { can } = useViContext();
  const res = useVi<Array<{ id: string; kind: string; kindLabel: string; name: string; threshold: number; windowMinutes: number; severity: string; channels: string[]; recipientUserIds: string[]; cooldownMinutes: number; enabled: boolean; help: string; lastFiredAt: string | null }>>(viPath(`${VI_PATHS.alerts}/rules`), "rules");
  const [msg, setMsg] = useState<string | null>(null);
  const update = async (r: NonNullable<typeof res.data>[number], patch: Partial<NonNullable<typeof res.data>[number]>) => {
    const next = { ...r, ...patch };
    try {
      await viSend(viPath(`${VI_PATHS.alerts}/rules/${r.id}`), "PUT", { kind: next.kind, name: next.name, threshold: Number(next.threshold), windowMinutes: next.windowMinutes, severity: next.severity, channels: next.channels, recipientUserIds: next.recipientUserIds, cooldownMinutes: next.cooldownMinutes, enabled: next.enabled });
      res.reload();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  const evaluate = async () => {
    const r = await viSend<{ fired: number }>(viPath(`${VI_PATHS.alerts}/evaluate`), "POST").catch(() => ({ fired: -1 }));
    setMsg(r.fired >= 0 ? `${r.fired} alerts fired.` : "Could not evaluate.");
  };
  return (
    <Panel title="Alert rules" subtitle="In-app always; email when configured; WhatsApp only once an approved sender exists." actions={can("manageAlerts") ? <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void evaluate()}>Check now</button> : undefined}>
      {msg && <div className={s.banner}>{msg}</div>}
      {!res.data ? <Skeleton height={200} /> : (
        <DataTable searchable={false} pageSize={20} rows={res.data} columns={[
          { key: "on", label: "On", value: (r) => (r.enabled ? 1 : 0), render: (r) => <input type="checkbox" aria-label={`Enable ${r.name}`} disabled={!can("manageAlerts")} checked={r.enabled} onChange={(e) => void update(r, { enabled: e.target.checked })} /> },
          { key: "n", label: "Alert", value: (r) => r.kindLabel },
          { key: "t", label: "Threshold", value: (r) => r.threshold, render: (r) => (<span title={r.help}><input className={s.input} style={{ width: 80 }} type="number" defaultValue={r.threshold} disabled={!can("manageAlerts")} onBlur={(e) => Number(e.target.value) !== r.threshold && void update(r, { threshold: Number(e.target.value) })} /> <span className={s.muted}>{r.help}</span></span>) },
          { key: "w", label: "Window", value: (r) => r.windowMinutes, render: (r) => `${r.windowMinutes} min` },
          { key: "s", label: "Severity", value: (r) => r.severity, render: (r) => (<select className={s.select} value={r.severity} disabled={!can("manageAlerts")} onChange={(e) => void update(r, { severity: e.target.value })}>{["INFO", "WARNING", "CRITICAL"].map((x) => <option key={x}>{x}</option>)}</select>) },
          { key: "e", label: "Email", value: (r) => (r.channels.includes("EMAIL") ? 1 : 0), render: (r) => <input type="checkbox" aria-label="Email" disabled={!can("manageAlerts")} checked={r.channels.includes("EMAIL")} onChange={(e) => void update(r, { channels: e.target.checked ? [...new Set([...r.channels, "EMAIL"])] : r.channels.filter((c) => c !== "EMAIL") })} /> },
          { key: "rcp", label: "Recipients", value: (r) => r.recipientUserIds.length, render: (r) => (<input className={s.input} style={{ width: 180 }} placeholder="user ids, comma-separated" defaultValue={r.recipientUserIds.join(",")} disabled={!can("manageAlerts")} onBlur={(e) => void update(r, { recipientUserIds: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />) },
          { key: "c", label: "Cooldown", value: (r) => r.cooldownMinutes, render: (r) => `${r.cooldownMinutes} min` },
          { key: "f", label: "Last fired", value: (r) => r.lastFiredAt ?? "", render: (r) => (r.lastFiredAt ? fmtAgo(r.lastFiredAt) : "—") },
        ]} />
      )}
      <p className={s.note}>Available: {VI_ALERT_KINDS.map((k) => VI_ALERT_KIND_LABELS[k]).join(", ")}.</p>
    </Panel>
  );
}

function StaffRoles() {
  const res = useVi<Array<{ id: string; userId: string; role: string; user: { email: string | null; phone: string | null } | null }>>(viPath(VI_PATHS.staffRoles), "roles");
  const cand = useVi<Array<{ userId: string; role: string; email: string | null; phone: string | null }>>(viPath(`${VI_PATHS.staffRoles}/candidates`), "cand");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<string>(VI_STAFF_ROLES[0]);
  const [err, setErr] = useState<string | null>(null);
  const people = useMemo(() => [...new Map((cand.data ?? []).map((c) => [c.userId, c])).values()], [cand.data]);
  const grant = async () => {
    setErr(null);
    try {
      await viSend(viPath(VI_PATHS.staffRoles), "POST", { userId, role });
      res.reload();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <Panel title="Responsibilities" subtitle="Marketing / Sales / Operations Head and Support, layered on existing admin users (no new login roles). See docs for the full capability matrix.">
      {err && <ErrorBox message={err} />}
      <DataTable searchable={false} rows={res.data ?? []} columns={[
        { key: "u", label: "User", value: (r) => r.user?.email ?? r.user?.phone ?? r.userId },
        { key: "r", label: "Responsibility", value: (r) => r.role },
        { key: "x", label: "", value: () => "", render: (r) => <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void viSend(viPath(`${VI_PATHS.staffRoles}/${r.id}`), "DELETE").then(res.reload)}>Remove</button> },
      ]} emptyText="No responsibilities assigned." />
      <div className={s.form} style={{ marginTop: 12 }}>
        <label className={s.field}>Admin user<select className={s.select} value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Choose…</option>{people.map((p) => <option key={p.userId} value={p.userId}>{p.email ?? p.phone ?? p.userId} ({p.role})</option>)}</select></label>
        <label className={s.field}>Responsibility<select className={s.select} value={role} onChange={(e) => setRole(e.target.value)}>{VI_STAFF_ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={!userId} onClick={() => void grant()}>Assign</button>
      </div>
    </Panel>
  );
}

function Privacy() {
  const res = useVi<Array<{ id: string; type: string; status: string; note: string | null; createdAt: string; completedAt: string | null; userId: string | null }>>(viPath(VI_PATHS.privacy), "privacy");
  const [f, setF] = useState({ type: "ACCESS", visitorId: "", userId: "", note: "" });
  const [result, setResult] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null);
    if (f.type === "DELETE" && !window.confirm("Permanently erase all Visitor Intelligence data for this visitor/account? Bookings and the account itself are not changed. This cannot be undone.")) return;
    try {
      const r = await viSend<{ result: unknown }>(viPath(VI_PATHS.privacy), "POST", { type: f.type, visitorId: f.visitorId || undefined, userId: f.userId || undefined, note: f.note || null });
      setResult(r.result);
      res.reload();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <Panel title="Privacy requests (DPDP)" subtitle="Access exports everything held; erasure deletes it. The visitor id is the browser id shown in their cookie settings; the user id comes from the customer's account.">
      {err && <ErrorBox message={err} />}
      <div className={s.form}>
        <label className={s.field}>Request<select className={s.select} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="ACCESS">Access</option><option value="DELETE">Erase</option></select></label>
        <label className={s.field}>Browser visitor id<input className={s.input} value={f.visitorId} onChange={(e) => setF({ ...f, visitorId: e.target.value })} /></label>
        <label className={s.field}>Account user id<input className={s.input} value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })} /></label>
        <label className={s.field}>Note / ticket<input className={s.input} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <button type="button" className={`${s.btn} ${f.type === "DELETE" ? s.btnDanger : s.btnPrimary}`} disabled={!f.visitorId && !f.userId} onClick={() => void submit()}>Run</button>
      </div>
      {result != null && (
        <div className={s.row} style={{ marginTop: 10 }}>
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" })); a.download = "fastque-privacy-request.json"; a.click(); }}>Download result (JSON)</button>
        </div>
      )}
      <DataTable searchable={false} rows={res.data ?? []} columns={[
        { key: "t", label: "Type", value: (r) => r.type },
        { key: "s", label: "Status", value: (r) => r.status },
        { key: "n", label: "Note", value: (r) => r.note ?? "—" },
        { key: "c", label: "Completed", value: (r) => r.completedAt ?? "", render: (r) => fmtDateTime(r.completedAt) },
      ]} emptyText="No requests yet." />
    </Panel>
  );
}

export function SettingsTab() {
  const { can } = useViContext();
  return (
    <>
      <TrackingSettings />
      {can("integrations") && <Integrations />}
      {can("alerts") && <AlertRules />}
      {can("staffRoles") && <StaffRoles />}
      {can("privacy") && <Privacy />}
      <Panel title="Tracking plan" subtitle="What the website sends (only after analytics consent).">
        <HBars rows={[
          ["page_view", "every page"], ["engagement", "visible time"], ["search / search_results", "/search"], ["location_set / near_me", "city choice, Near Me (city only stored)"],
          ["salon_view", "salon profile"], ["booking_start / confirmed / failed", "booking flow (value read from the booking)"], ["product_view / add_to_cart / checkout_start / purchase", "FastQue shop"],
          ["partner_registration_start / sign_up", "owner registration"], ["page_error", "uncaught errors (count only)"],
        ].map(([k, l], i) => ({ key: k, label: `${k} — ${l}`, value: 9 - i }))} format={() => ""} />
      </Panel>
    </>
  );
}
