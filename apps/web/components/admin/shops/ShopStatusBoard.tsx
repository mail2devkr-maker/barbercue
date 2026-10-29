"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ADMIN_PATHS, SalonStatus, type AdminShopStatusDto, type AdminShopStatusRowDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../lib/api";
import ui from "../../owner/owner.module.css";
import { ComboChart, SERIES_COLORS } from "../charts/ComboChart";
import { formatInr } from "../command-center/format";
import css from "./shop-status.module.css";

const REFRESH_MS = 60_000;
const HOUR_MS = 3_600_000;

export type StatusFilter =
  | "all"
  | "open"
  | "closed"
  | "unknown"
  | "openingSoon"
  | "closingSoon"
  | "tempClosed"
  | "accepting"
  | "notAccepting"
  | "quiet";

export const STATUS_FILTERS: ReadonlyArray<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "open", label: "Open now" },
  { id: "closed", label: "Closed now" },
  { id: "unknown", label: "Hours unknown" },
  { id: "openingSoon", label: "Opening soon" },
  { id: "closingSoon", label: "Closing soon" },
  { id: "tempClosed", label: "Temporarily closed" },
  { id: "accepting", label: "Accepting bookings" },
  { id: "notAccepting", label: "Not accepting" },
  { id: "quiet", label: "Open, no bookings" },
];

/** Pure filter used by the table (and its tests). "Soon" = within the next hour of `now`. */
export function matchesFilter(row: AdminShopStatusRowDto, filter: StatusFilter, now: number): boolean {
  switch (filter) {
    case "open":
      return row.scheduled === "OPEN";
    case "closed":
      return row.scheduled === "CLOSED";
    case "unknown":
      return row.scheduled === "UNKNOWN";
    case "openingSoon":
      return !!row.opensAt && Date.parse(row.opensAt) - now <= HOUR_MS;
    case "closingSoon":
      return !!row.closesAt && Date.parse(row.closesAt) - now <= HOUR_MS;
    case "tempClosed":
      return row.temporarilyClosed;
    case "accepting":
      return row.acceptingBookings;
    case "notAccepting":
      return !row.acceptingBookings;
    case "quiet":
      return row.quietSince !== null;
    default:
      return true;
  }
}

const time = (iso: string | null, tz: string | null) =>
  iso ? new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: tz ?? "Asia/Kolkata" }).format(new Date(iso)) : null;

function ScheduleBadge({ row }: { row: AdminShopStatusRowDto }) {
  if (row.scheduled === "OPEN") return <span className={`${ui.badge} ${ui.badgeOk}`}>● Scheduled open</span>;
  if (row.scheduled === "CLOSED") return <span className={`${ui.badge} ${ui.badgeNeutral}`}>○ Scheduled closed</span>;
  return <span className={`${ui.badge} ${ui.badgeWarn}`}>? Hours unknown</span>;
}

/**
 * Live open/closed monitoring. Scheduled status, the owner's temporary closure, accepting bookings
 * and merchant presence are separate concepts and are shown separately - a configured opening time
 * is never presented as proof that a shop is physically open.
 */
