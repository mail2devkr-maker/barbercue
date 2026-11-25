"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { homeApi, istDate, money, useLang, useLoad, when, type HomeBookingDto } from "../../lib/home";
import { Field, KindBadge, LangSwitch, Loading, useAct } from "./HomeUi";
import s from "./home.module.css";

const TABS = [["active", "Upcoming & active"], ["history", "History"], ["favourites", "Favourite professionals"], ["addresses", "Saved addresses"], ["recurring", "Repeat bookings"], ["privacy", "Privacy"]] as const;

export function AccountHome() {
  const router = useRouter();
  const tab = useSearchParams().get("tab") ?? "active";
  return (
    <div className={s.page} style={{ paddingInline: 0 }}>
      <div className={s.top}><div><h1 className={s.title}>Home services</h1><p className={s.sub}>Visits to your home. Salon appointments stay under My Appointments and product orders under Marketplace.</p></div><div className={s.row}><LangSwitch /><Link className={`${s.btn} ${s.small}`} href="/home-services">Book a home service</Link></div></div>
      <div className={s.tabs} role="tablist">{TABS.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} className={s.tab} onClick={() => router.replace(`/account/home-services?tab=${id}`)}>{l}</button>)}</div>
      {(tab === "active" || tab === "history") && <List key={tab} scope={tab} />}
      {tab === "favourites" && <Favourites />}
      {tab === "addresses" && <Addresses />}
      {tab === "recurring" && <Recurring />}
      {tab === "privacy" && <Privacy />}
    </div>
  );
}

