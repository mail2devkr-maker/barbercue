"use client";

import { useCallback, useMemo, useState } from "react";
import {
  VI_CHANNEL_LABELS,
  VI_GEO_SOURCE_LABELS,
  VI_MODULE_LABELS,
  VI_PATHS,
  type ViBreakdownRow,
  type ViChannel,
  type ViGeoSource,
  type ViLiveDto,
  type ViLiveSessionDto,
  type ViModule,
  type ViOverviewDto,
} from "@barbercue/shared";
import { AreaChart, BarChart } from "../../owner/charts";
import { GeoMap, type GeoPoint } from "./GeoMap";
import { DataTable, Donut, Drawer, Empty, ErrorBox, Funnel, HBars, Info, Kpi, LevelPill, Panel, Skeleton, type Column, type FunnelStageView } from "./parts";
import { fmtAgo, fmtDateTime, fmtDuration, fmtInr, fmtNum, fmtPaise, fmtPct, fmtTime, useVi, viPath, viSend } from "./vi-api";
import { useViContext } from "./VisitorIntelligence";
import s from "./vi.module.css";

type Row = ViBreakdownRow & { pageViews?: number; searches?: number; avgEngagedSeconds?: number | null };
const DIMS: Array<[string, string]> = [
  ["channel", "Traffic source"],
  ["city", "City"],
  ["state", "State"],
  ["country", "Country"],
  ["device", "Device"],
  ["browser", "Browser"],
  ["os", "Operating system"],
  ["landing", "Landing page"],
  ["campaign", "Campaign"],
  ["source", "UTM source / referrer"],
  ["day", "Day"],
  ["hour", "Hour of day"],
];

const breakdownColumns = (label: string): Column<Row>[] => [
  { key: "label", label, value: (r) => r.label },
  { key: "visitors", label: "Visitors", value: (r) => r.visitors, num: true },
  { key: "sessions", label: "Visits", value: (r) => r.sessions, num: true },
  { key: "pageViews", label: "Page views", value: (r) => r.pageViews ?? null, num: true },
  { key: "searches", label: "Searches", value: (r) => r.searches ?? null, num: true },
  { key: "eng", label: "Avg engagement", value: (r) => r.avgEngagedSeconds ?? null, render: (r) => fmtDuration(r.avgEngagedSeconds), num: true },
  { key: "bookings", label: "Bookings", value: (r) => r.bookings, num: true },
  { key: "conv", label: "Conversion", value: (r) => r.conversionPct, render: (r) => fmtPct(r.conversionPct), num: true },
  { key: "rev", label: "Value", value: (r) => r.revenuePaise / 100, render: (r) => fmtPaise(r.revenuePaise), num: true },
];

