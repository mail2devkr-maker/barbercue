"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OwnerAnalyticsDto, RecordedPaymentListDto, SalonTimezoneResultDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import {
  PAYMENT_CSV_HEADERS,
  PERIOD_CSV_HEADERS,
  RANGE_ERROR_TEXT,
  addDays,
  analyticsInstants,
  bucketRows,
  buildDayRows,
  filterByName,
  loadAllPayments,
  netCollected,
  paymentCsvRows,
  periodCsvRows,
  periodLabel,
  presetRange,
  reportFileName,
  serviceMix,
  todayInZone,
  toCsv,
  validateRange,
  type Granularity,
  type LoadedPayments,
  type PresetId,
} from "../../lib/revenue-report";
import { BarChart, LineChart } from "./charts";
import { formatMoney } from "./format";
import { Banner, Btn, Card, EmptyState, Field, Skeleton, Tabs } from "./parts";
import ui from "./owner.module.css";

const PRESETS: ReadonlyArray<{ id: PresetId; label: string }> = [
  { id: "today", label: "Today" },
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
];

const METHOD_LABEL: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", OTHER: "Other" };

interface Loaded {
  from: string;
  to: string;
  timeZone: string;
  analytics: OwnerAnalyticsDto;
  payments: LoadedPayments;
}

