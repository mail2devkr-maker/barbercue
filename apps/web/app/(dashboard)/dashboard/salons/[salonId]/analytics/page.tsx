"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { DASHBOARD_PATHS, formatMoney, OWNER_ANALYTICS_RANGES } from "@barbercue/shared";
import type {
  BarberValueDto,
  DailyServiceValueDto,
  OwnerAnalyticsDto,
  OwnerAnalyticsRange,
  ServiceValueDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

const RANGE_LABEL: Record<OwnerAnalyticsRange, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  custom: "Custom",
};

type AnalyticsView = "overview" | "value" | "operations";

function analyticsPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.analytics}`;
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--bc-border)",
        borderRadius: "var(--bc-radius-md)",
        padding: "14px 16px",
        minWidth: 150,
        background: "var(--bc-surface)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: "1.35rem",
          color: "var(--bc-ink)",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--bc-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
          marginTop: 3,
        }}
      >
        {label}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--bc-muted)", marginTop: 5 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        border: "1px solid var(--bc-border)",
        borderRadius: "var(--bc-radius-lg)",
        padding: 18,
        background: "var(--bc-surface)",
        minWidth: 0,
      }}
    >
      <h2 className={styles.sectionHeading} style={{ marginBottom: subtitle ? 4 : 14 }}>
        {title}
      </h2>
      {subtitle && (
        <p className={styles.rowMeta} style={{ marginTop: 0, marginBottom: 16 }}>
          {subtitle}
        </p>
      )}
      {children}
    </section>
  );
}

function formatHour(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}

function formatDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function LineChart({
  rows,
  currency,
}: {
  rows: DailyServiceValueDto[];
  currency: string | null;
}) {
  const width = 720;
  const height = 220;
  const left = 28;
  const top = 20;
  const bottom = 34;
  const usableWidth = width - left * 2;
  const usableHeight = height - top - bottom;
  const max = Math.max(1, ...rows.map((row) => row.estimatedServiceValue));
  const points = rows.map((row, index) => {
    const x =
      rows.length <= 1
        ? width / 2
        : left + (index / (rows.length - 1)) * usableWidth;
    const y = top + usableHeight - (row.estimatedServiceValue / max) * usableHeight;
    return { x, y, row };
  });
  const labelEvery = Math.max(1, Math.ceil(rows.length / 6));

  if (rows.length === 0) {
    return <p className={styles.emptyState}>No completed service value yet.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Daily estimated service value trend"
        style={{ width: "100%", minWidth: 520, display: "block" }}
      >
        <line
          x1={left}
          x2={width - left}
          y1={top + usableHeight}
          y2={top + usableHeight}
          stroke="var(--bc-border)"
        />
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="var(--bc-accent)"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map(({ x, y, row }, index) => (
          <g key={row.date}>
            <circle cx={x} cy={y} r="4" fill="var(--bc-accent)">
              <title>{`${formatDay(row.date)}: ${formatMoney(row.estimatedServiceValue, currency)}`}</title>
            </circle>
            {(index % labelEvery === 0 || index === points.length - 1) && (
              <text
                x={x}
                y={height - 10}
                textAnchor="middle"
                fill="var(--bc-muted)"
                fontSize="11"
              >
                {formatDay(row.date)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function RankedValueBars({
  rows,
  currency,
}: {
  rows: Array<ServiceValueDto | BarberValueDto>;
  currency: string | null;
}) {
  const max = Math.max(1, ...rows.map((row) => row.estimatedServiceValue));
  if (rows.length === 0) {
    return <p className={styles.emptyState}>No completed services yet.</p>;
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {rows.slice(0, 10).map((row) => {
        const key = "serviceId" in row ? row.serviceId : row.staffId;
        const name = "name" in row ? row.name : row.displayName;
        const count = "completedCount" in row ? row.completedCount : row.completedSessions;
        return (
          <div key={key}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "baseline",
                marginBottom: 5,
              }}
            >
              <span className={styles.rowTitle}>{name}</span>
              <span className={styles.rowMeta}>
                {formatMoney(row.estimatedServiceValue, currency)} · {count} completed
              </span>
            </div>
            <div
              aria-hidden="true"
              style={{
                height: 8,
                borderRadius: 999,
                background: "color-mix(in srgb, var(--bc-border) 65%, transparent)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(3, (row.estimatedServiceValue / max) * 100)}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: "var(--bc-accent)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SplitBar({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  formatter = (value) => String(value),
}: {
  leftLabel: string;
  leftValue: number;
  rightLabel: string;
  rightValue: number;
  formatter?: (value: number) => string;
}) {
  const total = leftValue + rightValue;
  const leftPct = total > 0 ? (leftValue / total) * 100 : 50;
  return (
    <div>
      <div style={{ display: "flex", height: 16, borderRadius: 999, overflow: "hidden", background: "var(--bc-border)" }}>
        <div style={{ width: `${leftPct}%`, background: "var(--bc-accent)" }} />
        <div
          style={{
            flex: 1,
            background: "color-mix(in srgb, var(--bc-accent) 32%, var(--bc-surface))",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          marginTop: 10,
          fontSize: 13,
        }}
      >
        <div>
          <strong>{leftLabel}</strong>
          <div className={styles.rowMeta}>{formatter(leftValue)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <strong>{rightLabel}</strong>
          <div className={styles.rowMeta}>{formatter(rightValue)}</div>
        </div>
      </div>
    </div>
  );
}

function HourHeatmap({
  data,
  currency,
}: {
  data: OwnerAnalyticsDto["hourlyServiceValue"];
  currency: string | null;
}) {
  const max = Math.max(1, ...data.map((row) => row.estimatedServiceValue));
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(82px, 1fr))",
        gap: 8,
      }}
    >
      {data.map((row) => {
        const intensity = Math.round(10 + (row.estimatedServiceValue / max) * 58);
        return (
          <div
            key={row.hour}
            title={`${formatHour(row.hour)} · ${formatMoney(row.estimatedServiceValue, currency)} · ${row.completedCount} completed`}
            style={{
              border: "1px solid var(--bc-border)",
              borderRadius: 10,
              padding: "10px 8px",
              background: `color-mix(in srgb, var(--bc-accent) ${intensity}%, var(--bc-surface))`,
            }}
          >
            <div style={{ fontWeight: 700 }}>{formatHour(row.hour)}</div>
            <div style={{ fontSize: 12, marginTop: 3 }}>
              {formatMoney(row.estimatedServiceValue, currency)}
            </div>
            <div className={styles.rowMeta}>{row.completedCount} done</div>
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardAnalyticsPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = use(params);
  const [range, setRange] = useState<OwnerAnalyticsRange>("today");
  const [view, setView] = useState<AnalyticsView>("overview");
  const [data, setData] = useState<OwnerAnalyticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    (selectedRange: OwnerAnalyticsRange) => {
      setLoading(true);
      setError(null);
      return apiFetch<OwnerAnalyticsDto>(
        `${analyticsPath(salonId)}?range=${selectedRange}`,
      )
        .then(setData)
        .catch((err: unknown) =>
          setError(err instanceof ApiError ? err.message : "Could not load analytics."),
        )
        .finally(() => setLoading(false));
    },
    [salonId],
  );

  useEffect(() => {
    void Promise.resolve().then(() => load(range));
  }, [load, range]);

  const valueFormatter = useCallback(
    (value: number) => formatMoney(value, data?.currency ?? null),
    [data?.currency],
  );

  const totalLostBookingValue = useMemo(
    () =>
      data
        ? data.lostOpportunity.cancelledEstimatedServiceValue +
          data.lostOpportunity.noShowEstimatedServiceValue
        : 0,
    [data],
  );

  return (
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Analytics</h1>
      <p className={styles.pageSubtitle}>
        Real operational activity from your bookings and queue. Service-value charts use listed
        prices for completed work because FastQue does not observe every cash/card settlement at
        the shop.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0 12px" }}>
        {OWNER_ANALYTICS_RANGES.filter((item) => item !== "custom").map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setRange(item)}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: "1px solid var(--bc-border)",
              background:
                range === item
                  ? "color-mix(in srgb, var(--bc-accent) 12%, transparent)"
                  : "var(--bc-surface)",
              color: range === item ? "var(--bc-accent)" : "var(--bc-muted)",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {RANGE_LABEL[item]}
          </button>
        ))}
      </div>

      <div
        role="tablist"
        aria-label="Analytics views"
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}
      >
        {([
          ["overview", "Overview"],
          ["value", "Sales & value"],
          ["operations", "Operations"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              border: "1px solid var(--bc-border)",
              background: view === id ? "var(--bc-accent)" : "var(--bc-surface)",
              color: view === id ? "white" : "var(--bc-ink)",
              cursor: "pointer",
              fontWeight: 650,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
      {loading && <p className={styles.loadingText}>Loading…</p>}

      {data && !loading && (
        <>
          {view === "overview" && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
                <StatTile label="Appointments booked" value={data.appointmentsBooked} />
                <StatTile label="Completed" value={data.completedCount} />
                <StatTile label="Cancelled" value={data.cancelledCount} />
                <StatTile label="No-show" value={data.noShowCount} />
                <StatTile label="Walk-ins" value={data.walkInCount} />
                <StatTile label="New customers" value={data.newCustomerCount} />
                <StatTile label="Repeat customers" value={data.repeatCustomerCount} />
                <StatTile
                  label="Avg wait"
                  value={data.averageWaitMinutes !== null ? `${data.averageWaitMinutes}m` : "—"}
                />
                <StatTile
                  label="Avg service time"
                  value={
                    data.averageServiceDurationMinutes !== null
                      ? `${data.averageServiceDurationMinutes}m`
                      : "—"
                  }
                />
                <StatTile
                  label="Estimated service value"
                  value={formatMoney(data.estimatedServiceValue, data.currency)}
                  hint="Completed appointments + completed walk-ins"
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 18,
                }}
              >
                <SectionCard title="Service popularity">
                  {data.servicePopularity.length === 0 ? (
                    <p className={styles.emptyState}>No completed services yet.</p>
                  ) : (
                    <ul className={styles.rowList}>
                      {data.servicePopularity.slice(0, 8).map((service) => (
                        <li key={service.serviceId} className={styles.row}>
                          <span className={styles.rowTitle}>{service.name}</span>
                          <span className={styles.rowMeta}>
                            {service.completedCount} completed
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>

                <SectionCard title="Barber utilization">
                  {data.barberUtilization.length === 0 ? (
                    <p className={styles.emptyState}>No completed sessions yet.</p>
                  ) : (
                    <ul className={styles.rowList}>
                      {data.barberUtilization.map((row) => (
                        <li key={row.id} className={styles.row}>
                          <span className={styles.rowTitle}>{row.displayName}</span>
                          <span className={styles.rowMeta}>
                            {row.completedSessions} sessions · {row.totalServiceMinutes} min
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>

                <SectionCard title="Chair utilization">
                  {data.chairUtilization.length === 0 ? (
                    <p className={styles.emptyState}>No completed sessions yet.</p>
                  ) : (
                    <ul className={styles.rowList}>
                      {data.chairUtilization.map((row) => (
                        <li key={row.id} className={styles.row}>
                          <span className={styles.rowTitle}>{row.displayName}</span>
                          <span className={styles.rowMeta}>
                            {row.completedSessions} sessions · {row.totalServiceMinutes} min
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>
              </div>
            </>
          )}

          {view === "value" && (
            <div style={{ display: "grid", gap: 18 }}>
              <SectionCard
                title="Service value trend"
                subtitle="Daily listed-price value of completed appointments and walk-ins. This is not audited payment revenue."
              >
                <LineChart rows={data.dailyServiceValue} currency={data.currency} />
              </SectionCard>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                  gap: 18,
                }}
              >
                <SectionCard title="Value by service" subtitle="Which services contribute the most completed service value.">
                  <RankedValueBars rows={data.serviceValue} currency={data.currency} />
                </SectionCard>
                <SectionCard title="Value by barber" subtitle="Listed-price value attached to completed sessions handled by each barber.">
                  <RankedValueBars rows={data.barberValue} currency={data.currency} />
                </SectionCard>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                  gap: 18,
                }}
              >
                <SectionCard title="Bookings vs walk-ins" subtitle="Completed customer source mix.">
                  <SplitBar
                    leftLabel="Bookings"
                    leftValue={data.sourceMix.bookingCompletedCount}
                    rightLabel="Walk-ins"
                    rightValue={data.sourceMix.walkInCompletedCount}
                  />
                </SectionCard>

                <SectionCard title="New vs repeat value" subtitle="Completed booked-appointment value by customer relationship.">
                  <SplitBar
                    leftLabel="New"
                    leftValue={data.newCustomerEstimatedServiceValue}
                    rightLabel="Repeat"
                    rightValue={data.repeatCustomerEstimatedServiceValue}
                    formatter={valueFormatter}
                  />
                </SectionCard>
              </div>
            </div>
          )}

          {view === "operations" && (
            <div style={{ display: "grid", gap: 18 }}>
              <SectionCard
                title="Peak value hours"
                subtitle="Hourly heatmap of completed service value in the salon's local time."
              >
                <HourHeatmap data={data.hourlyServiceValue} currency={data.currency} />
              </SectionCard>

              <SectionCard
                title="Lost opportunity signals"
                subtitle="Cancellation/no-show values are listed-price estimates. Idle chairs are capacity time, not assumed lost revenue."
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <StatTile
                    label="Cancelled value"
                    value={formatMoney(
                      data.lostOpportunity.cancelledEstimatedServiceValue,
                      data.currency,
                    )}
                  />
                  <StatTile
                    label="No-show value"
                    value={formatMoney(
                      data.lostOpportunity.noShowEstimatedServiceValue,
                      data.currency,
                    )}
                  />
                  <StatTile
                    label="Booking opportunity"
                    value={formatMoney(totalLostBookingValue, data.currency)}
                    hint="Cancelled + no-show listed value"
                  />
                  <StatTile
                    label="Idle chair time"
                    value={
                      data.lostOpportunity.idleChairPercent === null
                        ? "—"
                        : `${Math.round(data.lostOpportunity.idleChairMinutes / 60)}h`
                    }
                    hint={
                      data.lostOpportunity.idleChairPercent === null
                        ? "Set shop opening hours to calculate"
                        : `${data.lostOpportunity.idleChairPercent}% of configured chair capacity`
                    }
                  />
                </div>
              </SectionCard>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                  gap: 18,
                }}
              >
                <SectionCard title="Peak / slow booking hours">
                  {data.peakHours.length === 0 ? (
                    <p className={styles.emptyState}>Not enough bookings yet.</p>
                  ) : (
                    <>
                      <p className={styles.rowMeta} style={{ marginBottom: 6 }}>
                        Busiest:{" "}
                        {data.peakHours
                          .map((hour) => `${formatHour(hour.hour)} (${hour.count})`)
                          .join(", ")}
                      </p>
                      <p className={styles.rowMeta}>
                        Slowest:{" "}
                        {data.slowHours
                          .map((hour) => `${formatHour(hour.hour)} (${hour.count})`)
                          .join(", ")}
                      </p>
                    </>
                  )}
                </SectionCard>

                <SectionCard title="Chair utilization">
                  {data.chairUtilization.length === 0 ? (
                    <p className={styles.emptyState}>No completed sessions yet.</p>
                  ) : (
                    <ul className={styles.rowList}>
                      {data.chairUtilization.map((row) => (
                        <li key={row.id} className={styles.row}>
                          <span className={styles.rowTitle}>{row.displayName}</span>
                          <span className={styles.rowMeta}>
                            {row.completedSessions} sessions · {row.totalServiceMinutes} min
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
