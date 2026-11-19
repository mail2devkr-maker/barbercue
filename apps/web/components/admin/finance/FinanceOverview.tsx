"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FINANCE_DEPARTMENTS,
  type FinanceBreakdownRowDto,
  type FinanceCategoryDto,
  type FinanceContributorDto,
  type FinanceOverviewDto,
  type FinanceRunway,
} from "@barbercue/shared";
import { apiFetch } from "../../../lib/api";
import { Banner, Card, EmptyState, Field, Kpi, Skeleton } from "../../owner/parts";
import ui from "../../owner/owner.module.css";
import css from "./finance.module.css";
import { FIN, barWidth, errorText, inr, today } from "./finance-ui";

type Preset = "today" | "week" | "month" | "last_month" | "fy" | "custom";

/** Date range for a preset, in India's calendar; Indian financial year runs April–March. */
function presetRange(preset: Preset): { from: string; to: string } | null {
  const t = today();
  const [y, m, d] = t.split("-").map(Number);
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  switch (preset) {
    case "today":
      return { from: t, to: t };
    case "week": {
      const dt = new Date(Date.UTC(y, m - 1, d));
      const offset = (dt.getUTCDay() + 6) % 7; // Monday start
      return { from: iso(new Date(Date.UTC(y, m - 1, d - offset))), to: t };
    }
    case "month":
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: t };
    case "last_month":
      return { from: iso(new Date(Date.UTC(y, m - 2, 1))), to: iso(new Date(Date.UTC(y, m - 1, 0))) };
    case "fy": {
      const startYear = m >= 4 ? y : y - 1;
      return { from: `${startYear}-04-01`, to: t };
    }
    default:
      return null;
  }
}

function runwayText(r: FinanceRunway): { value: string; foot: string } {
  switch (r.kind) {
    case "MONTHS":
      return { value: `${r.months} months`, foot: "Available cash ÷ average monthly net burn" };
    case "NOT_BURNING":
      return { value: "Not burning", foot: "No net company cash outflow in recent months — runway is not a meaningful number." };
    case "NO_CASH":
      return { value: "No cash", foot: "Company accounts hold no cash while money is going out." };
    default:
      return { value: "Insufficient data", foot: "Record company accounts and payments for at least one full month." };
  }
}

