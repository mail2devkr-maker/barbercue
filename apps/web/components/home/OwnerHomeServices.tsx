"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { homeApi, money, newKey, useLang, useLoad, when, type HomeBookingDto } from "../../lib/home";
import { askText, Field, KindBadge, Loading, Stat, useAct } from "./HomeUi";
import { AreaEditor, Checklist, Earnings, OfferingEditor, SettingsEditor, type ProviderDto, type Sources } from "./ProviderForms";
import s from "./home.module.css";

const TABS = [
  ["overview", "Overview"], ["services", "My Home Services & Pricing"], ["professionals", "Professional Assignment"], ["availability", "Availability"], ["areas", "Service Areas"],
  ["incoming", "Incoming"], ["upcoming", "Upcoming"], ["active", "Active"], ["completed", "Completed"], ["cancellations", "Cancellations"],
  ["reviews", "Reviews"], ["earnings", "Earnings"], ["settlements", "Settlements"], ["promotions", "Promotions"], ["settings", "Settings"],
] as const;
const LISTS = ["incoming", "upcoming", "active", "completed", "cancellations"];

export function OwnerHomeServices({ salonId }: { salonId: string }) {
  const router = useRouter();
  const tab = useSearchParams().get("tab") ?? "overview";
  const root = `dashboard/salons/${salonId}/home`;
  const { data, error, reload } = useLoad<{ enabled: boolean; provider: ProviderDto | null; overview: { incoming: number; upcoming: number; active: number; completed30: number; cancelled30: number; rating: number | null; reviews: number } | null }>(root);
  const { data: sources, reload: reloadSources } = useLoad<Sources>(`${root}/sources`);
  const { act, busy, banner } = useAct(() => { reload(); reloadSources(); });
  if (!data) return <div className={`${s.page} ${s.dark}`}><Loading error={error} /></div>;
  const p = data.provider;
  if (!p)
    return (
      <div className={`${s.page} ${s.dark}`}>
        <h1 className={s.title}>Home Services</h1>
        <section className={s.card}>
          <h2 className={s.h2}>Serve customers at their doorstep</h2>
          <p className={s.sub}>You choose the services, separate home prices, staff, areas and rules that protect your shop floor. Your in-salon prices, queue and bookings stay exactly as they are. Nothing is public until you finish the steps and FastQue approves.</p>
          {banner}
          <button className={s.btn} disabled={busy} onClick={() => void act(() => homeApi(`${root}/enable`, "POST", {}), "Enabled")}>Enable home services</button>
        </section>
      </div>
    );
  const both = () => { reload(); reloadSources(); };
  return (
    <div className={`${s.page} ${s.dark}`}>
      <div className={s.top}><h1 className={s.title}>Home Services</h1><KindBadge kind="SALON_MANAGED" label={`Salon managed · ${p.status.toLowerCase()}`} /></div>
      <div className={s.tabs} role="tablist">{TABS.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} className={s.tab} onClick={() => router.replace(`/dashboard/salons/${salonId}/home-services?tab=${id}`)}>{l}</button>)}</div>
      {banner}
      {tab === "overview" && data.overview && (
        <>
          <div className={s.grid}><Stat label="Incoming" value={data.overview.incoming} /><Stat label="Upcoming" value={data.overview.upcoming} /><Stat label="Active now" value={data.overview.active} /><Stat label="Completed (30 days)" value={data.overview.completed30} /><Stat label="Cancelled (30 days)" value={data.overview.cancelled30} /><Stat label={`Rating (${data.overview.reviews} reviews)`} value={data.overview.rating ? data.overview.rating.toFixed(1) : "—"} /></div>
          <Checklist root={root} p={p} reload={reload} />
          <Advice root={root} />
        </>
      )}
      {tab === "services" && <OfferingEditor root={root} p={p} sources={sources} reload={both} />}
      {(tab === "professionals" || tab === "availability") && (
        <section className={s.section}>
          <h2 className={s.h2}>{tab === "professionals" ? "Who does home visits" : "Availability"}</h2>
          <p className={s.sub}>{tab === "professionals" ? "Staff must agree from their own FastQue sign-in at /home-pro before customers can book them." : "Home visits follow your salon hours, each person's salon shift, appointments and live queue automatically. Staff can add narrower hours or breaks in their own dashboard."}</p>
          {sources?.staff.filter((x) => !x.homeProfessional).map((x) => tab === "professionals" && <div key={x.id} className={`${s.card} ${s.between}`}><span>{x.displayName}</span><button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => void act(() => homeApi(`${root}/staff/${x.id}`, "POST", {}), "Invited – waiting for their consent")}>Invite to home visits</button></div>)}
          {p.professionals.map((x) => (
            <form key={x.id} className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void act(() => homeApi(`${root}/professionals/${x.id}`, "PUT", { serviceCodes: d.getAll("svc"), dedicated: d.get("dedicated") === "on", active: d.get("active") === "on" }), "Saved"); }}>
              <div className={s.between}><span className={s.strong}>{x.displayName}</span><span className={`${s.badge} ${x.consentAt ? s.green : s.amber}`}>{x.consentAt ? (x.isOnline ? "Online" : "Consented") : "Waiting for consent"}</span></div>
              {tab === "availability" ? <span className={s.meta}>{x.schedules.length ? x.schedules.map((y) => `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][y.dayOfWeek]} ${y.startTime}–${y.endTime}`).join(", ") : "Follows salon hours and shift"}</span> : (
                <>
                  <div className={s.row}>{p.offerings.map((o) => <label key={o.id} className={s.check}><input type="checkbox" name="svc" value={o.serviceDef.code} defaultChecked={x.services.some((y) => y.offeringId === o.id)} /> {o.serviceDef.name}</label>)}</div>
                  <label className={s.check}><input type="checkbox" name="dedicated" defaultChecked={x.dedicated} /> Only does home visits (not counted on the shop floor)</label>
                  <label className={s.check}><input type="checkbox" name="active" defaultChecked={x.active} /> Active for home visits</label>
                  <button className={`${s.btn} ${s.small}`} disabled={busy}>Save</button>
                </>
              )}
            </form>
          ))}
        </section>
      )}
      {tab === "areas" && <AreaEditor root={root} p={p} reload={reload} />}
      {tab === "settings" && <SettingsEditor root={root} p={p} reload={reload} />}
      {LISTS.includes(tab) && <Bookings key={tab} root={root} tab={tab} p={p} />}
      {tab === "reviews" && <OwnerReviews root={root} />}
      {tab === "earnings" && <OwnerEarnings root={root} />}
      {tab === "settlements" && <Settlements root={root} />}
      {tab === "promotions" && <Promotions root={root} p={p} />}
    </div>
  );
}

