"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OwnerRevenueReportDto, SalonTimezoneResultDto } from "@barbercue/shared";
import { apiFetch, apiFetchBlob, ApiError } from "../../lib/api";
import {
  RANGE_ERROR_TEXT,
  SOURCE_FILTERS,
  EXCEL_EXPORT_LABEL,
  EXCEL_EXPORT_NOTE,
  csvFallbackName,
  describeSemantics,
  excelFallbackName,
  filterByLabel,
  isEmptyReport,
  isKnownSource,
  periodLabel,
  presetRange,
  reportQueryString,
  safeDownloadName,
  sortByValue,
  todayInZone,
  validateRange,
  type Granularity,
  type PresetId,
  type ReportQuery,
} from "../../lib/revenue-report";
import { BarChart, LineChart } from "./charts";
import { formatMoney } from "./format";
import { Badge, Banner, Btn, Card, EmptyState, Field, Skeleton, Tabs } from "./parts";
import { sourceLabel } from "../../lib/booking-sources";
import ui from "./owner.module.css";

const PRESETS: ReadonlyArray<{ id: PresetId; label: string }> = [
  { id: "today", label: "Today" },
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
];

const TABLE_ROW_LIMIT = 50;

interface Loaded {
  query: ReportQuery;
  report: OwnerRevenueReportDto;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Revenue report for any date range (requirements #1, #2, #4, #17), rendered from the server report
 * (`revenue/report`, Codex PR #226). Every figure, bucket and breakdown comes from the server, so the page and the
 * CSV export always agree and no financial logic lives in the browser.
 *
 * Two kinds of figures, never mixed:
 *  - RECORDED: collections and refunds are only the payments the shop recorded against invoices (the append-only
 *    ledger). A completed service, an invoice or a displayed QR is never counted as cash.
 *  - ESTIMATED / INVOICED: listed-price value of completed services, and issued invoice totals.
 */
export function RevenueReport({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const [timeZone, setTimeZone] = useState<string | null | undefined>(undefined); // undefined = loading, null = not set
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [source, setSource] = useState<ReportQuery["source"]>("");
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<null | "csv" | "excel">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serviceSearch, setServiceSearch] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const requestId = useRef(0);

  const run = useCallback(
    async (query: ReportQuery) => {
      const problem = validateRange(query.from, query.to);
      setRangeError(problem ? RANGE_ERROR_TEXT[problem] : null);
      if (problem) return;
      const mine = ++requestId.current;
      setLoading(true);
      setError(null);
      setNotice(null);
      try {
        const report = await apiFetch<OwnerRevenueReportDto>(`${base}/revenue/report?${reportQueryString(query)}`);
        if (mine !== requestId.current) return; // a newer request was made meanwhile
        setData({ query, report });
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
          void run({ ...range, groupBy: "day", source: "" });
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

  const report = data?.report ?? null;
  const currency = report?.currency ?? null;
  const money = useCallback((n: number) => formatMoney(n, currency), [currency]);
  const compact = useCallback((n: number) => formatMoney(n, currency, { compact: true }), [currency]);
  const shownGranularity = report?.groupBy ?? granularity;
  const collectedSeries = useMemo(() => (report ? report.periods.map((p) => ({ label: periodLabel(p.period, shownGranularity), value: p.netRecordedCollections })) : []), [report, shownGranularity]);
  const estimatedSeries = useMemo(() => (report ? report.periods.map((p) => ({ label: periodLabel(p.period, shownGranularity), value: p.estimatedServiceValue })) : []), [report, shownGranularity]);

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
  const today = todayInZone(zone);
  const current = (): ReportQuery => ({ from, to, groupBy: granularity, source });
  const choosePreset = (id: PresetId) => {
    const range = presetRange(id, todayInZone(zone));
    setFrom(range.from);
    setTo(range.to);
    void run({ ...range, groupBy: granularity, source });
  };
  const changeGranularity = (next: Granularity) => {
    setGranularity(next);
    void run({ ...current(), groupBy: next });
  };
  const changeSource = (value: string) => {
    const next = value === "" ? "" : isKnownSource(value) ? value : "";
    setSource(next);
    void run({ ...current(), source: next });
  };

  async function download(kind: "csv" | "excel") {
    if (!data) return;
    setDownloading(kind);
    setNotice(null);
    setError(null);
    try {
      // The export uses the exact query that produced the report on screen, so the file matches what is shown.
      const route = kind === "csv" ? "report.csv" : "report.excel.xml";
      const fallback = kind === "csv" ? csvFallbackName(data.query) : excelFallbackName(data.query);
      const { blob, filename } = await apiFetchBlob(`${base}/revenue/${route}?${reportQueryString(data.query)}`);
      saveBlob(blob, safeDownloadName(filename, fallback, kind === "csv" ? ".csv" : ".xml"));
      setNotice(kind === "csv" ? "Report downloaded." : "Excel-compatible report downloaded. Open it with Excel.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : kind === "csv" ? "Could not download the report." : "Could not download the Excel report.");
    } finally {
      setDownloading(null);
    }
  }

  const t = report?.totals;
  const services = report ? sortByValue(filterByLabel(report.byService, serviceSearch)) : [];
  const staff = report ? sortByValue(filterByLabel(report.byStaff, staffSearch)) : [];
  const customers = report ? sortByValue(filterByLabel(report.byCustomer, customerSearch)) : [];
  const Chart = shownGranularity === "day" ? LineChart : BarChart;

  return (
    <div className={ui.mt16}>
      <Card
        title="Revenue report"
        sub={<>Choose any dates. Dates follow your shop&apos;s calendar ({zone}); weeks start on Monday. <strong>Collected</strong> is only money your shop recorded against invoices. <strong>Estimated</strong> value is completed services at listed prices and is never counted as revenue.</>}
      >
        <div className={ui.rowWrap}>
          <Field label="From" htmlFor="rep-from"><input id="rep-from" type="date" className={ui.input} value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To" htmlFor="rep-to"><input id="rep-to" type="date" className={ui.input} value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Booking source" htmlFor="rep-source">
            <select id="rep-source" className={ui.input} value={source} onChange={(e) => changeSource(e.target.value)} disabled={loading}>
              {SOURCE_FILTERS.map((s) => (
                <option key={s.value || "all"} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Btn variant="primary" onClick={() => void run(current())} disabled={loading}>{loading ? "Loading…" : "Show report"}</Btn>
        </div>
        <div className={`${ui.rowWrap} ${ui.mt12}`} role="group" aria-label="Quick ranges">
          {PRESETS.map((p) => (
            <Btn key={p.id} small onClick={() => choosePreset(p.id)} disabled={loading}>{p.label}</Btn>
          ))}
        </div>
        {rangeError && <div className={ui.mt12}><Banner tone="error">{rangeError}</Banner></div>}
      </Card>

      {error && <div className={ui.mt12}><Banner tone="error">{error}</Banner></div>}
      {loading && !report && <div className={ui.mt12}><Skeleton height={220} /></div>}

      {report && t && (
        <div aria-busy={loading}>
          {isEmptyReport(report) ? (
            <div className={ui.mt16}>
              <EmptyState title="No activity in this range">No completed services, invoices or recorded payments were found for these dates{source ? " and this source" : ""}. Try a wider range.</EmptyState>
            </div>
          ) : (
            <>
              <div className={`${ui.statGrid} ${ui.mt16}`}>
                <div className={ui.stat}><div className={ui.statLabel}>Collected</div><div className={ui.statValue}>{money(t.recordedCollections)}</div></div>
                <div className={ui.stat}><div className={ui.statLabel}>Refunded</div><div className={ui.statValue}>{money(t.refunds)}</div></div>
                <div className={ui.stat}><div className={ui.statLabel}>Net collected</div><div className={ui.statValue}>{money(t.netRecordedCollections)}</div></div>
                <div className={ui.stat}><div className={ui.statLabel}>Invoiced ({t.invoiceCount})</div><div className={ui.statValue}>{money(t.invoicedAmount)}</div></div>
                <div className={ui.stat}><div className={ui.statLabel}>Discounts on invoices</div><div className={ui.statValue}>{money(t.invoiceDiscounts)}</div></div>
                <div className={ui.stat}><div className={ui.statLabel}>Estimated service value</div><div className={ui.statValue}>{money(t.estimatedServiceValue)}</div></div>
                <div className={ui.stat}><div className={ui.statLabel}>Completed services</div><div className={ui.statValue}>{t.completedVisits}</div></div>
              </div>

              <div className={ui.mt16}>
                <Card
                  title="By period"
                  action={<Tabs label="Report view" value={granularity} onChange={changeGranularity} tabs={[{ id: "day", label: "Daily" }, { id: "week", label: "Weekly" }, { id: "month", label: "Monthly" }]} />}
                  sub={`${report.from} to ${report.to} (${report.timeZone}). Collections and refunds are placed on the day they were recorded; visits and invoices on the day of service.`}
                >
                  <h3 className={ui.cardSub}>Net collected</h3>
                  <Chart points={collectedSeries} formatValue={compact} ariaLabel={`${shownGranularity} net collected`} />
                  <h3 className={ui.cardSub}>Estimated service value</h3>
                  <Chart points={estimatedSeries} formatValue={compact} ariaLabel={`${shownGranularity} estimated service value`} />
                  <div className={ui.tableWrap}>
                    <table className={ui.table}>
                      <caption className={ui.cardSub}>Figures by period</caption>
                      <thead>
                        <tr><th>Period</th><th className={ui.num}>Collected</th><th className={ui.num}>Refunded</th><th className={ui.num}>Net</th><th className={ui.num}>Invoiced</th><th className={ui.num}>Discounts</th><th className={ui.num}>Estimated</th><th className={ui.num}>Services</th></tr>
                      </thead>
                      <tbody>
                        {report.periods.map((p) => (
                          <tr key={p.period}>
                            <td>{periodLabel(p.period, shownGranularity)}</td>
                            <td className={ui.num}>{money(p.recordedCollections)}</td>
                            <td className={ui.num}>{money(p.refunds)}</td>
                            <td className={ui.num}>{money(p.netRecordedCollections)}</td>
                            <td className={ui.num}>{money(p.invoicedAmount)}</td>
                            <td className={ui.num}>{money(p.invoiceDiscounts)}</td>
                            <td className={ui.num}>{money(p.estimatedServiceValue)}</td>
                            <td className={ui.num}>{p.completedVisits}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className={`${ui.rowWrap} ${ui.mt12}`}>
                    <Btn icon="receipt" onClick={() => void download("csv")} disabled={downloading !== null || loading}>{downloading === "csv" ? "Preparing…" : "Download report (CSV)"}</Btn>
                    <Btn icon="receipt" onClick={() => void download("excel")} disabled={downloading !== null || loading}>{downloading === "excel" ? "Preparing…" : `Download report (${EXCEL_EXPORT_LABEL})`}</Btn>
                  </div>
                  <p className={ui.cardSub}>{EXCEL_EXPORT_NOTE}</p>
                  <div role="status" aria-live="polite">{notice && <Banner tone="ok">{notice}</Banner>}</div>
                </Card>
              </div>

              <div className={`${ui.grid} ${ui.evenTwo} ${ui.mt16}`}>
                <Card title="By service" sub="Cash is shared across an invoice's services in proportion to each line's total.">
                  <Field label="Search services" htmlFor="rep-service-search"><input id="rep-service-search" type="search" className={ui.input} value={serviceSearch} onChange={(e) => setServiceSearch(e.target.value)} placeholder="Haircut, facial…" /></Field>
                  {services.length === 0 ? (
                    <EmptyState title={report.byService.length === 0 ? "No services in this range" : "No service matches your search"} />
                  ) : (
                    <div className={ui.tableWrap}>
                      <table className={ui.table}>
                        <thead><tr><th>Service</th><th className={ui.num}>Done</th><th className={ui.num}>Estimated</th><th className={ui.num}>Collected (net)</th></tr></thead>
                        <tbody>
                          {services.slice(0, TABLE_ROW_LIMIT).map((s) => (
                            <tr key={s.key}>
                              <td>{s.label}</td>
                              <td className={ui.num}>{s.completedVisits}</td>
                              <td className={ui.num}>{money(s.estimatedServiceValue)}</td>
                              <td className={ui.num}>{money(s.netRecordedCollections)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {services.length > TABLE_ROW_LIMIT && <p className={ui.cardSub}>Showing the top {TABLE_ROW_LIMIT} of {services.length}. The CSV and Excel files have every row.</p>}
                    </div>
                  )}
                </Card>
                <Card title="By staff" sub="A name without a linked service session is marked, because it cannot be verified as one person.">
                  <Field label="Search staff" htmlFor="rep-staff-search"><input id="rep-staff-search" type="search" className={ui.input} value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)} placeholder="Barber name" /></Field>
                  {staff.length === 0 ? (
                    <EmptyState title={report.byStaff.length === 0 ? "No staff activity in this range" : "No staff member matches your search"} />
                  ) : (
                    <div className={ui.tableWrap}>
                      <table className={ui.table}>
                        <thead><tr><th>Barber</th><th className={ui.num}>Done</th><th className={ui.num}>Estimated</th><th className={ui.num}>Collected (net)</th></tr></thead>
                        <tbody>
                          {staff.slice(0, TABLE_ROW_LIMIT).map((s) => (
                            <tr key={s.key}>
                              <td>{s.label} {!s.identityVerified && <Badge tone="neutral">Not linked</Badge>}</td>
                              <td className={ui.num}>{s.completedVisits}</td>
                              <td className={ui.num}>{money(s.estimatedServiceValue)}</td>
                              <td className={ui.num}>{money(s.netRecordedCollections)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {staff.length > TABLE_ROW_LIMIT && <p className={ui.cardSub}>Showing the top {TABLE_ROW_LIMIT} of {staff.length}.</p>}
                    </div>
                  )}
                </Card>
              </div>

              <div className={ui.mt16}>
                <Card title="By source" sub="Where visits and collected money came from. “Not recorded” covers anything that cannot be traced; it is never guessed. The rows add up to the totals above.">
                  {(report.bySource ?? []).length === 0 ? (
                    <EmptyState title="No source data in this range" />
                  ) : (
                    <div className={ui.tableWrap}>
                      <table className={ui.table}>
                        <thead><tr><th>Source</th><th className={ui.num}>Visits</th><th className={ui.num}>Estimated</th><th className={ui.num}>Collected (net)</th></tr></thead>
                        <tbody>
                          {(report.bySource ?? []).map((s) => (
                            <tr key={s.key}>
                              <td>{sourceLabel(s.source)}</td>
                              <td className={ui.num}>{s.completedVisits}</td>
                              <td className={ui.num}>{money(s.estimatedServiceValue)}</td>
                              <td className={ui.num}>{money(s.netRecordedCollections)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>

              <div className={ui.mt16}>
                <Card title="By customer" sub="Guests are never merged by name or phone. A row without a verified account is marked as a guest.">
                  <Field label="Search customers" htmlFor="rep-customer-search"><input id="rep-customer-search" type="search" className={ui.input} value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Customer" /></Field>
                  {customers.length === 0 ? (
                    <EmptyState title={report.byCustomer.length === 0 ? "No customer activity in this range" : "No customer matches your search"} />
                  ) : (
                    <div className={ui.tableWrap}>
                      <table className={ui.table}>
                        <thead><tr><th>Customer</th><th className={ui.num}>Visits</th><th className={ui.num}>Estimated</th><th className={ui.num}>Collected (net)</th></tr></thead>
                        <tbody>
                          {customers.slice(0, TABLE_ROW_LIMIT).map((c) => (
                            <tr key={c.key}>
                              <td>{c.label} {!c.identityVerified && <Badge tone="neutral">Guest</Badge>}</td>
                              <td className={ui.num}>{c.completedVisits}</td>
                              <td className={ui.num}>{money(c.estimatedServiceValue)}</td>
                              <td className={ui.num}>{money(c.netRecordedCollections)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {customers.length > TABLE_ROW_LIMIT && <p className={ui.cardSub}>Showing the top {TABLE_ROW_LIMIT} of {customers.length}. The CSV and Excel files have every row.</p>}
                    </div>
                  )}
                </Card>
              </div>
            </>
          )}

          <div className={ui.mt16}>
            <Card title="How these numbers are made">
              <details>
                <summary>Show definitions</summary>
                <ul>
                  {describeSemantics(report.dataSemantics).map((line) => (
                    <li key={line} className={ui.cardSub}>{line}</li>
                  ))}
                </ul>
              </details>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
