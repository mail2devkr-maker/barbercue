"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HomeIntent } from "@barbercue/shared";
import { useAuth } from "../../lib/auth-context";
import { hasPlace, homeApi, money, placeQuery, useLang, useLoad, usePlace, type HomeCard } from "../../lib/home";
import { BagBar, HomeNav, Loading, PlacePicker, ProfessionalCard, useAct } from "./HomeUi";
import s from "./home.module.css";

interface Landing {
  flags: Record<string, boolean>;
  categories: { code: string; group: string; name: string; nameHi: string; services: { code: string; name: string; nameHi: string; durationMinutes: number }[] }[];
  popular: { code: string; name: string; nameHi: string }[];
  offers: { code: string; title: string; provider: string }[];
  packages: { id: string; title: string; description: string | null; pricePaise: number; offeringIds: string[]; provider: { id: string; displayName: string; kind: string } }[];
  recentProfessionals: { id: string; displayName: string }[];
  favorites: { id: string; displayName: string }[];
  campaigns: { id: string; title: string; society: { name: string; locality: string } }[];
}
interface SearchDto {
  total: number;
  items: HomeCard[];
  salons: { providerId: string; name: string; locality: string | null; professionals: number; fromPaise: number | null }[];
}

export function HomeLanding() {
  const { status } = useAuth();
  const { t, lang } = useLang();
  const router = useRouter();
  const [place] = usePlace();
  const [text, setText] = useState("");
  const { data, error } = useLoad<Landing>(status === "loading" ? null : status === "authenticated" ? "home/me/landing" : "home/landing");
  const { data: near } = useLoad<SearchDto>(hasPlace(place) ? `home/search?${placeQuery(place)}` : null);
  const { act, busy, banner } = useAct();
  const label = (x: { name: string; nameHi: string }) => (lang === "hi" ? x.nameHi : x.name);

  function ask(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length < 2) return;
    void act(async () => {
      const { intent } = await homeApi<{ intent: HomeIntent }>("home/understand", "POST", { text });
      const q = new URLSearchParams();
      if (intent.serviceCodes[0]) q.set("service", intent.serviceCodes[0]);
      else q.set("q", text.trim());
      if (intent.maxPricePaise) q.set("max", String(intent.maxPricePaise));
      if (intent.mode === "INSTANT") q.set("instant", "1");
      if (intent.providerKind) q.set("kind", intent.providerKind);
      if (intent.wantsCheapest) q.set("sort", "PRICE");
      if (intent.comfortPreference) q.set("comfort", intent.comfortPreference);
      router.push(`/home-services/search?${q}`);
    }, "");
  }

  return (
    <main className={s.page}>
      <HomeNav current="home" />
      <section className={s.hero} data-keep-colors>
        <h1>{t("tagline")}</h1>
        <p>Book a barber, stylist or beautician from a salon near you, or an independent professional. See the full price first. Pay them directly after the service.</p>
        <PlacePicker />
        <form className={s.row} onSubmit={ask}>
          <input className={`${s.input} ${s.wide}`} style={{ color: "#1c1a20", background: "#fff" }} value={text} onChange={(e) => setText(e.target.value)} placeholder={lang === "hi" ? "जैसे: रविवार सुबह हेयरकट, ₹500 से कम" : "e.g. haircut Sunday morning under ₹500"} aria-label={t("search")} maxLength={300} />
          <button className={s.btn} disabled={busy}>{t("find")}</button>
        </form>
        <div className={s.row}>
          {data?.flags.HOME_INSTANT_BOOKING_ENABLED && <Link className={`${s.btn} ${s.small}`} href="/home-services/search?instant=1">⚡ {t("bookNow")}</Link>}
          {data?.flags.HOME_SCHEDULED_BOOKING_ENABLED && <Link className={`${s.ghost} ${s.small}`} href="/home-services/search">🗓 {t("schedule")}</Link>}
        </div>
      </section>
      {banner}
      {!data && <Loading error={error} />}
      {data && data.popular.length > 0 && (
        <section className={s.section}>
          <h2 className={s.h2}>Popular services</h2>
          <div className={s.scroll}>{data.popular.map((p) => <Link key={p.code} className={s.chip} href={`/home-services/search?service=${p.code}`}>{label(p)}</Link>)}</div>
        </section>
      )}
      {near && (
        <>
          <section className={s.section}>
            <h2 className={s.h2}>Nearby salons offering home services</h2>
            {near.salons.length === 0 ? <p className={s.empty}>No salon covers this location yet.</p> : (
              <div className={s.grid}>{near.salons.map((x) => (
                <Link key={x.providerId} href={`/home-services/search?provider=${x.providerId}&kind=SALON_MANAGED`} className={s.card}>
                  <span className={s.strong}>{x.name}</span>
                  <span className={s.meta}>{x.locality} · {x.professionals} home professionals</span>
                  {x.fromPaise != null && <span className={s.price}>from {money(x.fromPaise)}</span>}
                </Link>
              ))}</div>
            )}
          </section>
          <section className={s.section}>
            <h2 className={s.h2}>Available professionals</h2>
            {near.items.length === 0 ? <p className={s.empty}>Nobody covers this location yet. Try another PIN code.</p> : <div className={s.grid}>{near.items.slice(0, 6).map((c) => <ProfessionalCard key={c.id} c={c} />)}</div>}
          </section>
        </>
      )}
      {data && (data.favorites.length > 0 || data.recentProfessionals.length > 0) && (
        <section className={s.section}>
          <h2 className={s.h2}>Your professionals</h2>
          <div className={s.scroll}>
            {data.favorites.map((f) => <Link key={f.id} className={s.chip} href={`/home-services/professionals/${f.id}`}>♥ {f.displayName}</Link>)}
            {data.recentProfessionals.filter((r) => !data.favorites.some((f) => f.id === r.id)).map((r) => <Link key={r.id} className={s.chip} href={`/home-services/professionals/${r.id}`}>{r.displayName}</Link>)}
          </div>
        </section>
      )}
      {data?.categories.map((c) => (
        <section key={c.code} className={s.section} id={c.code}>
          <h2 className={s.h2}>{label(c)}</h2>
          <div className={s.scroll}>{c.services.map((x) => <Link key={x.code} className={s.chip} href={`/home-services/search?service=${x.code}`}>{label(x)}</Link>)}</div>
        </section>
      ))}
      {data && data.packages.length > 0 && (
        <section className={s.section}>
          <h2 className={s.h2}>Packages</h2>
          <div className={s.grid}>{data.packages.map((p) => (
            <Link key={p.id} className={s.card} href={`/home-services/booking?package=${p.id}&provider=${p.provider.id}&offers=${p.offeringIds.join(",")}`}>
              <span className={s.strong}>{p.title}</span><span className={s.meta}>{p.provider.displayName}{p.description ? ` · ${p.description}` : ""}</span><span className={s.price}>{money(p.pricePaise)}</span>
            </Link>
          ))}</div>
        </section>
      )}
      {data && data.offers.length > 0 && (
        <section className={s.section}>
          <h2 className={s.h2}>Offers</h2>
          <div className={s.scroll}>{data.offers.map((o) => <span key={o.code} className={s.chip}>{o.title} · <b>{o.code}</b> · {o.provider}</span>)}</div>
        </section>
      )}
      {data && data.campaigns.length > 0 && (
        <section className={s.section}>
          <h2 className={s.h2}>FastQue Home Community</h2>
          <div className={s.scroll}>{data.campaigns.map((c) => <Link key={c.id} className={s.chip} href="/home-services/community">{c.title} · {c.society.name}</Link>)}</div>
        </section>
      )}
      <section className={s.card}>
        <h2 className={s.h2}>Trust and safety</h2>
        <p className={s.sub}>Every profile says who provides the service: a named salon or an independent professional. A badge names the exact check that was completed and is not a guarantee of safety. Your full address is shown only to the professional who is assigned to you. Start codes make sure the right person begins the service. In an emergency call 112; FastQue does not run an emergency response centre.</p>
      </section>
      <BagBar />
    </main>
  );
}
