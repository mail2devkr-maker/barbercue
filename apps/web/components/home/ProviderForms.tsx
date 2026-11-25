"use client";

import { useState } from "react";
import { errorText, homeApi, money, useLang, useLoad } from "../../lib/home";
import { Field, useAct } from "./HomeUi";
import s from "./home.module.css";

export interface ProviderDto {
  id: string;
  kind: string;
  status: string;
  displayName: string;
  reviewNote: string | null;
  city: string;
  locality: string | null;
  bio: string | null;
  instantEnabled: boolean;
  scheduledEnabled: boolean;
  paused: boolean;
  autoDispatch: boolean;
  manualApproval: boolean;
  travelFeePaise: number;
  minOrderPaise: number;
  maxTravelMinutes: number;
  travelMode: string;
  minStaffInSalon: number;
  maxHomeStaff: number;
  queueWaitingLimit: number;
  blockWeekends: boolean;
  blockedStart: string | null;
  blockedEnd: string | null;
  weekendSurchargePct: number;
  peakSurchargePct: number;
  peakStart: string | null;
  peakEnd: string | null;
  upiVpa: string | null;
  termsAcceptedAt: string | null;
  areas: { kind: string; value: string; radiusKm: number | null; excluded: boolean; surchargePaise: number; minOrderPaise: number }[];
  offerings: { id: string; pricePaise: number; productPaise: number; durationMinutes: number; active: boolean; salonServiceId: string | null; serviceDef: { code: string; name: string; nameHi: string } }[];
  professionals: { id: string; displayName: string; consentAt: string | null; active: boolean; dedicated: boolean; isOnline: boolean; suspendedAt: string | null; salonStaffId: string | null; services: { offeringId: string }[]; schedules: { dayOfWeek: number; startTime: string; endTime: string }[]; verifications: { id: string; scope: string; subject: string; status: string }[] }[];
  checklist: { items: { id: string; done: boolean; label: string }[]; ready: boolean };
}
interface Category { code: string; name: string; nameHi: string; services: { code: string; name: string; nameHi: string; durationMinutes: number }[] }
export interface Sources { services: { id: string; name: string; price: string; durationMinutes: number }[]; staff: { id: string; displayName: string; status: string; homeProfessional: { id: string; consentAt: string | null } | null }[]; products: { id: string; name: string; unit: string; stockOnHand: string }[] }

const num = (d: FormData, k: string) => Number(d.get(k) || 0);
const rupees = (d: FormData, k: string) => Math.round(num(d, k) * 100);

