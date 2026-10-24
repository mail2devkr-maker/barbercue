"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OwnerOverviewDto, OwnerRevenueDto, PeriodComparisonDto, QueueEntryDetailDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { getRealtimeSocket, joinSalonRoom, onReconnect } from "../../lib/realtime";
import { AreaChart, BarChart, ShareBar } from "./charts";
import { DaySchedule } from "./DaySchedule";
import { formatMoney, formatPercentChange, formatShopDate, formatShopTime, initialsOf } from "./format";
import { NewQueueCustomerDialog } from "./NewQueueCustomerDialog";
import { Banner, Btn, BtnLink, Card, EmptyState, PageHead, Skeleton, Tabs } from "./parts";
import { Icon, type IconName } from "./icons";
import ui from "./owner.module.css";

const REFRESH_MS = 60_000;

type RevenueView = "daily" | "weekly" | "monthly";

function Delta({ comparison, label }: { comparison: PeriodComparisonDto; label: string }) {
  const change = formatPercentChange(comparison.changePercent);
  return (
    <span className={`${ui.delta} ${change.tone === "up" ? ui.deltaUp : change.tone === "down" ? ui.deltaDown : ui.deltaFlat}`}>
      {change.text} <span style={{ fontWeight: 500, color: "var(--os-muted)" }}>{label}</span>
    </span>
  );
}

const ACTOR_LABEL: Record<string, string> = {
  CUSTOMER: "Customer",
  OWNER: "Owner",
  STAFF: "Barber",
  SYSTEM: "Automatic",
  ADMIN: "FastQue support",
  UNKNOWN: "Not recorded",
};
const ACTOR_COLOR: Record<string, string> = {
  CUSTOMER: "#3b6df0",
  OWNER: "#c8104d",
  STAFF: "#e0891a",
  SYSTEM: "#7a5af8",
  ADMIN: "#1a1533",
  UNKNOWN: "#98a2b3",
};
const SERVICE_TINTS = [ui.svcIconGreen, ui.svcIconPink, ui.svcIconBlue];
const BRANCH_TINTS = [ui.branchBarPink, ui.branchBarLilac, ui.branchBarGreen, ui.branchBarBlue];

/** Large, scannable figure with a small icon chip - the three headline cards beside the greeting. */
function HeadlineCard({ label, value, foot, icon, href }: { label: string; value: React.ReactNode; foot: string; icon: IconName; href?: string }) {
  const body = (
    <>
      <div className={ui.headlineTop}>
        <span className={ui.headlineLabel}>{label}</span>
        <span className={ui.headlineIcon}>
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div className={ui.headlineValue}>{value}</div>
      <div className={ui.headlineFoot}>{foot}</div>
    </>
  );
  return href ? (
    <Link href={href} className={`${ui.card} ${ui.headlineCard} ${ui.kpiLinkCard}`}>
      {body}
    </Link>
  ) : (
    <div className={`${ui.card} ${ui.headlineCard}`}>{body}</div>
  );
}

/** Compact figure for the "today at a glance" strip. */
function GlanceCard({ label, value, foot, icon, tone, href }: { label: string; value: React.ReactNode; foot: string; icon: IconName; tone: "ok" | "warn" | "info" | "brand"; href?: string }) {
  const tint = tone === "ok" ? ui.kpiIconOk : tone === "warn" ? ui.kpiIconWarn : tone === "info" ? ui.kpiIconInfo : "";
  const body = (
    <>
      <span className={`${ui.kpiIcon} ${tint}`}>
        <Icon name={icon} size={16} />
      </span>
      <div className={ui.glanceText}>
        <div className={ui.glanceLabel}>{label}</div>
        <div className={ui.glanceValue}>{value}</div>
        <div className={ui.glanceFoot}>{foot}</div>
      </div>
    </>
  );
  return href ? (
    <Link href={href} className={`${ui.card} ${ui.glanceCard} ${ui.kpiLinkCard}`}>
      {body}
    </Link>
  ) : (
    <div className={`${ui.card} ${ui.glanceCard}`}>{body}</div>
  );
}

