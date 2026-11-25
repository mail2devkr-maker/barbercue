"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { ApiError } from "../../lib/api";
import { etaText, homeApi, istDate, money, newKey, time, useBag, useGuestLinks, useLang, useLoad, usePlace, when, type BagItem, type HomeOption, type HomeQuoteDto } from "../../lib/home";
import { Field, HomeNav, OptionHead, PriceLines, useAct } from "./HomeUi";
import s from "./home.module.css";

interface Address { id: string; label: string; house: string; building: string | null; locality: string; city: string; postalCode: string }
const EMPTY = { label: "HOME", house: "", building: "", street: "", locality: "", landmark: "", city: "", state: "", postalCode: "", accessNotes: "", contactName: "", contactPhone: "" };

/** Bag items grouped by who performs them: one group = one appointment, shown before checkout. */
export function groupBag(bag: BagItem[]): { key: string; title: string; items: BagItem[] }[] {
  const map = new Map<string, BagItem[]>();
  for (const b of bag) {
    const key = b.professionalId ?? b.providerId ?? "any";
    map.set(key, [...(map.get(key) ?? []), b]);
  }
  return [...map].map(([key, items]) => ({ key, title: items[0].providerName ?? "Any eligible professional", items }));
}

export function HomeBooking() {
  const params = useSearchParams();
  const router = useRouter();
  const { t, lang } = useLang();
  const { status } = useAuth();
  const [bag, setBag] = useBag();
  const [place] = usePlace();
  const [links, setLinks] = useGuestLinks();
  const signedIn = status === "authenticated";
  const me = signedIn ? "home/me" : "home";
  const { data: addresses } = useLoad<Address[]>(signedIn ? "home/me/addresses" : null);
  const { data: config } = useLoad<{ flags: Record<string, boolean> }>("home/config");
  const pkg = params.get("package");
  const groups = useMemo(() => groupBag(bag), [bag]);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const pkgItems = useMemo<BagItem[] | null>(() => (pkg ? (params.get("offers") ?? "").split(",").filter(Boolean).map((id) => ({ offeringId: id, serviceCode: "", name: "Package service", quantity: 1, providerId: params.get("provider") ?? undefined })) : null), [pkg, params]);
  const group = pkgItems ? { key: "package", title: "Package", items: pkgItems } : (groups.find((g) => g.key === groupKey) ?? groups[0]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY, postalCode: place.pincode ?? "" });
  const [modeChoice, setMode] = useState<"INSTANT" | "SCHEDULED" | null>(null);
  const mode = modeChoice ?? (params.get("instant") && config?.flags.HOME_INSTANT_BOOKING_ENABLED ? "INSTANT" : "SCHEDULED");
  const [anyOne, setAnyOne] = useState(false);
  const [date, setDate] = useState(istDate(1));
  const [part, setPart] = useState<"all" | "m" | "a" | "e">("all");
  const [slots, setSlots] = useState<{ startAt: string; available: number }[] | null>(null);
  const [startAt, setStartAt] = useState<string | null>(null);
  const [quote, setQuote] = useState<HomeQuoteDto | null>(null);
  const [choice, setChoice] = useState<HomeOption | null>(null);
  const [hold, setHold] = useState<{ holdId: string; expiresAt: string } | null>(null);
  const [pay, setPay] = useState<"CASH" | "DIRECT_UPI" | "OTHER_OFFLINE">("CASH");
  const [promo, setPromo] = useState("");
  const [notes, setNotes] = useState("");
  const [ownProducts, setOwnProducts] = useState(false);
  const [alt, setAlt] = useState(false);
  const [child, setChild] = useState(false);
  const [guardian, setGuardian] = useState(false);
  const [agree, setAgree] = useState(false);
  const [guest, setGuest] = useState({ name: "", phone: "" });
  const [key, setKey] = useState(() => newKey());
  const { act, busy, banner, setMsg } = useAct();
  const chosenAddress = addressId ?? (form.house ? null : (addresses?.[0]?.id ?? null));

  function base() {
    const g = group!;
    const pro = g.items.find((i) => i.professionalId)?.professionalId;
    const provider = g.items.find((i) => i.providerId)?.providerId;
    const any = anyOne && !pkg;
    const address = {
      ...Object.fromEntries(Object.entries(form).filter(([, v]) => v)),
      ...(place.lat != null && place.lng != null && form.postalCode && (!place.pincode || place.pincode === form.postalCode) ? { lat: place.lat, lng: place.lng } : {}),
    };
    return {
      ...(signedIn && chosenAddress ? { addressId: chosenAddress } : { address }),
      items: g.items.map((i) => ({ ...(any || !i.offeringId ? { serviceCode: i.serviceCode } : { offeringId: i.offeringId }), ...(i.variantCode && !any ? { variantCode: i.variantCode } : {}), quantity: i.quantity })),
      preference: any || (!pro && !provider) ? "FASTEST" : pro && !pkg ? "SPECIFIC_PROFESSIONAL" : "SPECIFIC_PROVIDER",
      ...(any ? {} : pro && !pkg ? { professionalId: pro } : provider ? { providerId: provider } : {}),
      ...(promo.trim() ? { promoCode: promo.trim().toUpperCase() } : {}),
      ...(pkg ? { packageId: pkg } : {}),
    };
  }
  const addressReady = (signedIn && !!chosenAddress) || (!!form.house && !!form.locality && !!form.city && !!form.state && /^[1-9]\d{5}$/.test(form.postalCode));
  const reset = () => {
    setQuote(null);
    setChoice(null);
    setHold(null);
  };

  const loadSlots = () =>
    act(async () => {
      reset();
      setStartAt(null);
      const r = await homeApi<{ slots: { startAt: string; available: number }[] }>(`${me}/slots`, "POST", { date, quote: base() });
      setSlots(r.slots);
    }, "");

  const loadQuote = (at?: string) =>
    act(async () => {
      reset();
      const r = await homeApi<HomeQuoteDto>(`${me}/quote`, "POST", { ...base(), mode, ...(mode === "SCHEDULED" ? { startAt: at } : {}) });
      setQuote(r);
      if (r.options.length === 1) setChoice(r.options[0]);
      if (r.options.length === 0) throw new Error(r.unavailable.map((u) => u.text).join("; ") || "No one is available.");
    }, "").then((ok) => {
      if (!ok) setMsg((m) => (m && m.text.startsWith("Something") ? { ok: false, text: "No one is available for this. Try another time or allow any eligible professional." } : m));
    });

  /** The exact person and time the customer picked, as a server quote. */
  const finalQuote = (o: HomeOption) => ({ ...base(), mode, ...(mode === "SCHEDULED" ? { startAt: startAt! } : {}), ...(pkg ? {} : anyOne ? {} : { preference: "SPECIFIC_PROFESSIONAL", professionalId: o.professionalId, providerId: undefined }) });

  const pick = (o: HomeOption) =>
    act(async () => {
      setChoice(o);
      if (mode === "SCHEDULED" && !anyOne && !pkg) {
        const h = await homeApi<{ holdId: string; expiresAt: string }>(`${signedIn ? "home/me" : "home/guest"}/holds`, "POST", { quote: finalQuote(o) });
        setHold(h);
      }
    }, "");

  useEffect(() => {
    if (!hold) return;
    const id = setTimeout(() => setHold(null), Math.max(0, new Date(hold.expiresAt).getTime() - Date.now()));
    return () => clearTimeout(id);
  }, [hold]);

  const confirm = () =>
    act(async () => {
      const o = choice!;
      try {
        const r = await homeApi<{ code: string; guestToken: string | null }>(signedIn ? "home/me/bookings" : "home/guest/bookings", "POST", {
          quote: finalQuote(o),
          ...(hold ? { holdId: hold.holdId } : {}),
          expectedTotalPaise: o.price.totalPaise,
          paymentMethod: pay,
          allowAlternatives: alt,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          productPreference: ownProducts ? "CUSTOMER" : "PROFESSIONAL",
          forChild: child,
          guardianConfirmed: guardian,
          acceptPolicies: true,
          ...(signedIn ? {} : { guest }),
        }, { idempotent: key });
        if (r.guestToken) setLinks({ ...links, [r.code]: r.guestToken });
        if (!pkg) setBag(bag.filter((b) => !group!.items.includes(b)));
        router.push(`/home-services/tracking/${r.code}`);
      } catch (e) {
        if (e instanceof ApiError) setKey(newKey());
        if (e instanceof ApiError && e.code === "HOME_PRICE_CHANGED") reset();
        throw e;
      }
    }, "");

  if (!group)
    return <main className={`${s.page} ${s.narrow}`}><HomeNav /><p className={s.empty}>Your bag is empty.<br /><Link href="/home-services/search">Choose a service</Link></p></main>;

  const hour = (iso: string) => Number(new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }));
  const shown = (slots ?? []).filter((x) => part === "all" || (part === "m" ? hour(x.startAt) < 12 : part === "a" ? hour(x.startAt) >= 12 && hour(x.startAt) < 17 : hour(x.startAt) >= 17));
  const kids = group.items.some((i) => i.serviceCode === "kids-haircut");
  const f = (k: keyof typeof EMPTY) => ({ className: s.input, value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setForm({ ...form, [k]: e.target.value }); reset(); } });
  return (
    <main className={`${s.page} ${s.narrow}`}>
      <HomeNav />
      <h1 className={s.title}>{t("bag")}</h1>
      {groups.length > 1 && !pkg && <p className={s.note}>You chose services from {groups.length} providers. Each is a separate appointment with its own time, price and payment; book them one by one. Nothing is split without you seeing it.</p>}
      {!pkg && groups.map((g) => (
        <section key={g.key} className={s.card} aria-current={g.key === group.key ? "true" : undefined}>
          <div className={s.between}><span className={s.strong}>{g.title}</span>{groups.length > 1 && <button className={`${s.ghost} ${s.small}`} disabled={g.key === group.key} onClick={() => { setGroupKey(g.key); reset(); setSlots(null); }}>{g.key === group.key ? "Booking this" : "Book this one"}</button>}</div>
          {g.items.map((i) => (
            <div key={`${i.offeringId}${i.serviceCode}`} className={s.between}>
              <span>{i.name}</span>
              <span className={s.row}>
                <button className={`${s.ghost} ${s.small}`} aria-label="Fewer" onClick={() => { setBag(i.quantity > 1 ? bag.map((b) => (b === i ? { ...b, quantity: b.quantity - 1 } : b)) : bag.filter((b) => b !== i)); reset(); }}>−</button>
                <span aria-label="People">{i.quantity} {i.quantity > 1 ? "people" : "person"}</span>
                <button className={`${s.ghost} ${s.small}`} aria-label="More" disabled={i.quantity >= 10} onClick={() => { setBag(bag.map((b) => (b === i ? { ...b, quantity: b.quantity + 1 } : b))); reset(); }}>+</button>
              </span>
            </div>
          ))}
        </section>
      ))}

      <section className={s.card}>
        <h2 className={s.h2}>{t("address")}</h2>
        {signedIn && addresses && addresses.length > 0 && (
          <div className={s.scroll}>
            {addresses.map((a) => <button key={a.id} className={s.chip} aria-pressed={chosenAddress === a.id} onClick={() => { setAddressId(a.id); setForm({ ...EMPTY }); reset(); }}>{a.label}: {a.house}, {a.locality}</button>)}
            <button className={s.chip} aria-pressed={!chosenAddress} onClick={() => { setAddressId(null); setForm({ ...EMPTY, house: " " }); reset(); }}>+ New</button>
          </div>
        )}
        {!(signedIn && chosenAddress) && (
          <>
            <div className={s.form}>
              <Field label={t("house")}><input {...f("house")} autoComplete="address-line1" /></Field>
              <Field label={t("building")}><input {...f("building")} /></Field>
              <Field label={t("street")}><input {...f("street")} /></Field>
              <Field label={t("locality")}><input {...f("locality")} /></Field>
              <Field label={t("landmark")}><input {...f("landmark")} /></Field>
              <Field label={t("city")}><input {...f("city")} autoComplete="address-level2" /></Field>
              <Field label={t("state")}><input {...f("state")} autoComplete="address-level1" /></Field>
              <Field label={t("pincode")}><input {...f("postalCode")} inputMode="numeric" maxLength={6} autoComplete="postal-code" /></Field>
              <Field label={t("access")}><input {...f("accessNotes")} /></Field>
              <Field label={t("mobile")}><input {...f("contactPhone")} placeholder="+919812345678" inputMode="tel" /></Field>
            </div>
            {signedIn && addressReady && <button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => void act(async () => { const a = await homeApi<Address>("home/me/addresses", "POST", Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()))); setAddressId(a.id); }, "Address saved")}>{t("save")}</button>}
            <p className={s.meta}>Only the assigned professional sees the full address, and only until the visit ends.</p>
          </>
        )}
      </section>

      <section className={s.card}>
        <div className={s.seg} role="group" aria-label="When">
          {config?.flags.HOME_INSTANT_BOOKING_ENABLED && <button aria-pressed={mode === "INSTANT"} onClick={() => { setMode("INSTANT"); reset(); }}>⚡ {t("bookNow")}</button>}
          {config?.flags.HOME_SCHEDULED_BOOKING_ENABLED && <button aria-pressed={mode === "SCHEDULED"} onClick={() => { setMode("SCHEDULED"); reset(); }}>🗓 {t("schedule")}</button>}
        </div>
        {!pkg && <label className={s.check}><input type="checkbox" checked={anyOne} onChange={(e) => { setAnyOne(e.target.checked); reset(); setSlots(null); }} /> Any eligible professional (fastest available)</label>}
        <Field label="Offer code (optional)"><input className={s.input} value={promo} onChange={(e) => { setPromo(e.target.value); reset(); }} maxLength={30} /></Field>
        {mode === "SCHEDULED" ? (
          <>
            <div className={s.row}>
              <button className={s.chip} aria-pressed={date === istDate(0)} onClick={() => setDate(istDate(0))}>Today</button>
              <button className={s.chip} aria-pressed={date === istDate(1)} onClick={() => setDate(istDate(1))}>Tomorrow</button>
              <input type="date" className={s.input} style={{ maxWidth: 190 }} value={date} min={istDate(0)} max={istDate(21)} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
              <button className={`${s.btn} ${s.small}`} disabled={!addressReady || busy} onClick={() => void loadSlots()}>Show times</button>
            </div>
            {slots && (
              <>
                <div className={s.row}>{([["all", "All"], ["m", "Morning"], ["a", "Afternoon"], ["e", "Evening"]] as const).map(([k, l]) => <button key={k} className={s.chip} aria-pressed={part === k} onClick={() => setPart(k)}>{l}</button>)}</div>
                {shown.length === 0 ? <p className={s.empty}>No free time. Try another day.</p> : <div className={s.row}>{shown.map((x) => <button key={x.startAt} className={s.chip} aria-pressed={startAt === x.startAt} onClick={() => { setStartAt(x.startAt); void loadQuote(x.startAt); }}>{time(x.startAt)}</button>)}</div>}
                <p className={s.meta}>Times are in India Standard Time and include travel and preparation.</p>
              </>
            )}
          </>
        ) : (
          <button className={s.btn} disabled={!addressReady || busy} onClick={() => void loadQuote()}>See who can come now</button>
        )}
      </section>
      {banner}
      {quote && quote.options.length > 0 && (
        <section className={s.section}>
          {quote.options.map((o) => (
            <div key={o.professionalId} className={s.card} aria-current={choice?.professionalId === o.professionalId ? "true" : undefined}>
              <OptionHead o={o} />
              <span>{t("eta")}: <b>{mode === "INSTANT" ? etaText(o.eta.from, o.eta.to) : when(o.serviceStart)}</b>{o.eta.approximate ? ` · ${t("approx")}` : ""}</span>
              <div className={s.row}>{o.reasons.map((r) => <span key={r} className={s.badge}>{r}</span>)}{o.badges.map((b) => <span key={b.label} className={`${s.badge} ${s.green}`}>✓ {b.label}</span>)}</div>
              {choice?.professionalId === o.professionalId ? <PriceLines lines={o.price.lines} totalPaise={o.price.totalPaise} /> : <button className={`${s.ghost} ${s.small}`} disabled={busy} onClick={() => void pick(o)}>Choose</button>}
            </div>
          ))}
        </section>
      )}
      {choice && quote && (
        <section className={s.card}>
          {hold && <p className={s.ok}>This time is held for you until {time(hold.expiresAt)}.</p>}
          <p className={s.sub}><b>{choice.paymentCollectedBy}</b> collects the payment and <b>{choice.invoiceIssuedBy}</b> issues the bill. FastQue does not process this money.</p>
          {choice.items.filter((i) => i.safety || i.preparation || i.eligibility).map((i) => <p key={i.name} className={s.note}><b>{i.name}:</b> {[i.preparation, i.eligibility, i.safety].filter(Boolean).join(" ")}</p>)}
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
            <legend className={s.strong}>{t("payment")}</legend>
            {([["CASH", t("cash")], ...(choice.upiVpa ? [["DIRECT_UPI", t("upi")]] : []), ["OTHER_OFFLINE", t("other")]] as [typeof pay, string][]).map(([v, l]) => <label key={v} className={s.check}><input type="radio" name="pay" checked={pay === v} onChange={() => setPay(v)} /> {l}</label>)}
          </fieldset>
          <Field label="Special instructions (optional)"><input className={s.input} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></Field>
          {choice.items.every((i) => i.customerProducts) && <label className={s.check}><input type="checkbox" checked={ownProducts} onChange={(e) => setOwnProducts(e.target.checked)} /> I will provide approved products myself</label>}
          {!anyOne && <label className={s.check}><input type="checkbox" checked={alt} onChange={(e) => setAlt(e.target.checked)} /> {t("alternatives")}</label>}
          <label className={s.check}><input type="checkbox" checked={child || kids} disabled={kids} onChange={(e) => setChild(e.target.checked)} /> This service is for a child</label>
          {(child || kids) && <label className={s.check}><input type="checkbox" checked={guardian} onChange={(e) => { setGuardian(e.target.checked); setChild(true); }} /> {t("guardian")}</label>}
          {!signedIn && status !== "loading" && (
            <div className={s.form}>
              <p className={s.meta} style={{ gridColumn: "1 / -1" }}><Link href={`/login?next=/home-services/booking`}>Sign in</Link>, or continue as a guest. A guest request is sent only after your mobile number is verified.</p>
              <Field label={t("name")}><input className={s.input} value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} autoComplete="name" /></Field>
              <Field label={t("mobile")}><input className={s.input} value={guest.phone} placeholder="+919812345678" inputMode="tel" autoComplete="tel" onChange={(e) => setGuest({ ...guest, phone: e.target.value })} /></Field>
            </div>
          )}
          <details><summary className={s.strong}>Cancellation policy</summary><p className={s.sub}>{lang === "hi" ? quote.policies.cancellationHi : quote.policies.cancellation}</p><p className={s.sub}>{quote.policies.reService}</p></details>
          <label className={s.check}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {t("policies")}</label>
          <p className={s.meta}>{t("notConfirmed")}</p>
        </section>
      )}
      {choice && (
        <div className={s.sticky}>
          <span className={s.price}>{money(choice.price.totalPaise)}</span>
          <button className={s.btn} disabled={busy || !agree || ((child || kids) && !guardian) || (!signedIn && (!guest.name || !guest.phone))} onClick={() => void confirm()}>{t("confirm")}</button>
        </div>
      )}
    </main>
  );
}
