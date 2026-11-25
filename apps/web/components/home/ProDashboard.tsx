"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { HOME_HYGIENE_CHECKLIST, HOME_INCIDENT_KINDS, HOME_VERIFICATION_SCOPES } from "@barbercue/shared";
import { useAuth } from "../../lib/auth-context";
import { apiFetch } from "../../lib/api";
import { homeApi, istDate, money, newKey, time, useLang, useLoad, when, type HomeBookingDto } from "../../lib/home";
import { askText, Field, LangSwitch, Loading, Stat, useAct } from "./HomeUi";
import { AreaEditor, Checklist, Earnings, OfferingEditor, SettingsEditor, type ProviderDto } from "./ProviderForms";
import s from "./home.module.css";

interface Profile { id: string; displayName: string; consentAt: string | null; isOnline: boolean; suspendedAt: string | null; trustedContact: string | null; provider: { id: string; kind: string; displayName: string; status: string; instantEnabled: boolean }; schedules: { dayOfWeek: number; startTime: string; endTime: string }[]; verifications: { id: string; scope: string; subject: string; status: string; reviewNote: string | null }[]; services: { offering: { serviceDef: { name: string; nameHi: string } } }[] }
interface Req { id: string; code: string; provider: { displayName: string; kind: string }; services: { name: string; quantity: number; minutes: number }[]; locality: string; city: string; postalCode: string; serviceStart: string; serviceEnd: string; leaveBy: string | null; totalPaise: number; forChild: boolean; expiresAt: string }
interface Cal { id: string; kind: string; startAt: string; endAt: string; serviceStart: string | null; note: string | null; booking: { code: string; status: string } | null }
const TABS = ["home", "requests", "active", "upcoming", "availability", "services", "earnings", "reviews", "settings", "safety"] as const;
type Tab = (typeof TABS)[number];
const ACTIVE = ["PREPARING", "ON_THE_WAY", "ARRIVED", "CHECKED_IN", "IN_PROGRESS", "ADDRESS_ISSUE", "INTERRUPTED", "REPLACEMENT_REQUESTED"];
const words = (v: string) => v.toLowerCase().replace(/_/g, " ");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ProDashboard() {
  const { status } = useAuth();
  const { t } = useLang();
  const params = useSearchParams();
  const router = useRouter();
  const tab: Tab = TABS.includes(params.get("tab") as Tab) ? (params.get("tab") as Tab) : "home";
  const signed = status === "authenticated";
  const { data, error, reload } = useLoad<{ profiles: Profile[]; independent: ProviderDto | null }>(signed ? "home/pro/profile" : null);
  const { data: reqs, reload: reloadReqs } = useLoad<Req[]>(signed ? "home/pro/requests" : null);
  const { data: list, reload: reloadList } = useLoad<{ items: HomeBookingDto[] }>(signed ? "home/pro/bookings?scope=active" : null);
  const refresh = () => { reload(); reloadReqs(); reloadList(); };
  useEffect(() => {
    if (!signed) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") { reloadReqs(); reloadList(); } }, 20_000);
    return () => clearInterval(id);
  }, [signed, reloadReqs, reloadList]);
  if (status === "unauthenticated") return <main className={`${s.page} ${s.narrow}`}><div className={s.top}><h1 className={s.title}>FastQue Home for professionals</h1><LangSwitch /></div><p className={s.empty}>Sign in with your FastQue account. Salon staff use their salon sign-in; no second account is needed.<br /><Link href="/login?next=/home-pro">Sign in</Link> · <Link href="/staff/login?next=/home-pro">Salon staff sign-in</Link></p></main>;
  if (!data) return <main className={s.page}><Loading error={error} /></main>;
  if (data.profiles.length === 0) return <Register reload={reload} />;
  const labels: Record<Tab, string> = { home: "Home", requests: `${t("requests")}${reqs?.length ? ` (${reqs.length})` : ""}`, active: t("active"), upcoming: t("upcoming"), availability: t("availability"), services: "Services & area", earnings: t("earnings"), reviews: t("reviews"), settings: t("settings"), safety: "Safety & support" };
  const active = list?.items.filter((b) => ACTIVE.includes(b.status)) ?? [];
  const upcoming = list?.items.filter((b) => !ACTIVE.includes(b.status)) ?? [];
  return (
    <main className={`${s.page} ${s.narrow}`}>
      <div className={s.top}><h1 className={s.title}>FastQue Home</h1><LangSwitch /></div>
      <div className={s.tabs} role="tablist">{TABS.map((x) => <button key={x} role="tab" aria-selected={tab === x} className={s.tab} onClick={() => router.replace(`/home-pro?tab=${x}`)}>{labels[x]}</button>)}</div>
      {(tab === "home" || tab === "settings") && data.profiles.map((p) => <ProfileCard key={p.id} p={p} reload={refresh} />)}
      {tab === "home" && <><HomeStats upcoming={upcoming} active={active} />{active[0] && <Visit b={active[0]} reload={refresh} />}{!active[0] && upcoming[0] && <Visit b={upcoming[0]} reload={refresh} />}</>}
      {tab === "requests" && (reqs?.length ? reqs.map((r) => <Request key={r.id} r={r} reload={refresh} />) : <p className={s.empty}>No requests now. You can decline any request; it never lowers your rating.</p>)}
      {tab === "active" && (active.length ? active.map((b) => <Visit key={b.code} b={b} reload={refresh} />) : <p className={s.empty}>No active visit.</p>)}
      {tab === "upcoming" && (upcoming.length ? upcoming.map((b) => <Visit key={b.code} b={b} reload={refresh} />) : <p className={s.empty}>Nothing booked.</p>)}
      {tab === "availability" && <Availability profiles={data.profiles} reload={reload} />}
      {tab === "services" && (data.independent ? <><Checklist root="home/pro" p={data.independent} reload={reload} /><OfferingEditor root="home/pro" p={data.independent} reload={reload} /><AreaEditor root="home/pro" p={data.independent} reload={reload} /></> : <p className={s.empty}>Your salon manages services, prices and areas. You do: {data.profiles.flatMap((p) => p.services.map((x) => x.offering.serviceDef.name)).join(", ") || "nothing assigned yet"}.</p>)}
      {tab === "earnings" && <EarningsTab />}
      {tab === "reviews" && <Reviews />}
      {tab === "settings" && data.independent && <SettingsEditor root="home/pro" p={data.independent} reload={reload} />}
      {tab === "settings" && data.profiles.map((p) => <Verifications key={p.id} p={p} reload={reload} />)}
      {tab === "settings" && !data.independent && <Register reload={reload} inline />}
      {tab === "safety" && <Safety profiles={data.profiles} reload={reload} />}
    </main>
  );
}

