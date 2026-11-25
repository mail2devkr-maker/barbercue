"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { HOME_FLAG_NAMES, Role } from "@barbercue/shared";
import { useAuth } from "../../lib/auth-context";
import { apiFetchBlob } from "../../lib/api";
import { homeServicesLinksEnabled } from "../../lib/dashboard-flags";
import { homeApi, istDate, money, useLang, useLoad, when, type HomeBookingDto } from "../../lib/home";
import { ADMIN_HOME_TABS, type AdminHomeTab } from "./admin-home-tabs";
import { askText, Field, Loading, Stat, useAct } from "./HomeUi";
import s from "./home.module.css";

const A = "admin/home";
const words = (v: unknown) => String(v ?? "").toLowerCase().replace(/_/g, " ");
type Row = Record<string, unknown>;

export function AdminHome() {
  const { user } = useAuth();
  const raw = useSearchParams().get("tab");
  const tab = (ADMIN_HOME_TABS.some((t) => t.id === raw) ? raw : "overview") as AdminHomeTab;
  const admin = !!user?.roles.includes(Role.PLATFORM_ADMIN);
  const sensitive = admin || !!user?.roles.includes(Role.CO_FOUNDER);
  const view: Record<AdminHomeTab, ReactNode> = {
    overview: <Overview />,
    catalog: <Catalog admin={admin} />,
    salons: <Providers kind="SALON_MANAGED" sensitive={sensitive} admin={admin} />,
    independents: <Providers kind="INDEPENDENT_PROFESSIONAL" sensitive={sensitive} admin={admin} />,
    verification: <Verification sensitive={sensitive} />,
    active: <Bookings key="a" scope="active" sensitive={sensitive} admin={admin} />,
    scheduled: <Bookings key="s" scope="scheduled" sensitive={sensitive} admin={admin} />,
    dispatch: <Dispatch admin={admin} />,
    live: <Dispatch admin={admin} liveOnly />,
    areas: <Areas />,
    pricing: <Pricing />,
    promotions: <Growth part="promotions" admin={admin} />,
    societies: <Growth part="societies" admin={admin} />,
    packages: <Growth part="packages" admin={admin} />,
    quality: <Quality admin={admin} />,
    incidents: sensitive ? <Incidents /> : <p className={s.empty}>Safety reports are limited to administrators.</p>,
    complaints: <Complaints sensitive={sensitive} />,
    payments: <Money part="payments" admin={admin} />,
    commissions: <Money part="commissions" admin={admin} />,
    training: <Training />,
    insights: <Insights />,
    analytics: <Analytics sensitive={sensitive} />,
    settings: <Settings admin={admin} />,
  };
  return (
    <div className={`${s.page} ${s.dark}`}>
      <div className={s.top}>
        <div><h1 className={s.title}>FastQue Home</h1><p className={s.sub}>{ADMIN_HOME_TABS.find((t) => t.id === tab)?.label}{!admin && " · read access"}</p></div>
        {homeServicesLinksEnabled() ? <a className={`${s.btn} ${s.small}`} href="/home-services" target="_blank" rel="noreferrer">Open FastQue Home site ↗</a> : <span className={s.meta}>Public site is switched off (NEXT_PUBLIC_FASTQUE_HOME_ENABLED)</span>}
      </div>
      {view[tab]}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return rows.length === 0 ? <p className={s.empty}>Nothing recorded yet.</p> : <div className={s.tableWrap}><table className={s.table}><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>;
}

function Overview() {
  const { data, error } = useLoad<{ flags: Record<string, boolean>; routingConfigured: boolean; providers: { kind: string; status: string; count: number }[]; professionals: number; pendingProviders: number; pendingVerifications: number; searching: number; upcoming: number; live: number; late: number; openIncidents: number; openTickets: number }>(`${A}/overview`);
  if (!data) return <Loading error={error} />;
  const go = (t: string, l: string, v: number) => <Link key={l} href={`/dashboard/admin/home?tab=${t}`} style={{ textDecoration: "none", color: "inherit" }}><Stat label={l} value={v} /></Link>;
  return (
    <>
      <div className={s.grid}>{go("dispatch", "Searching for a professional", data.searching)}{go("scheduled", "Confirmed", data.upcoming)}{go("live", "Live visits", data.live)}{go("dispatch", "Late or at risk", data.late)}{go("salons", "Profiles to review", data.pendingProviders)}{go("verification", "Checks to review", data.pendingVerifications)}{go("incidents", "Open safety reports", data.openIncidents)}{go("complaints", "Open complaints", data.openTickets)}{go("independents", "Consenting professionals", data.professionals)}</div>
      <section className={s.card}><h2 className={s.h2}>Providers</h2>{data.providers.length === 0 ? <p className={s.sub}>None yet.</p> : data.providers.map((p) => <span key={p.kind + p.status}>{words(p.kind)} · {words(p.status)}: {p.count}</span>)}</section>
      <section className={s.card}><h2 className={s.h2}>Switches (server environment)</h2><div className={s.row}>{HOME_FLAG_NAMES.map((f) => <span key={f} className={`${s.badge} ${data.flags[f] ? s.green : ""}`}>{f}: {data.flags[f] ? "on" : "off"}</span>)}</div><p className={s.meta}>Road routing: {data.routingConfigured ? "configured" : "not configured – conservative estimates are used and labelled approximate"}. Switches stop new business only; existing bookings can always be completed.</p></section>
    </>
  );
}

interface Def { id: string; code: string; name: string; nameHi: string; durationMinutes: number; prepMinutes: number; cleanupMinutes: number; status: string; minPricePaise: number | null; maxPricePaise: number | null; forChildren: boolean; customerProducts: boolean; safetyInstructions: string | null; _count: { offerings: number } }
function Catalog({ admin }: { admin: boolean }) {
  const { data, error, reload } = useLoad<{ id: string; code: string; name: string; active: boolean; requiresQualification: boolean; services: Def[] }[]>(`${A}/catalog`);
  const { act, busy, banner } = useAct(reload);
  if (!data) return <Loading error={error} />;
  const save = (c: { id: string }, x: Def, patch: Row) => act(() => homeApi(`${A}/catalog/services`, "PUT", { id: x.id, categoryId: c.id, code: x.code, name: x.name, nameHi: x.nameHi, durationMinutes: x.durationMinutes, prepMinutes: x.prepMinutes, cleanupMinutes: x.cleanupMinutes, forChildren: x.forChildren, customerProducts: x.customerProducts, minPricePaise: x.minPricePaise, maxPricePaise: x.maxPricePaise, status: x.status, ...(x.safetyInstructions ? { safetyInstructions: x.safetyInstructions } : {}), ...patch }), "Saved");
  return (
    <section className={s.section}>
      {banner}
      <p className={s.sub}>Invasive or medical procedures are not in this catalogue. Categories that need a qualification show a professional only after that check is completed.</p>
      {data.map((c) => (
        <div key={c.id} className={s.card}>
          <div className={s.between}><span className={s.strong}>{c.name} {c.requiresQualification && <span className={`${s.badge} ${s.amber}`}>qualification required</span>}</span>{admin && <button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => void act(() => homeApi(`${A}/catalog/categories/${c.id}`, "PUT", { active: !c.active }), "Saved")}>{c.active ? "Switch off" : "Switch on"}</button>}</div>
          <Table head={["Service", "Minutes", "Offers", "Price limits", "Status", ""]} rows={c.services.map((x) => [`${x.name} / ${x.nameHi}`, x.durationMinutes, x._count.offerings, `${x.minPricePaise != null ? money(x.minPricePaise) : "—"} – ${x.maxPricePaise != null ? money(x.maxPricePaise) : "—"}`, words(x.status), admin ? <button key="b" className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => void save(c, x, { status: x.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}>{x.status === "ACTIVE" ? "Deactivate" : "Activate"}</button> : null])} />
          {admin && <form className={s.row} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void act(() => homeApi(`${A}/catalog/services`, "PUT", { categoryId: c.id, code: d.get("code"), name: d.get("name"), nameHi: d.get("hi"), durationMinutes: Number(d.get("min")) }), "Added"); }}><input className={s.input} style={{ maxWidth: 150 }} name="code" placeholder="code" required pattern="[a-z0-9-]{2,60}" aria-label="Code" /><input className={s.input} style={{ maxWidth: 180 }} name="name" placeholder="Name" required aria-label="Name" /><input className={s.input} style={{ maxWidth: 180 }} name="hi" placeholder="हिन्दी नाम" required aria-label="Hindi name" /><input className={s.input} style={{ maxWidth: 90 }} name="min" type="number" min={5} placeholder="min" required aria-label="Minutes" /><button className={`${s.ghost} ${s.small}`}>Add service</button></form>}
        </div>
      ))}
    </section>
  );
}

