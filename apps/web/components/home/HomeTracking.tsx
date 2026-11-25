"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { HOME_INCIDENT_KINDS, HOME_TICKET_CATEGORIES } from "@barbercue/shared";
import { useAuth } from "../../lib/auth-context";
import { etaText, homeApi, istDate, money, time, useBag, useGuestLinks, useLang, useLoad, when, type HomeBookingDto } from "../../lib/home";
import { askText, Avatar, Field, HomeNav, KindBadge, Loading, PriceLines, useAct } from "./HomeUi";
import s from "./home.module.css";

const words = (v: string) => v.toLowerCase().replace(/_/g, " ");
const LIVE = ["REQUESTED", "AWAITING_ASSIGNMENT", "INVITED", "CONFIRMED", "PREPARING", "ON_THE_WAY", "ARRIVED", "CHECKED_IN", "IN_PROGRESS", "ADDRESS_ISSUE"];

export function HomeTracking({ code }: { code: string }) {
  const { status } = useAuth();
  const router = useRouter();
  const { t, status: label } = useLang();
  const [links] = useGuestLinks();
  const [, setBag] = useBag();
  const guest = links[code] ?? null;
  const root = guest ? `home/guest/bookings/${code}` : `home/me/bookings/${code}`;
  const ready = !!guest || status === "authenticated";
  const { data: b, error, reload } = useLoad<HomeBookingDto>(ready ? root : null, guest);
  const { data: loc, reload: reloadLoc } = useLoad<{ mode: string; reason: string | null; location: { lat: number; lng: number } | null; lastUpdatedAt: string | null }>(ready && b?.can.track ? `${root}/tracking` : null, guest);
  const { act, busy, banner } = useAct(reload);
  const [secret, setSecret] = useState<{ code: string; qr: string; expiresAt: string } | null>(null);
  const [otp, setOtp] = useState("");
  const [panel, setPanel] = useState<"time" | "help" | "safety" | "review" | null>(null);
  const live = !!b && LIVE.includes(b.status);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      reload();
      reloadLoc();
    }, 15_000);
    return () => clearInterval(id);
  }, [live, reload, reloadLoc]);
  const send = (path: string, body: unknown = {}, ok?: string) => act(() => homeApi(`${root}/${path}`, "POST", body, { guest }), ok);

  if (!ready && status !== "loading") return <main className={`${s.page} ${s.narrow}`}><HomeNav /><p className={s.empty}>Sign in to see this booking, or open it in the browser you booked from.<br /><Link href={`/login?next=/home-services/tracking/${code}`}>Sign in</Link></p></main>;
  if (!b) return <main className={`${s.page} ${s.narrow}`}><HomeNav /><Loading error={error} /></main>;
  const ad = b.address;
  return (
    <main className={`${s.page} ${s.narrow}`}>
      <HomeNav current="bookings" />
      <section className={s.card} aria-live="polite">
        <div className={s.between}><h1 className={s.title}>{label(b.status)}</h1><span className={s.badge}>Home service</span></div>
        <span className={s.meta}>{b.code} · {when(b.serviceStart)}</span>
        <KindBadge kind={b.provider.kind} label={b.provider.label} />
        {b.eta && live && <p>{t("eta")}: <b>{b.mode === "INSTANT" || b.status === "ON_THE_WAY" ? etaText(b.eta.from, b.eta.to) : `${time(b.eta.from)} – ${time(b.eta.to)}`}</b>{b.eta.approximate ? ` · ${t("approx")}` : ""}<br /><span className={s.meta}>Updated {time(b.eta.updatedAt)}{b.delayMinutes ? ` · running about ${b.delayMinutes} min late` : ""}</span></p>}
        {b.professional && (
          <div className={s.row}>
            <Avatar name={b.professional.name} url={b.professional.photoUrl} />
            <div className={s.grow}><span className={s.strong}>{b.professional.name}</span><br />{b.professional.badges.map((x) => <span key={x.label} className={`${s.badge} ${s.green}`}>✓ {x.label}</span>)}</div>
            {b.professional.phone && <a className={`${s.ghost} ${s.small}`} href={`tel:${b.professional.phone}`}>Call</a>}
          </div>
        )}
        {b.status === "ARRIVED" && <p className={s.note}>Check that the person is <b>{b.professional?.name}</b> before sharing your code. If it is someone else, do not start the service; report it below.</p>}
      </section>
      {banner}
      {b.guestVerificationNeeded && (
        <section className={s.card}>
          <h2 className={s.h2}>Verify your mobile number</h2>
          <p className={s.sub}>Your request has not been sent yet. It expires in 30 minutes.</p>
          <button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => void send("phone-code", {}, "Code sent by SMS")}>Send code</button>
          <div className={s.row}><input className={s.input} style={{ maxWidth: 160 }} inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} aria-label="Code" /><button className={`${s.btn} ${s.small}`} disabled={busy || otp.length !== 6} onClick={() => void send("phone-verify", { otp }, "Verified – request sent")}>Verify</button></div>
        </section>
      )}
      {["CONFIRMED", "PREPARING", "ON_THE_WAY", "ARRIVED", "ADDRESS_ISSUE"].includes(b.status) && (
        <section className={s.card}>
          <button className={s.btn} disabled={busy} onClick={() => void act(async () => setSecret(await homeApi(`${root}/start-code`, "POST", {}, { guest })), "")}>{t("startCode")}</button>
          <p className={s.meta}>{t("startCodeHint")}</p>
          {secret && <div className={s.row}><span className={s.code}>{secret.code}</span><span style={{ background: "#fff", padding: 8, borderRadius: 10 }}><QRCodeSVG value={secret.qr} size={112} /></span><span className={s.meta}>Expires {time(secret.expiresAt)}</span></div>}
        </section>
      )}
      {b.can.track && loc && (
        <section className={s.card}>
          <h2 className={s.h2}>Location</h2>
          {loc.location ? <><p>{loc.mode === "RECENT" ? "Recently shared location" : loc.reason} · <span className={s.meta}>last updated {loc.lastUpdatedAt ? time(loc.lastUpdatedAt) : ""}</span></p><a className={`${s.ghost} ${s.small}`} target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${loc.location.lat}&mlon=${loc.location.lng}#map=15/${loc.location.lat}/${loc.location.lng}`}>Open on a map</a></> : <p className={s.sub}>{loc.reason}</p>}
        </section>
      )}
      {b.adjustments.filter((x) => x.status === "PENDING").map((x) => (
        <section key={x.id} className={s.card}>
          <h2 className={s.h2}>Approve an extra?</h2>
          <p>{x.description} · <b>{money(x.amountPaise)}</b>{x.minutes ? ` · ${x.minutes} more minutes` : ""}</p>
          <div className={s.row}><button className={`${s.btn} ${s.small}`} disabled={busy} onClick={() => void send(`extras/${x.id}`, { approve: true }, "Added")}>Approve</button><button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => void send(`extras/${x.id}`, { approve: false }, "Declined")}>No</button></div>
        </section>
      ))}
      {b.status === "REPLACEMENT_REQUESTED" && (
        <section className={s.card}>
          <h2 className={s.h2}>Your professional cannot come</h2>
          <div className={s.row}>
            {b.replacementProposedId && <button className={`${s.btn} ${s.small}`} disabled={busy} onClick={() => void send("replacement", { choice: "APPROVE" })}>Accept the proposed replacement</button>}
            {b.replacementProposedId && <Link className={s.meta} href={`/home-services/professionals/${b.replacementProposedId}`}>See their profile</Link>}
            <button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => void send("replacement", { choice: "ANY" })}>Ask anyone eligible</button>
          </div>
        </section>
      )}
      {b.status === "RESCHEDULE_REQUESTED" && b.rescheduleTo && (
        <section className={s.card}>
          <p>New time requested: <b>{when(b.rescheduleTo)}</b></p>
          {b.history.filter((h) => h.to === "RESCHEDULE_REQUESTED").at(-1)?.by !== "CUSTOMER" ? <div className={s.row}><button className={`${s.btn} ${s.small}`} onClick={() => void send("reschedule/answer", { approve: true })}>Accept</button><button className={`${s.ghost} ${s.small}`} onClick={() => void send("reschedule/answer", { approve: false })}>Keep original</button></div> : <p className={s.meta}>Waiting for the professional to answer.</p>}
        </section>
      )}
      <section className={s.card}>
        {b.items.map((i) => <div key={i.id} className={s.between}><span>{i.name}{i.quantity > 1 ? ` × ${i.quantity}` : ""}</span><span className={s.meta}>{i.durationMinutes} min</span></div>)}
        <PriceLines lines={b.price.lines} totalPaise={b.totalPaise} />
        <p className={s.meta}>Pay {b.collectedBy} directly ({words(b.paymentMethod)}). Bill issued by {b.invoiceIssuedBy}. FastQue does not process this payment.</p>
        {b.upiVpa && <p>UPI ID: <b>{b.upiVpa}</b></p>}
        {b.payments.filter((p) => !p.voided).map((p) => (
          <div key={p.id} className={s.row}>
            <span className={s.grow}>{money(p.amountPaise)} recorded ({words(p.method)}) {p.customerConfirmedAt ? "· confirmed by you" : p.disputedAt ? "· disputed" : ""}</span>
            {!guest && !p.customerConfirmedAt && !p.disputedAt && <><button className={`${s.btn} ${s.small}`} onClick={() => void send(`payments/${p.id}`, { agree: true }, "Thank you")}>I paid this</button><button className={`${s.danger} ${s.small}`} onClick={() => { const note = askText("What is wrong with this payment record?"); if (note) void send(`payments/${p.id}`, { agree: false, note }, "Sent to support"); }}>Dispute</button></>}
          </div>
        ))}
        {b.duePaise > 0 && <p className={s.strong}>Due: {money(b.duePaise)}</p>}
      </section>
      <section className={s.card}>
        <span className={s.strong}>{t("address")}</span>
        <span className={s.sub}>{[ad.full?.house, ad.full?.building, ad.full?.street, ad.locality, ad.full?.landmark, ad.city, ad.postalCode].filter(Boolean).join(", ")}</span>
      </section>
      <div className={s.row}>
        {b.can.reschedule && !guest && <button className={`${s.ghost} ${s.small}`} onClick={() => setPanel(panel === "time" ? null : "time")}>{t("reschedule")}</button>}
        {b.can.cancel && <button className={`${s.danger} ${s.small}`} disabled={busy} onClick={() => { const reason = askText("Why are you cancelling? There is no charge."); if (reason) void send("cancel", { reason }, "Cancelled"); }}>{t("cancel")}</button>}
        {b.can.rebook && !guest && <button className={`${s.btn} ${s.small}`} onClick={() => void act(async () => {
          const r = await homeApi<{ professionalId: string | null; providerId: string; items: { offeringId: string; quantity: number }[] }>(`${root}/rebook`);
          setBag(r.items.map((i, n) => ({ offeringId: i.offeringId, serviceCode: "", name: b.items[n]?.name ?? "Service", quantity: i.quantity, professionalId: r.professionalId ?? undefined, providerId: r.providerId, providerName: b.professional?.name ?? b.provider.name })));
          router.push("/home-services/booking");
        }, "")}>{t("rebook")}</button>}
        {b.can.review && <button className={`${s.btn} ${s.small}`} onClick={() => setPanel("review")}>Review</button>}
        <button className={`${s.ghost} ${s.small}`} onClick={() => setPanel(panel === "help" ? null : "help")}>{t("support")}</button>
        <button className={`${s.danger} ${s.small}`} onClick={() => setPanel(panel === "safety" ? null : "safety")}>{t("safety")}</button>
        {!guest && live && <button className={`${s.ghost} ${s.small}`} onClick={() => void act(async () => { const r = await homeApi<{ token: string }>(`${root}/share`, "POST", {}); await navigator.clipboard.writeText(`${window.location.origin}/home-services/shared/${r.token}`); }, "Status link copied. It shows no address or phone number.")}>Share status</button>}
        {["CONFIRMED", "PREPARING", "ON_THE_WAY"].includes(b.status) && !guest && <button className={`${s.ghost} ${s.small}`} onClick={() => { const reason = askText("What happened?"); if (reason) void send("no-show", { reason }); }}>Professional did not arrive</button>}
        {b.professional && !guest && <button className={`${s.ghost} ${s.small}`} onClick={() => { if (window.confirm("Stop being matched with this professional?")) void send("block", {}, "Blocked. You will not be matched again."); }}>Block</button>}
      </div>
      {panel === "time" && (
        <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void send("reschedule", { startAt: new Date(`${d.get("date") as string}T${d.get("time") as string}:00+05:30`).toISOString() }, "Sent").then((ok) => ok && setPanel(null)); }}>
          <div className={s.form}><Field label="Date"><input className={s.input} type="date" name="date" min={istDate(0)} defaultValue={istDate(1)} required /></Field><Field label="Time (IST)"><input className={s.input} type="time" name="time" defaultValue="11:00" required /></Field></div>
          <button className={`${s.btn} ${s.small}`} disabled={busy}>{t("submit")}</button>
        </form>
      )}
      {panel === "help" && (
        <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void send("tickets", { category: d.get("category"), message: d.get("message") }, "Support request sent").then((ok) => ok && setPanel(null)); }}>
          <Field label="What is it about?"><select className={s.input} name="category">{HOME_TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{words(c)}</option>)}</select></Field>
          <Field label="Tell us more"><textarea className={s.input} name="message" minLength={5} maxLength={2000} rows={4} required /></Field>
          <button className={`${s.btn} ${s.small}`} disabled={busy}>{t("submit")}</button>
        </form>
      )}
      {panel === "safety" && (
        <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void send("incident", { kind: d.get("kind"), description: d.get("description") }, "Reported to FastQue staff. In danger, call 112.").then((ok) => ok && setPanel(null)); }}>
          <p className={s.note}>{t("emergency")} <a href="tel:112"><b>Call 112</b></a></p>
          <Field label="What happened?"><select className={s.input} name="kind">{HOME_INCIDENT_KINDS.map((c) => <option key={c} value={c}>{words(c)}</option>)}</select></Field>
          <Field label="Details"><textarea className={s.input} name="description" minLength={5} maxLength={2000} rows={4} required /></Field>
          <div className={s.row}><button className={`${s.danger} ${s.small}`} disabled={busy}>{t("submit")}</button>{!guest && ["ARRIVED", "CHECKED_IN", "IN_PROGRESS"].includes(b.status) && <button type="button" className={`${s.ghost} ${s.small}`} onClick={() => { const reason = askText("Why are you stopping the service?"); if (reason) void send("interrupt", { reason }); }}>Stop the service</button>}</div>
        </form>
      )}
      {panel === "review" && (
        <form className={s.card} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); const n = (k: string) => Number(d.get(k)); void send("review", { overall: n("overall"), quality: n("quality"), behaviour: n("behaviour"), punctuality: n("punctuality"), hygiene: n("hygiene"), transparency: n("transparency"), ...(d.get("comment") ? { comment: d.get("comment") } : {}) }, "Thank you").then((ok) => ok && setPanel(null)); }}>
          <div className={s.form}>{[["overall", "Overall"], ["quality", "Service quality"], ["behaviour", "Behaviour"], ["punctuality", "Punctuality"], ["hygiene", "Hygiene"], ["transparency", "Price transparency"]].map(([k, l]) => <Field key={k} label={l}><select className={s.input} name={k} defaultValue="5">{[5, 4, 3, 2, 1].map((x) => <option key={x}>{x}</option>)}</select></Field>)}</div>
          <Field label="Comment (optional)"><textarea className={s.input} name="comment" maxLength={1000} rows={3} /></Field>
          <button className={`${s.btn} ${s.small}`} disabled={busy}>{t("submit")}</button>
        </form>
      )}
      {b.tickets.length > 0 && <section className={s.card}><span className={s.strong}>Support</span>{b.tickets.map((x) => <span key={x.id} className={s.meta}>#{x.number} {words(x.category)} · {words(x.status)}</span>)}</section>}
      <section className={s.section}><h2 className={s.h2}>Timeline</h2><ol className={s.timeline}>{b.history.filter((h) => h.to || ["DELAY", "EXTRA_APPROVED", "PAYMENT_RECORDED", "RESCHEDULED", "PROVIDER_CHANGED"].includes(h.kind)).map((h, i) => <li key={i}><b>{h.to ? label(h.to as never) : words(h.kind)}</b> <span className={s.meta}>{when(h.at)}{h.note ? ` · ${h.note}` : ""}</span></li>)}</ol></section>
    </main>
  );
}

export function HomeShared({ token }: { token: string }) {
  const { status: label } = useLang();
  const { data, error } = useLoad<{ status: never; provider: string; professional: string | null; area: string; serviceStart: string; serviceEnd: string }>(`home/shared/${token}`);
  if (!data) return <main className={`${s.page} ${s.narrow}`}><Loading error={error} /></main>;
  return <main className={`${s.page} ${s.narrow}`}><section className={s.card}><h1 className={s.title}>{label(data.status)}</h1><p>{data.professional ?? "Not assigned yet"} · {data.provider}</p><p className={s.sub}>{data.area} · {when(data.serviceStart)} – {time(data.serviceEnd)}</p><p className={s.meta}>Shared status only. No address, phone number or location is shown.</p></section></main>;
}

export function HomeCommunity() {
  const { status } = useAuth();
  const { data, error, reload } = useLoad<{ id: string; title: string; society: { name: string; locality: string; city: string; postalCode: string }; provider: { displayName: string; kind: string }; service: string | null; pricePaise: number | null; discountPct: number; joined: number; minParticipants: number; maxParticipants: number; startsAt: string; joinBy: string; status: string; condition: string }[]>("home/campaigns");
  const { data: addresses } = useLoad<{ id: string; label: string; house: string; postalCode: string }[]>(status === "authenticated" ? "home/me/addresses" : null);
  const { act, busy, banner } = useAct(reload);
  return (
    <main className={s.page}>
      <HomeNav current="community" />
      <h1 className={s.title}>FastQue Home Community</h1>
      <p className={s.sub}>One visit to your society, several residents, one individual booking and payment each. Other residents never see your name or flat.</p>
      {banner}
      {!data && <Loading error={error} />}
      {data?.length === 0 && <p className={s.empty}>No society visits are planned yet.</p>}
      <div className={s.grid}>{data?.map((c) => {
        const mine = addresses?.filter((a) => a.postalCode === c.society.postalCode) ?? [];
        return (
          <article key={c.id} className={s.card}>
            <span className={s.strong}>{c.title}</span>
            <span className={s.meta}>{c.society.name}, {c.society.locality} · {c.provider.displayName}</span>
            <span>{c.service}{c.pricePaise != null ? ` · ${money(c.pricePaise)}` : ""} · {c.discountPct}% group discount</span>
            <span className={s.meta}>{when(c.startsAt)} · join by {when(c.joinBy)} · {c.joined} joined, {c.minParticipants} needed</span>
            <p className={s.note}>{c.condition}</p>
            {c.status === "OPEN" && (status !== "authenticated" ? <Link href="/login?next=/home-services/community">Sign in to join</Link> : mine.length === 0 ? <span className={s.meta}>Save an address in PIN {c.society.postalCode} to join.</span> : mine.map((a) => <button key={a.id} className={`${s.btn} ${s.small}`} disabled={busy} onClick={() => void act(() => homeApi(`home/me/campaigns/${c.id}/join`, "POST", { addressId: a.id }), "Joined")}>Join from {a.label} ({a.house})</button>))}
            {c.status === "BELOW_MINIMUM" && status === "authenticated" && <div className={s.row}><button className={`${s.btn} ${s.small}`} onClick={() => void act(() => homeApi(`home/me/campaigns/${c.id}/price`, "POST", { approve: true }), "Booked at the normal price")}>Book at the normal price</button><button className={`${s.ghost} ${s.small}`} onClick={() => void act(() => homeApi(`home/me/campaigns/${c.id}/price`, "POST", { approve: false }), "Declined")}>No thanks</button></div>}
          </article>
        );
      })}</div>
    </main>
  );
}