function Advice({ root }: { root: string }) {
  const { data } = useLoad<{ workforce: { message: string; basis?: string }; pricing: { offeringId: string; service: string; pricePaise: number; medianPaise: number | null; peers: number; advice: string }[] }>(`${root}/advice`);
  if (!data) return null;
  return <section className={s.card}><h2 className={s.h2}>Suggestions</h2><p className={s.meta}>Rules over your own records. Suggestions only; nothing is changed for you.</p><p>{data.workforce.message}</p>{data.pricing.map((x) => <p key={x.offeringId} className={s.sub}><b>{x.service}</b> {money(x.pricePaise)} · {x.medianPaise != null ? `local median ${money(x.medianPaise)} (${x.peers} offers)` : x.advice}</p>)}</section>;
}

function Bookings({ root, tab, p }: { root: string; tab: string; p: ProviderDto }) {
  const { status: label } = useLang();
  const [page, setPage] = useState(1);
  const { data, error, reload } = useLoad<{ total: number; page: number; pageSize: number; items: HomeBookingDto[] }>(`${root}/bookings?tab=${tab}&page=${page}`);
  const { act, busy, banner } = useAct(reload);
  if (!data) return <Loading error={error} />;
  const go = (c: string, a: string, body: unknown, ok?: string, key?: string) => act(() => homeApi(`${root}/bookings/${c}/${a}`, "POST", body, key ? { idempotent: key } : {}), ok);
  return (
    <section className={s.section}>
      {banner}
      {data.items.length === 0 && <p className={s.empty}>Nothing here.</p>}
      {data.items.map((b) => (
        <div key={b.code} className={s.card}>
          <div className={s.between}><span className={s.strong}>{label(b.status)}</span><span className={s.price}>{money(b.totalPaise)}</span></div>
          <span>{when(b.serviceStart)} · {b.items.map((i) => i.name).join(", ")} · {b.code}</span>
          <span className={s.meta}>{b.address.full ? [b.address.full.house, b.address.full.building, b.address.locality, b.address.city].filter(Boolean).join(", ") : `${b.address.locality}, ${b.address.city} (full address after assignment)`}{b.customer?.phone ? ` · ${b.customer.phone}` : ""}</span>
          {b.professional && <span>Professional: <b>{b.professional.name}</b>{b.delayMinutes ? ` · about ${b.delayMinutes} min late` : ""}</span>}
          {b.invitations?.map((i, n) => <span key={n} className={s.meta}>{i.name}: {i.status.toLowerCase()}</span>)}
          {["AWAITING_ASSIGNMENT", "INVITED", "REQUESTED"].includes(b.status) && (
            <form className={s.row} onSubmit={(e) => { e.preventDefault(); void go(b.code, "assign", { professionalId: new FormData(e.currentTarget).get("pro") }, "Assigned"); }}>
              <select className={s.input} name="pro" style={{ maxWidth: 220 }} aria-label="Professional">{p.professionals.filter((x) => x.consentAt && x.active).map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}</select><button className={`${s.btn} ${s.small}`} disabled={busy}>Assign</button>
            </form>
          )}
          {["CONFIRMED", "PREPARING", "ON_THE_WAY", "REPLACEMENT_REQUESTED"].includes(b.status) && (
            <form className={s.row} onSubmit={(e) => { e.preventDefault(); const reason = askText("Reason shown in the booking history"); if (reason) void go(b.code, "replacement", { reason, professionalId: new FormData(e.currentTarget).get("pro") }, "Proposed – waiting for the customer"); }}>
              <select className={s.input} name="pro" style={{ maxWidth: 220 }} aria-label="Replacement">{p.professionals.filter((x) => x.consentAt && x.active && x.id !== b.professional?.id).map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}</select><button className={`${s.ghost} ${s.small}`} disabled={busy}>Propose replacement</button>
            </form>
          )}
          {b.status === "RESCHEDULE_REQUESTED" && b.rescheduleTo && <div className={s.row}><span className={s.grow}>Asked for {when(b.rescheduleTo)}</span><button className={`${s.btn} ${s.small}`} onClick={() => void go(b.code, "reschedule-answer", { approve: true })}>Accept</button><button className={`${s.ghost} ${s.small}`} onClick={() => void go(b.code, "reschedule-answer", { approve: false })}>Decline</button></div>}
          {b.status === "PAYMENT_PENDING" && <button className={`${s.btn} ${s.small}`} disabled={busy} onClick={() => { if (window.confirm(`Record ${money(b.duePaise)} received by your salon?`)) void go(b.code, "payment", { method: b.paymentMethod, amountPaise: b.duePaise }, "Recorded", newKey()); }}>Record {money(b.duePaise)} received</button>}
          {b.can.cancel && <button className={`${s.danger} ${s.small}`} disabled={busy} onClick={() => { const reason = askText("Why is the salon cancelling?"); if (reason) void go(b.code, "cancel", { reason }, "Cancelled"); }}>Cancel</button>}
        </div>
      ))}
      {data.total > data.pageSize && <div className={s.row}><button className={`${s.ghost} ${s.small}`} disabled={page <= 1} onClick={() => setPage(page - 1)}>Back</button><span className={s.meta}>Page {page}</span><button className={`${s.ghost} ${s.small}`} disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</button></div>}
    </section>
  );
}