interface Prov { id: string; kind: string; status: string; displayName: string; city: string; locality: string | null; paused: boolean; reviewNote: string | null; minStaffInSalon: number; maxHomeStaff: number; travelFeePaise: number; areas: { kind: string; value: string; radiusKm: number | null; excluded: boolean }[]; offerings: { id: string; pricePaise: number; active: boolean; serviceDef: { name: string } }[]; professionals: { id: string; displayName: string; consentAt: string | null; suspendedAt: string | null; isOnline: boolean }[] }
function useProviders(kind: string | null, status = "", q = "", page = 1) {
  const p = new URLSearchParams({ page: String(page) });
  if (kind) p.set("kind", kind);
  if (status) p.set("status", status);
  if (q) p.set("q", q);
  return useLoad<{ total: number; items: Prov[] }>(`${A}/providers?${p}`);
}
function Providers({ kind, sensitive, admin }: { kind: string; sensitive: boolean; admin: boolean }) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, reload } = useProviders(kind, status, q, page);
  const { act, busy, banner } = useAct(reload);
  return (
    <section className={s.section}>
      <form className={s.row} onSubmit={(e) => { e.preventDefault(); setQ(new FormData(e.currentTarget).get("q") as string); setPage(1); }}>
        <input className={s.input} style={{ maxWidth: 240 }} name="q" placeholder="Search name or city" aria-label="Search" />
        <select className={s.input} style={{ maxWidth: 180 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="">All statuses</option>{["SUBMITTED", "APPROVED", "DRAFT", "REJECTED", "SUSPENDED"].map((x) => <option key={x} value={x}>{words(x)}</option>)}</select>
        <button className={`${s.ghost} ${s.small}`}>Search</button>
      </form>
      {banner}
      {!data && <Loading error={error} />}
      {data?.items.length === 0 && <p className={s.empty}>No providers.</p>}
      {data?.items.map((p) => (
        <div key={p.id} className={s.card}>
          <div className={s.between}><span className={s.strong}>{p.displayName} <span className={s.meta}>{[p.locality, p.city].filter(Boolean).join(", ")}</span></span><span className={`${s.badge} ${p.status === "APPROVED" ? s.green : s.amber}`}>{words(p.status)}</span></div>
          <span className={s.meta}>{p.offerings.filter((o) => o.active).map((o) => `${o.serviceDef.name} ${money(o.pricePaise)}`).join(" · ") || "No services"}</span>
          <span className={s.meta}>{p.areas.map((a) => `${a.excluded ? "not " : ""}${a.kind === "RADIUS" ? `${a.radiusKm} km` : a.value}`).join(", ") || "No areas"}{p.kind === "SALON_MANAGED" ? ` · keeps ${p.minStaffInSalon} in salon, up to ${p.maxHomeStaff} out` : ""}</span>
          {p.professionals.map((x) => <div key={x.id} className={s.row}><span className={s.grow}>{x.displayName} <span className={s.meta}>{x.consentAt ? "consented" : "no consent yet"}{x.suspendedAt ? " · suspended" : ""}</span></span>{admin && <button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => { const note = askText(x.suspendedAt ? "Reason to reinstate" : "Reason to suspend (recorded)", 5); if (note) void act(() => homeApi(`${A}/professionals/${x.id}/suspend`, "POST", { suspended: !x.suspendedAt, note })); }}>{x.suspendedAt ? "Reinstate" : "Suspend"}</button>}</div>)}
          {sensitive && <div className={s.row}>{(p.status === "SUBMITTED" ? ["APPROVED", "REJECTED"] : p.status === "APPROVED" ? ["SUSPENDED"] : p.status === "SUSPENDED" ? ["APPROVED"] : []).map((d) => <button key={d} className={`${d === "APPROVED" ? s.btn : s.danger} ${s.small}`} disabled={busy} onClick={() => { const note = askText(`Note for "${words(d)}" (the provider sees it)`); if (note) void act(() => homeApi(`${A}/providers/${p.id}/review`, "POST", { decision: d, note }), words(d)); }}>{d === "APPROVED" ? "Approve" : d === "REJECTED" ? "Reject" : "Suspend"}</button>)}</div>}
        </div>
      ))}
      {data && data.total > 25 && <div className={s.row}><button className={`${s.ghost} ${s.small}`} disabled={page <= 1} onClick={() => setPage(page - 1)}>Back</button><span className={s.meta}>Page {page}</span><button className={`${s.ghost} ${s.small}`} disabled={page * 25 >= data.total} onClick={() => setPage(page + 1)}>Next</button></div>}
    </section>
  );
}

