"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CHANNEL_LABEL,
  DATA_SOURCE_LABEL,
  GROWTH_ROLES,
  GROWTH_ROLE_LABEL,
  GROWTH_SERVICES,
  GROWTH_SERVICE_KEYS,
  LIFECYCLE_STEPS,
  PROPOSAL_TRANSITIONS,
  type DataSource,
  type GrowthMeDto,
  type GrowthPermission,
  type MatchedSalonDto,
  type MeasurementDto,
  type OpportunityRowDto,
  type ProposalAction,
  type ProposalStatus,
  type Sourced,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../lib/api";
import ui from "../../owner/owner.module.css";
import inv from "../inventory/admin-inventory.module.css";
import c from "../commerce/admin-commerce.module.css";
import g from "./admin-growth.module.css";

// Growth AI → Customer Acquisition. Advisory mode: research, matching, proposals, approval and
// measurement. Nothing on this page spends money, publishes an ad or sends a message. Every number
// shows where it came from; MOCK and AI-written values are labelled as such.

const API = "admin/growth";
const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");
const rupees = (paise: number | null | undefined) =>
  paise == null ? "—" : `${paise < 0 ? "−" : ""}₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Math.abs(paise) / 100)}`;
const when = (v: unknown) => (v ? new Date(String(v)).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!path) return;
    apiFetch<T>(`${API}/${path}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(errText(e)));
  }, [path]);
  useEffect(() => load(), [load]);
  return { data, error, load };
}
const post = <T,>(path: string, body: unknown = {}, method: "POST" | "PUT" | "DELETE" = "POST") =>
  apiFetch<T>(`${API}/${path}`, { method, body: method === "DELETE" ? undefined : JSON.stringify(body) });

function Src({ s }: { s: DataSource }) {
  const cls = s === "MOCK" || s === "AI_GENERATED" ? g.sourceMock : s === "FIRST_PARTY" || s === "GOOGLE_ADS" ? g.sourceReal : "";
  return <span className={`${g.source} ${cls}`}>{DATA_SOURCE_LABEL[s]}</span>;
}
function Value<T>({ v, show, brief = false }: { v: Sourced<T>; show: (x: T) => ReactNode; brief?: boolean }) {
  return (
    <>
      {v.value == null ? "Unavailable" : show(v.value)} {!(v.value == null && v.source === "UNAVAILABLE") && <Src s={v.source} />}
      {v.note && !brief && <small className={ui.hint} style={{ display: "block" }}>{v.note}</small>}
    </>
  );
}
function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={ui.card} aria-label={title}>
      <div className={ui.cardHead}>
        <h2 className={ui.cardTitle}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className={ui.hint}>{empty}</p>;
  return (
    <div className={c.tableWrap}>
      <table className={c.table}>
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((x, j) => <td key={j}>{x}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
const Problem = ({ text }: { text: string | null }) => (text ? <p className={c.error} role="alert">{text}</p> : null);

const TABS: ReadonlyArray<readonly [string, string, GrowthPermission]> = [
  ["overview", "Overview", "view"],
  ["research", "Keyword research", "view"],
  ["proposals", "Campaign proposals", "view"],
  ["settings", "Settings & cost", "view"],
];

export function AdminGrowth() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const { data: me, error, load } = useApi<GrowthMeDto>("me");
  const can = (p: GrowthPermission) => !!me?.permissions.includes(p);
  const wanted = params.get("tab") ?? "overview";
  const tab = TABS.find((t) => t[0] === wanted)?.[0] ?? "overview";
  const go = (id: string, extra = "") => router.replace(id === "overview" && !extra ? path : `${path}?tab=${id}${extra}`);
  return (
    <main className={ui.grid} aria-labelledby="ga-title">
      <div className={ui.pageHead}>
        <div>
          <div className={ui.eyebrow}>Growth AI</div>
          <h1 id="ga-title" className={ui.pageTitle}>Customer Acquisition</h1>
          <p className={ui.pageSub}>
            Find search demand, match it to active salons, propose a campaign and measure completed bookings. Advisory mode: FastQue spends nothing, publishes nothing and sends nothing.
          </p>
        </div>
      </div>
      {!me ? (
        error ? (
          <p className={c.error} role="alert">{error === "Not available." ? "Growth AI is switched off on the server." : error}</p>
        ) : (
          <div className={ui.skeleton} style={{ height: 80 }} />
        )
      ) : !me.permissions.length ? (
        <p className={c.error}>Your account has no Growth AI role. An Admin can give one under Settings.</p>
      ) : (
        <>
          {me.paused && <p className={g.paused} role="status">Emergency pause is on{me.pausedReason ? `: ${me.pausedReason}` : ""}. Nothing can be researched, drafted or approved.</p>}
          <div className={ui.rowWrap} role="tablist">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={`${inv.tab} ${tab === id ? inv.tabOn : ""}`} onClick={() => go(id)}>
                {label}
              </button>
            ))}
          </div>
          {tab === "overview" && <Overview me={me} />}
          {tab === "research" && <Research me={me} can={can} onProposal={(id) => go("proposals", `&proposal=${id}`)} />}
          {tab === "proposals" && <Proposals can={can} selected={params.get("proposal")} open={(id) => go("proposals", id ? `&proposal=${id}` : "")} />}
          {tab === "settings" && <Settings me={me} can={can} onChange={load} />}
        </>
      )}
    </main>
  );
}

// ---------- Overview (dashboard) ----------

type Section = { id: string; title: string; status: "LIVE" | "UNAVAILABLE"; value: string | null; reason?: string };

function Overview({ me }: { me: GrowthMeDto }) {
  const { data, error } = useApi<Section[]>("dashboard");
  return (
    <>
      <Card title="How this works">
        <ol className={g.steps} aria-label="Campaign lifecycle">
          {LIFECYCLE_STEPS.map((s) => (
            <li key={s} className={`${g.step} ${s === "PUBLISH" ? g.stepOff : ""}`} title={s === "PUBLISH" ? "Not available in advisory mode" : undefined}>
              {s}
            </li>
          ))}
        </ol>
        <p className={ui.hint}>
          Publishing is off in advisory mode: an approved proposal is a decision a person can set up by hand. Monitoring counts completed bookings from FastQue&apos;s own records.
        </p>
        <dl className={g.kv}>
          <dt>Keyword data</dt>
          <dd>{me.keywordProvider.note}</dd>
          <dt>AI model</dt>
          <dd>{me.llm.note}{me.llm.models.length ? ` (${me.llm.models.join(", ")})` : ""}</dd>
          <dt>Your role</dt>
          <dd>{me.role ? GROWTH_ROLE_LABEL[me.role] : "—"}</dd>
        </dl>
      </Card>
      <Card title="Growth AI dashboard">
        <Problem text={error} />
        <div className={g.sections}>
          {(data ?? []).map((s) => (
            <div key={s.id} className={`${g.section} ${s.status === "UNAVAILABLE" ? g.unavailable : ""}`}>
              <strong>{s.title}</strong>
              <span>{s.status === "LIVE" ? s.value : "Unavailable"}</span>
              {s.reason && <small>{s.reason}</small>}
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

// ---------- Research ----------

type City = { id: string; name: string; state: string; activeSalons: number };
type Report = {
  run: { id: string; provider: string; isMock: boolean; location: string; serviceLabel: string; createdAt: string; dailyBudgetPaise: number };
  salons: MatchedSalonDto[];
  rows: OpportunityRowDto[];
  notes: string[];
};
type RunRow = { id: string; provider: string; isMock: boolean; locationLabel: string; serviceKey: string; status: string; error: string | null; createdAt: string; _count: { ideas: number } };

function Research({ me, can, onProposal }: { me: GrowthMeDto; can: (p: GrowthPermission) => boolean; onProposal: (id: string) => void }) {
  const cities = useApi<City[]>("cities");
  const runs = useApi<RunRow[]>("keyword-runs");
  const [form, setForm] = useState({ cityId: "", serviceKey: "haircut", dailyBudgetInr: "500", geoTargetConstant: "", extraSeeds: "" });
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const open = (id: string) =>
    apiFetch<Report>(`${API}/keyword-runs/${id}/report`)
      .then(setReport)
      .catch((e) => setProblem(errText(e)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const r = await post<Report>("keyword-runs", {
        cityId: form.cityId,
        serviceKey: form.serviceKey,
        dailyBudgetInr: Number(form.dailyBudgetInr),
        ...(form.geoTargetConstant.trim() ? { geoTargetConstant: form.geoTargetConstant.trim() } : {}),
        extraSeeds: form.extraSeeds.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setReport(r);
      runs.load();
    } catch (err) {
      setProblem(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {can("research") && (
        <Card title="New keyword research">
          {me.keywordProvider.isMock && <p className={g.mock}>Keyword provider is MOCK: results are invented test numbers, not real search demand.</p>}
          {!me.keywordProvider.configured && <p className={ui.hint}>{me.keywordProvider.note}</p>}
          <form className={c.form} onSubmit={submit}>
            <label className={c.field}>
              City
              <select required value={form.cityId} onChange={(e) => setForm({ ...form, cityId: e.target.value })}>
                <option value="">Choose a city</option>
                {(cities.data ?? []).map((ct) => (
                  <option key={ct.id} value={ct.id}>{`${ct.name}, ${ct.state} (${ct.activeSalons} active)`}</option>
                ))}
              </select>
            </label>
            <label className={c.field}>
              Service
              <select value={form.serviceKey} onChange={(e) => setForm({ ...form, serviceKey: e.target.value })}>
                {GROWTH_SERVICE_KEYS.map((k) => <option key={k} value={k}>{GROWTH_SERVICES[k].label}</option>)}
              </select>
            </label>
            <label className={c.field}>
              Proposed daily budget (₹)
              <input type="number" min={50} max={100000} required value={form.dailyBudgetInr} onChange={(e) => setForm({ ...form, dailyBudgetInr: e.target.value })} />
            </label>
            <label className={c.field}>
              Google Ads location
              <input placeholder="geoTargetConstants/…" value={form.geoTargetConstant} onChange={(e) => setForm({ ...form, geoTargetConstant: e.target.value })} />
              <small>City level only; needed for real data. Neighbourhood volumes are never estimated.</small>
            </label>
            <label className={c.field}>
              Extra seed keywords
              <input placeholder="comma separated" value={form.extraSeeds} onChange={(e) => setForm({ ...form, extraSeeds: e.target.value })} />
            </label>
            <div>
              <button className={`${ui.btn} ${ui.btnPrimary}`} disabled={busy || me.paused || !me.keywordProvider.configured}>
                {busy ? "Researching…" : "Find opportunities"}
              </button>
            </div>
          </form>
          <Problem text={problem ?? cities.error} />
        </Card>
      )}
      {report && <OpportunityReport report={report} canDraft={can("draft") && !me.paused} onProposal={onProposal} />}
      <Card title="Earlier research">
        <Problem text={runs.error} />
        <Table
          head={["When", "Location", "Service", "Data", "Keywords", ""]}
          empty="No research yet."
          rows={(runs.data ?? []).map((r) => [
            when(r.createdAt),
            r.locationLabel,
            GROWTH_SERVICES[r.serviceKey as keyof typeof GROWTH_SERVICES]?.label ?? r.serviceKey,
            r.status === "FAILED" ? <span className={`${ui.badge} ${ui.badgeBad}`} title={r.error ?? ""}>Failed</span> : <Src s={r.isMock ? "MOCK" : "GOOGLE_ADS"} />,
            r._count.ideas,
            r.status === "COMPLETED" ? <button type="button" className={`${ui.btn} ${ui.btnSecondary}`} onClick={() => open(r.id)}>Open report</button> : null,
          ])}
        />
      </Card>
    </>
  );
}

const PRIORITY_BADGE: Record<string, string> = { HIGH: ui.badgeOk, MEDIUM: ui.badgeInfo, LOW: ui.badgeNeutral, NO_SUPPLY: ui.badgeBad, INSUFFICIENT_DATA: ui.badgeWarn };

function OpportunityReport({ report, canDraft, onProposal }: { report: Report; canDraft: boolean; onProposal: (id: string) => void }) {
  const [picked, setPicked] = useState<string[]>(() => report.rows.filter((r) => r.priority === "HIGH").slice(0, 5).map((r) => r.ideaId));
  const [plan, setPlan] = useState({ dailyBudgetInr: String(report.run.dailyBudgetPaise / 100), durationDays: "14", startsOn: istToday() });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  async function draft(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const p = await post<{ id: string }>("proposals", { keywordRunId: report.run.id, ideaIds: picked, dailyBudgetInr: Number(plan.dailyBudgetInr), durationDays: Number(plan.durationDays), startsOn: plan.startsOn });
      onProposal(p.id);
    } catch (err) {
      setProblem(errText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Card title={`Opportunity report — ${report.run.serviceLabel}, ${report.run.location}`}>
        {report.run.isMock && <p className={g.mock}>MOCK DATA — search demand, competition and bids in this report are invented for testing. They are not real.</p>}
        <ul className={g.list}>{report.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        <Table
          head={["", "Keyword", "Location", "Search Demand", "Competition", "Top-of-page bid", "Recommended Channel", "Matching Salons", "Priority"]}
          empty="No keyword ideas came back."
          rows={report.rows.map((r) => [
            <input key="c" type="checkbox" aria-label={`Use ${r.keyword}`} checked={picked.includes(r.ideaId)} onChange={() => toggle(r.ideaId)} disabled={!canDraft} />,
            r.keyword,
            r.location.split(",")[0],
            <Value key="d" v={r.searchDemand} brief show={(n) => `${n.toLocaleString("en-IN")}/mo`} />,
            `${r.competition}${r.competitionIndex != null ? ` (${r.competitionIndex})` : ""}`,
            r.lowBidPaise != null ? `${rupees(r.lowBidPaise)}–${rupees(r.highBidPaise)}` : "Unavailable",
            CHANNEL_LABEL[r.recommendedChannel],
            r.matchingSalons,
            <span key="p" className={`${ui.badge} ${PRIORITY_BADGE[r.priority] ?? ""}`}>{r.priority.replace("_", " ")}</span>,
          ])}
        />
      </Card>
      <Card title={`Matching salons (${report.salons.length}) — FastQue data`}>
        <Table
          head={["Salon", "Area", "Services", "Completed, last 30 days"]}
          empty="No active salon in this city offers this service. Do not advertise it yet."
          rows={report.salons.map((s) => [s.name, s.locality ?? "—", s.services.map((x) => `${x.name} ${rupees(x.pricePaise)}`).join(", "), s.completedLast30Days])}
        />
      </Card>
      {canDraft && report.salons.length > 0 && (
        <Card title="Draft a Google Search proposal">
          <form className={c.form} onSubmit={draft}>
            <label className={c.field}>
              Daily budget (₹)
              <input type="number" min={50} required value={plan.dailyBudgetInr} onChange={(e) => setPlan({ ...plan, dailyBudgetInr: e.target.value })} />
            </label>
            <label className={c.field}>
              Days
              <input type="number" min={1} max={90} required value={plan.durationDays} onChange={(e) => setPlan({ ...plan, durationDays: e.target.value })} />
            </label>
            <label className={c.field}>
              Start
              <input type="date" min={istToday()} required value={plan.startsOn} onChange={(e) => setPlan({ ...plan, startsOn: e.target.value })} />
            </label>
            <div>
              <button className={`${ui.btn} ${ui.btnPrimary}`} disabled={busy || !picked.length}>{busy ? "Drafting…" : `Draft proposal with ${picked.length} keyword(s)`}</button>
            </div>
          </form>
          <Problem text={problem} />
        </Card>
      )}
    </>
  );
}

// ---------- Proposals ----------

type ProposalRow = { id: string; name: string; status: ProposalStatus; dailyBudgetPaise: number; durationDays: number; startsOn: string; usesMockData: boolean; createdAt: string; approvedAt: string | null };
type Preview = {
  dailyBudgetPaise: number;
  durationDays: number;
  totalBudgetPaise: number;
  realSpendPaise: number;
  clicksPerDay: Sourced<{ min: number; max: number }>;
  avgServiceValuePaise: Sourced<number>;
  breakEvenBookingsPerDay: Sourced<number>;
  maxAcquisitionCostPaise: Sourced<number>;
  expectedBookings: Sourced<number>;
};
type Proposal = ProposalRow & {
  endsOn: string;
  keywords: Array<{ keyword: string; avgMonthlySearches: number | null; competition: string; isMock: boolean }>;
  salons: Array<{ salonId: string; name: string; locality: string | null }>;
  preview: Preview;
  assumptions: string[];
  risks: string[];
  adCopy: { headlines: string[]; descriptions: string[]; note: string } | null;
  adCopySource: "AI_GENERATED" | "TEMPLATE" | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvalNote: string | null;
  approvalIsCurrent: boolean | null;
  events: Array<{ id: string; action: string; fromStatus: string | null; toStatus: string; actor: string | null; note: string | null; createdAt: string }>;
};

const STATUS_BADGE: Record<ProposalStatus, string> = { DRAFT: ui.badgeNeutral, REVIEW: ui.badgeInfo, APPROVED: ui.badgeOk, REJECTED: ui.badgeBad, ARCHIVED: ui.badgeNeutral };
const ACTION_LABEL: Record<ProposalAction, string> = { submit: "Send for review", approve: "Approve (advisory)", send_back: "Send back", reject: "Reject", archive: "Archive" };
const ACTION_NEEDS: Record<ProposalAction, GrowthPermission> = { submit: "draft", archive: "draft", approve: "approve", send_back: "approve", reject: "approve" };

function Proposals({ can, selected, open }: { can: (p: GrowthPermission) => boolean; selected: string | null; open: (id: string | null) => void }) {
  const list = useApi<ProposalRow[]>("proposals");
  return (
    <>
      {selected && <ProposalDetail id={selected} can={can} onChange={list.load} onClose={() => open(null)} />}
      <Card title="Campaign proposals">
        <Problem text={list.error} />
        <Table
          head={["Proposal", "Status", "Budget", "Start", "Data", ""]}
          empty="No proposals yet. Start from Keyword research."
          rows={(list.data ?? []).map((p) => [
            p.name,
            <span key="s" className={`${ui.badge} ${STATUS_BADGE[p.status]}`}>{p.status}</span>,
            `${rupees(p.dailyBudgetPaise)}/day × ${p.durationDays}`,
            String(p.startsOn).slice(0, 10),
            p.usesMockData ? <Src s="MOCK" /> : <Src s="GOOGLE_ADS" />,
            <button key="o" type="button" className={`${ui.btn} ${ui.btnSecondary}`} onClick={() => open(p.id)}>Open</button>,
          ])}
        />
      </Card>
    </>
  );
}

function ProposalDetail({ id, can, onChange, onClose }: { id: string; can: (p: GrowthPermission) => boolean; onChange: () => void; onClose: () => void }) {
  const { data: p, error, load } = useApi<Proposal>(`proposals/${id}`);
  const [note, setNote] = useState("");
  const [ackMock, setAckMock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      load();
      onChange();
      setNote("");
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!p) return <Card title="Proposal">{error ? <Problem text={error} /> : <div className={ui.skeleton} style={{ height: 60 }} />}</Card>;
  const actions = Object.keys(PROPOSAL_TRANSITIONS[p.status]) as ProposalAction[];
  const reached = (s: (typeof LIFECYCLE_STEPS)[number]) =>
    s === "RESEARCH" || s === "DRAFT" || (s === "REVIEW" && p.status !== "DRAFT") || (s === "APPROVE" && !!p.approvedAt) || (s === "MONITOR" && !!p.approvedAt);
  const pv = p.preview;
  return (
    <Card title={p.name} action={<button type="button" className={`${ui.btn} ${ui.btnSecondary}`} onClick={onClose}>Close</button>}>
      <ol className={g.steps} aria-label="Lifecycle">
        {LIFECYCLE_STEPS.map((s) => (
          <li key={s} className={`${g.step} ${reached(s) ? g.stepDone : ""} ${s === "PUBLISH" ? g.stepOff : ""}`}>{s}</li>
        ))}
      </ol>
      {p.usesMockData && <p className={g.mock}>Built on MOCK keyword data. Demand and bid numbers are not real — do not set up ads from them.</p>}
      <div className={g.split}>
        <div>
          <h3 className={ui.cardTitle}>Approval preview</h3>
          <dl className={g.kv}>
            <dt>Status</dt>
            <dd><span className={`${ui.badge} ${STATUS_BADGE[p.status]}`}>{p.status}</span></dd>
            <dt>Channel</dt>
            <dd>Google Search (set up by hand; advisory)</dd>
            <dt>Dates</dt>
            <dd>{p.startsOn} → {p.endsOn}</dd>
            <dt>Budget</dt>
            <dd>{rupees(pv.dailyBudgetPaise)}/day × {pv.durationDays} days = {rupees(pv.totalBudgetPaise)} (proposed)</dd>
            <dt>Spent by FastQue</dt>
            <dd>{rupees(pv.realSpendPaise)}</dd>
            <dt>Clicks/day</dt>
            <dd><Value v={pv.clicksPerDay} show={(x) => `${x.min}–${x.max}`} /></dd>
            <dt>Avg service value</dt>
            <dd><Value v={pv.avgServiceValuePaise} show={rupees} /></dd>
            <dt>Break-even bookings/day</dt>
            <dd><Value v={pv.breakEvenBookingsPerDay} show={(n) => n} /></dd>
            <dt>Expected bookings</dt>
            <dd><Value v={pv.expectedBookings} show={(n) => n} /></dd>
            <dt>Drafted by</dt>
            <dd>{p.createdBy ?? "—"}</dd>
            <dt>Approved by</dt>
            <dd>{p.approvedBy ? `${p.approvedBy}, ${when(p.approvedAt)}${p.approvalNote ? ` — “${p.approvalNote}”` : ""}${p.approvalIsCurrent === false ? " (changed since approval)" : ""}` : "—"}</dd>
          </dl>
        </div>
        <div>
          <h3 className={ui.cardTitle}>Assumptions</h3>
          <ul className={g.list}>{p.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          <h3 className={ui.cardTitle}>Risks</h3>
          <ul className={g.list}>{p.risks.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      </div>
      <div className={g.split}>
        <div>
          <h3 className={ui.cardTitle}>Keywords ({p.keywords.length})</h3>
          <ul className={g.list}>
            {p.keywords.map((k) => (
              <li key={k.keyword}>
                {k.keyword} — {k.avgMonthlySearches == null ? "Unavailable" : `${k.avgMonthlySearches.toLocaleString("en-IN")}/mo`} <Src s={k.isMock ? "MOCK" : "GOOGLE_ADS"} />
              </li>
            ))}
          </ul>
          <h3 className={ui.cardTitle}>Salons it would send customers to ({p.salons.length})</h3>
          <ul className={g.list}>{p.salons.map((s) => <li key={s.salonId}>{s.name}{s.locality ? `, ${s.locality}` : ""}</li>)}</ul>
        </div>
        <div>
          <h3 className={ui.cardTitle}>Ad text {p.adCopySource && <Src s={p.adCopySource} />}</h3>
          {p.adCopy ? (
            <>
              <ul className={g.list}>{p.adCopy.headlines.map((h) => <li key={h}><strong>{h}</strong> <small className={ui.hint}>({h.length}/30)</small></li>)}</ul>
              <ul className={g.list}>{p.adCopy.descriptions.map((d) => <li key={d}>{d} <small className={ui.hint}>({d.length}/90)</small></li>)}</ul>
              <p className={ui.hint}>{p.adCopy.note}</p>
            </>
          ) : (
            <p className={ui.hint}>No ad text yet.</p>
          )}
          {p.status === "DRAFT" && can("draft") && (
            <button type="button" className={`${ui.btn} ${ui.btnSecondary}`} disabled={busy} onClick={() => act(() => post(`proposals/${id}/copy`))}>
              {p.adCopy ? "Redraft ad text" : "Draft ad text"}
            </button>
          )}
        </div>
      </div>
      {actions.some((a) => can(ACTION_NEEDS[a])) && (
        <div className={g.actions}>
          <input className={c.input} placeholder="Note (required to reject or send back)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} aria-label="Note" />
          {p.usesMockData && actions.includes("approve") && can("approve") && (
            <label className={c.check}>
              <input type="checkbox" checked={ackMock} onChange={(e) => setAckMock(e.target.checked)} /> I understand this is MOCK data
            </label>
          )}
          {actions
            .filter((a) => can(ACTION_NEEDS[a]))
            .map((a) => (
              <button
                key={a}
                type="button"
                className={`${ui.btn} ${a === "approve" ? ui.btnPrimary : a === "reject" ? ui.btnDanger : ui.btnSecondary}`}
                disabled={busy}
                onClick={() => act(() => post(`proposals/${id}/transition`, { action: a, ...(note.trim() ? { note: note.trim() } : {}), ...(a === "approve" ? { acknowledgeMock: ackMock } : {}) }))}
              >
                {ACTION_LABEL[a]}
              </button>
            ))}
        </div>
      )}
      <Problem text={problem} />
      {p.approvedAt && <Measurement id={id} canRecord={can("research")} />}
      <h3 className={ui.cardTitle}>History</h3>
      <Table
        head={["When", "Action", "Status", "Who", "Note"]}
        empty="No history."
        rows={p.events.map((e) => [when(e.createdAt), e.action, `${e.fromStatus ?? "—"} → ${e.toStatus}`, e.actor ?? "—", e.note ?? ""])}
      />
    </Card>
  );
}

function Measurement({ id, canRecord }: { id: string; canRecord: boolean }) {
  const { data: m, error, load } = useApi<MeasurementDto>(`proposals/${id}/measurement`);
  const [problem, setProblem] = useState<string | null>(null);
  if (!m) return <Problem text={error} />;
  const row = (label: string, a: number, b: number, fmt: (n: number) => ReactNode = (n) => n) => [label, fmt(a), fmt(b), fmt(a - b)];
  return (
    <>
      <h3 className={ui.cardTitle}>Measurement — completed bookings <Src s="FIRST_PARTY" /></h3>
      <Table
        head={["", `Campaign (${m.campaign.from} → ${m.campaign.to})`, `Before (${m.baseline.from} → ${m.baseline.to})`, "Observed change"]}
        empty=""
        rows={[
          row("Completed bookings", m.campaign.completedBookings, m.baseline.completedBookings),
          row("Service value", m.campaign.serviceValuePaise, m.baseline.serviceValuePaise, rupees),
          row("New customers", m.campaign.newCustomers, m.baseline.newCustomers),
        ]}
      />
      <dl className={g.kv}>
        <dt>Attributed by FastQue link</dt>
        <dd><Value v={m.firstPartyAttributed} show={(n) => n} /></dd>
        <dt>Platform-attributed</dt>
        <dd><Value v={m.platformAttributed} show={(n) => n} /></dd>
        <dt>Cost per completed booking</dt>
        <dd><Value v={m.costPerCompletedBooking} show={rupees} /></dd>
      </dl>
      <ul className={g.list}>{m.caveats.map((x) => <li key={x}>{x}</li>)}</ul>
      {canRecord && (
        <button type="button" className={`${ui.btn} ${ui.btnSecondary}`} onClick={() => post(`proposals/${id}/measurements`).then(load).catch((e) => setProblem(errText(e)))}>
          Record this snapshot
        </button>
      )}
      <Problem text={problem} />
    </>
  );
}

// ---------- Settings ----------

type RoleRow = { userId: string; role: string; name: string | null; createdAt: string };
type Exclusion = { salonId: string; name: string | null; reason: string };
type Usage = { todayMicroUsd: number; dailyBudgetUsd: number; rows: Array<{ id: string; feature: string; model: string; inputTokens: number; outputTokens: number; costMicroUsd: number; ok: boolean; error: string | null; createdAt: string }> };

function Settings({ me, can, onChange }: { me: GrowthMeDto; can: (p: GrowthPermission) => boolean; onChange: () => void }) {
  const admin = can("settings");
  const roles = useApi<RoleRow[]>(admin ? "roles" : null);
  const exclusions = useApi<Exclusion[]>("exclusions");
  const usage = useApi<Usage>("usage");
  const [grant, setGrant] = useState({ userId: "", role: "ANALYST" });
  const [exclude, setExclude] = useState({ salonId: "", reason: "" });
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>, after: () => void) =>
    fn()
      .then(() => {
        setProblem(null);
        after();
      })
      .catch((e) => setProblem(errText(e)));
  return (
    <>
      <Problem text={problem} />
      {admin && (
        <Card title="Emergency pause">
          <p className={ui.hint}>Stops every research run, draft, approval and measurement write at once. Reads keep working.</p>
          <div className={g.actions}>
            {!me.paused && <input className={c.input} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Pause reason" />}
            <button type="button" className={`${ui.btn} ${me.paused ? ui.btnPrimary : ui.btnDanger}`} onClick={() => act(() => post("pause", me.paused ? { paused: false } : { paused: true, reason }, "PUT"), onChange)}>
              {me.paused ? "Resume Growth AI" : "Pause Growth AI"}
            </button>
          </div>
        </Card>
      )}
      {admin && (
        <Card title="Growth roles">
          <p className={ui.hint}>Admin: everything. Marketing Manager: research, draft, approve. Analyst: research and measure. Read-Only: view. Platform admins are always Admin.</p>
          <form className={c.form} onSubmit={(e) => { e.preventDefault(); act(() => post("roles", grant, "PUT"), roles.load); }}>
            <label className={c.field}>
              Admin user id
              <input required value={grant.userId} onChange={(e) => setGrant({ ...grant, userId: e.target.value })} />
            </label>
            <label className={c.field}>
              Role
              <select value={grant.role} onChange={(e) => setGrant({ ...grant, role: e.target.value })}>
                {GROWTH_ROLES.map((r) => <option key={r} value={r}>{GROWTH_ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <div><button className={`${ui.btn} ${ui.btnPrimary}`}>Give role</button></div>
          </form>
          <Table
            head={["Person", "Role", ""]}
            empty="No Growth roles given yet."
            rows={(roles.data ?? []).map((r) => [r.name ?? r.userId, GROWTH_ROLE_LABEL[r.role as keyof typeof GROWTH_ROLE_LABEL] ?? r.role, <button key="x" type="button" className={`${ui.btn} ${ui.btnSecondary}`} onClick={() => act(() => post(`roles/${r.userId}`, {}, "DELETE"), roles.load)}>Remove</button>])}
          />
        </Card>
      )}
      <Card title="Salons left out of matching">
        {admin && (
          <form className={c.form} onSubmit={(e) => { e.preventDefault(); act(() => post("exclusions", exclude), exclusions.load); }}>
            <label className={c.field}>
              Salon id
              <input required value={exclude.salonId} onChange={(e) => setExclude({ ...exclude, salonId: e.target.value })} />
            </label>
            <label className={c.field}>
              Reason
              <input required minLength={3} value={exclude.reason} onChange={(e) => setExclude({ ...exclude, reason: e.target.value })} />
            </label>
            <div><button className={`${ui.btn} ${ui.btnSecondary}`}>Leave out</button></div>
          </form>
        )}
        <Table
          head={["Salon", "Reason", ""]}
          empty="No salons are left out."
          rows={(exclusions.data ?? []).map((x) => [x.name ?? x.salonId, x.reason, admin ? <button key="x" type="button" className={`${ui.btn} ${ui.btnSecondary}`} onClick={() => act(() => post(`exclusions/${x.salonId}`, {}, "DELETE"), exclusions.load)}>Include again</button> : null])}
        />
      </Card>
      <Card title="AI usage and cost">
        <p className={ui.hint}>
          {me.llm.note} Today: US${((usage.data?.todayMicroUsd ?? 0) / 1e6).toFixed(4)} of US${usage.data?.dailyBudgetUsd ?? 1} daily cap.
        </p>
        <Table
          head={["When", "Feature", "Model", "Tokens in/out", "Cost (US$)", "Result"]}
          empty="No model calls yet."
          rows={(usage.data?.rows ?? []).map((r) => [when(r.createdAt), r.feature, r.model, `${r.inputTokens}/${r.outputTokens}`, (r.costMicroUsd / 1e6).toFixed(6), r.ok ? "OK" : r.error ?? "Failed"])}
        />
      </Card>
    </>
  );
}