/** `root` = home/pro (independent) or dashboard/salons/:id/home (salon). Both use the same server rules. */
export function OfferingEditor({ root, p, sources, reload }: { root: string; p: ProviderDto; sources?: Sources | null; reload: () => void }) {
  const { lang } = useLang();
  const { data: cats } = useLoad<Category[]>("home/categories");
  const { act, busy, banner } = useAct(reload);
  const [code, setCode] = useState("");
  const def = cats?.flatMap((c) => c.services).find((x) => x.code === code);
  const existing = p.offerings.find((o) => o.serviceDef.code === code);
  return (
    <section className={s.section}>
      <h2 className={s.h2}>Home services and prices</h2>
      <p className={s.sub}>Home prices are separate. Changing them never changes your in-salon prices, and bookings already made keep the price the customer agreed.</p>
      {banner}
      {p.offerings.map((o) => {
        const inSalon = sources?.services.find((x) => x.id === o.salonServiceId);
        return (
          <div key={o.id} className={`${s.card}`}>
            <div className={s.between}><div><span className={s.strong}>{lang === "hi" ? o.serviceDef.nameHi : o.serviceDef.name}</span><br /><span className={s.meta}>{o.durationMinutes} min{inSalon ? ` · in-salon ${inSalon.name} ₹${inSalon.price} (unchanged)` : ""}</span></div><span className={s.price}>{money(o.pricePaise)}</span></div>
            <div className={s.row}><button className={`${s.ghost} ${s.small}`} onClick={() => setCode(o.serviceDef.code)}>Edit</button><button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => void act(() => homeApi(`${root}/offerings`, "PUT", { serviceCode: o.serviceDef.code, salonServiceId: o.salonServiceId, pricePaise: o.pricePaise, productPaise: o.productPaise, durationMinutes: o.durationMinutes, active: !o.active }), o.active ? "Switched off" : "Switched on")}>{o.active ? "Switch off" : "Switch on"}</button>{!o.active && <span className={`${s.badge} ${s.amber}`}>Off</span>}</div>
          </div>
        );
      })}
      <form key={code} className={s.card} onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        const product = d.get("product") as string;
        void act(() => homeApi(`${root}/offerings`, "PUT", { serviceCode: code, salonServiceId: (d.get("salonServiceId") as string) || null, pricePaise: rupees(d, "price"), productPaise: rupees(d, "products"), disposablePaise: rupees(d, "disposable"), durationMinutes: num(d, "minutes"), products: product && num(d, "qty") > 0 ? [{ productId: product, quantity: num(d, "qty") }] : [] }), "Saved").then((ok) => ok && setCode(""));
      }}>
        <div className={s.form}>
          <Field label="Service"><select className={s.input} value={code} onChange={(e) => setCode(e.target.value)} required><option value="">Choose…</option>{cats?.map((c) => <optgroup key={c.code} label={lang === "hi" ? c.nameHi : c.name}>{c.services.map((x) => <option key={x.code} value={x.code}>{lang === "hi" ? x.nameHi : x.name}</option>)}</optgroup>)}</select></Field>
          <Field label="Home price (₹)"><input className={s.input} name="price" type="number" min={1} step="1" required defaultValue={existing ? existing.pricePaise / 100 : undefined} /></Field>
          <Field label="Minutes"><input className={s.input} name="minutes" type="number" min={5} max={600} required defaultValue={existing?.durationMinutes ?? def?.durationMinutes ?? 30} /></Field>
          <Field label="Products charge (₹)"><input className={s.input} name="products" type="number" min={0} defaultValue={existing ? existing.productPaise / 100 : 0} /></Field>
          <Field label="Disposables charge (₹)"><input className={s.input} name="disposable" type="number" min={0} defaultValue={0} /></Field>
          {sources && <Field label="From in-salon service"><select className={s.input} name="salonServiceId" defaultValue={existing?.salonServiceId ?? ""}><option value="">Home-only service</option>{sources.services.map((x) => <option key={x.id} value={x.id}>{x.name} (₹{x.price} in salon)</option>)}</select></Field>}
          {sources && sources.products.length > 0 && <><Field label="Inventory used per service"><select className={s.input} name="product"><option value="">None</option>{sources.products.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.stockOnHand} {x.unit.toLowerCase()})</option>)}</select></Field><Field label="Quantity used"><input className={s.input} name="qty" type="number" min={0} step="0.001" defaultValue={0} /></Field></>}
        </div>
        <button className={`${s.btn} ${s.small}`} disabled={busy || !code}>Save service</button>
      </form>
    </section>
  );
}