async function openFile(path: string) {
  const { blob } = await apiFetchBlob(path);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
function Verification({ sensitive }: { sensitive: boolean }) {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useLoad<{ id: string; scope: string; subject: string; status: string; evidenceNote: string | null; evidenceType: string | null; submittedAt: string; professional: { displayName: string; provider: { displayName: string } } }[]>(`${A}/verifications${status ? `?status=${status}` : ""}`);
  const { act, busy, banner } = useAct(reload);
  return (
    <section className={s.section}>
      <select className={s.input} style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">To review</option>{["VERIFIED", "REJECTED", "EXPIRED", "SUSPENDED"].map((x) => <option key={x} value={x}>{words(x)}</option>)}</select>
      {banner}
      {!data && <Loading error={error} />}
      {data?.length === 0 && <p className={s.empty}>Nothing to review.</p>}
      {data?.map((v) => <div key={v.id} className={s.card}><span className={s.strong}>{v.professional.displayName} · {words(v.scope)} {v.subject && `(${v.subject})`}</span><span className={s.meta}>{v.professional.provider.displayName} · {words(v.status)} · {when(v.submittedAt)}</span>{v.evidenceNote && <p className={s.sub}>{v.evidenceNote}</p>}{sensitive && <div className={s.row}>{v.evidenceType && <button className={`${s.ghost} ${s.small}`} onClick={() => void act(() => openFile(`${A}/verifications/${v.id}/file`), "Opened (recorded)")}>View document</button>}{(["UNDER_REVIEW", "VERIFIED", "REJECTED", "SUSPENDED"] as const).map((x) => <button key={x} className={`${x === "VERIFIED" ? s.btn : s.ghost} ${s.small}`} disabled={busy} onClick={() => { const note = askText("What was checked? (recorded)"); if (note) void act(() => homeApi(`${A}/verifications/${v.id}/review`, "POST", { status: x, note })); }}>{words(x)}</button>)}</div>}</div>)}
    </section>
  );
}

interface BRow { id: string; code: string; status: string; paymentStatus: string; complaintStatus: string; mode: string; serviceStart: string; totalPaise: number; services: string; provider: string; kind: string; professional: string | null; area: string }
function Bookings({ scope, sensitive, admin }: { scope: "active" | "scheduled"; sensitive: boolean; admin: boolean }) {
  const { status: label } = useLang();
  const [all, setAll] = useState(false);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const qs = new URLSearchParams({ scope: all ? "all" : scope, page: String(page) });
  if (q) qs.set("q", q);
  if (from) qs.set("from", new Date(`${from}T00:00:00+05:30`).toISOString());
  if (to) qs.set("to", new Date(`${to}T23:59:59+05:30`).toISOString());
  const { data, error } = useLoad<{ total: number; items: BRow[] }>(`${A}/bookings?${qs}`);
  const { act, banner } = useAct();
  return (
    <section className={s.section}>
      <form className={s.row} onSubmit={(e) => { e.preventDefault(); setQ(new FormData(e.currentTarget).get("q") as string); setPage(1); }}>
        <input className={s.input} style={{ maxWidth: 200 }} name="q" placeholder="Code or provider" aria-label="Search" /><input className={s.input} style={{ maxWidth: 160 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><input className={s.input} style={{ maxWidth: 160 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" /><button className={`${s.ghost} ${s.small}`}>Search</button>
        <label className={s.check}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All statuses</label>
        {sensitive && <button type="button" className={`${s.ghost} ${s.small}`} onClick={() => void act(async () => { const { blob } = await apiFetchBlob(`${A}/bookings/export?${qs}`); const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = "fastque-home-bookings.csv"; a.click(); URL.revokeObjectURL(u); }, "Exported (recorded)")}>Export CSV</button>}
      </form>
      {banner}
      {!data ? <Loading error={error} /> : <Table head={["Booking", "Status", "When", "Services", "Provider", "Professional", "Area", "Total"]} rows={data.items.map((b) => [sensitive ? <button key="c" className={`${s.ghost} ${s.small}`} onClick={() => setOpen(open === b.code ? null : b.code)}>{b.code}</button> : b.code, <span key="s">{label(b.status as never)}<br /><span className={s.meta}>{words(b.paymentStatus)}{b.complaintStatus !== "NONE" ? ` · complaint ${words(b.complaintStatus)}` : ""}</span></span>, when(b.serviceStart), b.services, <span key="p">{b.provider}<br /><span className={s.meta}>{b.kind === "SALON_MANAGED" ? "Salon" : "Independent"}</span></span>, b.professional ?? "—", b.area, money(b.totalPaise)])} />}
      {open && <BookingDetail code={open} admin={admin} />}
      {data && data.total > 25 && <div className={s.row}><button className={`${s.ghost} ${s.small}`} disabled={page <= 1} onClick={() => setPage(page - 1)}>Back</button><span className={s.meta}>Page {page}</span><button className={`${s.ghost} ${s.small}`} disabled={page * 25 >= data.total} onClick={() => setPage(page + 1)}>Next</button></div>}
    </section>
  );
}

function BookingDetail({ code, admin }: { code: string; admin: boolean }) {
  const { status: label } = useLang();
  const { data: b, error, reload } = useLoad<HomeBookingDto>(`${A}/bookings/${code}`);
  const { act, busy, banner } = useAct(reload);
  if (!b) return <Loading error={error} />;
  const go = (a: string, body: unknown) => act(() => homeApi(`${A}/bookings/${code}/${a}`, "POST", body), "Recorded");
  const ask = (a: string, q: string, f: (v: string) => unknown) => <button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => { const v = askText(q, 5); if (v) void go(a, f(v)); }}>{words(a)}</button>;
  return (
    <section className={s.card}>
      <span className={s.strong}>{b.code} · {label(b.status)}</span>
      <span>{[b.address.full?.house, b.address.full?.building, b.address.locality, b.address.city, b.address.postalCode].filter(Boolean).join(", ")} · {b.customer?.name} {b.customer?.phone}</span>
      <span>Paid {money(b.paidPaise)} of {money(b.totalPaise)} · collected by {b.collectedBy}</span>
      {banner}
      {admin && <div className={s.row}>{b.can.cancel && ask("cancel", "Reason for cancelling", (reason) => ({ reason }))}{b.status === "ARRIVED" && ask("force-check-in", "How did you verify both sides? (audited)", (note) => ({ note }))}{["CONFIRMED", "PREPARING", "ON_THE_WAY"].includes(b.status) && <>{ask("replacement", "Reason – the customer must approve any replacement", (reason) => ({ reason }))}{ask("professional-no-show", "What was confirmed?", (reason) => ({ reason }))}</>}{b.paidPaise > 0 && <button className={`${s.ghost} ${s.small}`} onClick={() => { const amt = Number(window.prompt("Offline refund amount in ₹ (a record only)")); const reason = amt > 0 ? askText("Reason", 5) : null; if (reason) void go("refund", { kind: "REFUND", amountPaise: Math.round(amt * 100), reason }); }}>record refund</button>}{b.payments.filter((p) => !p.voided).map((p) => <button key={p.id} className={`${s.ghost} ${s.small}`} onClick={() => { const note = askText(`Void ${money(p.amountPaise)}? Reason`, 5); if (note) void go("void-payment", { paymentId: p.id, note }); }}>void {money(p.amountPaise)}</button>)}</div>}
      <ol className={s.timeline}>{b.history.map((h, i) => <li key={i}>{h.to ? label(h.to as never) : words(h.kind)} · {words(h.by)} <span className={s.meta}>{when(h.at)} {h.note}</span></li>)}</ol>
    </section>
  );
}

interface DRow { id: string; code: string; status: string; serviceStart: string; services: string[]; area: string; provider: { displayName: string; kind: string }; professional: string | null; delayMinutes: number; atRisk: boolean; preference: string; invitations: { name: string; status: string }[] }
function Dispatch({ admin, liveOnly }: { admin: boolean; liveOnly?: boolean }) {
  const { status: label } = useLang();
  const { data, error, reload } = useLoad<Record<string, DRow[]> & { availableNow: { id: string; displayName: string; provider: { displayName: string } }[]; onVisit: { id: string; displayName: string }[]; mapNote: string; generatedAt: string }>(`${A}/dispatch`);
  const { act, busy, banner } = useAct(reload);
  if (!data) return <Loading error={error} />;
  const list = (title: string, rows: DRow[], invite?: boolean) => (
    <section className={s.section}>
      <h2 className={s.h2}>{title} ({rows.length})</h2>
      {rows.map((b) => (
        <div key={b.code} className={s.card}>
          <div className={s.between}><span className={s.strong}>{b.code} · {label(b.status as never)}</span>{b.atRisk && <span className={`${s.badge} ${s.red}`}>At risk</span>}</div>
          <span>{when(b.serviceStart)} · {b.services.join(", ")} · {b.area}</span>
          <span className={s.meta}>{b.provider.displayName} ({b.provider.kind === "SALON_MANAGED" ? "salon" : "independent"}) · {b.professional ?? "unassigned"}{b.delayMinutes ? ` · ${b.delayMinutes} min late` : ""} · {words(b.preference)}</span>
          {b.invitations.map((i, n) => <span key={n} className={s.meta}>{i.name}: {words(i.status)}</span>)}
          {invite && admin && data.availableNow.length > 0 && <form className={s.row} onSubmit={(e) => { e.preventDefault(); const note = askText("Dispatch note (audited)"); if (note) void act(() => homeApi(`${A}/bookings/${b.code}/invite`, "POST", { professionalId: new FormData(e.currentTarget).get("pro"), note }), "Invitation sent – the professional decides"); }}><select className={s.input} style={{ maxWidth: 260 }} name="pro" aria-label="Professional">{data.availableNow.map((x) => <option key={x.id} value={x.id}>{x.displayName} – {x.provider.displayName}</option>)}</select><button className={`${s.btn} ${s.small}`} disabled={busy}>Invite</button></form>}
        </div>
      ))}
      {rows.length === 0 && <p className={s.meta}>None</p>}
    </section>
  );
  return (
    <>
      <div className={s.row}><button className={`${s.ghost} ${s.small}`} onClick={reload}>Refresh</button><span className={s.meta}>As of {when(data.generatedAt)}. {data.mapNote}</span></div>
      {banner}
      <div className={s.grid}><Stat label="Unassigned" value={data.unassigned.length} /><Stat label="Available online" value={data.availableNow.length} /><Stat label="Preparing" value={data.preparing.length} /><Stat label="Travelling" value={data.traveling.length} /><Stat label="Serving" value={data.serving.length} /><Stat label="At risk" value={data.atRisk.length} /><Stat label="Replacement / reschedule" value={data.replacements.length} /></div>
      {!liveOnly && list("Unassigned", data.unassigned, true)}
      {list("At risk", data.atRisk)}
      {!liveOnly && list("Replacement or reschedule waiting", data.replacements)}
      {list("Preparing", data.preparing)}
      {list("Travelling", data.traveling)}
      {list("Serving", data.serving)}
      {!liveOnly && list("Upcoming", data.upcoming)}
    </>
  );
}

function Areas() {
  const { data, error } = useProviders(null, "APPROVED");
  return !data ? <Loading error={error} /> : <Table head={["Provider", "City", "Areas"]} rows={data.items.map((p) => [p.displayName, p.city, p.areas.map((a) => `${a.excluded ? "not " : ""}${a.kind === "RADIUS" ? `${a.radiusKm} km radius` : `${a.value} (${words(a.kind)})`}`).join(", ")])} />;
}
function Pricing() {
  const { data, error } = useProviders(null, "APPROVED");
  return !data ? <Loading error={error} /> : <><p className={s.sub}>Providers set their own home prices. Price limits per service are in the Home-Service Catalog.</p><Table head={["Provider", "Service", "Home price", "Travel", "On"]} rows={data.items.flatMap((p) => p.offerings.map((o) => [p.displayName, o.serviceDef.name, money(o.pricePaise), money(p.travelFeePaise), o.active ? "Yes" : "No"]))} /></>;
}

interface GrowthDto { promotions: { id: string; code: string; title: string; percentOff: number | null; amountOffPaise: number | null; active: boolean; endsAt: string; provider: { displayName: string } | null }[]; societies: { id: string; name: string; locality: string; city: string; postalCode: string }[]; campaigns: { id: string; title: string; status: string; startsAt: string; joinBy: string; minParticipants: number; society: { name: string }; provider: { displayName: string }; _count: { participants: number } }[]; packages: { id: string; title: string; pricePaise: number; provider: { displayName: string } }[]; plans: { id: string; name: string; pricePaise: number; active: boolean }[]; membershipsEnabled: boolean }
function Growth({ part, admin }: { part: "promotions" | "societies" | "packages"; admin: boolean }) {
  const { data, error, reload } = useLoad<GrowthDto>(`${A}/growth`);
  const { data: provs } = useProviders(null, "APPROVED");
  const [prov, setProv] = useState("");
  const { act, busy, banner } = useAct(reload);
  if (!data) return <Loading error={error} />;
  const iso = (d: FormData, k: string) => new Date(`${d.get(k) as string}:00+05:30`).toISOString();
  return (
    <section className={s.section}>
      {banner}
      {part === "promotions" && <><Table head={["Code", "Title", "Off", "By", "Ends"]} rows={data.promotions.map((p) => [p.code, p.title, p.percentOff ? `${p.percentOff}%` : money(p.amountOffPaise ?? 0), p.provider?.displayName ?? "FastQue", when(p.endsAt)])} />{admin && <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void act(() => homeApi(`${A}/promotions`, "POST", { code: d.get("code"), title: d.get("title"), percentOff: Number(d.get("pct")), startsAt: new Date().toISOString(), endsAt: iso(d, "ends") }), "Created"); }}><div className={s.form}><Field label="Code"><input className={s.input} name="code" required /></Field><Field label="Title"><input className={s.input} name="title" required /></Field><Field label="Percent off"><input className={s.input} name="pct" type="number" min={1} max={80} required /></Field><Field label="Ends"><input className={s.input} name="ends" type="datetime-local" required /></Field></div><button className={`${s.btn} ${s.small}`} disabled={busy}>Create offer</button></form>}</>}
      {part === "societies" && (
        <>
          <Table head={["Campaign", "Society", "Provider", "Joined", "When", "Status"]} rows={data.campaigns.map((c) => [c.title, c.society.name, c.provider.displayName, `${c._count.participants} (min ${c.minParticipants})`, when(c.startsAt), words(c.status)])} />
          {admin && <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void act(() => homeApi(`${A}/societies`, "POST", { name: d.get("name"), locality: d.get("locality"), city: d.get("city"), postalCode: d.get("pin") }), "Society added"); }}><h2 className={s.h2}>Add society</h2><div className={s.form}>{[["name", "Society"], ["locality", "Locality"], ["city", "City"], ["pin", "PIN code"]].map(([k, l]) => <Field key={k} label={l}><input className={s.input} name={k} required /></Field>)}</div><button className={`${s.btn} ${s.small}`}>Add</button></form>}
          {admin && <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void act(() => homeApi(`${A}/campaigns`, "POST", { societyId: d.get("soc"), providerId: prov, offeringId: d.get("offer"), title: d.get("title"), minParticipants: Number(d.get("min")), maxParticipants: Number(d.get("max")), discountPct: Number(d.get("pct")), startsAt: iso(d, "from"), endsAt: iso(d, "to"), joinBy: iso(d, "by") }), "Campaign opened"); }}>
            <h2 className={s.h2}>New society campaign</h2>
            <div className={s.form}><Field label="Society"><select className={s.input} name="soc" required>{data.societies.map((x) => <option key={x.id} value={x.id}>{x.name}, {x.locality}</option>)}</select></Field><Field label="Provider"><select className={s.input} value={prov} onChange={(e) => setProv(e.target.value)} required><option value="">Choose…</option>{provs?.items.map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}</select></Field><Field label="Service"><select className={s.input} name="offer" required>{provs?.items.find((x) => x.id === prov)?.offerings.filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.serviceDef.name}</option>)}</select></Field><Field label="Title"><input className={s.input} name="title" required /></Field><Field label="Minimum residents"><input className={s.input} name="min" type="number" min={2} required /></Field><Field label="Maximum"><input className={s.input} name="max" type="number" min={2} required /></Field><Field label="Group discount %"><input className={s.input} name="pct" type="number" min={0} max={60} required /></Field><Field label="Visit from"><input className={s.input} name="from" type="datetime-local" required /></Field><Field label="Visit until"><input className={s.input} name="to" type="datetime-local" required /></Field><Field label="Join by"><input className={s.input} name="by" type="datetime-local" required /></Field></div>
            <button className={`${s.btn} ${s.small}`} disabled={busy}>Open campaign</button>
          </form>}
        </>
      )}
      {part === "packages" && <><Table head={["Package", "Provider", "Price"]} rows={data.packages.map((p) => [p.title, p.provider.displayName, money(p.pricePaise)])} /><p className={s.note}>Memberships are {data.membershipsEnabled ? "switched on" : "switched off. Plans can be saved as drafts only; nothing is sold"}.</p><Table head={["Membership plan", "Price", "Active"]} rows={data.plans.map((p) => [p.name, money(p.pricePaise), p.active ? "Yes" : "Draft"])} /></>}
    </section>
  );
}