export function ShopStatusBoard() {
  const params = useSearchParams();
  const [filter, setFilter] = useState<StatusFilter>((params.get("filter") as StatusFilter) ?? "all");
  const [city, setCity] = useState("all");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<AdminShopStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showHourly = params.get("view") === "hourly";

  useEffect(() => {
    const f = params.get("filter") as StatusFilter | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the filter comes from the sidebar link
    if (f && STATUS_FILTERS.some((s) => s.id === f)) setFilter(f);
  }, [params]);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<AdminShopStatusDto>(`${ADMIN_PATHS.admin}/${ADMIN_PATHS.shops}/${ADMIN_PATHS.shopStatus}`));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not load shop status.");
    }
  }, []);

  // Status changes with the clock, so it refreshes on a fixed interval while the tab is visible.
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  const now = data ? Date.parse(data.generatedAt) : 0;
  const cities = useMemo(() => [...new Set((data?.shops ?? []).map((s) => s.city))].sort(), [data]);
  const rows = useMemo(
    () =>
      (data?.shops ?? []).filter(
        (s) =>
          matchesFilter(s, filter, now) &&
          (city === "all" || s.city === city) &&
          (!search.trim() || `${s.name} ${s.publicId}`.toLowerCase().includes(search.trim().toLowerCase())),
      ),
    [data, filter, city, search, now],
  );

  const c = data?.counts;
  const kpis: Array<{ label: string; value: number | string; foot: string; filter?: StatusFilter }> = c
    ? [
        { label: "Registered shops", value: c.registered, foot: `${c.eligible} operational (active)` },
        { label: "Scheduled open now", value: c.scheduledOpen, foot: "by configured hours", filter: "open" },
        { label: "Scheduled closed now", value: c.scheduledClosed, foot: "by configured hours", filter: "closed" },
        { label: "Hours unknown", value: c.unknownSchedule, foot: "no hours or time zone set", filter: "unknown" },
        { label: "Temporarily closed", value: c.temporarilyClosed, foot: "owner closed for today", filter: "tempClosed" },
        { label: "Accepting bookings", value: c.acceptingBookings, foot: "active, not closed today", filter: "accepting" },
        { label: "Opening within 1 hour", value: c.openingWithinHour, foot: "next scheduled opening", filter: "openingSoon" },
        { label: "Closing within 1 hour", value: c.closingWithinHour, foot: "current scheduled closing", filter: "closingSoon" },
        { label: "Open, no bookings", value: c.openNoBookings, foot: `${data!.quietThresholdHours}+ h with no new booking or walk-in`, filter: "quiet" },
        { label: "Merchant app online", value: "Not tracked", foot: "merchant presence is not recorded yet" },
      ]
    : [];

  const hourLabels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
  const countFormat = (v: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(v);

  return (
    <main className={ui.grid} aria-labelledby="shop-status-title">
      <div className={ui.pageHead}>
        <div>
          <div className={ui.eyebrow}>Shops · Operations</div>
          <h1 id="shop-status-title" className={ui.pageTitle}>Open / Closed Shops</h1>
          <p className={ui.pageSub}>
            Scheduled status from each shop’s configured hours in its own time zone — not proof a shop is physically open.
            {data && ` Updated ${new Intl.DateTimeFormat("en-IN", { timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(data.generatedAt))} IST, refreshes every minute.`}
          </p>
        </div>
        <div className={ui.headActions}>
          <button type="button" className={`${ui.btn} ${ui.btnSecondary} ${ui.btnSm}`} onClick={() => void load()}>
            Refresh now
          </button>
        </div>
      </div>

      {error && <p className={`${ui.banner} ${ui.bannerError}`} role="alert">{error}</p>}
      {!data && !error && <div className={`${ui.skeleton} ${css.skeleton}`} role="status" aria-label="Loading shop status" />}

      {data && (
        <>
          <section className={css.kpis} aria-label="Shop status counts">
            {kpis.map((k) => {
              const content = (
                <>
                  <div className={ui.kpiTop}>{k.label}</div>
                  <div className={ui.kpiValue}>{k.value}</div>
                  <div className={ui.kpiFoot}>{k.foot}</div>
                </>
              );
              return k.filter ? (
                <button
                  key={k.label}
                  type="button"
                  className={`${ui.card} ${ui.cardTight} ${ui.kpi} ${css.kpiButton} ${filter === k.filter ? css.kpiActive : ""}`}
                  aria-pressed={filter === k.filter}
                  onClick={() => setFilter(filter === k.filter ? "all" : k.filter!)}
                >
                  {content}
                </button>
              ) : (
                <div key={k.label} className={`${ui.card} ${ui.cardTight} ${ui.kpi}`}>{content}</div>
              );
            })}
          </section>

          <section className={ui.card} aria-labelledby="hourly-title" id="hourly">
            <div className={ui.cardHead}>
              <div>
                <h2 id="hourly-title" className={ui.cardTitle}>Today, hour by hour (IST)</h2>
                <p className={ui.cardSub}>
                  Shops scheduled open (line, left axis) vs appointments and walk-ins starting that hour (columns, right axis). Uses the hours configured now — schedule history is not recorded, so past days are not shown.
                </p>
              </div>
            </div>
            <ComboChart
              labels={hourLabels}
              height={showHourly ? 340 : 280}
              ariaLabel="Shops scheduled open and bookings per hour today"
              leftAxisLabel="Shops open"
              rightAxisLabel="Visits"
              series={[
                { key: "appointments", label: "Appointments", values: data.hourly.map((h) => h.appointments), type: "column", axis: "right", color: SERIES_COLORS[1], format: countFormat, integer: true },
                { key: "walkIns", label: "Walk-ins", values: data.hourly.map((h) => h.walkIns), type: "column", axis: "right", color: SERIES_COLORS[2], format: countFormat, integer: true },
                { key: "open", label: "Shops scheduled open", values: data.hourly.map((h) => h.scheduledOpen), type: "line", axis: "left", color: SERIES_COLORS[0], format: countFormat, integer: true },
              ]}
            />
          </section>

          <section className={ui.card} aria-labelledby="shops-title">
            <div className={ui.cardHead}>
              <div>
                <h2 id="shops-title" className={ui.cardTitle}>Shops</h2>
                <p className={ui.cardSub}>{rows.length} of {data.shops.length} shown · today’s figures use India time</p>
              </div>
            </div>
            <div className={css.filters}>
              <div className={ui.tabs} role="group" aria-label="Status filter">
                {STATUS_FILTERS.map((f) => (
                  <button key={f.id} type="button" className={`${ui.tab} ${filter === f.id ? ui.tabActive : ""}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                    {f.label}
                  </button>
                ))}
              </div>
              <div className={css.filterRow}>
                <label className={css.field}>
                  <span>City</span>
                  <select value={city} onChange={(e) => setCity(e.target.value)}>
                    <option value="all">All cities</option>
                    {cities.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label className={css.field}>
                  <span>Search</span>
                  <input type="search" placeholder="Shop name or ID" value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
              </div>
            </div>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th scope="col">Shop</th>
                    <th scope="col">City</th>
                    <th scope="col">Today’s hours</th>
                    <th scope="col">Scheduled</th>
                    <th scope="col">Next change</th>
                    <th scope="col">Bookings</th>
                    <th scope="col">Merchant app</th>
                    <th scope="col" className={ui.num}>Booked today</th>
                    <th scope="col" className={ui.num}>Completed today</th>
                    <th scope="col" className={ui.num}>Value today</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row" className={css.shopCell}>
                        <strong>{row.name}</strong>
                        <small>
                          {row.publicId}
                          {row.status !== SalonStatus.ACTIVE && ` · ${row.status === SalonStatus.PENDING ? "not open yet" : "suspended"}`}
                        </small>
                      </th>
                      <td>{row.city}</td>
                      <td>{row.todayHours ?? <span className={ui.mutedCell}>Not set</span>}</td>
                      <td>
                        <ScheduleBadge row={row} />
                        {row.quietSince && <div className={css.quiet}>No new bookings since {time(row.quietSince, row.timeZone)}</div>}
                      </td>
                      <td>
                        {row.closesAt ? `Closes ${time(row.closesAt, row.timeZone)}` : row.opensAt ? `Opens ${time(row.opensAt, row.timeZone)}` : <span className={ui.mutedCell}>—</span>}
                      </td>
                      <td>
                        {row.temporarilyClosed ? (
                          <span className={`${ui.badge} ${ui.badgeBad}`}>Closed for today</span>
                        ) : row.acceptingBookings ? (
                          <span className={`${ui.badge} ${ui.badgeInfo}`}>Accepting</span>
                        ) : (
                          <span className={`${ui.badge} ${ui.badgeNeutral}`}>Not accepting</span>
                        )}
                      </td>
                      <td><span className={ui.mutedCell}>Not tracked</span></td>
                      <td className={ui.num}>{row.todayBookingsCreated}</td>
                      <td className={ui.num}>{row.todayVisitsCompleted}</td>
                      <td className={ui.num}>{formatInr(row.todayServiceValuePaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && <p className={ui.empty}>No shops match these filters.</p>}
          </section>
        </>
      )}
    </main>
  );
}