export function AreaEditor({ root, p, reload }: { root: string; p: ProviderDto; reload: () => void }) {
  const { act, busy, banner } = useAct(reload);
  const save = (areas: ProviderDto["areas"]) => act(() => homeApi(`${root}/areas`, "PUT", { areas: areas.map(({ kind, value, radiusKm, excluded, surchargePaise, minOrderPaise }) => ({ kind, value, radiusKm, excluded, surchargePaise, minOrderPaise })) }), "Saved");
  return (
    <section className={s.section}>
      <h2 className={s.h2}>Service areas</h2>
      <p className={s.sub}>Radius is measured in a straight line from your base and only decides who may ask. Travel time is checked separately for every booking.</p>
      {banner}
      <div className={s.row}>{p.areas.map((a, i) => <span key={i} className={s.chip}>{a.excluded ? "Not: " : ""}{a.kind === "RADIUS" ? `${a.radiusKm} km` : a.value} <span className={s.meta}>{a.kind.toLowerCase()}{a.surchargePaise ? ` +${money(a.surchargePaise)}` : ""}</span> <button aria-label="Remove area" style={{ border: 0, background: "none", color: "inherit", cursor: "pointer" }} disabled={busy} onClick={() => void save(p.areas.filter((_, j) => j !== i))}>✕</button></span>)}</div>
      <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); const kind = d.get("kind") as string; const v = (d.get("value") as string).trim(); void save([...p.areas, { kind, value: kind === "RADIUS" ? "base" : v, radiusKm: kind === "RADIUS" ? Number(v) : null, excluded: d.get("excluded") === "on", surchargePaise: rupees(d, "surcharge"), minOrderPaise: rupees(d, "min") }]); e.currentTarget.reset(); }}>
        <div className={s.form}>
          <Field label="Type"><select className={s.input} name="kind"><option value="PINCODE">PIN code</option><option value="RADIUS">Radius (km)</option><option value="LOCALITY">Locality</option><option value="CITY">City</option><option value="SOCIETY">Society</option></select></Field>
          <Field label="Value"><input className={s.input} name="value" required maxLength={120} /></Field>
          <Field label="Extra travel charge (₹)"><input className={s.input} name="surcharge" type="number" min={0} defaultValue={0} /></Field>
          <Field label="Minimum booking (₹)"><input className={s.input} name="min" type="number" min={0} defaultValue={0} /></Field>
        </div>
        <label className={s.check}><input type="checkbox" name="excluded" /> Do not serve this place</label>
        <button className={`${s.btn} ${s.small}`} disabled={busy}>Add area</button>
      </form>
    </section>
  );
}