function CardLinkIcon({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={ui.cardArrow} aria-label={label} title={label}>
      <Icon name="arrowUpRight" size={16} />
    </Link>
  );
}

export function OwnerOverview({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const [data, setData] = useState<OwnerOverviewDto | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [revenueView, setRevenueView] = useState<RevenueView>("daily");
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(() => {
    apiFetch<OwnerOverviewDto>(`${base}/overview`)
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError({ message: err instanceof ApiError ? err.message : "Could not load the dashboard.", code: err instanceof ApiError ? err.code : undefined }));
  }, [base]);

  const scheduleLoad = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(load, 400);
  }, [load]);

  useEffect(() => {
    load();
    const poll = window.setInterval(load, REFRESH_MS);
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);
    const events = ["queue.updated", "booking.created", "booking.cancelled", "booking.rescheduled", "staff.status.changed"];
    const handler = (payload: { salonId?: string }) => {
      if (!payload?.salonId || payload.salonId === salonId) scheduleLoad();
    };
    events.forEach((e) => socket.on(e, handler));
    const off = onReconnect(load);
    return () => {
      window.clearInterval(poll);
      if (timer.current) window.clearTimeout(timer.current);
      events.forEach((e) => socket.off(e, handler));
      off();
    };
  }, [salonId, load, scheduleLoad]);

  const money = useCallback((n: number) => formatMoney(n, data?.currency ?? "INR"), [data?.currency]);
  const moneyCompact = useCallback((n: number) => formatMoney(n, data?.currency ?? "INR", { compact: true }), [data?.currency]);

  const revenuePoints = useMemo(() => {
    if (!data) return [];
    const r: OwnerRevenueDto = data.revenue;
    const label = (iso: string) => (revenueView === "monthly" ? new Date(`${iso}T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" }) : new Date(`${iso}T00:00:00Z`).toLocaleString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }));
    const series = revenueView === "daily" ? r.daily : revenueView === "weekly" ? r.weekly : r.monthly;
    return series.map((p) => ({ label: label(p.date), value: p.amount }));
  }, [data, revenueView]);

  const staffNames = useMemo(() => (data ? data.staffPerformance.filter((s) => s.status === "ACTIVE").map((s) => s.displayName) : []), [data]);

  if (error && !data) {
    return (
      <>
        <PageHead title="Overview" />
        <Banner tone="error">
          {error.message}
          {error.code === "SALON_TIMEZONE_REQUIRED" && (
            <>
              {" "}
              <Link href={`/dashboard/salons/${salonId}/settings`} style={{ color: "inherit", fontWeight: 800 }}>
                Set the timezone
              </Link>
            </>
          )}
        </Banner>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHead title="Overview" />
        <div className={`${ui.grid} ${ui.kpiGrid}`}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className={`${ui.card} ${ui.cardTight}`}>
              <Skeleton height={14} width="60%" />
              <div style={{ height: 10 }} />
              <Skeleton height={30} width="45%" />
            </div>
          ))}
        </div>
      </>
    );
  }

  const k = data.kpis;
  const today = new Intl.DateTimeFormat("en-IN", { timeZone: data.timezone, weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const qs = data.queueSummary;
  const revenue = data.revenue;
  const cancelParts = (["CUSTOMER", "OWNER", "STAFF", "SYSTEM", "ADMIN", "UNKNOWN"] as const).map((actor) => ({
    label: ACTOR_LABEL[actor],
    value: data.cancellationSummary.byActor[actor] ?? 0,
    color: ACTOR_COLOR[actor],
  }));
  const rangeTotal = revenuePoints.reduce((sum, p) => sum + p.value, 0);
  const rangeLabel = revenueView === "daily" ? "last 14 days" : revenueView === "weekly" ? "recent weeks" : "recent months";
  const topPerformer = [...data.staffPerformance].filter((s) => s.completedLast30Days > 0).sort((a, b) => b.completedLast30Days - a.completedLast30Days || b.completedToday - a.completedToday)[0] ?? null;
  const branchMax = Math.max(...data.branches.map((b) => b.recordedRevenueToday), 1);

  return (
    <>
      {notice && <Banner tone="ok">{notice}</Banner>}
      {error && <Banner tone="warn">{error.message} Showing the last loaded numbers.</Banner>}

      <section className={ui.ovTop} aria-label="Welcome">
        <div className={ui.ovWelcome}>
          <p className={ui.welcomeHello}>Welcome back,</p>
          <h1 className={ui.welcomeName}>{data.salonName}</h1>
          <p className={ui.welcomeLine}>
            {today} · {qs.waiting > 0 ? `${qs.waiting} customer${qs.waiting === 1 ? " is" : "s are"} waiting` : "Nobody is waiting right now"} · {k.availableBarbers} barber{k.availableBarbers === 1 ? "" : "s"} free
          </p>
          <div className={ui.welcomeButtons}>
            <Btn variant="primary" icon="plus" onClick={() => setAddOpen(true)}>
              New Live Queue customer
            </Btn>
            <BtnLink variant="secondary" href={`/dashboard/salons/${salonId}/bookings/new`} icon="calendar">
              New in-shop appointment
            </BtnLink>
            <BtnLink variant="secondary" href={`/dashboard/salons/${salonId}/queue`} icon="queue">
              Open Live Queue
            </BtnLink>
          </div>
        </div>
        <div className={ui.headline3}>
          <HeadlineCard label="Appointments today" value={k.appointmentsToday} foot="Booked for today" icon="calendar" href={`/dashboard/salons/${salonId}/schedule`} />
          <HeadlineCard label="Customers served" value={k.customersServedToday} foot="Finished today" icon="users" />
          <HeadlineCard label="Active staff" value={k.activeStaff} foot="Clocked in" icon="team" href={`/dashboard/salons/${salonId}/staff`} />
        </div>
      </section>

      <div className={ui.glanceStrip}>
        <GlanceCard label="Waiting in Live Queue" value={k.waitingInQueue} foot="Waiting for available staff" icon="queue" tone="warn" href={`/dashboard/salons/${salonId}/queue?view=waiting`} />
        <GlanceCard label="In service now" value={k.inService} foot="Service started" icon="scissors" tone="ok" href={`/dashboard/salons/${salonId}/queue?view=in-service`} />
        <GlanceCard label="Revenue recorded today" value={revenue.hasRecordedPayments ? money(k.recordedRevenueToday) : "—"} foot={revenue.hasRecordedPayments ? `${k.recordedPaymentsToday} payment${k.recordedPaymentsToday === 1 ? "" : "s"} recorded` : "No payments recorded yet"} icon="rupee" tone="brand" href={`/dashboard/salons/${salonId}/revenue`} />
        <GlanceCard label="Barbers available" value={k.availableBarbers} foot="On duty and free" icon="team" tone="ok" />
        <GlanceCard label="Barbers busy" value={k.busyBarbers} foot="With a customer" icon="scissors" tone="warn" />
        <GlanceCard label="Services completed" value={k.completedServicesToday} foot="Today" icon="check" tone="ok" />
        <GlanceCard label="Cancelled today" value={k.cancelledToday} foot="Bookings cancelled" icon="alert" tone="warn" href={`/dashboard/salons/${salonId}/cancellations`} />
      </div>

      <div className={ui.ovGrid}>
        <Card
          title="Revenue overview"
          sub="Money your shop recorded as received, after recorded refunds"
          action={
            <div className={ui.cardActions}>
              <Tabs
                label="Revenue range"
                value={revenueView}
                onChange={setRevenueView}
                tabs={[
                  { id: "daily", label: "Daily" },
                  { id: "weekly", label: "Weekly" },
                  { id: "monthly", label: "Monthly" },
                ]}
              />
              <CardLinkIcon href={`/dashboard/salons/${salonId}/revenue`} label="Open revenue details" />
            </div>
          }
        >
          <div className={ui.bigFigure}>
            <div className={ui.bigFigureLabel}>Recorded revenue · {rangeLabel}</div>
            <div className={ui.bigFigureRow}>
              <span className={ui.bigFigureValue}>{revenue.hasRecordedPayments ? money(rangeTotal) : "—"}</span>
            </div>
          </div>
          {!revenue.hasRecordedPayments && (
            <Banner tone="info">
              No payments have been recorded yet, so there is no revenue to show. Revenue appears here once you record a payment on an{" "}
              <Link href={`/dashboard/salons/${salonId}/invoices`} style={{ color: "inherit", fontWeight: 800 }}>
                invoice
              </Link>
              . A completed service or a displayed payment QR is not counted as received.
            </Banner>
          )}
          {revenueView === "daily" ? (
            <AreaChart points={revenuePoints} formatValue={moneyCompact} ariaLabel="Daily recorded revenue, last 14 days" />
          ) : (
            <BarChart points={revenuePoints} formatValue={moneyCompact} ariaLabel={`${revenueView === "weekly" ? "Weekly" : "Monthly"} recorded revenue`} />
          )}
          <div className={ui.tilePair}>
            <div className={`${ui.tile} ${ui.tileGreen}`}>
              <div className={ui.tileLabel}>This week recorded</div>
              <div className={ui.tileValue}>{money(revenue.thisWeek.current)}</div>
              <Delta comparison={revenue.thisWeek} label="vs same days last week" />
            </div>
            <Link href={`/dashboard/salons/${salonId}/invoices`} className={`${ui.tile} ${ui.tileAmber}`}>
              <div className={ui.tileLabel}>Awaiting payment</div>
              <div className={ui.tileValue}>{money(revenue.unpaidInvoiceTotal)}</div>
              <div className={ui.tileFoot}>
                {revenue.unpaidInvoiceCount} invoice{revenue.unpaidInvoiceCount === 1 ? "" : "s"} still due
              </div>
            </Link>
          </div>
          <div className={`${ui.statGrid} ${ui.mt12}`}>
            {[
              { label: "Today", c: revenue.today, vs: "vs yesterday" },
              { label: "This month", c: revenue.thisMonth, vs: "vs same days last month" },
            ].map(({ label, c, vs }) => (
              <div key={label} className={ui.stat}>
                <div className={ui.statLabel}>{label}</div>
                <div className={ui.statValue}>{money(c.current)}</div>
                <Delta comparison={c} label={vs} />
              </div>
            ))}
          </div>
          {revenue.estimatedServiceValueToday > 0 && (
            <p className={ui.cardSub} style={{ marginTop: 10 }}>
              Estimated value of today&apos;s completed services at listed prices: <strong>{money(revenue.estimatedServiceValueToday)}</strong> — an estimate, not revenue.
            </p>
          )}
        </Card>

        <div className={ui.ovCol}>
          <Card title="Top services" sub="Last 30 days" action={<CardLinkIcon href={`/dashboard/salons/${salonId}/analytics`} label="Open full analytics" />}>
            {data.topServices.length === 0 ? (
              <EmptyState title="No completed services yet">Completed services will appear here with their popularity and recorded revenue.</EmptyState>
            ) : (
              <div className={ui.tableWrap} role="region" aria-label="Top services table" tabIndex={0}>
                <table className={ui.table}>
                  <thead>
                    <tr>
                      <th>Services</th>
                      <th className={ui.num}>Avg. price</th>
                      <th className={ui.num}>Done</th>
                      <th className={ui.num}>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topServices.map((s, index) => (
                      <tr key={s.serviceId ?? s.name} title={`${s.popularityPercent}% of completed services`}>
                        <td>
                          <span className={ui.svcCell}>
                            <span className={`${ui.svcIcon} ${SERVICE_TINTS[index % SERVICE_TINTS.length]}`}>
                              <Icon name="scissors" size={14} />
                            </span>
                            <strong>{s.name}</strong>
                          </span>
                        </td>
                        <td className={`${ui.num} ${s.averageChargedAmount === null ? ui.mutedCell : ""}`}>{s.averageChargedAmount === null ? "No invoices" : money(s.averageChargedAmount)}</td>
                        <td className={ui.num}>{s.completedCount}</td>
                        <td className={ui.num}>{money(s.recordedRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={ui.cardSub} style={{ marginTop: 8 }}>
              Revenue counts fully paid invoices only; average price is taken from issued invoices.
            </p>
          </Card>

          <div className={ui.ovPair}>
            <Card title="Live Queue" action={<CardLinkIcon href={`/dashboard/salons/${salonId}/queue`} label="Open the Live Queue" />}>
              <div className={`${ui.statGrid} ${ui.statGridCompact}`}>
                {[
                  // Called-to-the-counter customers have no barber yet, so they are still waiting for staff.
                  ["Waiting", qs.waiting + qs.called],
                  ["Assigned", qs.assigned ?? 0],
                  ["In service", qs.inService],
                  ["Completed", qs.completedToday],
                  ["Cancelled", qs.cancelledToday + qs.expiredToday],
                  ["No-show", qs.noShowToday],
                ].map(([label, value]) => (
                  <div key={label as string} className={ui.stat}>
                    <div className={ui.statLabel}>{label}</div>
                    <div className={ui.statValue}>{value}</div>
                  </div>
                ))}
              </div>
              <p className={ui.cardSub} style={{ marginTop: 10 }}>
                Each person is counted once: an assigned customer is not waiting and is not in service until the barber starts the service.
              </p>
              <div className={`${ui.rowWrap} ${ui.mt12}`}>
                <Btn variant="primary" small icon="plus" onClick={() => setAddOpen(true)}>
                  New customer
                </Btn>
                <BtnLink small href={`/dashboard/salons/${salonId}/queue?view=waiting`}>
                  See waiting list
                </BtnLink>
              </div>
            </Card>

            <Card title="Top performer" sub="Most completed · last 30 days" action={<CardLinkIcon href={`/dashboard/salons/${salonId}/team?tab=performance`} label="Open staff performance" />}>
              {topPerformer === null ? (
                <EmptyState title="No completed services yet">The barber with the most completed services shows here.</EmptyState>
              ) : (
                <div className={ui.performer}>
                  {topPerformer.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the barber's own uploaded photo, any host
                    <img className={ui.performerPhoto} src={topPerformer.photoUrl} alt={`${topPerformer.displayName}`} />
                  ) : (
                    <span className={ui.performerInitials} aria-hidden="true">
                      {initialsOf(topPerformer.displayName)}
                    </span>
                  )}
                  <div className={ui.performerBody}>
                    <div className={ui.performerName}>{topPerformer.displayName}</div>
                    <div className={ui.performerSub}>{topPerformer.completedLast30Days} services completed</div>
                    <div className={ui.performerSub}>{topPerformer.completedToday} today</div>
                    <div className={ui.performerValue}>{money(topPerformer.estimatedValueLast30Days)}</div>
                    <div className={ui.performerFoot}>listed-price value, not revenue</div>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      <div className={ui.ovGrid}>
        {data.branches.length > 1 ? (
          <Card title="Top performing branches" sub="Recorded revenue today · only shops you own">
            <div className={ui.branchBars} role="list" aria-label="Recorded revenue today by shop">
              {data.branches.map((b, index) => (
                <Link key={b.salonId} href={`/dashboard/salons/${b.salonId}`} role="listitem" className={ui.branchCol} title={`${b.name}: ${formatMoney(b.recordedRevenueToday, b.currency)} recorded today`}>
                  <span className={ui.branchValue}>{formatMoney(b.recordedRevenueToday, b.currency, { compact: true })}</span>
                  <span className={`${ui.branchBar} ${BRANCH_TINTS[index % BRANCH_TINTS.length]}`} style={{ height: `${Math.max(14, (b.recordedRevenueToday / branchMax) * 100)}%` }}>
                    <span className={ui.branchName}>{b.name}</span>
                  </span>
                </Link>
              ))}
            </div>
            <div className={`${ui.tableWrap} ${ui.mt12}`}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>Shop</th>
                    <th className={ui.num}>Waiting</th>
                    <th className={ui.num}>In service</th>
                    <th className={ui.num}>Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.branches.map((b) => (
                    <tr key={b.salonId}>
                      <td>
                        <Link href={`/dashboard/salons/${b.salonId}`} className={ui.cardLink}>
                          {b.name}
                        </Link>
                      </td>
                      <td className={ui.num}>{b.waiting}</td>
                      <td className={ui.num}>{b.inService}</td>
                      <td className={ui.num}>{b.completedToday}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card title="Cancellations" sub={`Last ${data.cancellationSummary.windowDays} days`} action={<CardLinkIcon href={`/dashboard/salons/${salonId}/cancellations`} label="Open cancellation details" />}>
            {data.cancellationSummary.total === 0 ? (
              <EmptyState title="No cancellations">Nothing was cancelled in this period.</EmptyState>
            ) : (
              <>
                <div className={ui.spaceBetween} style={{ marginBottom: 10 }}>
                  <div>
                    <div className={ui.kpiValue}>{data.cancellationSummary.total}</div>
                    <div className={ui.cardSub}>cancelled</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className={ui.kpiValue}>{data.cancellationSummary.ratePercent === null ? "—" : `${data.cancellationSummary.ratePercent}%`}</div>
                    <div className={ui.cardSub}>of bookings made</div>
                  </div>
                </div>
                <ShareBar parts={cancelParts} ariaLabel="Cancellations by who cancelled" />
              </>
            )}
          </Card>
        )}

        <Card
          title="Day schedule"
          sub={`${data.todaysSchedule.length} appointment${data.todaysSchedule.length === 1 ? "" : "s"} today`}
          action={<CardLinkIcon href={`/dashboard/salons/${salonId}/schedule`} label="Open the calendar" />}
        >
          {data.todaysSchedule.length === 0 ? (
            <EmptyState title="No appointments today" action={<BtnLink small href={`/dashboard/salons/${salonId}/bookings/new`} icon="plus">New in-shop appointment</BtnLink>}>
              Customers who arrive without a booking join the Live Queue.
            </EmptyState>
          ) : (
            <DaySchedule items={data.todaysSchedule} timeZone={data.timezone} staffNames={staffNames} />
          )}
        </Card>
      </div>

      <div className={ui.ovRow}>
        {data.branches.length > 1 && (
          <Card title="Cancellations" sub={`Last ${data.cancellationSummary.windowDays} days`} action={<CardLinkIcon href={`/dashboard/salons/${salonId}/cancellations`} label="Open cancellation details" />}>
            {data.cancellationSummary.total === 0 ? (
              <EmptyState title="No cancellations">Nothing was cancelled in this period.</EmptyState>
            ) : (
              <>
                <div className={ui.spaceBetween} style={{ marginBottom: 10 }}>
                  <div>
                    <div className={ui.kpiValue}>{data.cancellationSummary.total}</div>
                    <div className={ui.cardSub}>cancelled</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className={ui.kpiValue}>{data.cancellationSummary.ratePercent === null ? "—" : `${data.cancellationSummary.ratePercent}%`}</div>
                    <div className={ui.cardSub}>of bookings made</div>
                  </div>
                </div>
                <ShareBar parts={cancelParts} ariaLabel="Cancellations by who cancelled" />
              </>
            )}
          </Card>
        )}
        <Card title="Staff performance" sub="Completed services" action={<CardLinkIcon href={`/dashboard/salons/${salonId}/team?tab=performance`} label="Open staff performance" />}>
          {data.staffPerformance.length === 0 ? (
            <EmptyState title="No barbers yet" action={<BtnLink small href={`/dashboard/salons/${salonId}/staff`} icon="plus">Add a barber</BtnLink>} />
          ) : (
            <div className={ui.tableWrap} role="region" aria-label="Staff performance table" tabIndex={0}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>Barber</th>
                    <th>Status</th>
                    <th className={ui.num}>Today</th>
                    <th className={ui.num}>30 days</th>
                    <th className={ui.num}>Est. value (30d)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.staffPerformance.map((s) => (
                    <tr key={s.staffId}>
                      <td>
                        <strong>{s.displayName}</strong>
                      </td>
                      <td>
                        <span className={ui.rowWrap} style={{ gap: 6, flexWrap: "nowrap" }}>
                          <span className={`${ui.dot} ${s.availabilityState === "AVAILABLE" ? ui.dotOk : s.availabilityState === "OFF_DUTY" ? ui.dotOff : ui.dotWarn}`} />
                          {s.availabilityState === "AVAILABLE" ? "Available" : s.availabilityState === "IN_SERVICE" ? "With a customer" : s.availabilityState === "RESERVED" ? "Booked soon" : "Off duty"}
                        </span>
                      </td>
                      <td className={ui.num}>{s.completedToday}</td>
                      <td className={ui.num}>{s.completedLast30Days}</td>
                      <td className={ui.num}>{money(s.estimatedValueLast30Days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Shop controls">
          <div className={ui.quickGrid} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
            <Link className={ui.quickTile} href={`/dashboard/salons/${salonId}/services`}>
              <Icon name="tag" />
              <span>Manage services</span>
            </Link>
            <Link className={ui.quickTile} href={`/dashboard/salons/${salonId}/staff`}>
              <Icon name="team" />
              <span>Manage staff</span>
            </Link>
            <Link className={ui.quickTile} href={`/dashboard/salons/${salonId}/chairs`}>
              <Icon name="chair" />
              <span>Manage chairs</span>
            </Link>
            <Link className={ui.quickTile} href={`/dashboard/salons/${salonId}/hours`}>
              <Icon name="clock" />
              <span>Working hours</span>
            </Link>
            <Link className={ui.quickTile} href={`/dashboard/salons/${salonId}/payment-qr`}>
              <Icon name="qr" />
              <span>
                Payment QR<span className={ui.quickSub}>{data.settings.hasPaymentQr ? "Added" : "Optional · not added"}</span>
              </span>
            </Link>
            <Link className={ui.quickTile} href={`/dashboard/salons/${salonId}/invoices?tab=billing`}>
              <Icon name="receipt" />
              <span>
                Billing profile<span className={ui.quickSub}>{data.settings.hasBillingProfile ? "Ready for invoices" : "Needed for invoices"}</span>
              </span>
            </Link>
            <Link className={ui.quickTile} href={`/dashboard/salons/${salonId}/settings`}>
              <Icon name="store" />
              <span>Shop profile</span>
            </Link>
            <Link className={ui.quickTile} href={`/dashboard/salons/${salonId}/queue`}>
              <Icon name="settings" />
              <span>
                Automatic assignment<span className={ui.quickSub}>{data.settings.autoAssignEnabled ? "On" : "Off"}</span>
              </span>
            </Link>
          </div>
        </Card>
      </div>

      {addOpen && (
        <NewQueueCustomerDialog
          salonId={salonId}
          onClose={() => setAddOpen(false)}
          onCreated={(entry: QueueEntryDetailDto) => {
            setNotice(`Added ${entry.customerName ?? "customer"} to the Live Queue as queue #${entry.tokenNumber}.`);
            load();
          }}
        />
      )}
      <p className={ui.cardSub} style={{ marginTop: 14 }}>
        Updated {formatShopTime(data.generatedAt, data.timezone)} · {formatShopDate(data.generatedAt, data.timezone)} ({data.timezone})
      </p>
    </>
  );
}