function downloadCsv(fileName: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Revenue report for a custom date range (requirements #1, #2, #4, #17).
 *
 * Two kinds of figures, never mixed:
 *  - COLLECTED / REFUNDED: payments the shop recorded (the only figures called revenue).
 *  - ESTIMATED: completed services at their listed prices (what the shop may be owed or earned in work).
 * Everything is read from the server for the shop's own timezone calendar. Revenue by customer, discounts and
 * revenue by booking source need server fields that do not exist yet (see the contract issue), so they are
 * not shown rather than approximated here.
 */
export function RevenueReport({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const [timeZone, setTimeZone] = useState<string | null | undefined>(undefined); // undefined = loading, null = not set
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [serviceSearch, setServiceSearch] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const requestId = useRef(0);

  const run = useCallback(
    async (zone: string, rangeFrom: string, rangeTo: string) => {
      const problem = validateRange(rangeFrom, rangeTo);
      setRangeError(problem ? RANGE_ERROR_TEXT[problem] : null);
      if (problem) return;
      const mine = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const instants = analyticsInstants(rangeFrom, rangeTo, zone);
        const [analytics, payments] = await Promise.all([
          apiFetch<OwnerAnalyticsDto>(`${base}/${DASHBOARD_PATHS.analytics}?${new URLSearchParams({ range: "custom", from: instants.from, to: instants.to }).toString()}`),
          loadAllPayments((cursor) =>
            apiFetch<RecordedPaymentListDto>(`${base}/payments?${new URLSearchParams({ from: rangeFrom, to: rangeTo, limit: "100", ...(cursor ? { cursor } : {}) }).toString()}`),
          ),
        ]);
        if (mine !== requestId.current) return; // a newer range was requested meanwhile
        setData({ from: rangeFrom, to: rangeTo, timeZone: zone, analytics, payments });
      } catch (err) {
        if (mine !== requestId.current) return;
        setData(null);
        setError(err instanceof ApiError ? err.message : "Could not load the report.");
      } finally {
        if (mine === requestId.current) setLoading(false);
      }
    },
    [base],
  );

  useEffect(() => {
    let cancelled = false;
    apiFetch<SalonTimezoneResultDto>(`${base}/${DASHBOARD_PATHS.timezone}`)
      .then((result) => {
        if (cancelled) return;
        setTimeZone(result.timezone);
        if (result.timezone) {
          const range = presetRange("last30", todayInZone(result.timezone));
          setFrom(range.from);
          setTo(range.to);
          void run(result.timezone, range.from, range.to);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setTimeZone(null);
        setError(err instanceof ApiError ? err.message : "Could not load the shop timezone.");
      });
    return () => {
      cancelled = true;
    };
  }, [base, run]);

  const rows = useMemo(
    () => (data ? buildDayRows(data.from, data.to, data.timeZone, data.analytics.dailyServiceValue, data.payments.complete ? data.payments.items : null) : []),
    [data],
  );
  const buckets = useMemo(() => bucketRows(rows, granularity), [rows, granularity]);

  if (timeZone === undefined) return <Skeleton height={200} />;
  if (timeZone === null) {
    return (
      <Banner tone="warn">
        {error ?? "Your shop has no timezone yet, so a date-range report cannot be computed safely."}{" "}
        <Link className={ui.cardLink} href={`/dashboard/salons/${salonId}/settings`}>Set the timezone in Shop Settings</Link>
      </Banner>
    );
  }

  const zone = timeZone;
  const currency = data?.analytics.currency ?? data?.payments.first.currency ?? null;
  const money = (n: number) => formatMoney(n, currency);
  const compact = (n: number) => formatMoney(n, currency, { compact: true });
  const apply = () => void run(zone, from, to);
  const choosePreset = (id: PresetId) => {
    const range = presetRange(id, todayInZone(zone));
    setFrom(range.from);
    setTo(range.to);
    void run(zone, range.from, range.to);
  };
  const today = todayInZone(zone);

  const totals = data?.payments.first.totals;
  const services = data ? filterByName([...data.analytics.serviceValue].sort((a, b) => b.estimatedServiceValue - a.estimatedServiceValue), serviceSearch) : [];
  const staff = data ? filterByName([...data.analytics.barberValue].sort((a, b) => b.estimatedServiceValue - a.estimatedServiceValue), staffSearch) : [];
  const serviceTotal = data?.analytics.serviceValue.reduce((sum, s) => sum + s.estimatedServiceValue, 0) ?? 0;
  const mix = data ? serviceMix(data.analytics.sourceMix) : { booked: 0, liveQueue: 0, total: 0 };
  const chartLabel = (date: string) => periodLabel(date, granularity);
  const collectedSeries = buckets.map((b) => ({ label: chartLabel(b.date), value: netCollected(b) }));
  const estimatedSeries = buckets.map((b) => ({ label: chartLabel(b.date), value: b.estimated }));
  const Chart = granularity === "day" ? LineChart : BarChart;

  return (
    <div className={ui.mt16}>
      <Card
        title="Revenue report"
        sub={<>Choose any dates. Dates follow your shop&apos;s calendar ({zone}). <strong>Collected</strong> is money you recorded; <strong>estimated</strong> is completed services at listed prices and is never counted as revenue.</>}
      >
        <div className={ui.rowWrap}>
          <Field label="From" htmlFor="rep-from"><input id="rep-from" type="date" className={ui.input} value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To" htmlFor="rep-to"><input id="rep-to" type="date" className={ui.input} value={to} min={from} max={addDays(today, 0)} onChange={(e) => setTo(e.target.value)} /></Field>
          <Btn variant="primary" onClick={apply} disabled={loading}>{loading ? "Loading…" : "Show report"}</Btn>
        </div>
        <div className={`${ui.rowWrap} ${ui.mt12}`} role="group" aria-label="Quick ranges">
          {PRESETS.map((p) => (
            <Btn key={p.id} small onClick={() => choosePreset(p.id)} disabled={loading}>{p.label}</Btn>
          ))}
        </div>
        {rangeError && <div className={ui.mt12}><Banner tone="error">{rangeError}</Banner></div>}
      </Card>

      {error && <div className={ui.mt12}><Banner tone="error">{error}</Banner></div>}
      {loading && !data && <div className={ui.mt12}><Skeleton height={220} /></div>}

      {data && totals && (
        <div aria-busy={loading}>
          {!data.payments.complete && (
            <div className={ui.mt12}>
              <Banner tone="warn">
                This range has more payments than could be loaded, so the daily collected figures and the payment export are hidden. The totals below come from the server and cover the whole range. Choose a shorter range for the daily view.
              </Banner>
            </div>
          )}

          <div className={`${ui.statGrid} ${ui.mt16}`}>
            <div className={ui.stat}><div className={ui.statLabel}>Collected</div><div className={ui.statValue}>{money(totals.received)}</div></div>
            <div className={ui.stat}><div className={ui.statLabel}>Refunded</div><div className={ui.statValue}>{money(totals.refunded)}</div></div>
            <div className={ui.stat}><div className={ui.statLabel}>Net collected</div><div className={ui.statValue}>{money(totals.net)}</div></div>
            <div className={ui.stat}><div className={ui.statLabel}>Payments recorded</div><div className={ui.statValue}>{totals.count}</div></div>
            <div className={ui.stat}><div className={ui.statLabel}>Estimated service value</div><div className={ui.statValue}>{money(data.analytics.estimatedServiceValue)}</div></div>
            <div className={ui.stat}><div className={ui.statLabel}>Completed services</div><div className={ui.statValue}>{mix.total}</div></div>
            {data.payments.first.byMethod.map((m) => (
              <div key={m.method} className={ui.stat}><div className={ui.statLabel}>{METHOD_LABEL[m.method] ?? m.method} (net)</div><div className={ui.statValue}>{money(m.net)}</div></div>
            ))}
          </div>

          <div className={ui.mt16}>
            <Card
              title="By period"
              action={<Tabs label="Report view" value={granularity} onChange={setGranularity} tabs={[{ id: "day", label: "Daily" }, { id: "week", label: "Weekly" }, { id: "month", label: "Monthly" }]} />}
              sub="Weeks start on Monday. Daily, weekly and monthly views are built from the same days, so they always add up to the same totals. The first and last week or month can be partial when your dates fall inside it."
            >
              {data.payments.complete ? (
                <>
                  <h3 className={ui.cardSub}>Net collected</h3>
                  <Chart points={collectedSeries} formatValue={compact} ariaLabel={`${granularity} net collected`} />
                </>
              ) : (
                <p className={ui.cardSub}>Collected figures by period are hidden for this range (see the notice above).</p>
              )}
              <h3 className={ui.cardSub}>Estimated service value</h3>
              <Chart points={estimatedSeries} formatValue={compact} ariaLabel={`${granularity} estimated service value`} />
              <div className={ui.tableWrap}>
                <table className={ui.table}>
                  <caption className={ui.cardSub}>Figures by period</caption>
                  <thead>
                    <tr><th>Period</th><th className={ui.num}>Collected</th><th className={ui.num}>Refunded</th><th className={ui.num}>Net</th><th className={ui.num}>Estimated</th><th className={ui.num}>Services</th></tr>
                  </thead>
                  <tbody>
                    {buckets.map((b) => (
                      <tr key={b.date}>
                        <td>{chartLabel(b.date)}</td>
                        <td className={ui.num}>{data.payments.complete ? money(b.collected) : "—"}</td>
                        <td className={ui.num}>{data.payments.complete ? money(b.refunded) : "—"}</td>
                        <td className={ui.num}>{data.payments.complete ? money(netCollected(b)) : "—"}</td>
                        <td className={ui.num}>{money(b.estimated)}</td>
                        <td className={ui.num}>{b.completedServices}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={`${ui.rowWrap} ${ui.mt12}`}>
                <Btn
                  icon="receipt"
                  onClick={() => downloadCsv(reportFileName("revenue-by-period", data.from, data.to), toCsv(PERIOD_CSV_HEADERS, periodCsvRows(rows, granularity)))}
                  disabled={!data.payments.complete}
                >
                  Download period report (CSV)
                </Btn>
                <Btn
                  icon="receipt"
                  onClick={() => downloadCsv(reportFileName("payments", data.from, data.to), toCsv(PAYMENT_CSV_HEADERS, paymentCsvRows(data.payments.items, data.timeZone)))}
                  disabled={!data.payments.complete || data.payments.items.length === 0}
                >
                  Download payments (CSV)
                </Btn>
              </div>
            </Card>
          </div>

          <div className={`${ui.grid} ${ui.evenTwo} ${ui.mt16}`}>
            <Card title="Estimated value by service" sub="Completed services at listed prices. Estimated, not collected.">
              <Field label="Search services" htmlFor="rep-service-search"><input id="rep-service-search" type="search" className={ui.input} value={serviceSearch} onChange={(e) => setServiceSearch(e.target.value)} placeholder="Haircut, facial…" /></Field>
              {services.length === 0 ? (
                <EmptyState title={data.analytics.serviceValue.length === 0 ? "No completed services in this range" : "No service matches your search"} />
              ) : (
                <div className={ui.tableWrap}>
                  <table className={ui.table}>
                    <thead><tr><th>Service</th><th className={ui.num}>Done</th><th className={ui.num}>Estimated</th><th className={ui.num}>Share</th></tr></thead>
                    <tbody>
                      {services.map((s) => (
                        <tr key={s.serviceId}>
                          <td>{s.name}</td>
                          <td className={ui.num}>{s.completedCount}</td>
                          <td className={ui.num}>{money(s.estimatedServiceValue)}</td>
                          <td className={ui.num}>{serviceTotal > 0 ? `${Math.round((s.estimatedServiceValue / serviceTotal) * 100)}%` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card title="Estimated value by staff" sub="Services completed by each barber at listed prices.">
              <Field label="Search staff" htmlFor="rep-staff-search"><input id="rep-staff-search" type="search" className={ui.input} value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)} placeholder="Barber name" /></Field>
              {staff.length === 0 ? (
                <EmptyState title={data.analytics.barberValue.length === 0 ? "No completed services in this range" : "No staff member matches your search"} />
              ) : (
                <div className={ui.tableWrap}>
                  <table className={ui.table}>
                    <thead><tr><th>Barber</th><th className={ui.num}>Services</th><th className={ui.num}>Estimated</th></tr></thead>
                    <tbody>
                      {staff.map((s) => (
                        <tr key={s.staffId}>
                          <td>{s.displayName}</td>
                          <td className={ui.num}>{s.completedSessions}</td>
                          <td className={ui.num}>{money(s.estimatedServiceValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <div className={`${ui.grid} ${ui.evenTwo} ${ui.mt16}`}>
            <Card title="Where customers came from" sub="Completed services in this range.">
              <div className={ui.statGrid}>
                <div className={ui.stat}><div className={ui.statLabel}>Booked in advance</div><div className={ui.statValue}>{mix.booked}</div></div>
                <div className={ui.stat}><div className={ui.statLabel}>Live Queue</div><div className={ui.statValue}>{mix.liveQueue}</div></div>
              </div>
            </Card>
            <Card title="Not shown yet">
              <p className={ui.cardSub}>Revenue by customer, discounts given, and revenue by booking source need new data from the server. They are left out rather than approximated.</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
