"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { CancellationActorOrUnknown, CancellationAnalyticsDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { ShareBar } from "./charts";
import { formatMoney, formatShopDate, formatShopTime } from "./format";
import { Badge, Banner, Card, EmptyState, PageHead, Skeleton, type BadgeTone } from "./parts";
import ui from "./owner.module.css";

const ACTORS: ReadonlyArray<{ id: CancellationActorOrUnknown; label: string; short: string; color: string; tone: BadgeTone }> = [
  { id: "CUSTOMER", label: "Cancelled by customer", short: "Customer", color: "#3b6df0", tone: "info" },
  { id: "OWNER", label: "Cancelled by owner", short: "Owner", color: "#c8104d", tone: "brand" },
  { id: "STAFF", label: "Cancelled by a barber", short: "Barber", color: "#e0891a", tone: "warn" },
  { id: "SYSTEM", label: "Cancelled automatically", short: "Automatic", color: "#7a5af8", tone: "neutral" },
  { id: "ADMIN", label: "Cancelled by FastQue support", short: "FastQue support", color: "#1a1533", tone: "neutral" },
  { id: "UNKNOWN", label: "Not recorded (older bookings)", short: "Not recorded", color: "#98a2b3", tone: "neutral" },
];

/**
 * Cancelled bookings, split by who cancelled. The split comes from what was recorded at the moment of
 * cancellation - never inferred from a booking's current status; older bookings that predate this
 * record are shown as "Not recorded" rather than guessed. Live Queue outcomes are reported separately
 * and never mixed into the booking figures.
 */
