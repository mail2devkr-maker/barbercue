"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { errorText, hasPlace, money, useBag, useLang, usePlace, type HomeCard, type HomeOption } from "../../lib/home";
import s from "./home.module.css";

export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className={s.seg} role="group" aria-label="Language">
      <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
      <button type="button" aria-pressed={lang === "hi"} onClick={() => setLang("hi")}>हिन्दी</button>
    </div>
  );
}

export function HomeNav({ current }: { current?: "home" | "bookings" | "community" | "pro" }) {
  return (
    <div className={s.top}>
      <nav className={s.seg} aria-label="FastQue Home">
        <Link href="/">At Salon</Link>
        <Link href="/home-services" aria-current="page">At Home</Link>
      </nav>
      <div className={s.row}>
        <Link href="/account/home-services" className={s.meta} aria-current={current === "bookings" ? "page" : undefined}>My home bookings</Link>
        <Link href="/home-services/community" className={s.meta} aria-current={current === "community" ? "page" : undefined}>Community</Link>
        <Link href="/home-pro" className={s.meta}>For professionals</Link>
        <LangSwitch />
      </div>
    </div>
  );
}

export function KindBadge({ kind, label }: { kind: string; label: string }) {
  return <span className={`${s.badge} ${kind === "SALON_MANAGED" ? s.salon : s.independent}`}>{label}</span>;
}

export function Avatar({ name, url }: { name: string; url?: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element -- provider-supplied photo of unknown host
  return url ? <img className={s.avatar} src={url} alt="" loading="lazy" /> : <span className={s.avatar} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

export function Rating({ rating, count }: { rating: number | null; count: number }) {
  return <span className={s.meta}>{count > 0 && rating ? `★ ${rating.toFixed(1)} (${count})` : "No reviews yet"}</span>;
}

export function ProfessionalCard({ c, compare }: { c: HomeCard; compare?: ReactNode }) {
  return (
    <article className={s.card}>
      <Link href={`/home-services/professionals/${c.id}`} className={s.row} style={{ color: "inherit", textDecoration: "none" }}>
        <Avatar name={c.name} url={c.photoUrl} />
        <span className={s.grow}>
          <span className={s.strong}>{c.name}</span>
          <br />
          <Rating rating={c.rating} count={c.reviewCount} />
        </span>
        {c.fromPaise != null && <span className={s.price}>from {money(c.fromPaise)}</span>}
      </Link>
      <KindBadge kind={c.kind} label={c.label} />
      <span className={s.meta}>
        {[c.locality, c.city].filter(Boolean).join(", ")} · {c.completedServices} completed · {c.online ? "Online now" : "Book for later"}
      </span>
      <div className={s.row}>{c.badges.slice(0, 2).map((b) => <span key={b.label} className={`${s.badge} ${s.green}`}>✓ {b.label}</span>)}</div>
      <span className={s.meta}>{c.services.slice(0, 4).map((x) => x.name).join(" · ")}</span>
      {compare}
    </article>
  );
}

export function PriceLines({ lines, totalPaise }: { lines: { label: string; paise: number }[]; totalPaise: number }) {
  const { t } = useLang();
  return (
    <div className={s.lines}>
      {lines.map((l, i) => (
        <div key={i}><span>{l.label}</span><span>{l.paise < 0 ? `− ${money(-l.paise)}` : money(l.paise)}</span></div>
      ))}
      <div className={s.total}><span>{t("total")}</span><span>{money(totalPaise)}</span></div>
    </div>
  );
}

export function OptionHead({ o }: { o: HomeOption }) {
  return (
    <div className={s.row}>
      <Avatar name={o.professionalName} url={o.photoUrl} />
      <div className={s.grow}>
        <div className={s.strong}>{o.professionalName}</div>
        <KindBadge kind={o.kind} label={o.label} /> <Rating rating={o.rating} count={o.reviewCount} />
      </div>
      <span className={s.price}>{money(o.price.totalPaise)}</span>
    </div>
  );
}

/** Manual PIN first; GPS only on tap, with the browser's own permission prompt. */
export function PlacePicker({ onDone }: { onDone?: () => void }) {
  const { t } = useLang();
  const [place, setPlace] = usePlace();
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  function locate() {
    if (!navigator.geolocation) return setMsg("Location is not available in this browser. Enter your PIN code.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPlace({ ...place, lat: p.coords.latitude, lng: p.coords.longitude });
        setMsg(null);
        onDone?.();
      },
      () => setMsg("Location permission was not given. You can enter your PIN code instead."),
      { timeout: 10_000 },
    );
  }
  return (
    <form
      className={s.row}
      onSubmit={(e) => {
        e.preventDefault();
        if (!/^[1-9]\d{5}$/.test(pin)) return setMsg("Enter a 6-digit PIN code.");
        setPlace({ pincode: pin });
        setMsg(null);
        onDone?.();
      }}
    >
      <label className={s.grow} style={{ maxWidth: 220 }}>
        <span className={s.meta} style={{ color: "inherit" }}>{t("where")}</span>
        <input className={s.input} inputMode="numeric" maxLength={6} placeholder={place.pincode ?? t("pincode")} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-label={t("pincode")} />
      </label>
      <button className={`${s.btn} ${s.small}`}>{t("find")}</button>
      <button type="button" className={`${s.ghost} ${s.small}`} onClick={locate}>{t("useLocation")}</button>
      {hasPlace(place) && <span className={s.meta} style={{ color: "inherit" }}>{place.pincode ? `PIN ${place.pincode}` : "Your location"} ✓</span>}
      {msg && <p className={s.error} role="alert">{msg}</p>}
    </form>
  );
}

export function BagBar() {
  const { t } = useLang();
  const [bag] = useBag();
  if (bag.length === 0) return null;
  const groups = new Set(bag.map((b) => b.professionalId ?? b.providerId ?? "any")).size;
  return (
    <div className={s.sticky}>
      <span className={s.strong}>{t("bag")}: {bag.reduce((n, b) => n + b.quantity, 0)}{groups > 1 ? ` · ${groups} separate appointments` : ""}</span>
      <Link href="/home-services/booking" className={`${s.btn} ${s.small}`}>{t("continue")}</Link>
    </div>
  );
}

/** Runs an action once at a time and shows its result. */
export function useAct(reload?: () => void) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function act(fn: () => Promise<unknown>, okText = "Done"): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
      reload?.();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const banner = msg ? <p className={msg.ok ? s.ok : s.error} role="status">{msg.text}</p> : null;
  return { act, busy, banner, setMsg };
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={s.field}><span>{label}</span>{children}</label>;
}
export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return <div className={s.stat}><div className={s.statValue}>{value ?? "—"}</div><div className={s.meta}>{label}</div></div>;
}
export function Loading({ error }: { error?: string | null }) {
  return error ? <p className={s.error} role="alert">{error}</p> : <div className={s.skeleton} role="status" aria-label="Loading" />;
}
export const askText = (q: string, min = 3): string | null => {
  const v = window.prompt(q)?.trim();
  return v && v.length >= min ? v : null;
};