function Breakdown({ rows, empty }: { rows: FinanceBreakdownRowDto[]; empty: string }) {
  const max = Math.max(0, ...rows.map((r) => Number(r.amount)));
  if (!rows.length) return <p className={ui.hint}>{empty}</p>;
  return (
    <ul className={css.breakdown}>
      {rows.slice(0, 10).map((r) => (
        <li key={r.key} className={css.breakdownRow}>
          <span className={css.breakdownLabel} title={r.label}>{r.label}</span>
          <span className={ui.bar} aria-hidden="true"><span className={ui.barFill} style={{ display: "block", width: barWidth(r.amount, max) }} /></span>
          <span className={css.breakdownValue}>{inr(r.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

export function FinanceOverview() {
  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [filters, setFilters] = useState({ categoryId: "", city: "", department: "", contributorId: "" });
  const [data, setData] = useState<FinanceOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<FinanceCategoryDto[]>([]);
  const [contributors, setContributors] = useState<FinanceContributorDto[]>([]);

  useEffect(() => {
    apiFetch<FinanceCategoryDto[]>(`${FIN}/categories`).then(setCategories).catch(() => undefined);
    apiFetch<FinanceContributorDto[]>(`${FIN}/contributors`).then(setContributors).catch(() => undefined);
  }, []);

  const range = useMemo(() => (preset === "custom" ? (custom.from && custom.to ? custom : null) : presetRange(preset)), [preset, custom]);

  useEffect(() => {
    if (!range) return;
    const q = new URLSearchParams({ from: range.from, to: range.to });
    Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
    let cancelled = false;
    apiFetch<FinanceOverviewDto>(`${FIN}/overview?${q}`)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((err) => !cancelled && setError(errorText(err, "Could not load the finance overview.")));
    return () => {
      cancelled = true;
    };
  }, [range, filters]);

  const k = data?.kpis;
  const runway = k ? runwayText(k.runway) : null;
  const maxMonth = data ? Math.max(0, ...data.monthly.flatMap((m) => [Number(m.incurred), Number(m.companyCashOut)])) : 0;
  const empty = k && Number(k.totalExpensesIncurred) === 0 && Number(k.totalFundsContributed) === 0 && Number(k.availableCash) === 0;

  return (
    <>
      <Card title="Filters" tight>
        <div className={css.filters}>
          <Field label="Period" htmlFor="fo-period">
            <select id="fo-period" className={ui.select} value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="last_month">Last month</option>
              <option value="fy">This financial year</option>
              <option value="custom">Custom range</option>
            </select>
          </Field>
          {preset === "custom" && (
            <>
              <Field label="From" htmlFor="fo-from"><input id="fo-from" type="date" className={ui.input} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></Field>
              <Field label="To" htmlFor="fo-to"><input id="fo-to" type="date" className={ui.input} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></Field>
            </>
          )}
          <Field label="Category" htmlFor="fo-cat">
            <select id="fo-cat" className={ui.select} value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Department" htmlFor="fo-dept">
            <select id="fo-dept" className={ui.select} value={filters.department} onChange={(e) => setFilters({ ...filters, department: e.target.value })}>
              <option value="">All departments</option>
              {FINANCE_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="City / territory" htmlFor="fo-city">
            <input id="fo-city" className={ui.input} value={filters.city} placeholder="All" onChange={(e) => setFilters({ ...filters, city: e.target.value.trim() })} />
          </Field>
          <Field label="Contributor" htmlFor="fo-who">
            <select id="fo-who" className={ui.select} value={filters.contributorId} onChange={(e) => setFilters({ ...filters, contributorId: e.target.value })}>
              <option value="">Everyone</option>
              {contributors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      {error && <Banner tone="error">{error}</Banner>}
      {!k || !data ? (
        <Skeleton height={320} />
      ) : (
        <>
          {empty && (
            <Banner tone="info">
              No finance records yet. Start in Settings (company accounts), then Contributions & Funding and Expenses — every figure here is calculated from what you record.
            </Banner>
          )}
          <div className={ui.kpiGrid}>
            <Kpi icon="rupee" label="Available cash" value={inr(k.availableCash)} foot="Opening balances + actual company-account movements" tone="ok" />
            <Kpi icon="trend" label="Total funds contributed" value={inr(k.totalFundsContributed)} foot={`Founders/directors ${inr(k.founderContributions)} · Other ${inr(k.otherFunding)}`} />
            <Kpi icon="user" label="Paid personally for FastQue" value={inr(k.paidPersonallyOnBehalf)} foot="Not company cash — shown separately from funding" tone="info" />
            <Kpi icon="receipt" label="Total expenses incurred" value={inr(k.totalExpensesIncurred)} foot={`Paid ${inr(k.totalExpensesPaid)} · Unpaid ${inr(k.unpaidLiabilities)}`} />
            <Kpi icon="calendar" label="Expenses this month" value={inr(k.expensesThisMonth)} foot={`Last month ${inr(k.expensesLastMonth)}`} />
            <Kpi icon="chart" label="Monthly net cash burn" value={k.averageNetBurn === null ? "Insufficient data" : inr(k.averageNetBurn)} foot={k.averageNetBurn === null ? "Needs a full month of records" : `Average of ${k.burnMonthsUsed} month(s). No revenue is connected yet, so net = gross.`} tone="warn" />
            <Kpi icon="clock" label="Cash runway" value={runway!.value} foot={runway!.foot} />
            <Kpi icon="users" label="Reimbursements owed" value={inr(k.pendingReimbursements)} foot={`Awaiting review ${inr(k.reimbursementsAwaitingReview)}`} tone="warn" />
            <Kpi icon="alert" label="Outstanding payables" value={inr(k.outstandingPayables)} foot={`Approved, unpaid expenses ${inr(k.approvedUnpaidExpenses)}`} />
            <Kpi icon="info" label="Awaiting approval" value={inr(k.expensesAwaitingApproval)} foot="Submitted expenses not yet decided" />
            <Kpi icon="refresh" label="Net cash flow (period)" value={inr(k.periodNetCashFlow)} foot={`Funding in ${inr(k.periodFundingReceived)} this period`} />
            <Kpi icon="tag" label="Revenue received" value="Not connected" foot="FastQue revenue records are linked in a later phase — never counted from funding." />
            <Kpi icon="settings" label="Budget utilization" value="Not set up" foot="Budgets arrive in finance Phase 4." />
          </div>

          <div className={css.twoUp}>
            <Card title="Where the money goes" sub={`Incurred ${inr(k.periodExpensesIncurred)} · ${data.period.from} to ${data.period.to}`}>
              <Breakdown rows={data.byCategory} empty="No approved expenses in this period." />
            </Card>
            <Card title="Who paid" sub="Payments toward this period's expenses">
              <Breakdown rows={data.byPaidBy} empty="No payments recorded for this period's expenses." />
            </Card>
            <Card title="By city / territory">
              <Breakdown rows={data.byCity} empty="No approved expenses in this period." />
            </Card>
            <Card title="By department">
              <Breakdown rows={data.byDepartment} empty="No approved expenses in this period." />
            </Card>
            <Card title="Funding by contributor" sub="Cash received into company accounts, all time">
              <Breakdown rows={data.byContributorFunding} empty="No funding recorded yet." />
            </Card>
            <Card title="Reimbursements owed by person" sub="Approved or unclaimed, plus claims under review">
              <Breakdown rows={data.reimbursementsOwedByPerson} empty="Nothing is owed to anyone." />
            </Card>
          </div>

          <Card title="Last 12 months" sub="Expenses incurred vs. company cash paid out">
            {maxMonth === 0 ? (
              <EmptyState title="No monthly history yet" />
            ) : (
              <>
                <div className={css.months} role="img" aria-label="Monthly expenses incurred and company cash out for the last 12 months">
                  {data.monthly.map((m) => (
                    <div key={m.month} className={css.monthCol} title={`${m.month}: incurred ${inr(m.incurred)}, company cash out ${inr(m.companyCashOut)}, funding in ${inr(m.fundingIn)}`}>
                      <div className={css.monthBars}>
                        <span className={css.monthBar} style={{ height: `${(Number(m.incurred) / maxMonth) * 100}%` }} />
                        <span className={`${css.monthBar} ${css.monthBarCash}`} style={{ height: `${(Number(m.companyCashOut) / maxMonth) * 100}%` }} />
                      </div>
                      <span className={css.monthLabel}>{new Date(`${m.month}-01T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" })}</span>
                    </div>
                  ))}
                </div>
                <div className={css.legend}>
                  <span><span className={css.swatch} />Incurred</span>
                  <span><span className={`${css.swatch} ${css.swatchCash}`} />Company cash out</span>
                </div>
              </>
            )}
          </Card>
          <p className={ui.hint}>Generated {new Date(data.generatedAt).toLocaleString("en-IN")} · INR · Contributions are never counted as revenue; ownership is never derived from money contributed.</p>
        </>
      )}
    </>
  );
}