function OwnerReviews({ root }: { root: string }) {
  const { data, reload } = useLoad<{ id: string; overall: number; comment: string | null; response: string | null; status: string; professional: { displayName: string } }[]>(`${root}/reviews`);
  const { act, banner } = useAct(reload);
  return <section className={s.section}>{banner}{data?.length === 0 && <p className={s.empty}>No reviews yet.</p>}{data?.map((r) => <div key={r.id} className={s.card}><span className={s.strong}>★ {r.overall} · {r.professional.displayName}</span><p className={s.sub}>{r.comment}</p>{r.response ? <p className={s.meta}>Response: {r.response}</p> : <div className={s.row}><button className={`${s.ghost} ${s.small}`} onClick={() => { const message = askText("Public response"); if (message) void act(() => homeApi(`${root}/reviews/${r.id}/respond`, "POST", { message })); }}>Respond</button><button className={`${s.ghost} ${s.small}`} onClick={() => { const reason = askText("Why should FastQue check this review?"); if (reason) void act(() => homeApi(`${root}/reviews/${r.id}/report`, "POST", { reason })); }}>Dispute</button></div>}</div>)}</section>;
}

function OwnerEarnings({ root }: { root: string }) {
  const [days, setDays] = useState(30);
  const [now] = useState(() => Date.now());
  const { data } = useLoad<Record<string, unknown>>(`${root}/earnings?from=${new Date(now - days * 86_400_000).toISOString()}&to=${new Date(now + 86_400_000).toISOString()}`);
  return <section className={s.section}><div className={s.row}>{[7, 30, 90, 365].map((d) => <button key={d} className={s.chip} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>)}</div><Earnings data={data} /></section>;
}