function Quality({ admin }: { admin: boolean }) {
  const { data, error, reload } = useLoad<{ hygiene: { stage: string; complete: boolean; _count: { _all: number } }[]; reportedReviews: { id: string; overall: number; comment: string | null; reportReason: string | null; status: string; professional: { displayName: string } }[]; startedWithoutChecklist: { createdAt: string; booking: { code: string } }[] }>(`${A}/quality`);
  const { act, banner } = useAct(reload);
  if (!data) return <Loading error={error} />;
  return <section className={s.section}>{banner}<Table head={["Checklist", "Complete", "Visits"]} rows={data.hygiene.map((h) => [words(h.stage), h.complete ? "Yes" : "No", h._count._all])} /><h2 className={s.h2}>Started without a checklist</h2><Table head={["Booking", "When"]} rows={data.startedWithoutChecklist.map((x) => [x.booking.code, when(x.createdAt)])} /><h2 className={s.h2}>Reviews to check</h2>{data.reportedReviews.map((r) => <div key={r.id} className={s.card}><span className={s.strong}>★ {r.overall} · {r.professional.displayName} · {words(r.status)}</span><p className={s.sub}>{r.comment}</p><p className={s.meta}>Reported: {r.reportReason}</p>{admin && <div className={s.row}>{(["PUBLISHED", "HIDDEN"] as const).map((x) => <button key={x} className={`${s.ghost} ${s.small}`} onClick={() => { const note = askText("Reason (recorded)", 5); if (note) void act(() => homeApi(`${A}/reviews/${r.id}`, "POST", { status: x, note })); }}>{x === "PUBLISHED" ? "Keep" : "Hide"}</button>)}</div>}</div>)}</section>;
}
function Incidents() {
  const { data, error, reload } = useLoad<{ id: string; kind: string; severity: string; status: string; description: string; reporterParty: string; createdAt: string; resolution: string | null; booking: { code: string } | null }[]>(`${A}/incidents`);
  const { act, banner } = useAct(reload);
  if (!data) return <Loading error={error} />;
  return <section className={s.section}>{banner}{data.length === 0 && <p className={s.empty}>No safety reports.</p>}{data.map((i) => <div key={i.id} className={s.card}><div className={s.between}><span className={s.strong}>{words(i.kind)} · {i.booking?.code ?? "no booking"}</span><span className={`${s.badge} ${i.severity === "CRITICAL" ? s.red : s.amber}`}>{words(i.severity)} · {words(i.status)}</span></div><p className={s.sub}>{i.description}</p><span className={s.meta}>{words(i.reporterParty)} · {when(i.createdAt)} {i.resolution}</span><div className={s.row}>{(["INVESTIGATING", "ESCALATED", "CLOSED"] as const).map((x) => <button key={x} className={`${s.ghost} ${s.small}`} onClick={() => { const resolution = askText("What was done? (recorded)", 5); if (resolution) void act(() => homeApi(`${A}/incidents/${i.id}`, "POST", { status: x, resolution })); }}>{words(x)}</button>)}</div></div>)}</section>;
}
function Complaints({ sensitive }: { sensitive: boolean }) {
  const { data, error, reload } = useLoad<{ id: string; number: number; category: string; priority: string; status: string; booking: { code: string }; messages: { id: string; authorParty: string; internal: boolean; body: string; createdAt: string }[] }[]>(`${A}/tickets`);
  const { act, banner } = useAct(reload);
  if (!data) return <Loading error={error} />;
  return <section className={s.section}>{banner}{data.length === 0 && <p className={s.empty}>No open complaints.</p>}{data.map((t) => <div key={t.id} className={s.card}><div className={s.between}><span className={s.strong}>#{t.number} {words(t.category)} · {t.booking.code}</span><span className={`${s.badge} ${t.priority === "URGENT" ? s.red : s.amber}`}>{words(t.priority)} · {words(t.status)}</span></div>{t.messages.map((m) => <span key={m.id} className={s.sub}><b>{words(m.authorParty)}{m.internal ? " (internal)" : ""}:</b> {m.body}</span>)}{sensitive && <div className={s.row}><button className={`${s.ghost} ${s.small}`} onClick={() => { const reply = askText("Reply to the person"); if (reply) void act(() => homeApi(`${A}/tickets/${t.id}`, "POST", { reply, assignToMe: true, status: "IN_PROGRESS" })); }}>Reply</button><button className={`${s.ghost} ${s.small}`} onClick={() => { const reply = askText("Internal note"); if (reply) void act(() => homeApi(`${A}/tickets/${t.id}`, "POST", { reply, internal: true })); }}>Internal note</button><button className={`${s.ghost} ${s.small}`} onClick={() => void act(() => homeApi(`${A}/tickets/${t.id}`, "POST", { status: "ESCALATED", priority: "URGENT" }))}>Escalate</button><button className={`${s.btn} ${s.small}`} onClick={() => { const resolution = askText("Resolution"); if (resolution) void act(() => homeApi(`${A}/tickets/${t.id}`, "POST", { status: "RESOLVED", resolution })); }}>Resolve</button></div>}</div>)}</section>;
}
interface MoneyDto { monetizationEnabled: boolean; records: { id: string; amountPaise: number; method: string; collectedBy: string; createdAt: string; disputedAt: string | null; voidedAt: string | null; customerConfirmedAt: string | null; booking: { code: string } }[]; outstanding: { providerId: string; provider: string; amountPaise: number; visits: number }[]; settlements: { id: string; amountPaise: number; status: string; reference: string | null; createdAt: string; provider: { displayName: string } }[]; rules: { id: string; kind: string; providerKind: string | null; percentBps: number; fixedPaise: number; active: boolean; note: string | null }[] }
function Money({ part, admin }: { part: "payments" | "commissions"; admin: boolean }) {
  const { data, error, reload } = useLoad<MoneyDto>(`${A}/money`);
  const { act, busy, banner } = useAct(reload);
  if (!data) return <Loading error={error} />;
  return (
    <section className={s.section}>
      {banner}
      <p className={s.note}>Customers pay providers directly. These are records; FastQue processes no service payment. Platform fees are {data.monetizationEnabled ? "switched on" : "switched off (HOME_MONETIZATION_ENABLED)"}.</p>
      {part === "payments" ? (
        <>
          <Table head={["Booking", "Amount", "Method", "Collected by", "When", "State"]} rows={data.records.map((r) => [r.booking.code, money(r.amountPaise), words(r.method), r.collectedBy, when(r.createdAt), r.voidedAt ? "voided" : r.disputedAt ? "disputed" : r.customerConfirmedAt ? "confirmed by customer" : "recorded by provider"])} />
          <h2 className={s.h2}>Unsettled platform fees</h2>
          <Table head={["Provider", "Visits", "Amount", ""]} rows={data.outstanding.map((o) => [o.provider, o.visits, money(o.amountPaise), admin ? <button key="b" className={`${s.btn} ${s.small}`} disabled={busy} onClick={() => void act(() => homeApi(`${A}/settlements`, "POST", { providerId: o.providerId }), "Settlement created")}>Create settlement</button> : null])} />
          <Table head={["Settlement", "Amount", "Status", "Reference", ""]} rows={data.settlements.map((x) => [x.provider.displayName, money(x.amountPaise), words(x.status), x.reference ?? "", admin && x.status === "DUE" ? <button key="b" className={`${s.ghost} ${s.small}`} onClick={() => { const reference = askText("Offline collection reference"); if (reference) void act(() => homeApi(`${A}/settlements/${x.id}/collect`, "POST", { reference })); }}>Mark collected</button> : null])} />
        </>
      ) : (
        <>
          <Table head={["Rule", "For", "Percent", "Fixed", "State", ""]} rows={data.rules.map((r) => [words(r.kind), words(r.providerKind ?? "all"), `${r.percentBps / 100}%`, money(r.fixedPaise), r.active ? "Active" : "Off", admin ? <button key="b" className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => void act(() => homeApi(`${A}/fee-rules/${r.id}`, "PUT", { kind: r.kind, providerKind: r.providerKind, percentBps: r.percentBps, fixedPaise: r.fixedPaise, active: !r.active }))}>{r.active ? "Switch off" : "Activate"}</button> : null])} />
          {admin && <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void act(() => homeApi(`${A}/fee-rules`, "POST", { kind: d.get("kind"), providerKind: d.get("for") || null, percentBps: Math.round(Number(d.get("pct") || 0) * 100), fixedPaise: Math.round(Number(d.get("fixed") || 0) * 100), active: false }), "Saved (off)"); }}><div className={s.form}><Field label="Type"><select className={s.input} name="kind"><option value="COMMISSION">Commission</option><option value="FIXED_BOOKING">Fixed per booking</option></select></Field><Field label="For"><select className={s.input} name="for"><option value="">All</option><option value="SALON_MANAGED">Salons</option><option value="INDEPENDENT_PROFESSIONAL">Independent</option></select></Field><Field label="Percent"><input className={s.input} name="pct" type="number" min={0} max={30} step="0.1" /></Field><Field label="Fixed ₹"><input className={s.input} name="fixed" type="number" min={0} /></Field></div><button className={`${s.btn} ${s.small}`}>Save rule (off)</button></form>}
        </>
      )}
    </section>
  );
}
function Training() {
  const { data, error } = useLoad<{ id: string; scope: string; status: string; submittedAt: string; professional: { displayName: string; provider: { displayName: string } } }[]>(`${A}/training`);
  return !data ? <Loading error={error} /> : <><p className={s.sub}>Hygiene training, skill assessments and certificates recorded for professionals. Approve them under Professional Verification.</p><Table head={["Professional", "Provider", "Record", "Status", "Submitted"]} rows={data.map((x) => [x.professional.displayName, x.professional.provider.displayName, words(x.scope), words(x.status), when(x.submittedAt)])} /></>;
}
function Insights() {
  const { data, error } = useLoad<{ notice: string; signals: { kind: string; subject: string; count: number }[] }>(`${A}/insights`);
  return !data ? <Loading error={error} /> : <><p className={s.note}>{data.notice} Built-in rules; no AI service is used and no scores are produced.</p><Table head={["Signal", "About", "Count"]} rows={data.signals.map((x) => [x.kind, x.subject, x.count])} /></>;
}
function Analytics({ sensitive }: { sensitive: boolean }) {
  const [from, setFrom] = useState(istDate(-29));
  const [to, setTo] = useState(istDate(0));
  const { data, error } = useLoad<Record<string, Row>>(`${A}/analytics?from=${from}&to=${to}`);
  const { data: field } = useLoad<{ results: { userId: string; name: string | null; approved: number; published: number; firstBooking: number; completed: number }[] }>(`${A}/field`);
  const preset = (d: number) => { setFrom(istDate(-d)); setTo(istDate(0)); };
  const fmt = (k: string, v: unknown) => (v == null ? "—" : k.endsWith("Paise") ? money(Number(v)) : k.endsWith("Pct") ? `${String(v)}%` : typeof v === "number" ? Math.round(v * 10) / 10 : String(v));
  return (
    <section className={s.section}>
      <div className={s.row}>{([[0, "Today"], [6, "7 days"], [29, "30 days"], [89, "Quarter"], [364, "Year"]] as const).map(([d, l]) => <button key={l} className={s.chip} onClick={() => preset(d)}>{l}</button>)}<input className={s.input} style={{ maxWidth: 160 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><input className={s.input} style={{ maxWidth: 160 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" /></div>
      {!data ? <Loading error={error} /> : (["bookings", "dispatch", "professionals", "money"] as const).map((sec) => <div key={sec} className={s.section}><h2 className={s.h2}>{words(sec)}</h2><div className={s.grid}>{Object.entries(data[sec]).filter(([k]) => !/note/i.test(k)).map(([k, v]) => <Stat key={k} label={k.replace(/Paise$|Pct$/, "").replace(/([A-Z])/g, " $1").toLowerCase()} value={fmt(k, v)} />)}</div>{!!(data[sec].note ?? data[sec].distanceNote) && <p className={s.meta}>{String(data[sec].note ?? data[sec].distanceNote)}</p>}</div>)}
      {data && <div className={s.grid}>{Object.entries(data.market as unknown as Record<string, { key: string; count: number }[]>).map(([k, rows]) => <div key={k} className={s.card}><span className={s.strong}>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>{rows.length === 0 ? <span className={s.meta}>No records</span> : rows.map((r) => <div key={r.key} className={s.between}><span>{words(r.key)}</span><span>{r.count}</span></div>)}</div>)}</div>}
      <h2 className={s.h2}>Field sales activation</h2>
      <Table head={["Executive", "Approved providers", "Published", "With a completed booking", "Completed services"]} rows={(field?.results ?? []).map((r) => [r.name ?? r.userId, r.approved, r.published, r.firstBooking, r.completed])} />
      {!sensitive && <p className={s.meta}>Exports are limited to administrators.</p>}
    </section>
  );
}
function Settings({ admin }: { admin: boolean }) {
  const { data, error, reload } = useLoad<Record<string, number | string | boolean>>(`${A}/settings`);
  const { act, busy, banner } = useAct(reload);
  if (!data) return <Loading error={error} />;
  return (
    <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); const body = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === "number" ? Number(d.get(k)) : typeof v === "boolean" ? d.get(k) === "on" : d.get(k)])); void act(() => homeApi(`${A}/settings`, "PUT", body), "Saved"); }}>
      <p className={s.sub}>Dispatch timing, codes, buffers, support contacts and policies. Feature switches are server environment variables and cannot be changed here.</p>
      {banner}
      <div className={s.form}>{Object.entries(data).map(([k, v]) => <Field key={k} label={k.replace(/([A-Z])/g, " $1").toLowerCase()}>{typeof v === "boolean" ? <input type="checkbox" name={k} defaultChecked={v} disabled={!admin} /> : String(v).length > 60 || /Policy/.test(k) ? <textarea className={s.input} name={k} rows={4} defaultValue={String(v)} disabled={!admin} /> : <input className={s.input} name={k} type={typeof v === "number" ? "number" : "text"} defaultValue={String(v)} disabled={!admin} />}</Field>)}</div>
      {admin && <button className={`${s.btn} ${s.small}`} disabled={busy}>Save settings</button>}
    </form>
  );
}
