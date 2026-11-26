"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  VI_CHANNELS,
  VI_CHANNEL_LABELS,
  VI_MODULES,
  VI_MODULE_LABELS,
  VI_PATHS,
  VI_PERIODS,
  VI_PERIOD_LABELS,
  type ViCapability,
  type ViFilters,
  type ViMeDto,
} from "@barbercue/shared";
import { getRealtimeSocket } from "../../../lib/realtime";
import { VISITOR_INTEL_TABS } from "../shell/admin-nav";
import { useAdminFilters } from "../shell/admin-filters";
import { ErrorBox, Skeleton } from "./parts";
import { filtersQuery, useVi, viPath } from "./vi-api";
import { ConversionsTab, GeoTab, HistoryTab, JourneyTab, LiveTab, OverviewTab, SearchTab, SourcesTab } from "./tabs-analytics";
import { AiTab, MarketingTab, ReportsTab, SettingsTab } from "./tabs-ops";
import s from "./vi.module.css";

const TAB_CAP: Record<string, ViCapability> = {
  overview: "overview",
  live: "live",
  history: "history",
  geo: "geo",
  search: "search",
  journey: "journey",
  sources: "sources",
  conversions: "conversions",
  marketing: "campaigns",
  ai: "insights",
  reports: "reports",
  settings: "settings",
};

interface Ctx {
  me: ViMeDto;
  can: (c: ViCapability) => boolean;
  filters: Partial<ViFilters>;
  setFilters: (f: Partial<ViFilters>) => void;
  query: (extra?: Record<string, string | number | undefined | null>) => string;
  liveRevision: number;
}
const ViContext = createContext<Ctx | null>(null);
export function useViContext(): Ctx {
  const c = useContext(ViContext);
  if (!c) throw new Error("useViContext outside VisitorIntelligence");
  return c;
}

/** FastQue Visitor Intelligence (docs/visitor-intelligence/). Every number comes from the API; nothing is sample data. */
export function VisitorIntelligence() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname() ?? "/dashboard/admin/visitor-intelligence";
  const me = useVi<ViMeDto>(viPath(VI_PATHS.me), "me");
  const [filters, setFiltersState] = useState<Partial<ViFilters>>({ period: "7d" });
  const [liveRevision, setLiveRevision] = useState(0);
  // The admin shell's date picker drives this page too: changing it switches to that custom range.
  const { range } = useAdminFilters();
  const firstRange = useRef(true);
  useEffect(() => {
    if (firstRange.current) {
      firstRange.current = false;
      return;
    }
    const t = window.setTimeout(() => setFiltersState((f) => ({ ...f, period: "custom", from: range.from, to: range.to })), 0);
    return () => window.clearTimeout(t);
  }, [range.from, range.to]);
  const [connected, setConnected] = useState(false);

  // Live push: the server emits "something changed" (no data) on vi:live; panels refetch. Polling is the fallback.
  useEffect(() => {
    if (!me.data) return;
    const socket = getRealtimeSocket();
    const join = () => {
      socket.emit("join:visitor-intel", {}, (r: { ok: boolean } | undefined) => setConnected(!!r?.ok));
    };
    const onUpdate = () => setLiveRevision((r) => r + 1);
    const onDisconnect = () => setConnected(false);
    socket.on("connect", join);
    socket.on("vi.live.updated", onUpdate);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) join();
    return () => {
      socket.off("connect", join);
      socket.off("vi.live.updated", onUpdate);
      socket.off("disconnect", onDisconnect);
    };
  }, [me.data]);

  const ctx = useMemo<Ctx | null>(() => {
    if (!me.data) return null;
    const caps = new Set(me.data.capabilities);
    return {
      me: me.data,
      can: (c) => caps.has(c),
      filters,
      setFilters: (f) => setFiltersState(f),
      query: (extra) => filtersQuery(filters, extra),
      liveRevision,
    };
  }, [me.data, filters, liveRevision]);

  if (me.error) return <div className={s.page}><ErrorBox message={me.error} onRetry={me.reload} /></div>;
  if (!ctx) return <div className={s.page}><Skeleton height={60} /><Skeleton height={140} count={3} /></div>;

  const tabs = VISITOR_INTEL_TABS.filter(([id]) => ctx.can(TAB_CAP[id]));
  const wanted = params.get("tab") ?? "overview";
  const tab = tabs.find(([id]) => id === wanted)?.[0] ?? tabs[0]?.[0] ?? null;
  const scopeNote = ctx.me.scope.kind === "territory" ? `Showing your territory only: ${ctx.me.scope.cities.join(", ") || "no cities assigned yet"}.` : null;
  const showFilters = tab && !["settings", "reports", "ai"].includes(tab);

  return (
    <ViContext.Provider value={ctx}>
      <div className={s.page}>
        <header className={s.header}>
          <div>
            <p className={s.eyebrow}>FastQue · Visitor Intelligence</p>
            <h1>{tabs.find(([id]) => id === tab)?.[1] ?? "Visitor Intelligence"}</h1>
            <p className={s.subtitle}>Who visits, where from, what they look for, why they leave and where demand is. First-party and consented visitors only.</p>
          </div>
          <span className={s.liveBadge} title={connected ? "Live updates connected" : "Live updates via polling"}>
            <span className={`${s.dot} ${ctx.me.trackingEnabled ? "" : s.dotIdle}`} />
            {ctx.me.trackingEnabled ? (connected ? "Live" : "Live (polling)") : "Tracking paused"}
          </span>
        </header>

        <nav className={s.tabs} role="tablist" aria-label="Visitor Intelligence sections">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`${s.tab} ${tab === id ? s.tabOn : ""}`} onClick={() => router.replace(id === "overview" ? path : `${path}?tab=${id}`, { scroll: false })}>
              {label}
            </button>
          ))}
        </nav>

        {ctx.me.demoVisitors > 0 && <div className={s.banner}>⚠ DEMO DATA: {ctx.me.demoVisitors} synthetic visitors (development only) are included in every figure. Remove them in Tracking Settings.</div>}
        {scopeNote && <div className={s.banner}>{scopeNote}</div>}
        {showFilters && tab !== "live" && <FilterBar />}
        {!tab && <ErrorBox message="Your role has no Visitor Intelligence access." />}
        {tab === "overview" && <OverviewTab />}
        {tab === "live" && <LiveTab />}
        {tab === "history" && <HistoryTab />}
        {tab === "geo" && <GeoTab />}
        {tab === "search" && <SearchTab />}
        {tab === "journey" && <JourneyTab />}
        {tab === "sources" && <SourcesTab />}
        {tab === "conversions" && <ConversionsTab />}
        {tab === "marketing" && <MarketingTab />}
        {tab === "ai" && <AiTab />}
        {tab === "reports" && <ReportsTab />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </ViContext.Provider>
  );
}

