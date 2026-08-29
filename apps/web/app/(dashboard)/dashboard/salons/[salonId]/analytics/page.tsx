"use client";

import { use, useCallback, useEffect, useState } from "react";
import { DASHBOARD_PATHS, formatMoney, OWNER_ANALYTICS_RANGES } from "@barbercue/shared";
import type { OwnerAnalyticsDto, OwnerAnalyticsRange } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

const RANGE_LABEL: Record<OwnerAnalyticsRange, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  custom: "Custom",
};

function analyticsPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.analytics}`;
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ border: "1px solid var(--bc-border)", borderRadius: "var(--bc-radius-md)", padding: "12px 16px", minWidth: 120 }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.3rem", color: "var(--bc-ink)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--bc-muted)", textTransform: "uppercase", letterSpacing: "0.03em", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function formatHour(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}

/**
 * Owner operational analytics (Phase 9) — real DB aggregates for the selected range. Revenue is
 * deliberately never shown as such: "Estimated service value" is listed-price x completed
 * bookings, clearly separate from anything implying money was actually collected, since BarberCue
 * does not process payment.
 */
export default function DashboardAnalyticsPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = use(params);
  const [range, setRange] = useState<OwnerAnalyticsRange>("today");
  const [data, setData] = useState<OwnerAnalyticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    (r: OwnerAnalyticsRange) => {
      setLoading(true);
      setError(null);
      return apiFetch<OwnerAnalyticsDto>(`${analyticsPath(salonId)}?range=${r}`)
        .then(setData)
        .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load analytics."))
        .finally(() => setLoading(false));
    },
    [salonId],
  );

  useEffect(() => {
    void Promise.resolve().then(() => load(range));
  }, [load, range]);

  return (
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Analytics</h1>
      <p className={styles.pageSubtitle}>
        Real operational numbers from your own bookings and queue activity — never estimates
        presented as facts, never revenue we didn&apos;t actually collect.
      </p>

      <div style={{ display: "flex", gap: 8, margin: "12px 0 20px" }}>
        {OWNER_ANALYTICS_RANGES.filter((r) => r !== "custom").map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: "1px solid var(--bc-border)",
              background: range === r ? "color-mix(in srgb, var(--bc-accent) 12%, transparent)" : "var(--bc-surface)",
              color: range === r ? "var(--bc-accent)" : "var(--bc-muted)",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>

      {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
      {loading && <p className={styles.loadingText}>Loading…</p>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
            <StatTile label="Appointments booked" value={data.appointmentsBooked} />
            <StatTile label="Completed" value={data.completedCount} />
            <StatTile label="Cancelled" value={data.cancelledCount} />
            <StatTile label="No-show" value={data.noShowCount} />
            <StatTile label="Walk-ins" value={data.walkInCount} />
            <StatTile label="New customers" value={data.newCustomerCount} />
            <StatTile label="Repeat customers" value={data.repeatCustomerCount} />
            <StatTile label="Avg wait" value={data.averageWaitMinutes !== null ? `${data.averageWaitMinutes}m` : "—"} />
            <StatTile
              label="Avg service time"
              value={data.averageServiceDurationMinutes !== null ? `${data.averageServiceDurationMinutes}m` : "—"}
            />
            <StatTile
              label="Estimated service value"
              value={formatMoney(data.estimatedServiceValue, data.currency)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 24 }}>
            <section>
              <h2 className={styles.sectionHeading}>Service popularity</h2>
              {data.servicePopularity.length === 0 && <p className={styles.emptyState}>No completed services yet.</p>}
              <ul className={styles.rowList}>
                {data.servicePopularity.slice(0, 8).map((s) => (
                  <li key={s.serviceId} className={styles.row}>
                    <span className={styles.rowTitle}>{s.name}</span>
                    <span className={styles.rowMeta}>{s.completedCount} completed</span>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className={styles.sectionHeading}>Barber utilization</h2>
              {data.barberUtilization.length === 0 && <p className={styles.emptyState}>No completed sessions yet.</p>}
              <ul className={styles.rowList}>
                {data.barberUtilization.map((u) => (
                  <li key={u.id} className={styles.row}>
                    <span className={styles.rowTitle}>{u.displayName}</span>
                    <span className={styles.rowMeta}>
                      {u.completedSessions} sessions · {u.totalServiceMinutes} min
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className={styles.sectionHeading}>Chair utilization</h2>
              {data.chairUtilization.length === 0 && <p className={styles.emptyState}>No completed sessions yet.</p>}
              <ul className={styles.rowList}>
                {data.chairUtilization.map((u) => (
                  <li key={u.id} className={styles.row}>
                    <span className={styles.rowTitle}>{u.displayName}</span>
                    <span className={styles.rowMeta}>
                      {u.completedSessions} sessions · {u.totalServiceMinutes} min
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className={styles.sectionHeading}>Peak / slow hours</h2>
              {data.peakHours.length === 0 ? (
                <p className={styles.emptyState}>Not enough bookings yet.</p>
              ) : (
                <>
                  <p className={styles.rowMeta} style={{ marginBottom: 4 }}>
                    Busiest: {data.peakHours.map((h) => `${formatHour(h.hour)} (${h.count})`).join(", ")}
                  </p>
                  <p className={styles.rowMeta}>
                    Slowest: {data.slowHours.map((h) => `${formatHour(h.hour)} (${h.count})`).join(", ")}
                  </p>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