function Settlements({ root }: { root: string }) {
  const { data } = useLoad<{ id: string; amountPaise: number; status: string; reference: string | null; createdAt: string }[]>(`${root}/settlements`);
  return <section className={s.section}><p className={s.sub}>FastQue platform fees are switched off, so settlements appear here only after FastQue enables and discloses a fee.</p>{data?.length === 0 ? <p className={s.empty}>No settlements.</p> : data?.map((x) => <div key={x.id} className={`${s.card} ${s.between}`}><span>{when(x.createdAt)} · {x.status.toLowerCase()} {x.reference}</span><span className={s.price}>{money(x.amountPaise)}</span></div>)}</section>;
}

function Promotions({ root, p }: { root: string; p: ProviderDto }) {
  const { data, reload } = useLoad<{ promotions: { id: string; code: string; title: string; percentOff: number | null; amountOffPaise: number | null; endsAt: string; active: boolean }[]; packages: { id: string; title: string; pricePaise: number; active: boolean }[] }>(`${root}/promotions`);
  const { act, busy, banner } = useAct(reload);
  return (
    <section className={s.section}>
      {banner}
      {data?.promotions.map((x) => <div key={x.id} className={`${s.card} ${s.between}`}><span><b>{x.code}</b> {x.title}</span><span>{x.percentOff ? `${x.percentOff}%` : money(x.amountOffPaise ?? 0)} off · until {when(x.endsAt)}</span></div>)}
      <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); const off = d.get("type") === "pct"; void act(() => homeApi(`${root}/promotions`, "POST", { code: d.get("code"), title: d.get("title"), ...(off ? { percentOff: Number(d.get("value")) } : { amountOffPaise: Math.round(Number(d.get("value")) * 100) }), minOrderPaise: Math.round(Number(d.get("min") || 0) * 100), startsAt: new Date().toISOString(), endsAt: new Date(`${d.get("ends") as string}T23:59:00+05:30`).toISOString() }), "Offer created"); }}>
        <h2 className={s.h2}>New offer</h2>
        <div className={s.form}><Field label="Code"><input className={s.input} name="code" required pattern="[A-Za-z0-9]{3,30}" /></Field><Field label="Title"><input className={s.input} name="title" required /></Field><Field label="Type"><select className={s.input} name="type"><option value="pct">Percent</option><option value="amt">Amount (₹)</option></select></Field><Field label="Value"><input className={s.input} name="value" type="number" min={1} required /></Field><Field label="Minimum (₹)"><input className={s.input} name="min" type="number" min={0} /></Field><Field label="Ends"><input className={s.input} name="ends" type="date" required /></Field></div>
        <button className={`${s.btn} ${s.small}`} disabled={busy}>Create</button>
      </form>
      <h2 className={s.h2}>Packages</h2>
      {data?.packages.map((x) => <div key={x.id} className={`${s.card} ${s.between}`}><span>{x.title}</span><span className={s.price}>{money(x.pricePaise)}</span></div>)}
      <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void act(() => homeApi(`${root}/packages`, "POST", { title: d.get("title"), offeringIds: d.getAll("o"), pricePaise: Math.round(Number(d.get("price")) * 100) }), "Package created"); }}>
        <div className={s.form}><Field label="Package name"><input className={s.input} name="title" required /></Field><Field label="Package price (₹)"><input className={s.input} name="price" type="number" min={1} required /></Field></div>
        <div className={s.row}>{p.offerings.filter((o) => o.active).map((o) => <label key={o.id} className={s.check}><input type="checkbox" name="o" value={o.id} /> {o.serviceDef.name} ({money(o.pricePaise)})</label>)}</div>
        <button className={`${s.btn} ${s.small}`} disabled={busy}>Create package</button>
      </form>
    </section>
  );
}