export function SettingsEditor({ root, p, reload }: { root: string; p: ProviderDto; reload: () => void }) {
  const { act, busy, banner, setMsg } = useAct(reload);
  const salon = p.kind === "SALON_MANAGED";
  const check = (name: keyof ProviderDto, label: string) => <label className={s.check}><input type="checkbox" name={name} defaultChecked={!!p[name]} /> {label}</label>;
  return (
    <form className={s.card} onSubmit={(e) => {
      e.preventDefault();
      const d = new FormData(e.currentTarget);
      const on = (k: string) => d.get(k) === "on";
      const body: Record<string, unknown> = { instantEnabled: on("instantEnabled"), scheduledEnabled: on("scheduledEnabled"), paused: on("paused"), travelFeePaise: rupees(d, "travel"), minOrderPaise: rupees(d, "min"), maxTravelMinutes: num(d, "maxTravel"), travelMode: d.get("mode"), weekendSurchargePct: num(d, "weekend"), peakSurchargePct: num(d, "peak"), peakStart: d.get("peakStart") || null, peakEnd: d.get("peakEnd") || null, upiVpa: d.get("upi") || null };
      if (salon) Object.assign(body, { autoDispatch: !on("manualApproval"), manualApproval: on("manualApproval"), minStaffInSalon: num(d, "minStaff"), maxHomeStaff: num(d, "maxHome"), queueWaitingLimit: num(d, "queue"), blockWeekends: on("blockWeekends"), blockedStart: d.get("blockedStart") || null, blockedEnd: d.get("blockedEnd") || null, compensation: { model: d.get("comp"), fixedPaise: rupees(d, "compFixed"), percent: num(d, "compPct"), travelAllowancePaise: rupees(d, "compTravel") } });
      void act(() => homeApi(`${root}/settings`, "PUT", body), "Saved");
    }}>
      <h2 className={s.h2}>Settings</h2>
      {banner}
      {check("instantEnabled", "Take “Book now” requests")}{check("scheduledEnabled", "Take scheduled bookings")}{check("paused", "Pause new home bookings")}
      <div className={s.form}>
        <Field label="Travel charge (₹)"><input className={s.input} name="travel" type="number" min={0} defaultValue={p.travelFeePaise / 100} /></Field>
        <Field label="Minimum booking (₹)"><input className={s.input} name="min" type="number" min={0} defaultValue={p.minOrderPaise / 100} /></Field>
        <Field label="Longest travel (minutes)"><input className={s.input} name="maxTravel" type="number" min={10} max={180} defaultValue={p.maxTravelMinutes} /></Field>
        <Field label="Travel by"><select className={s.input} name="mode" defaultValue={p.travelMode}><option value="TWO_WHEELER">Two-wheeler</option><option value="CAR">Car</option><option value="PUBLIC_TRANSPORT">Public transport</option><option value="BICYCLE">Bicycle</option><option value="WALK">Walk</option></select></Field>
        <Field label="Weekend charge (%)"><input className={s.input} name="weekend" type="number" min={0} max={50} defaultValue={p.weekendSurchargePct} /></Field>
        <Field label="Peak charge (%)"><input className={s.input} name="peak" type="number" min={0} max={50} defaultValue={p.peakSurchargePct} /></Field>
        <Field label="Peak from"><input className={s.input} name="peakStart" type="time" defaultValue={p.peakStart ?? ""} /></Field>
        <Field label="Peak to"><input className={s.input} name="peakEnd" type="time" defaultValue={p.peakEnd ?? ""} /></Field>
        <Field label="UPI ID for direct payment"><input className={s.input} name="upi" defaultValue={p.upiVpa ?? ""} placeholder="name@bank" /></Field>
      </div>
      {salon && (
        <>
          <h3 className={s.strong}>Protect the shop floor</h3>
          <p className={s.sub}>FastQue never relaxes these rules on its own.</p>
          <div className={s.form}>
            <Field label="Staff who must stay in the salon"><input className={s.input} name="minStaff" type="number" min={0} max={50} defaultValue={p.minStaffInSalon} /></Field>
            <Field label="Most staff out at once"><input className={s.input} name="maxHome" type="number" min={0} max={50} defaultValue={p.maxHomeStaff} /></Field>
            <Field label="Waiting customers per remaining barber"><input className={s.input} name="queue" type="number" min={0} max={50} defaultValue={p.queueWaitingLimit} /></Field>
            <Field label="No visits from"><input className={s.input} name="blockedStart" type="time" defaultValue={p.blockedStart ?? ""} /></Field>
            <Field label="No visits until"><input className={s.input} name="blockedEnd" type="time" defaultValue={p.blockedEnd ?? ""} /></Field>
          </div>
          {check("manualApproval", "I assign every booking myself")}{check("blockWeekends", "No home visits on weekends")}
          <h3 className={s.strong}>Staff compensation for home visits</h3>
          <p className={s.sub}>Used only in these home-service reports. Your payroll records are not changed.</p>
          <div className={s.form}>
            <Field label="Model"><select className={s.input} name="comp"><option value="FIXED_SALARY">Salary (no extra)</option><option value="FIXED_PER_VISIT">Fixed per visit</option><option value="PERCENT">Percentage</option></select></Field>
            <Field label="Fixed (₹)"><input className={s.input} name="compFixed" type="number" min={0} defaultValue={0} /></Field>
            <Field label="Percent"><input className={s.input} name="compPct" type="number" min={0} max={100} defaultValue={0} /></Field>
            <Field label="Travel allowance (₹)"><input className={s.input} name="compTravel" type="number" min={0} defaultValue={0} /></Field>
          </div>
        </>
      )}
      <div className={s.row}>
        <button className={`${s.btn} ${s.small}`} disabled={busy}>Save settings</button>
        {!salon && <button type="button" className={`${s.ghost} ${s.small}`} onClick={() => navigator.geolocation?.getCurrentPosition((g) => void act(() => homeApi(`${root}/settings`, "PUT", { baseLat: g.coords.latitude, baseLng: g.coords.longitude }), "Base saved privately"), () => setMsg({ ok: false, text: "Location permission was not given. Named areas (PIN codes) still work." }))}>Set my base from here (private)</button>}
      </div>
    </form>
  );
}

