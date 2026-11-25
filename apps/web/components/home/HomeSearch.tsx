"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { hasPlace, money, placeQuery, useBag, useLang, useLoad, usePlace, homeApi, type HomeCard } from "../../lib/home";
import { useAuth } from "../../lib/auth-context";
import { Avatar, BagBar, HomeNav, KindBadge, Loading, PlacePicker, ProfessionalCard, Rating, useAct } from "./HomeUi";
import s from "./home.module.css";

export function HomeSearch() {
  const params = useSearchParams();
  const router = useRouter();
  const { t } = useLang();
  const [place] = usePlace();
  const [picked, setPicked] = useState<string[]>([]);
  const q = new URLSearchParams(placeQuery(place));
  const get = (k: string) => params.get(k);
  for (const [from, to] of [["service", "service"], ["q", "q"], ["kind", "kind"], ["sort", "sort"], ["max", "maxPricePaise"], ["language", "language"], ["page", "page"]] as const) if (get(from)) q.set(to, get(from)!);
  if (get("instant")) q.set("instant", "true");
  const { data, error } = useLoad<{ total: number; page: number; pageSize: number; items: HomeCard[] }>(hasPlace(place) ? `home/search?${q}` : null);
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(params.toString());
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== "page") n.delete("page");
    router.replace(`/home-services/search?${n}`);
  };
  const items = (data?.items ?? []).filter((c) => !get("provider") || c.providerId === get("provider"));
  const compared = items.filter((c) => picked.includes(c.id));
  return (
    <main className={s.page}>
      <HomeNav />
      <PlacePicker />
      <form className={s.row} onSubmit={(e) => { e.preventDefault(); set("q", new FormData(e.currentTarget).get("q") as string); }}>
        <input name="q" defaultValue={get("q") ?? ""} className={`${s.input} ${s.grow}`} placeholder={t("search")} aria-label={t("search")} maxLength={80} />
        <button className={`${s.btn} ${s.small}`}>{t("find")}</button>
      </form>
      <div className={s.scroll}>
        <button className={s.chip} aria-pressed={!!get("instant")} onClick={() => set("instant", get("instant") ? null : "1")}>⚡ Available now</button>
        <button className={s.chip} aria-pressed={get("kind") === "SALON_MANAGED"} onClick={() => set("kind", get("kind") === "SALON_MANAGED" ? null : "SALON_MANAGED")}>Salon professionals</button>
        <button className={s.chip} aria-pressed={get("kind") === "INDEPENDENT_PROFESSIONAL"} onClick={() => set("kind", get("kind") === "INDEPENDENT_PROFESSIONAL" ? null : "INDEPENDENT_PROFESSIONAL")}>Independent</button>
        <select className={s.chip} aria-label="Sort" value={get("sort") ?? "RECOMMENDED"} onChange={(e) => set("sort", e.target.value)}>
          <option value="RECOMMENDED">Recommended</option><option value="FASTEST">Available first</option><option value="PRICE">Lowest price</option><option value="RATING">Highest rating</option>
        </select>
        {get("service") && <button className={s.chip} onClick={() => set("service", null)}>{get("service")} ✕</button>}
        {get("max") && <button className={s.chip} onClick={() => set("max", null)}>Up to {money(Number(get("max")))} ✕</button>}
      </div>
      {get("comfort") && <p className={s.note}>You mentioned a preference for a {get("comfort") === "FEMALE" ? "woman" : "man"}. FastQue does not record professionals&apos; gender, so please check the profile or ask before booking.</p>}
      {!hasPlace(place) && <p className={s.empty}>Enter your PIN code or use your location to see who can come to you.</p>}
      {hasPlace(place) && !data && <Loading error={error} />}
      {compared.length > 1 && (
        <section className={`${s.card} ${s.tableWrap}`}>
          <h2 className={s.h2}>Compare</h2>
          <table className={s.table}>
            <thead><tr><th>Professional</th><th>Type</th><th>From</th><th>Rating</th><th>Completed</th><th>Checks</th></tr></thead>
            <tbody>{compared.map((c) => <tr key={c.id}><td><Link href={`/home-services/professionals/${c.id}`}>{c.name}</Link></td><td>{c.label}</td><td>{c.fromPaise != null ? money(c.fromPaise) : "—"}</td><td><Rating rating={c.rating} count={c.reviewCount} /></td><td>{c.completedServices}</td><td>{c.badges.map((b) => b.label).join(", ") || "None completed"}</td></tr>)}</tbody>
          </table>
        </section>
      )}
      {data && items.length === 0 && <p className={s.empty}>No eligible professional covers this location for your choice.<br />Try removing a filter, another service, or a nearby PIN code.</p>}
      <div className={s.grid}>
        {items.map((c) => (
          <ProfessionalCard key={c.id} c={c} compare={<label className={s.check}><input type="checkbox" checked={picked.includes(c.id)} disabled={!picked.includes(c.id) && picked.length >= 4} onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} /> Compare</label>} />
        ))}
      </div>
      {data && data.total > data.pageSize && (
        <div className={s.row}>
          <button className={`${s.ghost} ${s.small}`} disabled={data.page <= 1} onClick={() => set("page", String(data.page - 1))}>Back</button>
          <span className={s.meta}>Page {data.page}</span>
          <button className={`${s.ghost} ${s.small}`} disabled={data.page * data.pageSize >= data.total} onClick={() => set("page", String(data.page + 1))}>Next</button>
        </div>
      )}
      <BagBar />
    </main>
  );
}