function Register({ reload, inline }: { reload: () => void; inline?: boolean }) {
  const { t } = useLang();
  const { data: config } = useLoad<{ flags: Record<string, boolean> }>("home/config");
  const { data: pre } = useLoad<{ displayName: string | null; city: string | null; locality: string | null; languages: string[]; skills: string[]; bio: string | null; reusedFrom: string[]; yearsExperience: number | null }>("home/pro/prefill");
  const { act, busy, banner } = useAct(reload);
  const on = config?.flags.FREELANCER_HOME_SERVICES_ENABLED;
  const body = !config || !pre ? <Loading /> : !on ? <p className={s.empty}>Independent registration is not open yet.</p> : (
    <form className={s.card} onSubmit={(e) => {
      e.preventDefault();
      const d = new FormData(e.currentTarget);
      const list = (k: string) => ((d.get(k) as string) || "").split(",").map((x) => x.trim()).filter(Boolean);
      const o = (k: string) => (d.get(k) ? { [k]: d.get(k) } : {});
      void act(() => homeApi("home/pro/register", "POST", { displayName: d.get("displayName"), city: d.get("city"), category: d.get("category"), ...o("locality"), ...o("bio"), ...o("emergencyName"), ...o("emergencyPhone"), skills: list("skills"), languages: list("languages"), equipment: list("equipment"), productsCarried: list("productsCarried"), travelMode: d.get("travelMode"), ...(d.get("years") ? { yearsExperience: Number(d.get("years")) } : {}), adult: d.get("adult") === "on", channelConsent: d.get("consent") === "on" }), "Registered");
    }}>
      <h2 className={s.h2}>{t("register")}</h2>
      {pre.reusedFrom.length > 0 && <p className={s.ok}>We filled what we could from your {pre.reusedFrom.join(" and ")}. It stays the same account.</p>}
      {banner}
      <div className={s.form}>
        <Field label={t("fullName")}><input className={s.input} name="displayName" required defaultValue={pre.displayName ?? ""} maxLength={120} /></Field>
        <Field label="Category / श्रेणी"><select className={s.input} name="category">{["BARBER", "HAIR_STYLIST", "BEAUTICIAN", "MAKEUP_ARTIST", "BRIDAL_MAKEUP", "NAIL_TECHNICIAN", "SPA", "HAIR_COLOR", "OTHER"].map((c) => <option key={c} value={c}>{words(c)}</option>)}</select></Field>
        <Field label={t("city")}><input className={s.input} name="city" required defaultValue={pre.city ?? ""} /></Field>
        <Field label={t("locality")}><input className={s.input} name="locality" defaultValue={pre.locality ?? ""} /></Field>
        <Field label="Skills / हुनर (comma separated)"><input className={s.input} name="skills" defaultValue={pre.skills.join(", ")} /></Field>
        <Field label="Languages / भाषाएँ"><input className={s.input} name="languages" defaultValue={pre.languages.join(", ")} /></Field>
        <Field label="Years of experience / अनुभव (वर्ष)"><input className={s.input} name="years" type="number" min={0} max={60} defaultValue={pre.yearsExperience ?? ""} /></Field>
        <Field label="Travel by / यात्रा"><select className={s.input} name="travelMode"><option value="TWO_WHEELER">Two-wheeler</option><option value="CAR">Car</option><option value="PUBLIC_TRANSPORT">Public transport</option><option value="BICYCLE">Bicycle</option><option value="WALK">Walk</option></select></Field>
        <Field label="Equipment / उपकरण"><input className={s.input} name="equipment" /></Field>
        <Field label="Products carried / उत्पाद"><input className={s.input} name="productsCarried" /></Field>
        <Field label="Emergency contact name / आपातकालीन संपर्क"><input className={s.input} name="emergencyName" /></Field>
        <Field label="Emergency contact phone"><input className={s.input} name="emergencyPhone" placeholder="+919812345678" /></Field>
      </div>
      <Field label="About you / अपने बारे में"><textarea className={s.input} name="bio" rows={3} maxLength={1000} defaultValue={pre.bio ?? ""} /></Field>
      <label className={s.check}><input type="checkbox" name="adult" required /> {t("adult")}</label>
      <label className={s.check}><input type="checkbox" name="consent" required /> {t("consent")}</label>
      <p className={s.meta}>We do not ask for Aadhaar. Your phone, address and documents are never shown to customers. You can withdraw any time.</p>
      <button className={s.btn} disabled={busy}>{t("submit")}</button>
    </form>
  );
  return inline ? body : <main className={`${s.page} ${s.narrow}`}><div className={s.top}><h1 className={s.title}>FastQue Home for professionals</h1><LangSwitch /></div>{body}</main>;
}