/** Drill-down: any KPI or chart opens the supporting rows, by any dimension, for the same filters. */
function DrilldownDrawer({ title, initialDim, onClose }: { title: string; initialDim: string; onClose: () => void }) {
  const { query } = useViContext();
  const [dim, setDim] = useState(initialDim);
  const res = useVi<{ rows: Row[] }>(viPath(`${VI_PATHS.drilldown}?${query({ dim })}`), `${query()}|${dim}`);
  const label = DIMS.find(([d]) => d === dim)?.[1] ?? dim;
  return (
    <Drawer title={title} onClose={onClose}>
      <div className={s.row} style={{ marginBottom: 12 }}>
        <span className={s.muted}>Break down by</span>
        <select className={s.select} value={dim} onChange={(e) => setDim(e.target.value)} aria-label="Dimension">
          {DIMS.map(([d, l]) => (
            <option key={d} value={d}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {res.error && <ErrorBox message={res.error} onRetry={res.reload} />}
      {res.loading && !res.data ? <Skeleton height={300} /> : <DataTable rows={res.data?.rows ?? []} columns={breakdownColumns(label)} exportName={`fastque-drilldown-${dim}`} />}
    </Drawer>
  );
}

// ================= Overview =================

const SERIES_METRICS = [
  ["visitors", "Visitors"],
  ["sessions", "Visits"],
  ["pageViews", "Page views"],
  ["searches", "Searches"],
  ["bookings", "Bookings"],
  ["revenuePaise", "Value"],
] as const;

export function OverviewTab() {
  const { query, filters, setFilters, liveRevision } = useViContext();
  const res = useVi<ViOverviewDto>(viPath(`${VI_PATHS.overview}?${query()}`), `${query()}|${Math.floor(liveRevision / 15)}`, { pollMs: 60_000 });
  const [drill, setDrill] = useState<{ title: string; dim: string } | null>(null);
  const [metric, setMetric] = useState<(typeof SERIES_METRICS)[number][0]>("visitors");
  const d = res.data;
  if (res.error) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (!d) return <Skeleton height={110} count={4} />;
  const k = d.kpis;
  const open = (title: string, dim = "channel") => () => setDrill({ title, dim });
  const money = (v: number | null) => fmtPaise(v);
  const pctF = (v: number | null) => fmtPct(v);
  const sec = (v: number | null) => fmtDuration(v);
  return (
    <>
      {d.dataNote && <div className={s.banner}>{d.dataNote}</div>}
      <div className={s.kpiSection}>
        <h2>Visitors</h2>
        <div className={s.kpiGrid}>
          <Kpi label="Unique visitors" kpi={k.uniqueVisitors} onClick={open("Unique visitors")} help="Distinct consented browsers with at least one visit in the period." />
          <Kpi label="Visits" kpi={k.visits} onClick={open("Visits")} help="Sessions. A new session starts after 30 minutes of inactivity." />
          <Kpi label="Active now" value={k.activeNow} help="Sessions with activity inside the configured activity window." />
          <Kpi label="New visitors" kpi={k.newVisitors} onClick={open("New visitors", "city")} />
          <Kpi label="Returning visitors" kpi={k.returningVisitors} onClick={open("Returning visitors", "city")} />
          <Kpi label="Anonymous" kpi={k.anonymousVisitors} onClick={open("Anonymous visitors", "device")} />
          <Kpi label="Registered" kpi={k.registeredVisitors} onClick={open("Registered visitors", "device")} help="Visitors linked to a FastQue account after login (with consent)." />
        </div>
      </div>
      <div className={s.kpiSection}>
        <h2>Engagement & interest</h2>
        <div className={s.kpiGrid}>
          <Kpi label="Page views" kpi={k.pageViews} onClick={open("Page views", "landing")} />
          <Kpi label="Avg engagement" kpi={k.avgEngagementSeconds} format={sec} help="Average visible time per visit." onClick={open("Engagement", "device")} />
          <Kpi label="Engagement rate" kpi={k.engagementRatePct} format={pctF} help="Visits with 10+ seconds visible, 2+ pages, a search or a conversion." onClick={open("Engagement rate", "channel")} />
          <Kpi label="Service searches" kpi={k.serviceSearches} onClick={open("Searches", "city")} />
          <Kpi label="Salon profile views" kpi={k.salonProfileViews} onClick={open("Salon profile views", "city")} />
          <Kpi label="Product views" kpi={k.productViews} onClick={open("Product views", "channel")} />
        </div>
      </div>
      <div className={s.kpiSection}>
        <h2>Outcomes</h2>
        <div className={s.kpiGrid}>
          <Kpi label="Registrations" kpi={k.registrations} onClick={open("Registrations")} />
          <Kpi label="Bookings" kpi={k.bookings} onClick={open("Bookings")} help="Website bookings verified against the booking itself." />
          <Kpi label="Product purchases" kpi={k.purchases} onClick={open("Purchases")} />
          <Kpi label="Visitor → booking" kpi={k.visitorToBookingPct} format={pctF} onClick={open("Visitor → booking", "city")} />
          <Kpi label="Visitor → purchase" kpi={k.visitorToPurchasePct} format={pctF} onClick={open("Visitor → purchase")} />
          <Kpi label="Booking & order value" kpi={k.revenuePaise} format={money} help="Value recorded on verified bookings (after online discount) and orders. Salon service value, not FastQue revenue." onClick={open("Value", "city")} />
          <Kpi label="Value per visitor" kpi={k.revenuePerVisitorPaise} format={money} onClick={open("Value per visitor")} />
        </div>
      </div>

      <Panel
        title="Trend"
        subtitle={`${fmtDateTime(d.from)} – ${fmtDateTime(new Date(new Date(d.to).getTime() - 1))} (IST)`}
        actions={
          <div className={s.chips}>
            {SERIES_METRICS.map(([m, l]) => (
              <button key={m} type="button" className={`${s.chip} ${metric === m ? s.chipOn : ""}`} onClick={() => setMetric(m)}>
                {l}
              </button>
            ))}
          </div>
        }
      >
        <AreaChart points={d.series.map((p) => ({ label: p.date.slice(5), value: metric === "revenuePaise" ? p.revenuePaise / 100 : p[metric] }))} formatValue={(v) => (metric === "revenuePaise" ? fmtInr(v) : fmtNum(v))} ariaLabel={`Daily ${metric}`} />
      </Panel>

      <div className={s.grid3}>
        <Panel title="Traffic sources" help="Last-touch channel of each visit. Click a slice to filter." actions={<button type="button" className={`${s.btn} ${s.btnSm}`} onClick={open("Traffic sources")}>Details</button>}>
          <Donut ariaLabel="Visits by source" parts={d.byChannel.map((r) => ({ key: r.key, label: r.label, value: r.sessions }))} onSelect={(key) => setFilters({ ...filters, channel: key as ViChannel })} />
        </Panel>
        <Panel title="Devices" actions={<button type="button" className={`${s.btn} ${s.btnSm}`} onClick={open("Devices", "device")}>Details</button>}>
          <Donut ariaLabel="Visits by device" parts={d.byDevice.map((r) => ({ key: r.key, label: r.label, value: r.sessions }))} onSelect={(key) => setFilters({ ...filters, device: key as "mobile" })} />
        </Panel>
        <Panel title="Top cities" help="Approximate, from network data or the city the visitor chose." actions={<button type="button" className={`${s.btn} ${s.btnSm}`} onClick={open("Cities", "city")}>Details</button>}>
          <HBars rows={d.byCity.slice(0, 8).map((r) => ({ key: r.key, label: r.label, value: r.visitors }))} onSelect={(key) => key !== "Unknown" && setFilters({ ...filters, city: key })} />
        </Panel>
      </div>
      <Panel title="Booking funnel" help="Sessions that searched, viewed a salon, started and confirmed a booking. See Customer Journey for every module.">
        <Funnel stages={d.funnel} />
      </Panel>
      {drill && <DrilldownDrawer title={drill.title} initialDim={drill.dim} onClose={() => setDrill(null)} />}
    </>
  );
}

// ================= Live =================

function TimelineDrawer({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const res = useVi<{ visitorLabel: string; startedAt: string; channel: string; device: string; city: string | null; geoSource: ViGeoSource; note: string; events: Array<{ type: string; occurredAt: string; path: string; entityType: string | null; entityId: string | null; metadata: Record<string, unknown> | null }> }>(viPath(`${VI_PATHS.sessions}/${sessionId}/timeline`), sessionId);
  const d = res.data;
  return (
    <Drawer title={d ? `${d.visitorLabel} · session timeline` : "Session timeline"} onClose={onClose}>
      {res.error && <ErrorBox message={res.error} />}
      {!d ? (
        <Skeleton height={300} />
      ) : (
        <>
          <p className={s.muted}>
            {fmtDateTime(d.startedAt)} · {VI_CHANNEL_LABELS[d.channel as ViChannel] ?? d.channel} · {d.device} · {d.city ?? "Unknown city"} ({VI_GEO_SOURCE_LABELS[d.geoSource]})
          </p>
          <ol className={s.timeline}>
            {d.events.map((e, i) => (
              <li key={i}>
                <time>{fmtTime(e.occurredAt)}</time>
                <strong>{e.type.replace(/_/g, " ")}</strong>
                <span>
                  {e.path}
                  {e.metadata && Object.keys(e.metadata).length ? ` · ${Object.entries(e.metadata).map(([k, v]) => `${k}: ${String(v)}`).join(", ")}` : ""}
                </span>
              </li>
            ))}
          </ol>
          <p className={s.note}>{d.note}</p>
        </>
      )}
    </Drawer>
  );
}

function LiveCard({ v, onOpen }: { v: ViLiveSessionDto; onOpen?: () => void }) {
  const status = v.bookingStatus === "confirmed" ? "Booked" : v.purchaseStatus === "purchased" ? "Purchased" : v.bookingStatus === "started" ? "Booking…" : v.purchaseStatus !== "none" ? "In cart" : v.bookingStatus === "failed" ? "Booking failed" : null;
  return (
    <button type="button" className={`${s.liveCard} ${v.active ? "" : s.liveCardIdle}`} onClick={onOpen} disabled={!onOpen}>
      <span className={`${s.dot} ${v.active ? "" : s.dotIdle}`} aria-label={v.active ? "Active" : "Inactive"} />
      <span className={s.liveMain}>
        <strong>
          {v.registered && v.identity?.name ? v.identity.name : v.visitorLabel} {v.registered ? <span className={`${s.pill} ${s.pillGood}`}>Signed in</span> : <span className={s.pill}>Guest</span>}
          {status && <> <span className={`${s.pill} ${s.pillMedium}`}>{status}</span></>}
        </strong>
        <span title={`${VI_GEO_SOURCE_LABELS[v.geoSource]} · confidence ${v.geoConfidence}`}>
          📍 {[v.city, v.state, v.country].filter(Boolean).join(", ") || "Unknown location"} <span className={s.muted}>({v.geoConfidence} confidence)</span>
        </span>
        <span>
          Now on <strong>{v.currentPath ?? "—"}</strong>
          {v.previousPath ? ` · from ${v.previousPath}` : ""} · entered {v.entryPath ?? "—"}
        </span>
        {(v.searches.length > 0 || v.salonsViewed > 0 || v.productsViewed > 0) && (
          <span>
            {v.searches.length > 0 && `🔎 ${v.searches.join(", ")}`} {v.salonsViewed > 0 && `· ${v.salonsViewed} salons viewed`} {v.productsViewed > 0 && `· ${v.productsViewed} products`}
          </span>
        )}
      </span>
      <span className={s.liveSide}>
        <span>{fmtAgo(v.lastActivityAt)}</span>
        <span>
          {fmtDuration(v.durationSeconds)} · {v.device}
          {v.browser ? ` · ${v.browser}` : ""}
          {v.os ? ` / ${v.os}` : ""}
        </span>
        <span>
          {VI_CHANNEL_LABELS[v.channel] ?? v.channel}
          {v.campaign ? ` · ${v.campaign}` : ""}
        </span>
      </span>
    </button>
  );
}

export function LiveTab() {
  const { me, can, liveRevision } = useViContext();
  const [windowMin, setWindowMin] = useState(me.activityWindowMinutes);
  const [open, setOpen] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(true);
  const res = useVi<ViLiveDto>(viPath(`${VI_PATHS.live}?window=${windowMin}`), `${windowMin}|${liveRevision}`, { pollMs: 10_000 });
  const d = res.data;
  return (
    <>
      <div className={s.filters}>
        <span className={s.liveBadge}>
          <span className={s.dot} /> {d ? `${d.activeCount} active` : "…"}
        </span>
        <label className={s.row}>
          <span className={s.muted}>Active if seen in the last</span>
          <select className={s.select} value={windowMin} onChange={(e) => setWindowMin(Number(e.target.value))} aria-label="Activity window">
            {[1, 2, 5, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
        <label className={s.check}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show recently inactive
        </label>
        <span className={s.filterSpacer} />
        <span className={s.muted}>{d ? `Updated ${fmtTime(d.generatedAt)}` : ""}</span>
      </div>
      {res.error && <ErrorBox message={res.error} onRetry={res.reload} />}
      {!d ? (
        <Skeleton height={80} count={5} />
      ) : (
        <div className={s.grid3}>
          <div className={s.span2}>
            <Panel title={`Active now (${d.activeCount})`} subtitle="Updates automatically. Locations are approximate and never an address.">
              {d.sessions.filter((v) => v.active).length ? (
                <div className={s.liveGrid}>
                  {d.sessions.filter((v) => v.active).map((v) => (
                    <LiveCard key={v.sessionId} v={v} onOpen={can("timeline") ? () => setOpen(v.sessionId) : undefined} />
                  ))}
                </div>
              ) : (
                <Empty title="Nobody active right now">Visitors appear here within seconds of browsing, once they accept analytics cookies.</Empty>
              )}
            </Panel>
            {showInactive && d.inactiveCount > 0 && (
              <Panel title={`Recently inactive (${d.inactiveCount})`}>
                <div className={s.liveGrid}>
                  {d.sessions.filter((v) => !v.active).slice(0, 50).map((v) => (
                    <LiveCard key={v.sessionId} v={v} onOpen={can("timeline") ? () => setOpen(v.sessionId) : undefined} />
                  ))}
                </div>
              </Panel>
            )}
          </div>
          <div>
            <Panel title="Active by city">
              <HBars rows={d.byCity.map((c) => ({ key: c.city, label: c.city, value: c.count }))} />
            </Panel>
            <Panel title="Active pages">
              <HBars rows={d.byPath.map((c) => ({ key: c.path, label: c.path, value: c.count }))} />
            </Panel>
          </div>
        </div>
      )}
      {open && <TimelineDrawer sessionId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

// ================= Visitor history =================

interface VisitorRow {
  id: string;
  label: string;
  registered: boolean;
  contact: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  sessionCount: number;
  pageViews: number;
  searches: number;
  salonViews: number;
  bookingAttempts: number;
  bookings: number;
  purchases: number;
  revenuePaise: number;
  engagedSeconds: number;
  firstChannel: string | null;
  lastChannel: string | null;
  city: string | null;
  state: string | null;
  deviceCategory: string | null;
  topServices: Record<string, number> | null;
  priceMinInr: number | null;
  priceMaxInr: number | null;
}

interface VisitorDetail {
  label: string;
  firstSeenAt: string;
  lastSeenAt: string;
  visits: number;
  pageViews: number;
  engagedSeconds: number;
  location: { country: string | null; state: string | null; city: string | null; note: string };
  device: string | null;
  firstTouch: { channel: string | null; source: string | null; campaign: string | null };
  lastTouch: { channel: string | null; source: string | null; campaign: string | null };
  frequentServices: Array<{ query: string; category: string | null; count: number }>;
  inferredPriceRange: { minInr: number | null; maxInr: number | null; basis: string } | null;
  salonsViewed: Array<{ salon: string; views: number }>;
  productsViewed: number;
  bookingAttempts: number;
  bookings: number;
  purchases: number;
  revenueInr: number;
  marketingConsent: boolean;
  registered: null | { contact: string | null; contactMasked: boolean; registeredAt: string | null; completedBookings: number; cancelledBookings: number; noShows: number; purchases: number; totalSpendInr: number; clvInr: number; preferredSalons: Array<{ name: string; bookings: number }>; lastBookingAt: string | null };
  conversions: Array<{ type: string; at: string; valueInr: number; channel: string | null }>;
  sessions: Array<{ id: string; startedAt: string; durationSeconds: number; pageViews: number; channel: string; entryPath: string | null; city: string | null; geoSourceLabel: string; device: string; bookingConfirmed: boolean; purchased: boolean }>;
}

function VisitorDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useViContext();
  const res = useVi<VisitorDetail>(viPath(`${VI_PATHS.visitors}/${id}`), id);
  const [timeline, setTimeline] = useState<string | null>(null);
  const d = res.data;
  const ch = (c: string | null) => (c ? (VI_CHANNEL_LABELS[c as ViChannel] ?? c) : "—");
  return (
    <Drawer title={d?.label ?? "Visitor"} onClose={onClose}>
      {res.error && <ErrorBox message={res.error} />}
      {!d ? (
        <Skeleton height={400} />
      ) : (
        <div className={s.stack}>
          <div className={s.kpiGrid}>
            <Kpi label="Visits" value={d.visits} />
            <Kpi label="Page views" value={d.pageViews} />
            <Kpi label="Engagement" value={d.engagedSeconds} format={(v) => fmtDuration(v)} />
            <Kpi label="Booking attempts" value={d.bookingAttempts} />
            <Kpi label="Bookings" value={d.bookings} />
            <Kpi label="Tracked value" value={d.revenueInr} format={(v) => fmtInr(v)} />
          </div>
          <Panel title="Profile">
            <p>
              First visit {fmtDateTime(d.firstSeenAt)} · last {fmtDateTime(d.lastSeenAt)} · {d.device ?? "unknown device"}
            </p>
            <p>
              📍 {[d.location.city, d.location.state, d.location.country].filter(Boolean).join(", ") || "Unknown"} <span className={s.muted}>({d.location.note})</span>
            </p>
            <p>
              First touch: <strong>{ch(d.firstTouch.channel)}</strong> {d.firstTouch.campaign ? `(${d.firstTouch.campaign})` : ""} · Last touch: <strong>{ch(d.lastTouch.channel)}</strong> {d.lastTouch.campaign ? `(${d.lastTouch.campaign})` : ""}
            </p>
            {d.inferredPriceRange && (
              <p>
                Price range: {fmtInr(d.inferredPriceRange.minInr)} – {fmtInr(d.inferredPriceRange.maxInr)} <span className={s.muted}>({d.inferredPriceRange.basis})</span>
              </p>
            )}
            <p className={s.muted}>Marketing consent: {d.marketingConsent ? "yes" : "no"}</p>
          </Panel>
          {d.registered && (
            <Panel title="Registered customer" help={d.registered.contactMasked ? "Contact is masked for your role." : "Viewing contact details is recorded in the audit log."}>
              <p>
                Contact: <strong>{d.registered.contact ?? "—"}</strong> · registered {fmtDateTime(d.registered.registeredAt)}
              </p>
              <p>
                {d.registered.completedBookings} completed · {d.registered.cancelledBookings} cancelled · {d.registered.noShows} no-shows · {d.registered.purchases} orders
              </p>
              <p>
                Spend to date {fmtInr(d.registered.totalSpendInr)} · CLV (realised) {fmtInr(d.registered.clvInr)} · last booking {fmtDateTime(d.registered.lastBookingAt)}
              </p>
              {d.registered.preferredSalons.length > 0 && <p>Preferred salons: {d.registered.preferredSalons.map((p) => `${p.name} (${p.bookings})`).join(", ")}</p>}
              <p className={s.muted}>Loyalty: not available (no loyalty programme data yet).</p>
            </Panel>
          )}
          <div className={s.grid2}>
            <Panel title="Frequent services">
              <HBars rows={d.frequentServices.map((f) => ({ key: f.query, label: f.category ?? f.query, value: f.count }))} />
            </Panel>
            <Panel title="Salons viewed">
              <HBars rows={d.salonsViewed.map((f) => ({ key: f.salon, label: f.salon, value: f.views }))} />
            </Panel>
          </div>
          <Panel title="Sessions">
            <DataTable
              searchable={false}
              rows={d.sessions}
              onRowClick={can("timeline") ? (r) => setTimeline(r.id) : undefined}
              columns={[
                { key: "t", label: "Started", value: (r) => r.startedAt, render: (r) => fmtDateTime(r.startedAt) },
                { key: "d", label: "Duration", value: (r) => r.durationSeconds, render: (r) => fmtDuration(r.durationSeconds), num: true },
                { key: "pv", label: "Pages", value: (r) => r.pageViews, num: true },
                { key: "c", label: "Source", value: (r) => ch(r.channel) },
                { key: "e", label: "Entry", value: (r) => r.entryPath },
                { key: "city", label: "City", value: (r) => r.city ?? "—" },
                { key: "o", label: "Outcome", value: (r) => (r.bookingConfirmed ? "Booked" : r.purchased ? "Purchased" : "—") },
              ]}
            />
          </Panel>
        </div>
      )}
      {timeline && <TimelineDrawer sessionId={timeline} onClose={() => setTimeline(null)} />}
    </Drawer>
  );
}

export function HistoryTab() {
  const { query } = useViContext();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("last");
  const [open, setOpen] = useState<string | null>(null);
  const res = useVi<{ total: number; page: number; pageSize: number; items: VisitorRow[] }>(viPath(`${VI_PATHS.visitors}?${query({ page, pageSize: 50, q: search || undefined, sort })}`), `${query()}|${page}|${search}|${sort}`);
  const d = res.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const ch = (c: string | null) => (c ? (VI_CHANNEL_LABELS[c as ViChannel] ?? c) : "—");
  return (
    <Panel title="Visitor history" subtitle="Pseudonymous visitors; registered identity only for roles allowed to see it." actions={d && <span className={s.muted}>{fmtNum(d.total)} visitors</span>}>
      <form
        className={s.tableTools}
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(q.trim());
        }}
      >
        <input className={s.input} placeholder="Guest # or city (or phone/email if permitted)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search visitors" style={{ minWidth: 260 }} />
        <button type="submit" className={`${s.btn} ${s.btnSm}`}>
          Search
        </button>
        <select className={s.select} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="last">Last visit</option>
          <option value="first">First visit</option>
          <option value="visits">Most visits</option>
          <option value="revenue">Highest value</option>
        </select>
      </form>
      {res.error && <ErrorBox message={res.error} onRetry={res.reload} />}
      {!d ? (
        <Skeleton height={300} />
      ) : (
        <DataTable
          searchable={false}
          pageSize={50}
          rows={d.items}
          exportName="fastque-visitors-page"
          onRowClick={(r) => setOpen(r.id)}
          columns={[
            { key: "label", label: "Visitor", value: (r) => r.label, render: (r) => (<span>{r.label} {r.registered && <span className={`${s.pill} ${s.pillGood}`}>{r.contact ?? "Registered"}</span>}</span>) },
            { key: "first", label: "First visit", value: (r) => r.firstSeenAt, render: (r) => fmtDateTime(r.firstSeenAt) },
            { key: "last", label: "Last visit", value: (r) => r.lastSeenAt, render: (r) => fmtAgo(r.lastSeenAt) },
            { key: "visits", label: "Visits", value: (r) => r.sessionCount, num: true },
            { key: "city", label: "Approx. location", value: (r) => [r.city, r.state].filter(Boolean).join(", ") || "—" },
            { key: "services", label: "Frequent services", value: (r) => Object.keys(r.topServices ?? {}).slice(0, 3).join(", ") || "—" },
            { key: "price", label: "Price range", value: (r) => (r.priceMinInr != null || r.priceMaxInr != null ? `${fmtInr(r.priceMinInr)}–${fmtInr(r.priceMaxInr)}` : "—"), hidden: true },
            { key: "salons", label: "Salons viewed", value: (r) => r.salonViews, num: true },
            { key: "attempts", label: "Booking attempts", value: (r) => r.bookingAttempts, num: true },
            { key: "bookings", label: "Bookings", value: (r) => r.bookings, num: true },
            { key: "src", label: "First source", value: (r) => ch(r.firstChannel) },
            { key: "eng", label: "Engagement", value: (r) => r.engagedSeconds, render: (r) => fmtDuration(r.engagedSeconds), num: true, hidden: true },
            { key: "value", label: "Value", value: (r) => r.revenuePaise / 100, render: (r) => fmtPaise(r.revenuePaise), num: true },
          ]}
        />
      )}
      {d && pages > 1 && (
        <div className={s.pager}>
          <span>
            Page {page} of {pages}
          </span>
          <span className={s.row}>
            <button type="button" className={`${s.btn} ${s.btnSm}`} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button type="button" className={`${s.btn} ${s.btnSm}`} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </span>
        </div>
      )}
      {open && <VisitorDrawer id={open} onClose={() => setOpen(null)} />}
    </Panel>
  );
}

// ================= Geography =================

interface GeoRow {
  key: string;
  country: string | null;
  state: string | null;
  visitors: number;
  sessions: number;
  liveVisitors: number;
  searches: number;
  zeroResultSearches: number;
  bookings: number;
  purchases: number;
  revenuePaise: number;
  conversionPct: number | null;
  activeSalons: number;
  avgSearchedPriceInr: number | null;
  topServices: string[];
  opportunity: { demand: number; pressure: number; level: string; score: number };
  geoSourceLabel: string;
  confidence: string;
  coords: { lat: number; lng: number } | null;
}

function AssignDrawer({ row, onClose, onDone }: { row: GeoRow; onClose: () => void; onDone: (msg: string) => void }) {
  const { query } = useViContext();
  const people = useVi<Array<{ id: string; fullName: string; territory: string | null; employeeCode: string }>>(viPath("crm/assignees"), "assignees");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState(row.opportunity.level === "HIGH" ? "HIGH" : "NORMAL");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const suggested = useMemo(() => people.data?.filter((p) => (p.territory ?? "").toLowerCase().includes(row.key.toLowerCase())) ?? [], [people.data, row.key]);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await viSend<{ taskCode: string }>(viPath(`${VI_PATHS.opportunities}/assign?${query()}`), "POST", { city: row.key, state: row.state, assigneeEmployeeId: assignee, priority, dueAt: due ? new Date(`${due}T18:00:00+05:30`).toISOString() : null, note: note || null });
      onDone(`CRM task ${r.taskCode} created for ${row.key}.`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the task.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer title={`Assign ${row.key} to sales`} onClose={onClose}>
      <p className={s.muted}>
        Creates a Field CRM task with the location, metrics, recommended action, priority, owner and due date. Opportunity {row.opportunity.level} · score {row.opportunity.score}.
      </p>
      {err && <ErrorBox message={err} />}
      <div className={s.form}>
        <label className={s.field}>
          Owner (territory manager / sales)
          <select className={s.select} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Choose…</option>
            {suggested.length > 0 && (
              <optgroup label={`Territory matches ${row.key}`}>
                {suggested.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} ({p.territory})
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Everyone">
              {(people.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                  {p.territory ? ` (${p.territory})` : ""}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className={s.field}>
          Priority
          <select className={s.select} value={priority} onChange={(e) => setPriority(e.target.value)}>
            {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className={s.field}>
          Due date (default 1–2 weeks)
          <input className={s.input} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className={s.field} style={{ gridColumn: "1 / -1" }}>
          Note
          <input className={s.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </label>
      </div>
      <div className={s.row} style={{ marginTop: 14 }}>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={!assignee || busy} onClick={() => void submit()}>
          {busy ? "Creating…" : "Create CRM task"}
        </button>
      </div>
    </Drawer>
  );
}

export function GeoTab() {
  const { query, can, filters, setFilters } = useViContext();
  const [level, setLevel] = useState<"country" | "state" | "city" | "locality">("city");
  const [assign, setAssign] = useState<GeoRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const res = useVi<{ level: string; note: string; rows: GeoRow[] }>(viPath(`${VI_PATHS.geo}?${query({ level })}`), `${query()}|${level}`);
  const rows = useMemo(() => res.data?.rows ?? [], [res.data]);
  const points: GeoPoint[] = useMemo(
    () => rows.filter((r) => r.coords).map((r) => ({ key: r.key, lat: r.coords!.lat, lng: r.coords!.lng, value: r.visitors, level: r.opportunity.level, tooltip: `${r.key}: ${r.visitors} visitors, ${r.searches} searches, ${r.activeSalons} salons (${r.opportunity.level})` })),
    [rows],
  );
  const drill = useCallback(
    (key: string) => {
      if (level === "country") {
        setFilters({ ...filters, country: key });
        setLevel("state");
      } else if (level === "state") {
        setFilters({ ...filters, state: key });
        setLevel("city");
      } else if (level === "city") setFilters({ ...filters, city: key });
    },
    [level, filters, setFilters],
  );
  const crumbs = [["country", "World"], ["state", filters.country ?? "Country"], ["city", filters.state ?? "State"], ["locality", filters.city ?? "City"]] as const;
  return (
    <>
      <div className={s.row} style={{ marginBottom: 12 }}>
        {crumbs.map(([l, label], i) => (
          <button key={l} type="button" className={`${s.chip} ${level === l ? s.chipOn : ""}`} onClick={() => {
            setLevel(l);
            if (i === 0) setFilters({ ...filters, country: undefined, state: undefined, city: undefined });
            if (i === 1) setFilters({ ...filters, state: undefined, city: undefined });
            if (i === 2) setFilters({ ...filters, city: undefined });
          }}>
            {i > 0 ? "› " : ""}
            {label}
          </button>
        ))}
      </div>
      {toast && <div className={s.banner}>{toast}</div>}
      {res.error && <ErrorBox message={res.error} onRetry={res.reload} />}
      {!res.data ? (
        <Skeleton height={400} />
      ) : (
        <>
          {level === "city" && (
            <Panel title="Demand map" help="Circle size = visitors; colour = opportunity (pink high, amber medium, blue low). Plotted at city centres only.">
              {points.length ? <GeoMap points={points} onSelect={drill} /> : <Empty title="No mappable cities yet">Cities appear once visitors from known FastQue cities arrive.</Empty>}
            </Panel>
          )}
          <Panel title={`By ${level}`} subtitle={res.data.note} help="Opportunity: demand (searches + 0.3×visitors + 0.5×zero-result searches) per active salon. HIGH ≥ 50 demand and ≥ 25 per salon.">
            <DataTable
              rows={rows}
              exportName={`fastque-geo-${level}`}
              onRowClick={level === "locality" ? undefined : (r) => drill(r.key)}
              columns={[
                { key: "k", label: level[0].toUpperCase() + level.slice(1), value: (r) => r.key },
                { key: "v", label: "Visitors", value: (r) => r.visitors, num: true },
                { key: "live", label: "Live", value: (r) => r.liveVisitors, num: true },
                { key: "se", label: "Searches", value: (r) => r.searches, num: true },
                { key: "zr", label: "No-result searches", value: (r) => r.zeroResultSearches, num: true },
                { key: "b", label: "Bookings", value: (r) => r.bookings, num: true },
                { key: "p", label: "Purchases", value: (r) => r.purchases, num: true, hidden: true },
                { key: "rev", label: "Value", value: (r) => r.revenuePaise / 100, render: (r) => fmtPaise(r.revenuePaise), num: true },
                { key: "conv", label: "Conversion", value: (r) => r.conversionPct, render: (r) => fmtPct(r.conversionPct), num: true },
                { key: "sal", label: "Active salons", value: (r) => r.activeSalons, num: true },
                { key: "dps", label: "Demand / salon", value: (r) => r.opportunity.pressure, num: true },
                { key: "price", label: "Avg searched price", value: (r) => r.avgSearchedPriceInr, render: (r) => fmtInr(r.avgSearchedPriceInr), num: true, hidden: true },
                { key: "top", label: "Top services", value: (r) => r.topServices.join(", ") || "—" },
                { key: "opp", label: "Opportunity", value: (r) => r.opportunity.score, render: (r) => (<span><LevelPill level={r.opportunity.level} /> {r.opportunity.score}</span>), num: true },
                { key: "src", label: "Location source", value: (r) => `${r.geoSourceLabel} · ${r.confidence}`, hidden: true },
                ...(can("assignOpportunity") && level === "city"
                  ? [{ key: "act", label: "", value: () => "", render: (r: GeoRow) => (r.key !== "Unknown" ? (<button type="button" className={`${s.btn} ${s.btnSm}`} onClick={(e) => { e.stopPropagation(); setAssign(r); }}>Assign</button>) : null) } satisfies Column<GeoRow>]
                  : []),
              ]}
            />
          </Panel>
        </>
      )}
      {assign && <AssignDrawer row={assign} onClose={() => setAssign(null)} onDone={setToast} />}
    </>
  );
}

// ================= Search =================

interface SearchDto {
  totals: { searches: number; zeroResult: number; zeroResultPct: number | null; searchToBookingPct: number | null; searchToPurchasePct: number | null; searchToSalonViewPct: number | null; abandoned: number };
  top: Array<{ query: string; example: string; category: string | null; count: number; zeroResult: number; bookings: number; purchases: number; avgResults: number | null; conversionPct: number | null }>;
  trending: Array<{ query: string; count: number; previous: number; growthPct: number | null; isNew: boolean }>;
  byCity: Array<{ city: string; queries: Array<{ query: string; count: number }> }>;
  hourly: Array<{ hour: number; count: number }>;
  daily: Array<{ date: string; count: number; zeroResult: number }>;
  kinds: Array<{ kind: string; count: number; zeroResult: number }>;
  highDemand: Array<{ category: string; count: number; bookings: number; zeroResult: number; conversionPct: number | null }>;
  unfulfilled: Array<{ query: string; city: string; count: number; zeroResult: number }>;
  filtersUsed: Array<{ filter: string; count: number }>;
  seasonal: Array<{ month: string; category: string; count: number }>;
}

export function SearchTab() {
  const { query } = useViContext();
  const res = useVi<SearchDto>(viPath(`${VI_PATHS.search}?${query()}`), query());
  const d = res.data;
  if (res.error) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (!d) return <Skeleton height={120} count={4} />;
  const months = [...new Set(d.seasonal.map((r) => r.month))];
  const cats = [...new Set(d.seasonal.map((r) => r.category))].slice(0, 12);
  return (
    <>
      <div className={s.kpiGrid} style={{ marginBottom: 14 }}>
        <Kpi label="Searches" value={d.totals.searches} />
        <Kpi label="Zero-result" value={d.totals.zeroResultPct} format={fmtPct} help={`${d.totals.zeroResult} searches found nothing`} />
        <Kpi label="Search → salon view" value={d.totals.searchToSalonViewPct} format={fmtPct} />
        <Kpi label="Search → booking" value={d.totals.searchToBookingPct} format={fmtPct} />
        <Kpi label="Search → purchase" value={d.totals.searchToPurchasePct} format={fmtPct} />
        <Kpi label="Abandoned searches" value={d.totals.abandoned} help="No salon view, booking or purchase after the search." />
      </div>
      <div className={s.grid2}>
        <Panel title="Searches by hour (IST)">
          <BarChart points={d.hourly.map((h) => ({ label: String(h.hour).padStart(2, "0"), value: h.count }))} formatValue={fmtNum} ariaLabel="Searches by hour" height={200} />
        </Panel>
        <Panel title="Daily searches">
          {d.daily.length ? <AreaChart points={d.daily.map((p) => ({ label: p.date.slice(5), value: p.count }))} formatValue={fmtNum} ariaLabel="Daily searches" height={200} /> : <Empty />}
        </Panel>
      </div>
      <Panel title="Top 100 searches" help="Original keyword kept alongside the normalised service (e.g. 'hair cutting' → Haircut). Sensitive text is removed before storage.">
        <DataTable
          rows={d.top}
          exportName="fastque-top-searches"
          columns={[
            { key: "q", label: "Search (normalised)", value: (r) => r.query },
            { key: "ex", label: "As typed", value: (r) => r.example, hidden: true },
            { key: "cat", label: "Service", value: (r) => r.category ?? "—" },
            { key: "n", label: "Searches", value: (r) => r.count, num: true },
            { key: "zr", label: "No results", value: (r) => r.zeroResult, num: true },
            { key: "res", label: "Avg results", value: (r) => r.avgResults, num: true },
            { key: "b", label: "Bookings", value: (r) => r.bookings, num: true },
            { key: "p", label: "Purchases", value: (r) => r.purchases, num: true, hidden: true },
            { key: "c", label: "Conversion", value: (r) => r.conversionPct, render: (r) => fmtPct(r.conversionPct), num: true },
          ]}
        />
      </Panel>
      <div className={s.grid2}>
        <Panel title="Trending" help="Growth vs the previous equivalent period (3+ searches).">
          <DataTable searchable={false} pageSize={10} rows={d.trending} columns={[
            { key: "q", label: "Search", value: (r) => r.query },
            { key: "n", label: "Now", value: (r) => r.count, num: true },
            { key: "p", label: "Before", value: (r) => r.previous, num: true },
            { key: "g", label: "Growth", value: (r) => r.growthPct, render: (r) => (r.isNew ? <span className={`${s.pill} ${s.pillGood}`}>New</span> : fmtPct(r.growthPct)), num: true },
          ]} />
        </Panel>
        <Panel title="High-demand services">
          <DataTable searchable={false} pageSize={10} rows={d.highDemand} columns={[
            { key: "c", label: "Service", value: (r) => r.category },
            { key: "n", label: "Searches", value: (r) => r.count, num: true },
            { key: "zr", label: "No results", value: (r) => r.zeroResult, num: true },
            { key: "conv", label: "Conversion", value: (r) => r.conversionPct, render: (r) => fmtPct(r.conversionPct), num: true },
          ]} />
        </Panel>
      </div>
      <div className={s.grid2}>
        <Panel title="Unfulfilled demand" help="Searches with no results, or without any salon view or booking afterwards.">
          <DataTable searchable={false} pageSize={10} rows={d.unfulfilled} exportName="fastque-unfulfilled-demand" columns={[
            { key: "q", label: "Service / search", value: (r) => r.query },
            { key: "c", label: "City", value: (r) => r.city },
            { key: "n", label: "Searches", value: (r) => r.count, num: true },
            { key: "zr", label: "No results", value: (r) => r.zeroResult, num: true },
          ]} />
        </Panel>
        <Panel title="Popular by city">
          {d.byCity.length ? (
            <div className={s.stack}>
              {d.byCity.slice(0, 10).map((c) => (
                <div key={c.city}>
                  <strong>{c.city}</strong>
                  <span className={s.muted}> — {c.queries.map((q) => `${q.query} (${q.count})`).join(", ")}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty />
          )}
        </Panel>
      </div>
      <div className={s.grid3}>
        <Panel title="Search types" help="Product, home service, stylist, job and staffing searches appear once those modules send them.">
          <Donut ariaLabel="Searches by type" parts={d.kinds.map((k) => ({ key: k.kind, label: k.kind.replace(/_/g, " ").toLowerCase(), value: k.count }))} />
        </Panel>
        <Panel title="Filters used">
          <HBars rows={d.filtersUsed.map((f) => ({ key: f.filter, label: f.filter, value: f.count }))} />
        </Panel>
        <Panel title="Synonyms" help="Analytics groups equivalent wording; the booking search keeps its own stricter matching.">
          <ul className={s.muted} style={{ margin: 0, paddingLeft: 18, fontSize: "0.82rem" }}>
            <li>haircut · hair cutting · hair trimming → Haircut</li>
            <li>facial · face treatment → Facial</li>
            <li>beard trimming · beard grooming → Beard trim</li>
            <li>bridal makeup · wedding makeup → Bridal makeup</li>
            <li>Plus every name group used by FastQue search (Hinglish and common typos).</li>
          </ul>
        </Panel>
      </div>
      <Panel title="Seasonal demand (last 12 months)">
        {months.length ? (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Service</th>
                  {months.map((m) => (
                    <th key={m} className={s.num}>
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c}>
                    <td>{c}</td>
                    {months.map((m) => (
                      <td key={m} className={s.num}>
                        {fmtNum(d.seasonal.find((r) => r.month === m && r.category === c)?.count ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty />
        )}
      </Panel>
    </>
  );
}

// ================= Journey =================

interface FunnelDto {
  label: string;
  stages: FunnelStageView[];
  overallPct: number | null;
  revenuePaise: number;
  splitBy: string | null;
  splits: Array<{ key: string; label: string; sessions: number; overallPct: number | null }>;
  abandonment: { observed: Array<{ reason: string; count: number }>; inferred: Array<{ reason: string; basis: string; confidencePct: number }>; note: string };
}

const FUNNELS: Array<[string, string]> = [
  ["SALON_BOOKING", "Salon booking"],
  ["LIVE_QUEUE", "Live queue"],
  ["MARKETPLACE", "Marketplace"],
  ["HOME_SERVICES", "Home services"],
  ["PARTNER", "Partner registration"],
  ["FREELANCE_STYLIST", "Freelance stylist"],
  ["JOBS", "Jobs"],
  ["INSTANT_HIRING", "Instant hiring"],
  ["LOYALTY", "Loyalty"],
];

export function FunnelView({ funnel, split }: { funnel: string; split: string }) {
  const { query } = useViContext();
  const res = useVi<FunnelDto>(viPath(`${VI_PATHS.funnels}?${query({ funnel, split: split || undefined })}`), `${query()}|${funnel}|${split}`);
  const d = res.data;
  if (res.error) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (!d) return <Skeleton height={300} />;
  return (
    <>
      <div className={s.grid3}>
        <Panel title={d.label} className={s.span2} help="Sequential: a required step counts only if every earlier required step happened. Optional (striped) steps never block. Outcome steps count only when verified by the server." actions={<span className={s.muted}>Overall {fmtPct(d.overallPct)} · {fmtPaise(d.revenuePaise)}</span>}>
          {d.stages[0]?.sessions ? <Funnel stages={d.stages} /> : <Empty title="No sessions for this journey yet">Journeys for modules that are not live yet stay empty until they send events.</Empty>}
        </Panel>
        <Panel title="Why visitors leave" help={d.abandonment.note}>
          <h3 className={s.muted} style={{ fontSize: "0.75rem", margin: "0 0 6px" }}>OBSERVED (measured)</h3>
          <HBars rows={d.abandonment.observed.map((o) => ({ key: o.reason, label: o.reason, value: o.count }))} />
          <h3 className={s.muted} style={{ fontSize: "0.75rem", margin: "14px 0 6px" }}>INFERRED (hypotheses)</h3>
          {d.abandonment.inferred.length ? (
            d.abandonment.inferred.map((i) => (
              <p key={i.reason} style={{ fontSize: "0.82rem", margin: "0 0 8px" }}>
                {i.reason} <span className={s.muted}>— {i.basis} · confidence {i.confidencePct}%</span>
              </p>
            ))
          ) : (
            <p className={s.muted} style={{ fontSize: "0.82rem" }}>No pattern strong enough to suggest a cause.</p>
          )}
        </Panel>
      </div>
      {d.splitBy && (
        <Panel title={`Conversion by ${d.splitBy}`}>
          <DataTable searchable={false} rows={d.splits} columns={[
            { key: "l", label: d.splitBy, value: (r) => r.label },
            { key: "s", label: "Sessions", value: (r) => r.sessions, num: true },
            { key: "c", label: "Overall conversion", value: (r) => r.overallPct, render: (r) => fmtPct(r.overallPct), num: true },
          ]} />
        </Panel>
      )}
    </>
  );
}

export function JourneyTab() {
  const [funnel, setFunnel] = useState("SALON_BOOKING");
  const [split, setSplit] = useState("device");
  return (
    <>
      <div className={s.row} style={{ marginBottom: 12 }}>
        <div className={s.chips}>
          {FUNNELS.map(([k, l]) => (
            <button key={k} type="button" className={`${s.chip} ${funnel === k ? s.chipOn : ""}`} onClick={() => setFunnel(k)}>
              {l}
            </button>
          ))}
        </div>
        <select className={s.select} value={split} onChange={(e) => setSplit(e.target.value)} aria-label="Split by">
          <option value="">No split</option>
          <option value="device">Split by device</option>
          <option value="city">Split by city</option>
          <option value="channel">Split by source</option>
          <option value="campaign">Split by campaign</option>
        </select>
      </div>
      <FunnelView funnel={funnel} split={split} />
      <p className={s.note}>Session timelines (event level, no keystrokes or form contents) open from Live Visitors and Visitor History.</p>
    </>
  );
}

// ================= Sources =================

interface SourcesDto {
  lastTouch: Row[];
  firstTouch: Row[];
  sources: Row[];
  mediums: Row[];
  campaigns: Row[];
  referrers: Row[];
  landingPages: Row[];
  externalKeywords: Array<{ query: string; clicks: number; impressions: number; ctrPct: number | null; position: number | null }>;
  externalKeywordsNote: string;
}

export function SourcesTab() {
  const { query } = useViContext();
  const res = useVi<SourcesDto>(viPath(`${VI_PATHS.sources}?${query()}`), query());
  const d = res.data;
  const [view, setView] = useState<"sources" | "mediums" | "campaigns" | "referrers" | "landingPages">("sources");
  if (res.error) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (!d) return <Skeleton height={200} count={3} />;
  return (
    <>
      <div className={s.grid2}>
        <Panel title="Last-touch channel" help="The source of each visit.">
          <Donut ariaLabel="Visits by last-touch channel" parts={d.lastTouch.map((r) => ({ key: r.key, label: r.label, value: r.sessions }))} />
        </Panel>
        <Panel title="First-touch channel" help="How the visitor first found FastQue, carried on every later visit.">
          <Donut ariaLabel="Visits by first-touch channel" parts={d.firstTouch.map((r) => ({ key: r.key, label: r.label, value: r.sessions }))} />
        </Panel>
      </div>
      <Panel title="Channel performance (last touch)">
        <DataTable rows={d.lastTouch} columns={breakdownColumns("Channel")} exportName="fastque-channels" />
      </Panel>
      <Panel title="Channel performance (first touch)">
        <DataTable rows={d.firstTouch} columns={breakdownColumns("First channel")} exportName="fastque-first-touch" />
      </Panel>
      <Panel
        title="Campaign tags & landing pages"
        actions={
          <div className={s.chips}>
            {([["sources", "UTM source"], ["mediums", "Medium"], ["campaigns", "Campaign"], ["referrers", "Referring domain"], ["landingPages", "Landing page"]] as const).map(([k, l]) => (
              <button key={k} type="button" className={`${s.chip} ${view === k ? s.chipOn : ""}`} onClick={() => setView(k)}>
                {l}
              </button>
            ))}
          </div>
        }
      >
        <DataTable rows={d[view]} columns={breakdownColumns(view)} exportName={`fastque-${view}`} />
      </Panel>
      <Panel title="Google search keywords" subtitle={d.externalKeywordsNote}>
        {d.externalKeywords.length ? (
          <DataTable rows={d.externalKeywords} columns={[
            { key: "q", label: "Query", value: (r) => r.query },
            { key: "c", label: "Clicks", value: (r) => r.clicks, num: true },
            { key: "i", label: "Impressions", value: (r) => r.impressions, num: true },
            { key: "ctr", label: "CTR", value: (r) => r.ctrPct, render: (r) => fmtPct(r.ctrPct), num: true },
            { key: "pos", label: "Avg position", value: (r) => r.position, num: true },
          ]} />
        ) : (
          <Empty title="Search Console not connected" />
        )}
      </Panel>
    </>
  );
}

// ================= Conversions =================

interface ConversionsDto {
  byType: Array<{ type: string; count: number; valuePaise: number }>;
  byModule: Array<{ module: string; count: number; valuePaise: number }>;
  trend: Array<{ date: string; type: string; count: number; valuePaise: number }>;
  recent: Array<{ type: string; occurredAt: string; valuePaise: number; lastChannel: string | null; firstChannel: string | null; city: string | null; visitor: string }>;
  note: string;
}

export function ConversionsTab() {
  const { query } = useViContext();
  const res = useVi<ConversionsDto>(viPath(`${VI_PATHS.conversions}?${query()}`), query());
  const [funnel, setFunnel] = useState("SALON_BOOKING");
  const d = res.data;
  const trend = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of d?.trend ?? []) m.set(t.date, (m.get(t.date) ?? 0) + t.count);
    return [...m].map(([date, value]) => ({ label: date.slice(5), value }));
  }, [d]);
  if (res.error) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (!d) return <Skeleton height={200} count={3} />;
  const ch = (c: string | null) => (c ? (VI_CHANNEL_LABELS[c as ViChannel] ?? c) : "—");
  return (
    <>
      <div className={s.kpiGrid} style={{ marginBottom: 14 }}>
        {d.byType.length ? d.byType.map((t) => <Kpi key={t.type} label={t.type.replace(/_/g, " ").toLowerCase()} value={t.count} />) : <Kpi label="Conversions" value={0} />}
        <Kpi label="Verified value" value={d.byType.reduce((a, t) => a + t.valuePaise, 0)} format={(v) => fmtPaise(v)} help={d.note} />
      </div>
      <div className={s.grid2}>
        <Panel title="Conversions per day">{trend.length ? <AreaChart points={trend} formatValue={fmtNum} ariaLabel="Conversions per day" height={200} /> : <Empty />}</Panel>
        <Panel title="By business module">
          <Donut ariaLabel="Conversions by module" parts={d.byModule.map((m) => ({ key: m.module, label: VI_MODULE_LABELS[m.module as ViModule] ?? m.module, value: m.count }))} />
        </Panel>
      </div>
      <Panel
        title="Funnel by module"
        actions={
          <select className={s.select} value={funnel} onChange={(e) => setFunnel(e.target.value)} aria-label="Funnel">
            {FUNNELS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        }
      >
        <FunnelView funnel={funnel} split="channel" />
      </Panel>
      <Panel title="Recent verified conversions">
        <DataTable rows={d.recent} exportName="fastque-recent-conversions" columns={[
          { key: "t", label: "When", value: (r) => r.occurredAt, render: (r) => fmtDateTime(r.occurredAt) },
          { key: "type", label: "Type", value: (r) => r.type.toLowerCase() },
          { key: "v", label: "Visitor", value: (r) => r.visitor },
          { key: "city", label: "City", value: (r) => r.city ?? "—" },
          { key: "ft", label: "First touch", value: (r) => ch(r.firstChannel) },
          { key: "lt", label: "Last touch", value: (r) => ch(r.lastChannel) },
          { key: "val", label: "Value", value: (r) => r.valuePaise / 100, render: (r) => fmtPaise(r.valuePaise), num: true },
        ]} />
      </Panel>
      <p className={s.note}>
        <Info text="Why not every booking?" /> Only website sessions with analytics consent are attributed. App and walk-in bookings appear in the Command Center, not here.
      </p>
    </>
  );
}