export function Checklist({ root, p, reload }: { root: string; p: ProviderDto; reload: () => void }) {
  const { act, busy, banner } = useAct(reload);
  return (
    <section className={s.card}>
      <div className={s.between}><h2 className={s.h2}>Getting started</h2><span className={`${s.badge} ${p.status === "APPROVED" ? s.green : p.status === "SUBMITTED" ? s.amber : ""}`}>{p.status.toLowerCase()}</span></div>
      {p.reviewNote && <p className={s.note}>FastQue: {p.reviewNote}</p>}
      {banner}
      <ul style={{ margin: 0, paddingLeft: 18 }}>{p.checklist.items.map((i) => <li key={i.id}>{i.done ? "✅" : "⬜"} {i.label}</li>)}</ul>
      {!p.termsAcceptedAt && <button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => { if (window.confirm("Provider terms: you are responsible for service quality, staff, products, hygiene, pricing, invoices, taxes and payment collection. You agree to show this profile to customers, to follow the cancellation policy, and that FastQue may review or suspend the profile. Do you accept?")) void act(() => homeApi(`${root}/terms`, "POST", { acceptTerms: true, publicProfileConsent: true, adult: true }), "Accepted"); }}>Read and accept provider terms</button>}
      {["DRAFT", "REJECTED"].includes(p.status) && <button className={`${s.btn} ${s.small}`} disabled={busy || !p.checklist.ready} onClick={() => void act(() => homeApi(`${root}/submit`, "POST", {}), "Sent for review")}>Submit for FastQue review</button>}
      {p.status === "SUBMITTED" && <p className={s.sub}>A FastQue reviewer will check this. You are not visible to customers yet.</p>}
    </section>
  );
}

export function Earnings({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return <div className={s.skeleton} />;
  const n = (k: string) => Number(data[k] ?? 0);
  if (data.salonManaged) return <p className={s.empty}>{n("visits")} completed visits. {String(data.note)}</p>;
  const rows = (data.rows ?? []) as { code: string; at: string; totalPaise: number; receivedPaise: number; paymentStatus: string }[];
  const people = (data.byProfessional ?? []) as { id: string; name: string; visits: number; totalPaise: number; payoutPaise: number }[];
  return (
    <section className={s.section}>
      <div className={s.grid}>{([["Completed visits", n("visits"), false], ["Total value", n("totalPaise"), true], ["Received", n("receivedPaise"), true], ["Outstanding", n("outstandingPaise"), true], ["Tips", n("tipPaise"), true], ["Travel", n("travelPaise"), true], ["Products", n("productPaise"), true], ["Discounts", n("discountPaise"), true], ["FastQue fees", n("platformFeePaise"), true], ["Staff payouts", n("staffPayoutPaise"), true], ["Product cost", n("productCostPaise"), true], ["Contribution", n("contributionPaise"), true]] as [string, number, boolean][]).map(([l, v, m]) => <div key={l} className={s.stat}><div className={s.statValue}>{m ? money(v) : v}</div><div className={s.meta}>{l}</div></div>)}</div>
      <p className={s.meta}>{String(data.note ?? "")}</p>
      {people.length > 1 && <div className={s.tableWrap}><table className={s.table}><thead><tr><th>Professional</th><th>Visits</th><th>Value</th><th>Payout</th></tr></thead><tbody>{people.map((x) => <tr key={x.id}><td>{x.name}</td><td>{x.visits}</td><td>{money(x.totalPaise)}</td><td>{money(x.payoutPaise)}</td></tr>)}</tbody></table></div>}
      {rows.length > 0 && <div className={s.tableWrap}><table className={s.table}><thead><tr><th>Booking</th><th>Date</th><th>Value</th><th>Received</th><th>Payment</th></tr></thead><tbody>{rows.map((r) => <tr key={r.code}><td>{r.code}</td><td>{new Date(r.at).toLocaleDateString("en-IN")}</td><td>{money(r.totalPaise)}</td><td>{money(r.receivedPaise)}</td><td>{r.paymentStatus.toLowerCase()}</td></tr>)}</tbody></table></div>}
    </section>
  );
}
export { errorText };