function ProfileCard({ p, reload }: { p: Profile; reload: () => void }) {
  const { t } = useLang();
  const { act, busy, banner } = useAct(reload);
  return (
    <section className={s.card}>
      <div className={s.between}><div><span className={s.strong}>{p.displayName}</span><br /><span className={s.meta}>{p.provider.kind === "SALON_MANAGED" ? `Salon professional – ${p.provider.displayName}` : "Independent FastQue Professional"} · {words(p.provider.status)}</span></div><span className={`${s.badge} ${p.isOnline ? s.green : ""}`}>{p.isOnline ? "Online" : "Offline"}</span></div>
      {banner}
      {!p.consentAt ? (
        <><p className={s.note}>{p.provider.displayName} would like to offer you for home visits. Nothing is shown to customers unless you agree.</p><button className={s.btn} disabled={busy} onClick={() => void act(() => homeApi(`home/pro/profiles/${p.id}/consent`, "POST", { consent: true }), "Thank you")}>{t("consent")}</button></>
      ) : (
        <div className={s.row}>
          <button className={p.isOnline ? s.ghost : s.btn} disabled={busy || p.provider.status !== "APPROVED"} onClick={() => void act(() => homeApi(`home/pro/profiles/${p.id}/online`, "POST", { online: !p.isOnline }), p.isOnline ? "Offline. Accepted bookings stay." : "You are online")}>{p.isOnline ? t("goOffline") : t("goOnline")}</button>
          <button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => { if (window.confirm("Hide this profile and stop new home requests? Accepted visits stay.")) void act(() => homeApi(`home/pro/profiles/${p.id}/consent`, "POST", { consent: false }), "Hidden"); }}>Withdraw consent</button>
        </div>
      )}
    </section>
  );
}