function List({ scope }: { scope: string }) {
  const { status: label } = useLang();
  const [page, setPage] = useState(1);
  const { data, error } = useLoad<{ total: number; items: HomeBookingDto[] }>(`home/me/bookings?scope=${scope}&page=${page}`);
  const { data: tips } = useLoad<{ service: string; typicalDays: number; nextAround: string; basis: string }[]>(scope === "active" ? "home/me/suggestions" : null);
  if (!data) return <Loading error={error} />;
  return (
    <section className={s.section}>
      {data.items.length === 0 && <p className={s.empty}>No home services here.</p>}
      {data.items.map((b) => <Link key={b.code} href={`/home-services/tracking/${b.code}`} className={s.card}><div className={s.between}><span className={s.strong}>{label(b.status)}</span><span className={s.price}>{money(b.totalPaise)}</span></div><span>{b.items.map((i) => i.name).join(", ")} · {when(b.serviceStart)}</span><KindBadge kind={b.provider.kind} label={b.provider.label} />{b.professional && <span className={s.meta}>{b.professional.name}</span>}</Link>)}
      {data.total > 20 && <div className={s.row}><button className={`${s.ghost} ${s.small}`} disabled={page <= 1} onClick={() => setPage(page - 1)}>Back</button><button className={`${s.ghost} ${s.small}`} disabled={page * 20 >= data.total} onClick={() => setPage(page + 1)}>Next</button></div>}
      {tips && tips.length > 0 && <div className={s.card}><h2 className={s.h2}>Time for another?</h2>{tips.map((x) => <span key={x.service} className={s.sub}>{x.service}: you usually book about every {x.typicalDays} days ({x.basis}); next around {when(x.nextAround)}</span>)}</div>}
    </section>
  );
}
function Favourites() {
  const { data, error, reload } = useLoad<{ professionalId: string; professional: { id: string; displayName: string; active: boolean; provider: { displayName: string; kind: string } } }[]>("home/me/favorites");
  const { act, banner } = useAct(reload);
  if (!data) return <Loading error={error} />;
  return <section className={s.section}>{banner}{data.length === 0 && <p className={s.empty}>No favourites yet.</p>}<div className={s.grid}>{data.map((f) => <div key={f.professionalId} className={s.card}><Link className={s.strong} href={`/home-services/professionals/${f.professionalId}`}>{f.professional.displayName}</Link><span className={s.meta}>{f.professional.provider.displayName}</span><button className={`${s.ghost} ${s.small}`} onClick={() => void act(() => homeApi(`home/me/favorites/${f.professionalId}`, "DELETE"), "Removed")}>Remove</button></div>)}</div></section>;
}
interface Addr { id: string; label: string; house: string; building: string | null; street: string | null; locality: string; landmark: string | null; city: string; state: string; postalCode: string }
function Addresses() {
  const { t } = useLang();
  const { data, error, reload } = useLoad<Addr[]>("home/me/addresses");
  const { act, busy, banner } = useAct(reload);
  if (!data) return <Loading error={error} />;
  return (
    <section className={s.section}>
      {banner}
      {data.map((a) => <div key={a.id} className={`${s.card} ${s.between}`}><span><b>{a.label}</b><br />{[a.house, a.building, a.street, a.locality, a.landmark, a.city, a.postalCode].filter(Boolean).join(", ")}</span><button className={`${s.danger} ${s.small}`} disabled={busy} onClick={() => void act(() => homeApi(`home/me/addresses/${a.id}`, "DELETE"), "Removed")}>{t("remove")}</button></div>)}
      <form className={s.card} onSubmit={(e) => { e.preventDefault(); const el = e.currentTarget; const d = Object.fromEntries([...new FormData(el)].filter(([, v]) => v)); void act(() => homeApi("home/me/addresses", "POST", d), "Saved").then((ok) => ok && el.reset()); }}>
        <div className={s.form}><Field label="Type"><select className={s.input} name="label"><option>HOME</option><option>WORK</option><option>OTHER</option></select></Field>{([["house", "house"], ["building", "building"], ["street", "street"], ["locality", "locality"], ["landmark", "landmark"], ["city", "city"], ["state", "state"], ["postalCode", "pincode"], ["accessNotes", "access"]] as const).map(([k, l]) => <Field key={k} label={t(l)}><input className={s.input} name={k} required={["house", "locality", "city", "state", "postalCode"].includes(k)} /></Field>)}</div>
        <button className={`${s.btn} ${s.small}`} disabled={busy}>{t("save")}</button>
      </form>
    </section>
  );
}
function Recurring() {
  const { data, error, reload } = useLoad<{ id: string; intervalDays: number; nextStart: string; status: string; lastOutcome: string | null; professional: { displayName: string }; bookings: { code: string; status: string }[] }[]>("home/me/recurring");
  const { data: addresses } = useLoad<Addr[]>("home/me/addresses");
  const { data: favs } = useLoad<{ professionalId: string; professional: { displayName: string } }[]>("home/me/favorites");
  const { data: cats } = useLoad<{ services: { code: string; name: string }[] }[]>("home/categories");
  const { act, busy, banner } = useAct(reload);
  if (!data) return <Loading error={error} />;
  return (
    <section className={s.section}>
      <p className={s.sub}>Each visit is requested only if the same professional is really free. If not, nothing is booked and you are told; nobody else is sent.</p>
      {banner}
      {data.map((p) => <div key={p.id} className={s.card}><span className={s.strong}>{p.professional.displayName} · every {p.intervalDays} days</span><span className={s.meta}>{p.status.toLowerCase()} · next {when(p.nextStart)}{p.lastOutcome ? ` · ${p.lastOutcome}` : ""}</span>{p.status !== "CANCELLED" && <div className={s.row}><button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => void act(() => homeApi(`home/me/recurring/${p.id}`, "PUT", { status: p.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }))}>{p.status === "ACTIVE" ? "Pause" : "Resume"}</button><button className={`${s.danger} ${s.small}`} disabled={busy} onClick={() => void act(() => homeApi(`home/me/recurring/${p.id}`, "PUT", { status: "CANCELLED" }))}>Cancel</button></div>}</div>)}
      {favs?.length && addresses?.length ? (
        <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void act(() => homeApi("home/me/recurring", "POST", { professionalId: d.get("pro"), addressId: d.get("addr"), items: [{ serviceCode: d.get("svc"), quantity: 1 }], intervalDays: Number(d.get("days")), firstStart: new Date(`${d.get("date") as string}T${d.get("time") as string}:00+05:30`).toISOString(), paymentMethod: "CASH" }), "Repeat booking created"); }}>
          <div className={s.form}><Field label="Favourite professional"><select className={s.input} name="pro">{favs.map((f) => <option key={f.professionalId} value={f.professionalId}>{f.professional.displayName}</option>)}</select></Field><Field label="Service"><select className={s.input} name="svc">{cats?.flatMap((c) => c.services).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field><Field label="Address"><select className={s.input} name="addr">{addresses.map((a) => <option key={a.id} value={a.id}>{a.label}: {a.house}</option>)}</select></Field><Field label="Repeat"><select className={s.input} name="days"><option value="7">Weekly</option><option value="14">Every 2 weeks</option><option value="21">Every 3 weeks</option><option value="30">Monthly</option></select></Field><Field label="First date"><input className={s.input} type="date" name="date" min={istDate(1)} required /></Field><Field label="Time (IST)"><input className={s.input} type="time" name="time" required /></Field></div>
          <button className={`${s.btn} ${s.small}`} disabled={busy}>Create</button>
        </form>
      ) : <p className={s.empty}>Save a favourite professional and an address to set up repeat bookings.</p>}
    </section>
  );
}
function Privacy() {
  const { act, busy, banner } = useAct();
  return <section className={s.card}>{banner}<p className={s.sub}>Download your home-service data, or remove saved addresses, favourites and repeat plans. Booking and payment history is kept for legal and dispute reasons.</p><div className={s.row}><button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => void act(async () => { const d = await homeApi<unknown>("home/me/export"); const u = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = u; a.download = "fastque-home-my-data.json"; a.click(); URL.revokeObjectURL(u); }, "Downloaded")}>Download my data</button><button className={`${s.danger} ${s.small}`} disabled={busy} onClick={() => { if (window.confirm("Remove saved home-service data? This cannot be undone.")) void act(() => homeApi("home/me/data", "DELETE"), "Removed"); }}>Remove my saved data</button></div></section>;
}