export function HomeProfile({ id }: { id: string }) {
  const { t, lang } = useLang();
  const { status } = useAuth();
  const [bag, setBag] = useBag();
  const { data: p, error } = useLoad<HomeCard & { portfolioUrls: string[]; coverage: string[]; reviews: { overall: number; comment: string | null; response: string | null; createdAt: string }[] }>(`home/professionals/${id}`);
  const { act, banner } = useAct();
  if (!p) return <main className={s.page}><HomeNav /><Loading error={error} /></main>;
  return (
    <main className={`${s.page} ${s.narrow}`}>
      <HomeNav />
      <section className={s.card}>
        <div className={s.row}>
          <Avatar name={p.name} url={p.photoUrl} />
          <div className={s.grow}><h1 className={s.title}>{p.name}</h1><Rating rating={p.rating} count={p.reviewCount} /></div>
          {status === "authenticated" && <button className={`${s.ghost} ${s.small}`} onClick={() => void act(() => homeApi(`home/me/favorites/${id}`, "PUT"), "Saved to favourites")}>♥ Save</button>}
        </div>
        <KindBadge kind={p.kind} label={p.label} />
        {p.bio && <p className={s.sub}>{p.bio}</p>}
        <p className={s.meta}>{p.yearsExperience != null ? `${p.yearsExperience} years of experience · ` : ""}{p.completedServices} completed home services{p.languages.length ? ` · Speaks ${p.languages.join(", ")}` : ""}</p>
        <div className={s.row}>{p.badges.map((b) => <span key={b.label} className={`${s.badge} ${s.green}`}>✓ {b.label}</span>)}</div>
        <p className={s.meta}>Serves: {p.coverage.join(", ")}</p>
      </section>
      {banner}
      <section className={s.section}>
        <h2 className={s.h2}>Services and prices</h2>
        {p.services.map((x) => {
          const inBag = bag.some((b) => b.offeringId === x.offeringId && b.professionalId === p.id);
          return (
            <div key={x.offeringId} className={s.card}>
              <div className={s.between}>
                <div className={s.grow}><div className={s.strong}>{lang === "hi" ? x.nameHi : x.name}</div><span className={s.meta}>{x.durationMinutes} min{x.productPaise ? ` · products and materials ${money(x.productPaise)} extra` : ""}</span></div>
                <span className={s.price}>{money(x.pricePaise)}</span>
              </div>
              <button className={`${inBag ? s.ghost : s.btn} ${s.small}`} onClick={() => setBag(inBag ? bag.filter((b) => !(b.offeringId === x.offeringId && b.professionalId === p.id)) : [...bag, { offeringId: x.offeringId, serviceCode: x.code, name: x.name, quantity: 1, professionalId: p.id, providerId: p.providerId, providerName: p.name }])}>{inBag ? t("remove") : t("add")}</button>
            </div>
          );
        })}
      </section>
      {p.portfolioUrls.length > 0 && <section className={s.section}><h2 className={s.h2}>Portfolio</h2><div className={s.scroll}>{p.portfolioUrls.map((u) => (
        // eslint-disable-next-line @next/next/no-img-element -- professional-supplied image of unknown host
        <img key={u} src={u} alt="Portfolio" loading="lazy" style={{ height: 140, borderRadius: 14 }} />
      ))}</div></section>}
      <section className={s.section}>
        <h2 className={s.h2}>Reviews</h2>
        {p.reviews.length === 0 ? <p className={s.empty}>No reviews yet. Only customers with a completed booking can review.</p> : p.reviews.map((r, i) => <div key={i} className={s.card}><span className={s.strong}>★ {r.overall}</span>{r.comment && <p className={s.sub}>{r.comment}</p>}{r.response && <p className={s.meta}>Response: {r.response}</p>}</div>)}
      </section>
      <BagBar />
    </main>
  );
}
