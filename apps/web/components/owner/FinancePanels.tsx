"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { InvoicePaymentMethod, OwnerRevenueDto, RecordedPaymentListDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { BarChart, LineChart } from "./charts";
import { formatMoney, formatPercentChange, formatShopDate, formatShopTime } from "./format";
import { Badge, Banner, Btn, BtnLink, Card, EmptyState, Field, PageHead, Skeleton, Tabs } from "./parts";
import { todayIn } from "./SlotPicker";
import ui from "./owner.module.css";

const METHOD_LABEL: Record<InvoicePaymentMethod, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", OTHER: "Other" };

/** Revenue = money the shop recorded as received (net of recorded refunds). The page says so. */
export function RevenuePanel({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const [data, setData] = useState<OwnerRevenueDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"daily" | "weekly" | "monthly">("daily");

  useEffect(() => {
    apiFetch<OwnerRevenueDto>(`${base}/revenue`).then(setData).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load revenue."));
  }, [base]);

  if (error) return <><PageHead title="Revenue" /><Banner tone="error">{error}</Banner></>;
  if (!data) return <><PageHead title="Revenue" /><Skeleton height={260} /></>;
  const money = (n: number) => formatMoney(n, data.currency);
  const compact = (n: number) => formatMoney(n, data.currency, { compact: true });
  const label = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleString("en-IN", view === "monthly" ? { month: "short", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" });
  const series = (view === "daily" ? data.daily : view === "weekly" ? data.weekly : data.monthly).map((p) => ({ label: label(p.date), value: p.amount }));
  const cards = [
    { title: "Today", c: data.today, vs: "vs yesterday" },
    { title: "This week", c: data.thisWeek, vs: "vs the same days last week" },
    { title: "This month", c: data.thisMonth, vs: "vs the same days last month" },
  ];
  return (
    <>
      <PageHead
        eyebrow="Business"
        title="Revenue"
        sub="Money your shop recorded as received, after any refunds you recorded. A completed service, an unpaid invoice or a displayed payment QR is not revenue until you record the payment."
        actions={<BtnLink variant="primary" href={`/dashboard/salons/${salonId}/invoices`} icon="receipt">Invoices</BtnLink>}
      />
      {!data.hasRecordedPayments && <Banner tone="info">No payments have been recorded yet. Record a payment on an invoice and it will appear here.</Banner>}
      <div className={`${ui.grid} ${ui.threeCol}`}>
        {cards.map(({ title, c, vs }) => {
          const change = formatPercentChange(c.changePercent);
          return (
            <div key={title} className={`${ui.card} ${ui.cardTight} ${ui.kpi}`}>
              <div className={ui.kpiTop}>{title}</div>
              <div className={ui.kpiValue}>{money(c.current)}</div>
              <div className={ui.kpiFoot}>
                <span className={`${ui.delta} ${change.tone === "up" ? ui.deltaUp : change.tone === "down" ? ui.deltaDown : ui.deltaFlat}`}>{change.text}</span> {vs} ({money(c.previous)})
              </div>
            </div>
          );
        })}
      </div>
      <div className={ui.mt16}>
        <Card
          title="Recorded revenue"
          action={<Tabs label="Revenue range" value={view} onChange={setView} tabs={[{ id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }, { id: "monthly", label: "Monthly" }]} />}
        >
          {view === "daily" ? <LineChart points={series} formatValue={compact} ariaLabel="Daily recorded revenue" /> : <BarChart points={series} formatValue={compact} ariaLabel={`${view} recorded revenue`} />}
        </Card>
      </div>
      <div className={`${ui.grid} ${ui.evenTwo} ${ui.mt16}`}>
        <Card title="Still to collect">
          <div className={ui.kpiValue}>{money(data.unpaidInvoiceTotal)}</div>
          <p className={ui.cardSub}>{data.unpaidInvoiceCount} invoice{data.unpaidInvoiceCount === 1 ? "" : "s"} with a balance due.</p>
          <BtnLink small href={`/dashboard/salons/${salonId}/invoices`}>View invoices</BtnLink>
        </Card>
        <Card title="Estimated value of today's services">
          <div className={ui.kpiValue}>{money(data.estimatedServiceValueToday)}</div>
          <p className={ui.cardSub}>Completed services at their listed prices. This is only an estimate of what you may be owed — it is not counted as revenue.</p>
        </Card>
      </div>
    </>
  );
}

export function PaymentsPanel({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const [to, setTo] = useState(() => todayIn(null));
  const [from, setFrom] = useState(() => todayIn(null, -29));
  const [data, setData] = useState<RecordedPaymentListDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(
    (cursor?: string) => {
      const search = new URLSearchParams({ from, to, ...(cursor ? { cursor } : {}) });
      return apiFetch<RecordedPaymentListDto>(`${base}/payments?${search.toString()}`)
        .then((page) => {
          setData((cur) => (cursor && cur ? { ...page, items: [...cur.items, ...page.items] } : page));
          setError(null);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load payments."));
    },
    [base, from, to],
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the loading state while the new range is fetched
    setData(null);
    void load();
  }, [load]);

  const money = (n: number) => formatMoney(n, data?.currency ?? "INR");
  return (
    <>
      <PageHead eyebrow="Business" title="Payments" sub="Every payment and refund your shop has recorded against an invoice. FastQue does not move this money — it records what you tell it you received." />
      <Card tight>
        <div className={ui.rowWrap}>
          <Field label="From" htmlFor="pay-from"><input id="pay-from" type="date" className={ui.input} value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To" htmlFor="pay-to"><input id="pay-to" type="date" className={ui.input} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </Card>
      {error && <Banner tone="error">{error}</Banner>}
      {!data && !error && <Skeleton height={160} />}
      {data && (
        <>
          <div className={`${ui.statGrid} ${ui.mt16}`}>
            <div className={ui.stat}><div className={ui.statLabel}>Received</div><div className={ui.statValue}>{money(data.totals.received)}</div></div>
            <div className={ui.stat}><div className={ui.statLabel}>Refunded</div><div className={ui.statValue}>{money(data.totals.refunded)}</div></div>
            <div className={ui.stat}><div className={ui.statLabel}>Net recorded</div><div className={ui.statValue}>{money(data.totals.net)}</div></div>
            <div className={ui.stat}><div className={ui.statLabel}>Entries</div><div className={ui.statValue}>{data.totals.count}</div></div>
            {data.byMethod.map((m) => (
              <div key={m.method} className={ui.stat}><div className={ui.statLabel}>{METHOD_LABEL[m.method]}</div><div className={ui.statValue}>{money(m.net)}</div></div>
            ))}
          </div>
          <div className={ui.mt16}>
            <Card>
              {data.items.length === 0 ? (
                <EmptyState title="No payments recorded in this period">Payments you record on an invoice appear here.</EmptyState>
              ) : (
                <div className={ui.tableWrap}>
                  <table className={ui.table}>
                    <thead>
                      <tr><th>When</th><th>Invoice</th><th>Customer</th><th>Method</th><th>Recorded by</th><th className={ui.num}>Amount</th></tr>
                    </thead>
                    <tbody>
                      {data.items.map((p) => (
                        <tr key={p.id}>
                          <td>{formatShopDate(p.recordedAt, null, true)} {formatShopTime(p.recordedAt, null)}</td>
                          <td><Link className={ui.cardLink} href={`/dashboard/salons/${salonId}/invoices?open=${p.invoiceId}`}>{p.invoiceNumber}</Link></td>
                          <td>{p.customerName ?? <span className={ui.mutedCell}>Customer</span>}</td>
                          <td>{METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ""} {p.kind === "REFUND" && <Badge tone="neutral">Refund</Badge>}</td>
                          <td>{p.recordedBy}</td>
                          <td className={ui.num}>{p.kind === "REFUND" ? "-" : ""}{money(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.nextCursor && (
                <div className={ui.mt12}>
                  <Btn disabled={more} onClick={() => { setMore(true); void load(data.nextCursor!).finally(() => setMore(false)); }}>{more ? "Loading…" : "Load more"}</Btn>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
