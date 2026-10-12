"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OwnerOverviewDto, OwnerRevenueDto, PeriodComparisonDto, QueueEntryDetailDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { getRealtimeSocket, joinSalonRoom, onReconnect } from "../../lib/realtime";
import { BarChart, LineChart, ShareBar } from "./charts";
import { formatMoney, formatPercentChange, formatShopDate, formatShopTime, greetingFor, shopHour } from "./format";
import { NewQueueCustomerDialog } from "./NewQueueCustomerDialog";
import { Badge, Banner, Btn, BtnLink, Card, EmptyState, Kpi, PageHead, Skeleton, Tabs } from "./parts";
import { Icon } from "./icons";
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
  SYSTEM: "System",
  ADMIN: "FastQue admin",
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
  const hour = shopHour(data.timezone);
  const today = new Intl.DateTimeFormat("en-IN", { timeZone: data.timezone, weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const qs = data.queueSummary;
  const revenue = data.revenue;
  const cancelParts = (["CUSTOMER", "OWNER", "STAFF", "SYSTEM", "ADMIN", "UNKNOWN"] as const).map((actor) => ({
    label: ACTOR_LABEL[actor],
    value: data.cancellationSummary.byActor[actor] ?? 0,
    color: ACTOR_COLOR[actor],
  }));

  return (
    <>
      {notice && <Banner tone="ok">{notice}</Banner>}
      {error && <Banner tone="warn">{error.message} Showing the last loaded numbers.</Banner>}

      <section className={ui.welcome} aria-label="Welcome">
        <div>
          <p className={ui.welcomeSub}>{today}</p>
          <h1 className={ui.welcomeTitle}>
            {greetingFor(hour)}, {data.salonName}
          </h1>
          <p className={ui.welcomeSub}>
            {qs.waiting > 0 ? `${qs.waiting} customer${qs.waiting === 1 ? " is" : "s are"} waiting` : "Nobody is waiting right now"} · {k.availableBarbers} barber{k.availableBarbers === 1 ? "" : "s"} free
          </p>
        </div>
        <div className={ui.welcomeActions}>
          <Btn variant="secondary" className={ui.welcomeBtn} icon="plus" onClick={() => setAddOpen(true)}>
            New Live Queue customer
          </Btn>
          <BtnLink variant="secondary" className={ui.welcomeBtnGhost} href={`/dashboard/salons/${salonId}/bookings/new`} icon="calendar">
            New in-shop appointment
          </BtnLink>
          <BtnLink variant="secondary" className={ui.welcomeBtnGhost} href={`/dashboard/salons/${salonId}/queue`} icon="queue">
            Open Live Queue
          </BtnLink>
        </div>
      </section>

      <div className={`${ui.grid} ${ui.kpiGrid}`} role="list" aria-label="Today at a glance">
        <Kpi label="Today's appointments" value={k.appointmentsToday} icon="calendar" tone="info" href={`/dashboard/salons/${salonId}/schedule`} foot="Booked for today" />
        <Kpi label="Customers served" value={k.customersServedToday} icon="users" tone="ok" foot="Finished today" />
        <Kpi label="Waiting in Live Queue" value={k.waitingInQueue} icon="queue" tone="warn" href={`/dashboard/salons/${salonId}/queue?view=waiting`} foot="Not yet seated" />
        <Kpi label="In service now" value={k.inService} icon="scissors" tone="ok" href={`/dashboard/salons/${salonId}/queue?view=in-service`} foot="Seated customers" />
        <Kpi label="Revenue recorded today" value={revenue.hasRecordedPayments ? money(k.recordedRevenueToday) : "—"} icon="rupee" foot={revenue.hasRecordedPayments ? `${k.recordedPaymentsToday} payment${k.recordedPaymentsToday === 1 ? "" : "s"} recorded` : "No payments recorded yet"} href={`/dashboard/salons/${salonId}/revenue`} />
        <Kpi label="Barbers available" value={k.availableBarbers} icon="team" tone="ok" foot="On duty and free" />
        <Kpi label="Barbers busy" value={k.busyBarbers} icon="scissors" tone="warn" foot="With a customer" />
        <Kpi label="Active staff" value={k.activeStaff} icon="users" tone="info" href={`/dashboard/salons/${salonId}/staff`} foot="Clocked in" />
        <Kpi label="Services completed" value={k.completedServicesToday} icon="check" tone="ok" foot="Today" />
        <Kpi label="Cancelled today" value={k.cancelledToday} icon="alert" tone="warn" href={`/dashboard/salons/${salonId}/cancellations`} foot="Bookings cancelled" />
      </div>

      <div className={`${ui.grid} ${ui.twoCol} ${ui.mt16}`}>
        <Card
          title="Revenue overview"
          sub="Money your shop recorded as received, after recorded refunds"
          action={
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
          }
        >
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
            <LineChart points={revenuePoints} formatValue={moneyCompact} ariaLabel="Daily recorded revenue, last 14 days" />
          ) : (
            <BarChart points={revenuePoints} formatValue={moneyCompact} ariaLabel={`${revenueView === "weekly" ? "Weekly" : "Monthly"} recorded revenue`} />
          )}
          <div className={`${ui.statGrid} ${ui.mt12}`}>
            {[
              { label: "Today", c: revenue.today, vs: "vs yesterday" },
              { label: "This week", c: revenue.thisWeek, vs: "vs same days last week" },
              { label: "This month", c: revenue.thisMonth, vs: "vs same days last month" },
            ].map(({ label, c, vs }) => (
              <div key={label} className={ui.stat}>
                <div className={ui.statLabel}>{label}</div>
                <div className={ui.statValue}>{money(c.current)}</div>
                <Delta comparison={c} label={vs} />
              </div>
            ))}
            <div className={ui.stat}>
              <div className={ui.statLabel}>Invoices awaiting payment</div>
              <div className={ui.statValue}>{revenue.unpaidInvoiceCount}</div>
              <div className={ui.cardSub}>{money(revenue.unpaidInvoiceTotal)} still due</div>
            </div>
          </div>
          {revenue.estimatedServiceValueToday > 0 && (
            <p className={ui.cardSub} style={{ marginTop: 10 }}>
              Estimated value of today&apos;s completed services at listed prices: <strong>{money(revenue.estimatedServiceValueToday)}</strong> — an estimate, not revenue.
            </p>
          )}
        </Card>

        <div className={ui.sideStack}>
          <Card
            title="Live Queue"
            action={
              <Link href={`/dashboard/salons/${salonId}/queue`} className={ui.cardLink}>
                Open
              </Link>
            }
          >
            <div className={ui.statGrid} style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              <div className={ui.stat}>
                <div className={ui.statLabel}>Waiting</div>
                <div className={ui.statValue}>{qs.waiting}</div>
              </div>
              <div className={ui.stat}>
                <div className={ui.statLabel}>Called</div>
                <div className={ui.statValue}>{qs.called}</div>
              </div>
              <div className={ui.stat}>
                <div className={ui.statLabel}>In service</div>
                <div className={ui.statValue}>{qs.inService}</div>
              </div>
              <div className={ui.stat}>
                <div className={ui.statLabel}>Completed</div>
                <div className={ui.statValue}>{qs.completedToday}</div>
              </div>
              <div className={ui.stat}>
                <div className={ui.statLabel}>Cancelled</div>
                <div className={ui.statValue}>{qs.cancelledToday + qs.expiredToday}</div>
              </div>
              <div className={ui.stat}>
                <div className={ui.statLabel}>No-show</div>
                <div className={ui.statValue}>{qs.noShowToday}</div>
              </div>
            </div>
            <p className={ui.cardSub} style={{ marginTop: 10 }}>
              Each person is counted once: seated customers are not also counted as waiting.
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

          <Card
            title="Cancellations"
            sub={`Last ${data.cancellationSummary.windowDays} days`}
            action={
              <Link href={`/dashboard/salons/${salonId}/cancellations`} className={ui.cardLink}>
                Details
              </Link>
            }
          >
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
        </div>
      </div>

      <div className={`${ui.grid} ${ui.twoCol} ${ui.mt16}`}>
        <Card
          title="Top services"
          sub="Last 30 days"
          action={
            <Link href={`/dashboard/salons/${salonId}/analytics`} className={ui.cardLink}>
              Full analytics
            </Link>
          }
        >
          {data.topServices.length === 0 ? (
            <EmptyState title="No completed services yet">Completed services will appear here with their popularity and recorded revenue.</EmptyState>
          ) : (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>Service</th>
                    <th className={ui.num}>Done</th>
                    <th>Popularity</th>
                    <th className={ui.num}>Avg. charged</th>
                    <th className={ui.num}>Recorded revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topServices.map((s) => (
                    <tr key={s.serviceId ?? s.name}>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td className={ui.num}>{s.completedCount}</td>
                      <td>
                        <div className={ui.rowWrap} style={{ flexWrap: "nowrap" }}>
                          <div className={ui.bar} aria-hidden="true" style={{ flex: 1 }}>
                            <div className={ui.barFill} style={{ width: `${Math.min(100, s.popularityPercent)}%` }} />
                          </div>
                          <span className={ui.mutedCell}>{s.popularityPercent}%</span>
                        </div>
                      </td>
                      <td className={`${ui.num} ${s.averageChargedAmount === null ? ui.mutedCell : ""}`}>{s.averageChargedAmount === null ? "No invoices" : money(s.averageChargedAmount)}</td>
                      <td className={ui.num}>{money(s.recordedRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={ui.cardSub} style={{ marginTop: 8 }}>
            Recorded revenue counts fully paid invoices only; average charged is taken from issued invoices.
          </p>
        </Card>

        <Card
          title="Today's schedule"
          action={
            <Link href={`/dashboard/salons/${salonId}/schedule`} className={ui.cardLink}>
              Calendar
            </Link>
          }
        >
          {data.todaysSchedule.length === 0 ? (
            <EmptyState title="No appointments today" action={<BtnLink small href={`/dashboard/salons/${salonId}/bookings/new`} icon="plus">New in-shop appointment</BtnLink>}>
              Customers who arrive without a booking join the Live Queue.
            </EmptyState>
          ) : (
            <ul className={ui.list}>
              {data.todaysSchedule.slice(0, 7).map((item) => (
                <li key={item.id} className={ui.listRow}>
                  <span className={ui.timeChip}>{formatShopTime(item.slotStart, data.timezone)}</span>
                  <div className={ui.listMain}>
                    <div className={ui.listTitle}>{item.serviceNames.join(" + ")}</div>
                    <div className={ui.listSub}>
                      {item.customerLabel}
                      {item.staffName ? ` · ${item.staffName}` : " · barber not assigned"}
                    </div>
                  </div>
                  <Badge tone={item.status === "COMPLETED" ? "ok" : item.status === "NO_SHOW" ? "bad" : "info"}>
                    {item.status === "COMPLETED" ? "Done" : item.status === "NO_SHOW" ? "No-show" : item.source === "IN_SHOP" ? "In-shop" : "Booked"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className={`${ui.grid} ${ui.twoCol} ${ui.mt16}`}>
        <Card
          title="Staff performance"
          sub="Completed services"
          action={
            <Link href={`/dashboard/salons/${salonId}/team?tab=performance`} className={ui.cardLink}>
              Details
            </Link>
          }
        >
          {data.staffPerformance.length === 0 ? (
            <EmptyState title="No barbers yet" action={<BtnLink small href={`/dashboard/salons/${salonId}/staff`} icon="plus">Add a barber</BtnLink>} />
          ) : (
            <div className={ui.tableWrap}>
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
                Auto-assign<span className={ui.quickSub}>{data.settings.autoAssignEnabled ? "On" : "Off"}</span>
              </span>
            </Link>
          </div>
        </Card>
      </div>

      {data.branches.length > 1 && (
        <Card title="Branch performance" sub="Only shops you own" tight>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Shop</th>
                  <th className={ui.num}>Waiting</th>
                  <th className={ui.num}>In service</th>
                  <th className={ui.num}>Completed today</th>
                  <th className={ui.num}>Recorded revenue today</th>
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
                    <td className={ui.num}>{formatMoney(b.recordedRevenueToday, b.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {addOpen && (
        <NewQueueCustomerDialog
          salonId={salonId}
          onClose={() => setAddOpen(false)}
          onCreated={(entry: QueueEntryDetailDto) => {
            setNotice(`Added ${entry.customerName ?? "customer"} to the Live Queue as token #${entry.tokenNumber}.`);
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
