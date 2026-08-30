"use client";

import { useEffect, useMemo, useState } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OwnerBookingDetailDto, PaginatedResult, SalonStaffDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import styles from "./schedule.module.css";

const GRID_START_HOUR = 7;
const GRID_END_HOUR = 21; // exclusive — grid covers [7:00, 21:00)
const PX_PER_MINUTE = 2;
const GRID_HEIGHT = (GRID_END_HOUR - GRID_START_HOUR) * 60 * PX_PER_MINUTE;
const UNASSIGNED_COLUMN = "__unassigned__";

function salonPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
}

// Every position on the grid is computed from the salon's OWN local wall-clock time, never the
// viewer's browser timezone — an owner checking their shop's schedule from a different timezone
// than their shop must see the same grid a person standing in the shop would, not their own
// local time silently substituted in. Real IANA-zone math via Intl, same approach as the backend's
// own DST-safe timezone module — this deliberately re-derives it in the browser rather than
// trusting the browser's Date to already be in the right zone, which it never is.
function zonedParts(iso: string, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function todayInZone(timeZone: string): string {
  const p = zonedParts(new Date().toISOString(), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function minutesFromGridStart(iso: string, timeZone: string): number {
  const p = zonedParts(iso, timeZone);
  return (p.hour - GRID_START_HOUR) * 60 + p.minute;
}

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: "Confirmed",
  PENDING_PAYMENT: "Pending payment",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
  EXPIRED: "Expired",
};

function blockClass(status: string): string {
  if (status === "COMPLETED") return styles.blockCompleted;
  if (status === "CANCELLED" || status === "NO_SHOW" || status === "EXPIRED") return styles.blockCancelled;
  return styles.blockConfirmed;
}

async function fetchAllBookingsForDate(salonId: string, date: string): Promise<OwnerBookingDetailDto[]> {
  const items: OwnerBookingDetailDto[] = [];
  let cursor: string | undefined;
  // A single shop's single day is realistically well under a handful of pages — looped rather
  // than capped at one page so a genuinely busy day is never silently truncated.
  for (let guard = 0; guard < 20; guard++) {
    const params = new URLSearchParams({ date, limit: "50" });
    if (cursor) params.set("cursor", cursor);
    const page = await apiFetch<PaginatedResult<OwnerBookingDetailDto>>(
      `${salonPath(salonId)}/${DASHBOARD_PATHS.bookings}?${params}`,
    );
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

export function DayScheduler({ salonId }: { salonId: string }) {
  const [timezone, setTimezone] = useState<string | null | undefined>(undefined);
  const [date, setDate] = useState<string | null>(null);
  const [staff, setStaff] = useState<SalonStaffDto[] | null>(null);
  const [bookings, setBookings] = useState<OwnerBookingDetailDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Resolve the salon's own timezone once, then default the viewed date to "today" *in that
  // zone* — defaulting to the browser's own local date would show the wrong day for a shop in a
  // different timezone than whoever is looking at the dashboard.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ timezone: string | null }>(`${salonPath(salonId)}/${DASHBOARD_PATHS.timezone}`)
      .then((result) => {
        if (cancelled) return;
        setTimezone(result.timezone);
        if (result.timezone) setDate(todayInZone(result.timezone));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load this shop's time zone.");
      });
    return () => {
      cancelled = true;
    };
  }, [salonId]);

  useEffect(() => {
    apiFetch<SalonStaffDto[]>(`${salonPath(salonId)}/${DASHBOARD_PATHS.staff}`)
      .then((result) => setStaff(result.filter((s) => s.status === "ACTIVE")))
      .catch(() => setStaff([]));
  }, [salonId]);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    // Deferred a tick so this effect body never calls setState synchronously (the immediate
    // "clear stale bookings for the previous date" reset still runs before the fetch, just not
    // in the same synchronous pass as the effect itself).
    void Promise.resolve().then(() => {
      if (!cancelled) setBookings(null);
    });
    fetchAllBookingsForDate(salonId, date)
      .then((items) => {
        if (!cancelled) setBookings(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load the schedule for this day.");
          setBookings([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [salonId, date]);

  // Redraws the current-time line roughly once a minute — cheap (one interval, one re-render),
  // and only actually visible when the viewed date happens to be today.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const columns = useMemo(() => {
    const staffCols = (staff ?? []).map((s) => ({ key: s.id, label: s.displayName }));
    return [...staffCols, { key: UNASSIGNED_COLUMN, label: "No preference" }];
  }, [staff]);

  const bookingsByColumn = useMemo(() => {
    const map = new Map<string, OwnerBookingDetailDto[]>();
    for (const b of bookings ?? []) {
      const key = b.assignedStaffId ?? b.preferredStaffId ?? UNASSIGNED_COLUMN;
      const list = map.get(key) ?? [];
      list.push(b);
      map.set(key, list);
    }
    return map;
  }, [bookings]);

  const isToday = timezone && date ? date === todayInZone(timezone) : false;
  const nowTop = isToday && timezone
    ? minutesFromGridStart(new Date(nowTick).toISOString(), timezone) * PX_PER_MINUTE
    : null;

  const selected = bookings?.find((b) => b.id === selectedId) ?? null;

  const hourMarks = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR + 1 }, (_, i) => GRID_START_HOUR + i);

  return (
    <div>
      <div className={styles.toolbar}>
        <Button type="button" variant="outline" onClick={() => date && setDate(addDays(date, -1))} disabled={!date}>
          ← Previous day
        </Button>
        <span className={styles.dateLabel}>
          {date
            ? new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })
            : "Loading…"}
        </span>
        <Button
          type="button"
          variant="outline"
          onClick={() => timezone && setDate(todayInZone(timezone))}
          disabled={!timezone || isToday}
        >
          Today
        </Button>
        <Button type="button" variant="outline" onClick={() => date && setDate(addDays(date, 1))} disabled={!date}>
          Next day →
        </Button>
        {timezone && <span className={styles.tzNote}>Times shown in {timezone}</span>}
      </div>

      {error && <p role="alert" style={{ color: "var(--bc-accent)", marginBottom: 12 }}>{error}</p>}

      {timezone === null && (
        <p style={{ color: "var(--bc-muted)" }}>
          This shop hasn&apos;t set a time zone yet, so its schedule can&apos;t be shown safely.{" "}
          Set one in <a href={`/dashboard/salons/${salonId}/settings`}>Settings</a> first.
        </p>
      )}

      {timezone && date && (
        <>
          <div className={styles.scrollOuter}>
            <div className={styles.grid}>
              <div className={styles.rulerColumn} style={{ height: GRID_HEIGHT + 40 }}>
                <div className={styles.staffHeaderMuted}>&nbsp;</div>
                {hourMarks.map((h) => (
                  <span
                    key={h}
                    className={styles.rulerLabel}
                    style={{ top: 40 + (h - GRID_START_HOUR) * 60 * PX_PER_MINUTE }}
                  >
                    {h % 12 === 0 ? 12 : h % 12}
                    {h < 12 ? "am" : "pm"}
                  </span>
                ))}
              </div>
              {columns.map((col) => {
                const colBookings = bookingsByColumn.get(col.key) ?? [];
                return (
                  <div key={col.key} className={styles.staffColumn}>
                    <div className={col.key === UNASSIGNED_COLUMN ? styles.staffHeaderMuted : styles.staffHeader}>
                      {col.label}
                    </div>
                    <div className={styles.columnBody} style={{ height: GRID_HEIGHT }}>
                      {hourMarks.slice(0, -1).map((h) => (
                        <div
                          key={h}
                          className={styles.hourLine}
                          style={{ top: (h - GRID_START_HOUR) * 60 * PX_PER_MINUTE }}
                        />
                      ))}
                      {nowTop !== null && nowTop >= 0 && nowTop <= GRID_HEIGHT && (
                        <div className={styles.nowLine} style={{ top: nowTop }}>
                          <span className={styles.nowDot} />
                        </div>
                      )}
                      {bookings === null && (
                        <p style={{ padding: 8, color: "var(--bc-muted)", fontSize: "0.75rem" }}>Loading…</p>
                      )}
                      {colBookings.map((b) => {
                        const top = minutesFromGridStart(b.slotStart, timezone) * PX_PER_MINUTE;
                        const height = Math.max(
                          (minutesFromGridStart(b.slotEnd, timezone) - minutesFromGridStart(b.slotStart, timezone)) *
                            PX_PER_MINUTE,
                          18,
                        );
                        // A booking entirely outside the displayed 7am-9pm window is skipped rather
                        // than drawn off-grid — an honest gap is better than a block that silently
                        // renders in the wrong place or overlaps the header.
                        if (top + height < 0 || top > GRID_HEIGHT) return null;
                        const isPreferredOnly = !b.assignedStaffId && !!b.preferredStaffId;
                        return (
                          <button
                            key={b.id}
                            type="button"
                            className={`${styles.block} ${blockClass(b.status)}`}
                            style={{ top: Math.max(top, 0), height }}
                            onClick={() => setSelectedId(b.id === selectedId ? null : b.id)}
                            aria-label={`${b.serviceName}, ${STATUS_LABEL[b.status] ?? b.status}${isPreferredOnly ? ", preferred barber not yet confirmed" : ""}`}
                          >
                            <span className={styles.blockService}>{b.serviceName}</span>
                            <span className={styles.blockMeta}>
                              {b.customerPhone ?? "—"}
                              {isPreferredOnly ? " · preferred" : ""}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {selected && (
            <div className={styles.detailPanel} role="region" aria-label="Booking detail">
              <p style={{ margin: "0 0 4px", fontWeight: 700 }}>{selected.serviceName}</p>
              <p style={{ margin: "0 0 4px", color: "var(--bc-muted)", fontSize: "0.85rem" }}>
                {new Date(selected.slotStart).toLocaleString(undefined, {
                  timeZone: timezone,
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {" – "}
                {new Date(selected.slotEnd).toLocaleString(undefined, {
                  timeZone: timezone,
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {" · "}
                {STATUS_LABEL[selected.status] ?? selected.status}
              </p>
              <p style={{ margin: "0 0 4px", fontSize: "0.85rem" }}>
                {selected.customerPhone ?? "No contact on file"}
              </p>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--bc-muted)" }}>
                {selected.assignedStaffName
                  ? `Assigned: ${selected.assignedStaffName}`
                  : selected.preferredStaffName
                    ? `Preferred (not yet confirmed): ${selected.preferredStaffName}`
                    : "No barber preference"}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