function HomeStats({ upcoming, active }: { upcoming: HomeBookingDto[]; active: HomeBookingDto[] }) {
  const [range] = useState(() => ({ from: new Date(Date.now() - 7 * 86_400_000).toISOString(), to: new Date(Date.now() + 86_400_000).toISOString() }));
  const { data } = useLoad<{ totalPaise?: number; outstandingPaise?: number; visits: number }>(`home/pro/earnings?from=${range.from}&to=${range.to}`);
  const today = [...upcoming, ...active].filter((b) => new Date(new Date(b.serviceStart).getTime() + 330 * 60_000).toISOString().slice(0, 10) === istDate(0)).length;
  return <div className={s.grid}><Stat label="Visits today" value={today} /><Stat label="Upcoming" value={upcoming.length} /><Stat label="Completed this week" value={data?.visits} />{data?.totalPaise != null && <Stat label="Value this week" value={money(data.totalPaise)} />}{data?.outstandingPaise != null && <Stat label="Outstanding payments" value={money(data.outstandingPaise)} />}</div>;
}

function Request({ r, reload }: { r: Req; reload: () => void }) {
  const { t } = useLang();
  const { act, busy, banner } = useAct(reload);
  return (
    <section className={s.card}>
      <div className={s.between}><span className={s.strong}>{r.services.map((x) => `${x.name}${x.quantity > 1 ? ` × ${x.quantity}` : ""}`).join(", ")}</span><span className={s.price}>{money(r.totalPaise)}</span></div>
      <span>{when(r.serviceStart)} – {time(r.serviceEnd)} · {r.locality}, {r.city} {r.postalCode}</span>
      {r.leaveBy && <span className={s.meta}>Start getting ready by about {time(r.leaveBy)}</span>}
      {r.forChild && <span className={`${s.badge} ${s.amber}`}>For a child – guardian will be present</span>}
      <span className={s.meta}>{r.provider.displayName} · respond by {time(r.expiresAt)}. The full address appears after you accept.</span>
      {banner}
      <div className={s.row}><button className={s.btn} disabled={busy} onClick={() => void act(() => homeApi(`home/pro/requests/${r.id}/accept`, "POST", {}), "Accepted")}>{t("accept")}</button><button className={s.ghost} disabled={busy} onClick={() => void act(() => homeApi(`home/pro/requests/${r.id}/decline`, "POST", {}), "Declined")}>{t("decline")}</button></div>
    </section>
  );
}