function FilterBar() {
  const { filters, setFilters } = useViContext();
  const [city, setCity] = useState(filters.city ?? "");
  const set = (patch: Partial<ViFilters>) => setFilters({ ...filters, ...patch });
  const quick = ["today", "yesterday", "7d", "30d", "90d"] as const;
  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((filters.city ?? "") !== city.trim()) setFilters({ ...filters, city: city.trim() || undefined });
    }, 500);
    return () => window.clearTimeout(t);
  }, [city, filters, setFilters]);
  return (
    <div className={s.filters} role="group" aria-label="Filters">
      <div className={s.chips}>
        {quick.map((p) => (
          <button key={p} type="button" className={`${s.chip} ${filters.period === p ? s.chipOn : ""}`} onClick={() => set({ period: p, from: undefined, to: undefined })}>
            {VI_PERIOD_LABELS[p]}
          </button>
        ))}
      </div>
      <select className={s.select} aria-label="Period" value={quick.includes(filters.period as (typeof quick)[number]) ? "" : (filters.period ?? "")} onChange={(e) => e.target.value && set({ period: e.target.value as ViFilters["period"] })}>
        <option value="">More periods…</option>
        {VI_PERIODS.filter((p) => !quick.includes(p as (typeof quick)[number])).map((p) => (
          <option key={p} value={p}>
            {VI_PERIOD_LABELS[p]}
          </option>
        ))}
      </select>
      {filters.period === "custom" && (
        <>
          <input className={s.input} type="date" aria-label="From" value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
          <input className={s.input} type="date" aria-label="To" value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} />
        </>
      )}
      <input className={s.input} placeholder="City" aria-label="City" value={city} onChange={(e) => setCity(e.target.value)} style={{ width: 120 }} />
      <select className={s.select} aria-label="Traffic source" value={filters.channel ?? ""} onChange={(e) => set({ channel: (e.target.value || undefined) as ViFilters["channel"] })}>
        <option value="">All sources</option>
        {VI_CHANNELS.map((c) => (
          <option key={c} value={c}>
            {VI_CHANNEL_LABELS[c]}
          </option>
        ))}
      </select>
      <select className={s.select} aria-label="Device" value={filters.device ?? ""} onChange={(e) => set({ device: (e.target.value || undefined) as ViFilters["device"] })}>
        <option value="">All devices</option>
        <option value="mobile">Mobile</option>
        <option value="desktop">Desktop</option>
        <option value="tablet">Tablet</option>
      </select>
      <select className={s.select} aria-label="Visitor type" value={filters.visitorType ?? ""} onChange={(e) => set({ visitorType: (e.target.value || undefined) as ViFilters["visitorType"] })}>
        <option value="">All visitors</option>
        <option value="new">New</option>
        <option value="returning">Returning</option>
        <option value="registered">Registered</option>
        <option value="anonymous">Anonymous</option>
      </select>
      <select className={s.select} aria-label="Business module" value={filters.module ?? ""} onChange={(e) => set({ module: (e.target.value || undefined) as ViFilters["module"] })}>
        <option value="">All modules</option>
        {VI_MODULES.map((m) => (
          <option key={m} value={m}>
            {VI_MODULE_LABELS[m]}
          </option>
        ))}
      </select>
      {(filters.city || filters.channel || filters.device || filters.visitorType || filters.module) && (
        <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => { setCity(""); setFilters({ period: filters.period, from: filters.from, to: filters.to }); }}>
          Clear
        </button>
      )}
    </div>
  );
}