export function CancellationsPanel({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");
  const [actor, setActor] = useState<CancellationActorOrUnknown | "ALL">("ALL");
  const [data, setData] = useState<CancellationAnalyticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Actor and period filters may change while a prior response is still in flight.
    // Only the currently selected filter may replace the visible cancellation figures.
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the loading state while the new period is fetched
    setData(null);
    setError(null);
    const params = new URLSearchParams({ range, ...(actor !== "ALL" ? { actor } : {}) });
    apiFetch<CancellationAnalyticsDto>(`${base}/analytics/cancellations?${params.toString()}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Could not load cancellations.");
      });
    return () => { active = false; };
  }, [base, range, actor]);

  const money = (n: number) => formatMoney(n, data?.currency ?? "INR");
  return (
    <>
      <PageHead
        eyebrow="Business"
        title="Cancellations"
        sub="Online and in-shop bookings that were cancelled in the chosen period, by who cancelled them. The percentage compares them with the bookings made in the same period."
        actions={
          <div className={ui.rowWrap}>
            <label className={ui.srOnly} htmlFor="cx-range">Period</label>
            <select id="cx-range" className={ui.select} value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
            <label className={ui.srOnly} htmlFor="cx-actor">Cancelled by</label>
            <select id="cx-actor" className={ui.select} value={actor} onChange={(e) => setActor(e.target.value as typeof actor)}>
              <option value="ALL">Everyone</option>
              {ACTORS.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>
        }
      />
      {error && <Banner tone="error">{error}</Banner>}
      {!data && !error && <Skeleton height={200} />}
      {data && (
        <>
          <div className={`${ui.grid} ${ui.kpiGrid}`} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            <div className={`${ui.card} ${ui.cardTight} ${ui.kpi}`}><div className={ui.kpiTop}>Cancellations</div><div className={ui.kpiValue}>{data.totalCancellations}</div><div className={ui.kpiFoot}>in this period</div></div>
            <div className={`${ui.card} ${ui.cardTight} ${ui.kpi}`}><div className={ui.kpiTop}>Cancellation rate</div><div className={ui.kpiValue}>{data.cancellationRatePercent === null ? "—" : `${data.cancellationRatePercent}%`}</div><div className={ui.kpiFoot}>of {data.totalBookings} bookings made</div></div>
            <div className={`${ui.card} ${ui.cardTight} ${ui.kpi}`}><div className={ui.kpiTop}>Late-cancellation charges</div><div className={ui.kpiValue}>{money(data.charges.charged)}</div><div className={ui.kpiFoot}>{money(data.charges.waived)} waived · {money(data.charges.outstanding)} still due</div></div>
            <div className={`${ui.card} ${ui.cardTight} ${ui.kpi}`}><div className={ui.kpiTop}>Live Queue (separate)</div><div className={ui.kpiValue}>{data.liveQueue.cancelled + data.liveQueue.expired + data.liveQueue.noShow}</div><div className={ui.kpiFoot}>{data.liveQueue.cancelled} cancelled · {data.liveQueue.expired} expired · {data.liveQueue.noShow} no-show</div></div>
          </div>

          <div className={`${ui.grid} ${ui.twoCol} ${ui.mt16}`}>
            <Card title="Who cancelled">
              {data.totalCancellations === 0 && actor === "ALL" ? (
                <EmptyState title="No cancellations in this period" />
              ) : (
                <ShareBar ariaLabel="Cancellations by who cancelled" parts={ACTORS.map((a) => ({ label: a.short, value: data.byActor[a.id], color: a.color }))} />
              )}
              {data.unattributedCount > 0 && (
                <p className={ui.cardSub} style={{ marginTop: 10 }}>
                  {data.unattributedCount} older cancellation{data.unattributedCount === 1 ? " has" : "s have"} no record of who cancelled, so {data.unattributedCount === 1 ? "it is" : "they are"} shown as “Not recorded” instead of being guessed.
                </p>
              )}
            </Card>
            <div className={ui.sideStack}>
              <Card title="By service">
                {data.byService.length === 0 ? <EmptyState title="Nothing to show" /> : (
                  <ul className={ui.list}>
                    {data.byService.map((s) => (
                      <li key={s.key} className={ui.listRow}><div className={ui.listMain}><div className={ui.listTitle}>{s.label}</div></div><strong>{s.count}</strong></li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Reasons given">
                {data.byReason.length === 0 ? <EmptyState title="Nothing to show" /> : (
                  <ul className={ui.list}>
                    {data.byReason.map((r) => (
                      <li key={r.key} className={ui.listRow}><div className={ui.listMain}><div className={ui.listTitle} style={{ whiteSpace: "normal" }}>{r.label}</div></div><strong>{r.count}</strong></li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          <div className={ui.mt16}>
            <Card title="Cancelled bookings" sub={data.rows.length >= 200 ? "Showing the most recent 200" : undefined}>
              {data.rows.length === 0 ? (
                <EmptyState title="No cancelled bookings match" />
              ) : (
                <div className={ui.tableWrap}>
                  <table className={ui.table}>
                    <thead>
                      <tr><th>Cancelled</th><th>Appointment</th><th>Service</th><th>Cancelled by</th><th>Reason</th><th className={ui.num}>Charge</th></tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r) => {
                        const a = ACTORS.find((x) => x.id === r.actor)!;
                        return (
                          <tr key={r.bookingId}>
                            <td>{formatShopDate(r.cancelledAt, null, true)} {formatShopTime(r.cancelledAt, null)}</td>
                            <td>{formatShopDate(r.slotStart, null, true)} {formatShopTime(r.slotStart, null)}</td>
                            <td>{r.serviceNames.join(" + ")}</td>
                            <td><Badge tone={a.tone}>{a.short}</Badge></td>
                            <td>{r.reason ?? <span className={ui.mutedCell}>—</span>}</td>
                            <td className={ui.num}>
                              {r.chargeStatus === null ? <span className={ui.mutedCell}>None</span> : (
                                <span>{money(r.chargeAmount ?? 0)} <Badge tone={r.chargeStatus === "WAIVED" ? "ok" : r.chargeStatus === "SETTLED" ? "neutral" : "warn"}>{r.chargeStatus === "WAIVED" ? "Waived" : r.chargeStatus === "SETTLED" ? "Paid" : "Due"}</Badge></span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className={ui.cardSub} style={{ marginTop: 10 }}>
                To waive an outstanding late-cancellation charge, open the customer under{" "}
                <Link className={ui.cardLink} href={`/dashboard/salons/${salonId}/customers`}>Customers</Link>. Waivers are recorded with who approved them.
              </p>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