function Visit({ b, reload }: { b: HomeBookingDto; reload: () => void }) {
  const { t, status: label, lang } = useLang();
  const { act, busy, banner, setMsg } = useAct(reload);
  const [code, setCode] = useState("");
  const [sharing, setSharing] = useState(false);
  const watch = useRef<number | null>(null);
  const [payKey, setPayKey] = useState(() => newKey());
  const go = (a: string, body: unknown = {}, ok?: string) => act(() => homeApi(`home/pro/bookings/${b.code}/${a}`, "POST", body), ok);
  const f = b.address.full;
  useEffect(() => () => { if (watch.current != null) navigator.geolocation.clearWatch(watch.current); }, []);
  useEffect(() => {
    if (b.status !== "ON_THE_WAY" && watch.current != null) {
      navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
    }
  }, [b.status]);
  function share() {
    if (!window.confirm("Share your location with this customer until you arrive? It works only while this page is open. You can stop any time.")) return;
    void act(async () => {
      const r = await homeApi<{ sharing: boolean; reason?: string }>(`home/pro/bookings/${b.code}/tracking-start`, "POST", { consent: true });
      if (!r.sharing) throw new Error("Live location is switched off. The customer sees status updates.");
      let last = 0;
      watch.current = navigator.geolocation.watchPosition(
        (g) => {
          if (Date.now() - last < 15_000) return;
          last = Date.now();
          void homeApi(`home/pro/bookings/${b.code}/location`, "PUT", { lat: g.coords.latitude, lng: g.coords.longitude, accuracy: g.coords.accuracy }).catch(() => undefined);
        },
        () => {
          setSharing(false);
          setMsg({ ok: false, text: "Location permission was not given. The customer still sees your status updates." });
          void homeApi(`home/pro/bookings/${b.code}/tracking-stop`, "POST", {}).catch(() => undefined);
        },
        { enableHighAccuracy: true },
      );
      setSharing(true);
    }, "Sharing while this page is open");
  }
  return (
    <section className={s.card}>
      <div className={s.between}><span className={s.strong}>{label(b.status)}</span><span className={s.price}>{money(b.totalPaise)}</span></div>
      <span>{when(b.serviceStart)} – {time(b.serviceEnd)} · {b.code}</span>
      <span>{b.items.map((i) => `${i.name}${i.quantity > 1 ? ` × ${i.quantity}` : ""}`).join(", ")}</span>
      {f ? <p className={s.sub}><b>{[f.house, f.building, f.street, b.address.locality, f.landmark, b.address.city, b.address.postalCode].filter(Boolean).join(", ")}</b>{f.accessNotes ? <><br />{f.accessNotes}</> : null}<br />{b.customer?.name} {b.customer?.phone && <a href={`tel:${b.customer.phone}`}>{b.customer.phone}</a>}</p> : <p className={s.meta}>{b.address.locality}, {b.address.city}</p>}
      {b.notes && <p className={s.note}>{b.notes}</p>}
      {b.items.filter((i) => i.safety).map((i) => <p key={i.id} className={s.note}>{i.safety}</p>)}
      {banner}
      <div className={s.row}>
        {f && <a className={`${s.ghost} ${s.small}`} target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(f.lat != null ? `${f.lat},${f.lng}` : [f.house, f.building, b.address.locality, b.address.city, b.address.postalCode].filter(Boolean).join(", "))}`}>Navigate ↗</a>}
        {b.status === "CONFIRMED" && <button className={`${s.btn} ${s.small}`} disabled={busy} onClick={() => void go("prepare")}>{t("prepare")}</button>}
        {["CONFIRMED", "PREPARING", "ADDRESS_ISSUE"].includes(b.status) && <button className={`${s.btn} ${s.small}`} disabled={busy} onClick={() => void go("on-the-way")}>{t("onTheWay")}</button>}
        {["ON_THE_WAY", "ADDRESS_ISSUE"].includes(b.status) && <button className={`${s.btn} ${s.small}`} disabled={busy} onClick={() => void go("arrived")}>{t("arrived")}</button>}
        {b.status === "ON_THE_WAY" && (sharing ? <button className={`${s.ghost} ${s.small}`} onClick={() => { if (watch.current != null) navigator.geolocation.clearWatch(watch.current); setSharing(false); void go("tracking-stop", {}, "Stopped sharing"); }}>Stop sharing location</button> : <button className={`${s.ghost} ${s.small}`} onClick={share}>Share location</button>)}
        {["CONFIRMED", "PREPARING", "ON_THE_WAY", "IN_PROGRESS"].includes(b.status) && <button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => { const m = Number(window.prompt("How many minutes late?", "15")); if (m >= 5) void go("delay", { minutes: Math.min(180, Math.round(m)) }, "Customer informed"); }}>Running late</button>}
        {b.status === "ON_THE_WAY" && <button className={`${s.ghost} ${s.small}`} onClick={() => { const reason = askText("What is the problem with the address?"); if (reason) void go("address-issue", { reason }); }}>Address problem</button>}
      </div>
      {b.status === "ARRIVED" && (
        <div className={s.row}>
          <input className={s.input} style={{ maxWidth: 200 }} inputMode="numeric" placeholder={t("enterCode")} aria-label={t("enterCode")} value={code} onChange={(e) => setCode(e.target.value)} />
          <button className={`${s.btn} ${s.small}`} disabled={busy || code.length < 4} onClick={() => void go("check-in", { code })}>{t("verify")}</button>
          <button className={`${s.ghost} ${s.small}`} onClick={() => { const reason = askText("Confirm nobody is available, and what you tried:"); if (reason) void go("customer-no-show", { reason }); }}>Customer not available</button>
        </div>
      )}
      {["ARRIVED", "CHECKED_IN"].includes(b.status) && <Hygiene stage="BEFORE" lang={lang} done={b.hygiene.find((h) => h.stage === "BEFORE")?.complete} onSave={(answers) => void go("hygiene", { stage: "BEFORE", answers }, "Checklist saved")} />}
      {b.status === "CHECKED_IN" && <button className={s.btn} disabled={busy} onClick={() => void go("start")}>{t("start")}</button>}
      {b.status === "IN_PROGRESS" && (
        <>
          <Hygiene stage="AFTER" lang={lang} done={b.hygiene.find((h) => h.stage === "AFTER")?.complete} onSave={(answers) => void go("hygiene", { stage: "AFTER", answers }, "Checklist saved")} />
          <form className={s.row} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void go("extras", { description: d.get("what"), amountPaise: Math.round(Number(d.get("amount")) * 100), minutes: Number(d.get("minutes") || 0) }, "Sent to the customer for approval"); e.currentTarget.reset(); }}>
            <input className={`${s.input} ${s.grow}`} name="what" placeholder="Extra service" required maxLength={200} aria-label="Extra service" /><input className={s.input} style={{ maxWidth: 100 }} name="amount" type="number" min={1} placeholder="₹" required aria-label="Amount" /><input className={s.input} style={{ maxWidth: 90 }} name="minutes" type="number" min={0} max={240} placeholder="min" aria-label="Minutes" /><button className={`${s.ghost} ${s.small}`} disabled={busy}>Ask customer</button>
          </form>
          <button className={s.btn} disabled={busy} onClick={() => void go("complete", {}, "Completed")}>{t("complete")}</button>
        </>
      )}
      {b.adjustments.map((x) => <span key={x.id} className={s.meta}>{x.description}: {money(x.amountPaise)} – {words(x.status)}</span>)}
      {b.status === "RESCHEDULE_REQUESTED" && b.rescheduleTo && <div className={s.row}><span className={s.grow}>New time: <b>{when(b.rescheduleTo)}</b></span><button className={`${s.btn} ${s.small}`} disabled={busy} onClick={() => void go("reschedule-answer", { approve: true })}>{t("accept")}</button><button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => void go("reschedule-answer", { approve: false })}>{t("decline")}</button></div>}
      {b.status === "PAYMENT_PENDING" && (
        <form className={s.row} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void act(() => homeApi(`home/pro/bookings/${b.code}/payment`, "POST", { method: d.get("method"), amountPaise: Math.round(Number(d.get("amount")) * 100), tipPaise: Math.round(Number(d.get("tip") || 0) * 100) }, { idempotent: payKey }), "Payment recorded").then((ok) => ok && setPayKey(newKey())); }}>
          <select className={s.input} name="method" style={{ maxWidth: 150 }} aria-label="Method"><option value="CASH">Cash</option><option value="DIRECT_UPI">UPI (direct)</option><option value="OTHER_OFFLINE">Other</option></select>
          <input className={s.input} style={{ maxWidth: 120 }} name="amount" type="number" step="0.01" min={1} defaultValue={b.duePaise / 100} aria-label="Amount received" /><input className={s.input} style={{ maxWidth: 90 }} name="tip" type="number" min={0} placeholder="Tip ₹" aria-label="Tip" />
          <button className={`${s.btn} ${s.small}`} disabled={busy}>{t("recordPayment")}</button>
        </form>
      )}
      <div className={s.row}>
        {["CONFIRMED", "PREPARING", "ON_THE_WAY"].includes(b.status) && <><button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => { const reason = askText("Why can you not come? The customer will be asked before anyone else is sent."); if (reason) void go("cannot-come", { reason }); }}>I cannot come</button><button className={`${s.danger} ${s.small}`} disabled={busy} onClick={() => { const reason = askText("Cancel this booking? Please give a reason."); if (reason) void go("cancel", { reason }); }}>{t("cancel")}</button></>}
        {["ARRIVED", "CHECKED_IN", "IN_PROGRESS"].includes(b.status) && <button className={`${s.danger} ${s.small}`} onClick={() => { const reason = askText("Stop the visit – what happened? You may always leave an unsafe situation."); if (reason) void go("interrupt", { reason }); }}>Stop – unsafe or interrupted</button>}
        <button className={`${s.danger} ${s.small}`} onClick={() => { const description = askText("In danger call 112 first. Describe the safety concern:", 5); if (description) void go("incident", { kind: "OTHER", description }, "Reported to FastQue staff. In danger, call 112."); }}>{t("safety")}</button>
      </div>
    </section>
  );
}

function Hygiene({ stage, lang, done, onSave }: { stage: "BEFORE" | "AFTER"; lang: "en" | "hi"; done?: boolean; onSave: (a: Record<string, boolean>) => void }) {
  const [a, setA] = useState<Record<string, boolean>>({});
  if (done) return <span className={`${s.badge} ${s.green}`}>✓ Hygiene checklist ({stage.toLowerCase()})</span>;
  return <details className={s.card}><summary className={s.strong}>Hygiene checklist – {stage.toLowerCase()}</summary>{HOME_HYGIENE_CHECKLIST[stage].map((i) => <label key={i.id} className={s.check}><input type="checkbox" checked={!!a[i.id]} onChange={(e) => setA({ ...a, [i.id]: e.target.checked })} /> {i[lang]}</label>)}<button className={`${s.ghost} ${s.small}`} onClick={() => onSave(a)}>Save checklist</button></details>;
}

function Availability({ profiles, reload }: { profiles: Profile[]; reload: () => void }) {
  const [range] = useState(() => ({ from: new Date().toISOString(), to: new Date(Date.now() + 30 * 86_400_000).toISOString() }));
  const { data: cal, reload: reloadCal } = useLoad<Cal[]>(`home/pro/calendar?from=${range.from}&to=${range.to}`);
  const { act, busy, banner } = useAct(() => { reload(); reloadCal(); });
  const iso = (d: FormData, k: string) => new Date(`${d.get(k) as string}:00+05:30`).toISOString();
  return (
    <section className={s.section}>
      {banner}
      {profiles.map((p) => (
        <form key={p.id} className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); const schedule = DAYS.flatMap((_, i) => (d.get(`on${i}`) ? [{ dayOfWeek: i, startTime: d.get(`s${i}`), endTime: d.get(`e${i}`) }] : [])); void act(() => homeApi(`home/pro/profiles/${p.id}`, "PUT", { schedule }), "Saved"); }}>
          <h2 className={s.h2}>Working hours – {p.provider.displayName}</h2>
          {p.provider.kind === "SALON_MANAGED" && <p className={s.sub}>Optional: your salon&apos;s hours and your salon shift already apply. Add narrower home-visit hours here if you want.</p>}
          {DAYS.map((name, i) => { const x = p.schedules.find((y) => y.dayOfWeek === i); return <div key={name} className={s.row}><label className={s.check} style={{ width: 80 }}><input type="checkbox" name={`on${i}`} defaultChecked={!!x} /> {name}</label><input className={s.input} style={{ maxWidth: 130 }} type="time" name={`s${i}`} defaultValue={x?.startTime ?? "09:00"} aria-label={`${name} from`} /><input className={s.input} style={{ maxWidth: 130 }} type="time" name={`e${i}`} defaultValue={x?.endTime ?? "19:00"} aria-label={`${name} to`} /></div>; })}
          <button className={`${s.btn} ${s.small}`} disabled={busy}>Save hours</button>
        </form>
      ))}
      <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void act(() => homeApi("home/pro/time-off", "POST", { kind: d.get("kind"), startAt: iso(d, "from"), endAt: iso(d, "to") }), "Added"); }}>
        <h2 className={s.h2}>Break or time off</h2>
        <div className={s.form}><Field label="Type"><select className={s.input} name="kind"><option value="BREAK">Break</option><option value="TIME_OFF">Time off</option></select></Field><Field label="From"><input className={s.input} type="datetime-local" name="from" required /></Field><Field label="To"><input className={s.input} type="datetime-local" name="to" required /></Field></div>
        <button className={`${s.btn} ${s.small}`} disabled={busy}>Add</button>
      </form>
      <h2 className={s.h2}>Next 30 days</h2>
      {cal?.length === 0 && <p className={s.empty}>Nothing scheduled.</p>}
      {cal?.map((c) => <div key={c.id} className={`${s.card} ${s.between}`}><span>{words(c.kind)} · {when(c.startAt)} – {time(c.endAt)}{c.booking ? ` · ${c.booking.code}` : ""}<br /><span className={s.meta}>{c.serviceStart ? `Service at ${time(c.serviceStart)}; the rest is preparation, travel and cleanup` : c.note}</span></span>{!c.booking && <button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => void act(() => homeApi(`home/pro/time-off/${c.id}`, "DELETE"), "Removed")}>Remove</button>}</div>)}
    </section>
  );
}

function EarningsTab() {
  const [days, setDays] = useState(30);
  const [now] = useState(() => Date.now());
  const { data } = useLoad<Record<string, unknown>>(`home/pro/earnings?from=${new Date(now - days * 86_400_000).toISOString()}&to=${new Date(now + 86_400_000).toISOString()}`);
  return <section className={s.section}><div className={s.row}>{[1, 7, 30, 90].map((d) => <button key={d} className={s.chip} aria-pressed={days === d} onClick={() => setDays(d)}>{d === 1 ? "Today" : `${d} days`}</button>)}</div><Earnings data={data} /></section>;
}

function Reviews() {
  const { data, reload } = useLoad<{ id: string; overall: number; comment: string | null; response: string | null; status: string }[]>("home/pro/reviews");
  const { act, banner } = useAct(reload);
  return <section className={s.section}>{banner}{data?.length === 0 && <p className={s.empty}>No reviews yet.</p>}{data?.map((r) => <div key={r.id} className={s.card}><span className={s.strong}>★ {r.overall} {r.status !== "PUBLISHED" && <span className={`${s.badge} ${s.amber}`}>{words(r.status)}</span>}</span><p className={s.sub}>{r.comment}</p>{r.response ? <p className={s.meta}>You: {r.response}</p> : <div className={s.row}><button className={`${s.ghost} ${s.small}`} onClick={() => { const message = askText("Your public response"); if (message) void act(() => homeApi(`home/pro/reviews/${r.id}/respond`, "POST", { message }), "Posted"); }}>Respond</button><button className={`${s.ghost} ${s.small}`} onClick={() => { const reason = askText("Why should FastQue check this review?"); if (reason) void act(() => homeApi(`home/pro/reviews/${r.id}/report`, "POST", { reason }), "Sent for a person to check"); }}>Dispute</button></div>}</div>)}</section>;
}

function Verifications({ p, reload }: { p: Profile; reload: () => void }) {
  const { act, busy, banner } = useAct(reload);
  return (
    <section className={s.card}>
      <h2 className={s.h2}>Verification – {p.provider.displayName}</h2>
      <p className={s.sub}>Customers see only checks that FastQue staff completed, named exactly. Documents stay private. Aadhaar is not required.</p>
      {banner}
      {p.verifications.map((v) => <div key={v.id} className={s.between}><span>{words(v.scope)}{v.subject ? ` (${v.subject})` : ""}{v.reviewNote ? <><br /><span className={s.meta}>{v.reviewNote}</span></> : null}</span><span className={`${s.badge} ${v.status === "VERIFIED" ? s.green : s.amber}`}>{words(v.status)}</span></div>)}
      <form className={s.form} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); if (!(d.get("file") as File)?.size) d.delete("file"); void act(() => apiFetch(`home/pro/profiles/${p.id}/verifications`, { method: "POST", body: d }), "Submitted"); }}>
        <Field label="Check"><select className={s.input} name="scope">{HOME_VERIFICATION_SCOPES.filter((x) => x !== "MOBILE").map((x) => <option key={x} value={x}>{words(x)}</option>)}</select></Field>
        <Field label="Service category (for qualification)"><select className={s.input} name="subject"><option value="">—</option><option value="bridal-makeup">Bridal and makeup</option><option value="spa-massage">Spa and massage</option><option value="specialized">Specialized</option></select></Field>
        <Field label="Note"><input className={s.input} name="evidenceNote" maxLength={1000} /></Field>
        <Field label="Photo or PDF (optional, private)"><input className={s.input} type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></Field>
        <button className={`${s.btn} ${s.small}`} disabled={busy}>Submit</button>
      </form>
    </section>
  );
}

function Safety({ profiles, reload }: { profiles: Profile[]; reload: () => void }) {
  const { t } = useLang();
  const { act, busy, banner } = useAct(reload);
  return (
    <section className={s.section}>
      <div className={s.card}><h2 className={s.h2}>Emergency</h2><p className={s.note}>{t("emergency")}</p><a className={s.btn} href="tel:112">Call 112</a></div>
      {banner}
      <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void act(() => homeApi("home/pro/incident", "POST", { kind: d.get("kind"), description: d.get("description") }), "Reported to FastQue staff"); }}>
        <h2 className={s.h2}>{t("safety")}</h2>
        <Field label="What happened?"><select className={s.input} name="kind">{HOME_INCIDENT_KINDS.map((k) => <option key={k} value={k}>{words(k)}</option>)}</select></Field>
        <Field label="Details"><textarea className={s.input} name="description" minLength={5} rows={4} required /></Field>
        <button className={`${s.danger} ${s.small}`} disabled={busy}>{t("submit")}</button>
      </form>
      {profiles.slice(0, 1).map((p) => <form key={p.id} className={s.card} onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get("c") as string; void act(() => homeApi(`home/pro/profiles/${p.id}`, "PUT", { trustedContact: v || null }), "Saved"); }}><Field label="Trusted contact (only you use this, to share a visit's status)"><input className={s.input} name="c" defaultValue={p.trustedContact ?? ""} placeholder="+919812345678" /></Field><button className={`${s.ghost} ${s.small}`}>Save</button></form>)}
      <p className={s.sub}>You may decline any request and leave any unsafe visit. Neither lowers your rating.</p>
    </section>
  );
}
