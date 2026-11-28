"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FINANCE_DEPARTMENTS,
  FINANCE_EXPENSE_STATUS_LABEL,
  type FinanceBreakdownRowDto,
  type FinanceCategoryDto,
  type FinanceContributorDto,
  type FinanceExpenseDto,
  type FinanceExpensePageDto,
  type FinanceOverviewDto,
  type FinanceRunway,
} from "@barbercue/shared";
import { apiFetch } from "../../../lib/api";
import { Banner, Field, Skeleton } from "../../owner/parts";
import { Icon, type IconName } from "../../owner/icons";
import ui from "../../owner/owner.module.css";
import dash from "./finance-dashboard.module.css";
import { FIN, errorText, inr, today } from "./finance-ui";

// ------------------------------------------------------------------ filters

type Preset = "month" | "last_month" | "3m" | "6m" | "12m" | "fy" | "custom";
const PRESETS: ReadonlyArray<{ id: Preset; label: string }> = [
  { id: "month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "3m", label: "Last 3 months" },
  { id: "6m", label: "Last 6 months" },
  { id: "12m", label: "Last 12 months" },
  { id: "fy", label: "This financial year" },
  { id: "custom", label: "Custom range" },
];
type PaymentStatus = "" | "APPROVED" | "PARTIALLY_PAID" | "PAID";
interface Filters {
  preset: Preset;
  from: string;
  to: string;
  categoryId: string;
  department: string;
  city: string;
  contributorId: string;
  paymentStatus: PaymentStatus;
}
const DEFAULT_FILTERS: Filters = { preset: "6m", from: "", to: "", categoryId: "", department: "", city: "", contributorId: "", paymentStatus: "" };

/** Date range for a preset, in India's calendar; the Indian financial year runs April–March. */
export function presetRange(preset: Preset, t = today()): { from: string; to: string } | null {
  const [y, m] = t.split("-").map(Number);
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  const monthsBack = (count: number) => ({ from: iso(new Date(Date.UTC(y, m - count, 1))), to: t });
  switch (preset) {
    case "month":
      return monthsBack(1);
    case "last_month":
      return { from: iso(new Date(Date.UTC(y, m - 2, 1))), to: iso(new Date(Date.UTC(y, m - 1, 0))) };
    case "3m":
      return monthsBack(3);
    case "6m":
      return monthsBack(6);
    case "12m":
      return monthsBack(12);
    case "fy":
      return { from: `${m >= 4 ? y : y - 1}-04-01`, to: t };
    default:
      return null;
  }
}

const rangeOf = (f: Filters) => (f.preset === "custom" ? (f.from && f.to && f.from <= f.to ? { from: f.from, to: f.to } : null) : presetRange(f.preset));

// ------------------------------------------------------------------ formatting

const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

/** Compact INR for axes: ₹1.2 Cr, ₹45 L, ₹12K. */
export function inrShort(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  const fmt = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, ""));
  if (a >= 1e7) return `${sign}₹${fmt(a / 1e7)} Cr`;
  if (a >= 1e5) return `${sign}₹${fmt(a / 1e5)} L`;
  if (a >= 1e3) return `${sign}₹${fmt(a / 1e3)}K`;
  return `${sign}₹${Math.round(a)}`;
}

/** Headline amounts in whole rupees (exact figures stay in the tables and tooltips). */
const whole = (v: string | number | null | undefined) => inr(Math.round(n(v)).toFixed(2));
const signedWhole = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${whole(Math.abs(v))}`;
const signedInr = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${inr(Math.abs(v).toFixed(2))}`;

/** Percent change, or null when there is no base to compare with. */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

const monthLabel = (m: string, withYear = false) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleString("en-IN", { month: "short", ...(withYear ? { year: "2-digit" } : {}), timeZone: "UTC" });

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function runwayText(r: FinanceRunway): { value: string; note: string } {
  switch (r.kind) {
    case "MONTHS":
      return { value: `${r.months} months`, note: "at current burn" };
    case "NOT_BURNING":
      return { value: "Not burning", note: "no net cash outflow" };
    case "NO_CASH":
      return { value: "No cash", note: "accounts are empty" };
    default:
      return { value: "Insufficient data", note: "needs a full month of records" };
  }
}

/** Number of calendar months the range touches (at least 1). */
function monthsInRange(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(1, (ty - fy) * 12 + (tm - fm) + 1);
}

// Categorical slots (dataviz reference palette, validated for adjacent pairs in light and dark).
const SLOTS = 6;

// ------------------------------------------------------------------ small pieces

type Tone = "cash" | "burn" | "fund" | "claims" | "vendor" | "net";

function Delta({ value, goodWhenUp = true, children }: { value: number | null; goodWhenUp?: boolean; children: ReactNode }) {
  if (value === null || !Number.isFinite(value)) return <span className={dash.deltaNeutral}>{children}</span>;
  const up = value > 0;
  const flat = Math.abs(value) < 0.05;
  const good = flat ? null : up === goodWhenUp;
  const cls = good === null ? dash.deltaNeutral : good ? dash.deltaGood : dash.deltaBad;
  return (
    <span className={cls}>
      {!flat && <span aria-hidden="true">{up ? "▲" : "▼"} </span>}
      {children}
    </span>
  );
}

function KpiCard({ icon, tone, label, value, exact, children }: { icon: IconName; tone: Tone; label: string; value: string; exact?: string; children: ReactNode }) {
  return (
    <article className={`${dash.kpi} ${dash[`tone_${tone}`]}`}>
      <div className={dash.kpiHead}>
        <span className={dash.kpiIcon} aria-hidden="true"><Icon name={icon} size={18} /></span>
        <h3 className={dash.kpiLabel}>{label}</h3>
      </div>
      <p className={dash.kpiValue} title={exact ?? value}>{value}</p>
      <p className={dash.kpiFoot}>{children}</p>
    </article>
  );
}

function Panel({ title, icon, sub, action, className, children }: { title: string; icon?: IconName; sub?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`${dash.panel} ${className ?? ""}`} aria-label={title}>
      <header className={dash.panelHead}>
        <div>
          <h2 className={dash.panelTitle}>
            {icon && <span className={dash.panelIcon} aria-hidden="true"><Icon name={icon} size={16} /></span>}
            {title}
          </h2>
          {sub && <p className={dash.panelSub}>{sub}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className={dash.empty}>{children}</p>;
}

// ------------------------------------------------------------------ cash-flow chart

interface FlowPoint {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
}

const SERIES = [
  { key: "inflow", label: "Cash inflows", slot: 1 },
  { key: "outflow", label: "Cash outflows", slot: 2 },
  { key: "net", label: "Net cash flow", slot: 3 },
] as const;

function niceStep(span: number, ticks = 4) {
  const raw = span / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => raw <= s) ?? 10 * pow;
}

export function CashFlowChart({ points }: { points: FlowPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the box's real width so axis text stays legible on phones (no scaled-down SVG text).
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(260, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = W < 480;
  const H = narrow ? 220 : 250;
  const pad = { l: narrow ? 50 : 58, r: 12, t: 12, b: 28 };
  const labelEvery = narrow && points.length > 7 ? 2 : 1;
  const values = points.flatMap((p) => [p.inflow, p.outflow, p.net]);
  const rawMax = Math.max(0, ...values);
  const rawMin = Math.min(0, ...values);
  const step = niceStep(rawMax - rawMin || 1);
  const max = Math.ceil(rawMax / step) * step || step;
  const min = Math.floor(rawMin / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(v);
  const x = (i: number) => pad.l + (points.length <= 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + ((max - v) / (max - min)) * (H - pad.t - pad.b);
  const line = (key: (typeof SERIES)[number]["key"]) => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const base = y(Math.max(min, 0)).toFixed(1);
  const area = `${line("net")} L${x(points.length - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`;
  const hp = hover === null ? null : points[hover];
  const last = points[points.length - 1];
  const slotW = (W - pad.l - pad.r) / Math.max(1, points.length - 1);

  return (
    <div className={dash.chartWrap}>
      <ul className={dash.legend}>
        {SERIES.map((s) => (
          <li key={s.key}><span className={`${dash.legendDot} ${dash[`series${s.slot}`]}`} aria-hidden="true" />{s.label}</li>
        ))}
      </ul>
      <div className={dash.chartBox} ref={box} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className={dash.chartSvg} role="img" aria-label="Monthly cash inflows, outflows and net cash flow. Use 'Show as table' for the same figures.">
          <defs>
            <linearGradient id="fd-net-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--fd-s3)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--fd-s3)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? dash.axisZero : dash.gridLine} />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className={dash.axisText}>{inrShort(t)}</text>
            </g>
          ))}
          {points.map((p, i) =>
            (points.length - 1 - i) % labelEvery === 0 ? (
              <text key={p.month} x={x(i)} y={H - 8} textAnchor="middle" className={dash.axisText}>{monthLabel(p.month, !narrow && (i === 0 || p.month.endsWith("-01")))}</text>
            ) : null,
          )}
          <path d={area} fill="url(#fd-net-fill)" />
          {SERIES.map((s) => (
            <path key={s.key} d={line(s.key)} className={`${dash.seriesLine} ${dash[`stroke${s.slot}`]}`} />
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className={dash.crosshair} />}
          {SERIES.map((s) =>
            points.map((p, i) => (
              <circle key={`${s.key}-${p.month}`} cx={x(i)} cy={y(p[s.key])} r={hover === i ? 5 : 3.5} className={`${dash.dot} ${dash[`fill${s.slot}`]}`} />
            )),
          )}
          {points.map((p, i) => (
            <rect
              key={`hit-${p.month}`}
              x={x(i) - slotW / 2}
              y={0}
              width={slotW}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onTouchStart={() => setHover(i)}
            />
          ))}
        </svg>
        {hp && hover !== null ? (
          <div className={dash.tooltip} style={{ left: `${Math.min(80, Math.max(20, (x(hover) / W) * 100))}%` }} role="status">
            <strong>{monthLabel(hp.month, true)}</strong>
            <span><i className={`${dash.legendDot} ${dash.series1}`} />In {inr(hp.inflow.toFixed(2))}</span>
            <span><i className={`${dash.legendDot} ${dash.series2}`} />Out {inr(hp.outflow.toFixed(2))}</span>
            <span><i className={`${dash.legendDot} ${dash.series3}`} />Net {signedInr(hp.net)}</span>
          </div>
        ) : (
          last && (
            <div className={dash.callout} aria-hidden="true">
              <strong>{signedInr(last.net)}</strong>
              <span>Net · {monthLabel(last.month, true)}</span>
            </div>
          )
        )}
      </div>
      <details className={dash.tableToggle}>
        <summary>Show as table</summary>
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Month</th><th className={ui.num}>Inflows</th><th className={ui.num}>Outflows</th><th className={ui.num}>Net</th></tr></thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.month}><td>{monthLabel(p.month, true)}</td><td className={ui.num}>{inr(p.inflow.toFixed(2))}</td><td className={ui.num}>{inr(p.outflow.toFixed(2))}</td><td className={ui.num}>{signedInr(p.net)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------ donut

export function CategoryDonut({ rows, total }: { rows: FinanceBreakdownRowDto[]; total: number }) {
  const [active, setActive] = useState<string | null>(null);
  const top = rows.length > SLOTS ? rows.slice(0, SLOTS - 1) : rows;
  const rest = rows.length > SLOTS ? rows.slice(SLOTS - 1) : [];
  const restTotal = rest.reduce((t, r) => t + n(r.amount), 0);
  const slices = [
    ...top.map((r, i) => ({ key: r.key, label: r.label, amount: n(r.amount), slot: i + 1 })),
    ...(rest.length ? [{ key: "__other", label: `Other (${rest.length})`, amount: restTotal, slot: SLOTS }] : []),
  ];
  const R = 70;
  const C = 2 * Math.PI * R;
  const gap = slices.length > 1 ? 2 : 0;
  let offset = 0;
  const focus = slices.find((s) => s.key === active);

  return (
    <div className={dash.donutWrap}>
      <div className={dash.donutFigure}>
        <svg viewBox="0 0 180 180" className={dash.donutSvg} role="img" aria-label={`Expense split by category, total ${inr(total.toFixed(2))}`}>
          <circle cx="90" cy="90" r={R} className={dash.donutTrack} />
          {slices.map((s) => {
            const len = total > 0 ? (s.amount / total) * C : 0;
            const seg = Math.max(0, len - gap);
            const el = (
              <circle
                key={s.key}
                cx="90"
                cy="90"
                r={R}
                className={`${dash.donutSlice} ${dash[`stroke${s.slot}`]} ${active && active !== s.key ? dash.dim : ""}`}
                strokeDasharray={`${seg} ${C - seg}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 90 90)"
                onMouseEnter={() => setActive(s.key)}
                onMouseLeave={() => setActive(null)}
              >
                <title>{`${s.label}: ${inr(s.amount.toFixed(2))}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className={dash.donutCenter}>
          <strong>{focus ? inrShort(focus.amount) : inrShort(total)}</strong>
          <span>{focus ? focus.label : "Total spend"}</span>
        </div>
      </div>
      <ul className={dash.donutLegend}>
        {slices.map((s) => (
          <li key={s.key} className={active && active !== s.key ? dash.dim : ""} onMouseEnter={() => setActive(s.key)} onMouseLeave={() => setActive(null)}>
            <span className={`${dash.legendDot} ${dash[`series${s.slot}`]}`} aria-hidden="true" />
            <span className={dash.donutLabel} title={s.label}>{s.label}</span>
            <span className={dash.donutPct}>{total > 0 ? `${((s.amount / total) * 100).toFixed(1)}%` : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ recent transactions

type SortKey = "expenseDate" | "description" | "category" | "vendor" | "paidBy" | "amount" | "status" | "reimbursement";
const COLUMNS: ReadonlyArray<{ key: SortKey; label: string; num?: boolean }> = [
  { key: "expenseDate", label: "Date" },
  { key: "description", label: "Transaction" },
  { key: "category", label: "Category" },
  { key: "vendor", label: "Vendor" },
  { key: "paidBy", label: "Paid by" },
  { key: "amount", label: "Amount", num: true },
  { key: "status", label: "Status" },
  { key: "reimbursement", label: "Reimbursement" },
];

const sortValue = (e: FinanceExpenseDto, k: SortKey): string | number => {
  switch (k) {
    case "amount":
      return n(e.amount);
    case "category":
      return e.category.name;
    case "vendor":
      return e.vendor?.name ?? "";
    case "paidBy":
      return e.paidBy.join(", ");
    case "reimbursement":
      return e.reimbursementRequired ? 1 : 0;
    default:
      return e[k] ?? "";
  }
};

const STATUS_TONE: Record<string, string> = {
  PAID: "chipOk",
  PARTIALLY_PAID: "chipInfo",
  APPROVED: "chipWarn",
  SUBMITTED: "chipNeutral",
  UNDER_REVIEW: "chipNeutral",
  DRAFT: "chipNeutral",
  REJECTED: "chipBad",
  CANCELLED: "chipBad",
};

function RecentTransactions({ items, onViewAll }: { items: FinanceExpenseDto[] | null; onViewAll?: () => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "expenseDate", dir: -1 });
  const rows = useMemo(() => {
    if (!items) return null;
    return [...items].sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return c * sort.dir;
    });
  }, [items, sort]);
  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "amount" || key === "expenseDate" ? -1 : 1 }));

  return (
    <Panel
      title="Recent transactions"
      icon="receipt"
      sub="Latest expenses matching the filters"
      className={dash.span12}
      action={onViewAll && <button type="button" className={dash.linkBtn} onClick={onViewAll}>View all expenses →</button>}
    >
      {!rows ? (
        <Skeleton height={160} />
      ) : rows.length === 0 ? (
        <Empty>No expenses match these filters yet.</Empty>
      ) : (
        <div className={ui.tableWrap}>
          <table className={`${ui.table} ${dash.txTable}`}>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} className={c.num ? ui.num : undefined} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                    <button type="button" className={dash.sortBtn} onClick={() => toggle(c.key)}>
                      {c.label}
                      <span aria-hidden="true" className={dash.sortIcon}>{sort.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className={dash.nowrap}>{dayLabel(e.expenseDate)}</td>
                  <td><span className={dash.txTitle}>{e.description}</span><span className={dash.txNo}>{e.number}</span></td>
                  <td><span className={dash.catChip}>{e.category.name}</span></td>
                  <td>{e.vendor?.name ?? "—"}</td>
                  <td>{e.paidBy.length ? e.paidBy.join(", ") : <span className={dash.muted}>Not paid yet</span>}</td>
                  <td className={`${ui.num} ${dash.nowrap}`}><strong>{inr(e.amount)}</strong></td>
                  <td><span className={`${dash.chip} ${dash[STATUS_TONE[e.status] ?? "chipNeutral"]}`}>{FINANCE_EXPENSE_STATUS_LABEL[e.status]}</span></td>
                  <td>{e.reimbursementRequired ? <span className={`${dash.chip} ${dash.chipPlum}`}>Claim</span> : <span className={dash.muted}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ main

export type FinanceTabTarget = "expenses" | "funding" | "reimbursements" | "vendors" | "settings";

interface PendingAction {
  icon: IconName;
  tone: "warn" | "info" | "bad";
  title: string;
  sub: string;
  tab: FinanceTabTarget;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function FinanceOverview({ onNavigate }: { onNavigate?: (tab: FinanceTabTarget) => void } = {}) {
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS);
  const [data, setData] = useState<FinanceOverviewDto | null>(null);
  const [recent, setRecent] = useState<FinanceExpenseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<FinanceCategoryDto[]>([]);
  const [contributors, setContributors] = useState<FinanceContributorDto[]>([]);
  const [chartMonths, setChartMonths] = useState<6 | 12>(6);

  useEffect(() => {
    apiFetch<FinanceCategoryDto[]>(`${FIN}/categories`).then(setCategories).catch(() => undefined);
    apiFetch<FinanceContributorDto[]>(`${FIN}/contributors`).then(setContributors).catch(() => undefined);
  }, []);

  const range = useMemo(() => rangeOf(applied), [applied]);

  useEffect(() => {
    if (!range) return;
    const { categoryId, department, city, contributorId, paymentStatus } = applied;
    const q = new URLSearchParams({ from: range.from, to: range.to });
    Object.entries({ categoryId, department, city, contributorId, paymentStatus }).forEach(([key, v]) => v && q.set(key, v));
    const tx = new URLSearchParams({ from: range.from, to: range.to, sort: "date_desc", pageSize: "8" });
    if (categoryId) tx.set("categoryId", categoryId);
    if (department) tx.set("department", department);
    if (city) tx.set("city", city);
    if (contributorId) tx.set("paidByContributorId", contributorId);
    if (paymentStatus) tx.set("status", paymentStatus);
    let cancelled = false;
    apiFetch<FinanceOverviewDto>(`${FIN}/overview?${q}`)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((err) => !cancelled && setError(errorText(err, "Could not load the finance overview.")));
    apiFetch<FinanceExpensePageDto>(`${FIN}/expenses?${tx}`)
      .then((p) => !cancelled && setRecent(p.items))
      .catch(() => !cancelled && setRecent([]));
    return () => {
      cancelled = true;
    };
  }, [range, applied]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const draftValid = draft.preset !== "custom" || !!rangeOf(draft);
  const set = <K extends keyof Filters>(key: K, v: Filters[K]) => setDraft((f) => ({ ...f, [key]: v }));
  const cityOptions = useMemo(() => (data?.byCity ?? []).filter((c) => c.key !== "unassigned").map((c) => c.label), [data]);
  const flow: FlowPoint[] = useMemo(
    () =>
      (data?.monthly ?? []).slice(-chartMonths).map((m) => {
        const inflow = n(m.fundingIn);
        const outflow = n(m.companyCashOut) + n(m.repaymentsOut);
        return { month: m.month, inflow, outflow, net: inflow - outflow };
      }),
    [data, chartMonths],
  );

  const k = data?.kpis;
  const filterBar = (
    <form
      className={dash.filterBar}
      aria-label="Dashboard filters"
      onSubmit={(e) => {
        e.preventDefault();
        if (draftValid) setApplied(draft);
      }}
    >
      <div className={dash.filterTitle}><Icon name="search" size={16} aria-hidden="true" />Filters</div>
      <div className={dash.filterFields}>
        <Field label="Period" htmlFor="fo-period">
          <select id="fo-period" className={ui.select} value={draft.preset} onChange={(e) => set("preset", e.target.value as Preset)}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        {draft.preset === "custom" && (
          <>
            <Field label="From" htmlFor="fo-from"><input id="fo-from" type="date" className={ui.input} value={draft.from} max={today()} onChange={(e) => set("from", e.target.value)} /></Field>
            <Field label="To" htmlFor="fo-to"><input id="fo-to" type="date" className={ui.input} value={draft.to} max={today()} onChange={(e) => set("to", e.target.value)} /></Field>
          </>
        )}
        <Field label="Category" htmlFor="fo-cat">
          <select id="fo-cat" className={ui.select} value={draft.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Department" htmlFor="fo-dept">
          <select id="fo-dept" className={ui.select} value={draft.department} onChange={(e) => set("department", e.target.value)}>
            <option value="">All departments</option>
            {FINANCE_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="City / territory" htmlFor="fo-city">
          <input id="fo-city" className={ui.input} list="fo-city-list" value={draft.city} placeholder="All" onChange={(e) => set("city", e.target.value.trim())} />
          <datalist id="fo-city-list">{cityOptions.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Contributor" htmlFor="fo-who">
          <select id="fo-who" className={ui.select} value={draft.contributorId} onChange={(e) => set("contributorId", e.target.value)}>
            <option value="">All contributors</option>
            {contributors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Payment status" htmlFor="fo-status">
          <select id="fo-status" className={ui.select} value={draft.paymentStatus} onChange={(e) => set("paymentStatus", e.target.value as PaymentStatus)}>
            <option value="">All statuses</option>
            <option value="PAID">Paid</option>
            <option value="PARTIALLY_PAID">Partially paid</option>
            <option value="APPROVED">Approved — unpaid</option>
          </select>
        </Field>
      </div>
      <div className={dash.filterActions}>
        <button
          type="button"
          className={dash.linkBtn}
          onClick={() => {
            setDraft(DEFAULT_FILTERS);
            setApplied(DEFAULT_FILTERS);
          }}
        >
          Clear all
        </button>
        <button type="submit" className={dash.applyBtn} disabled={!dirty || !draftValid}>Apply</button>
      </div>
    </form>
  );

  if (!k || !data) {
    return (
      <div className={dash.root}>
        {filterBar}
        {error ? <Banner tone="error">{error}</Banner> : <div className={dash.skeletons}><Skeleton height={120} /><Skeleton height={300} /></div>}
      </div>
    );
  }

  const runway = runwayText(k.runway);
  const empty = n(k.totalExpensesIncurred) === 0 && n(k.totalFundsContributed) === 0 && n(k.availableCash) === 0;
  const flowEmpty = flow.every((p) => p.inflow === 0 && p.outflow === 0);

  // Burn trend: company cash out in the last complete month vs. the month before (lower is better).
  const complete = data.monthly.slice(0, -1);
  const lastBurn = n(complete[complete.length - 1]?.companyCashOut);
  const prevBurn = n(complete[complete.length - 2]?.companyCashOut);
  const burnChange = pctChange(lastBurn, prevBurn);
  const fundChange = pctChange(n(k.periodFundingReceived), n(data.previous.fundingReceived));
  const netNow = n(k.periodNetCashFlow);
  const netDiff = netNow - n(data.previous.netCashFlow);
  const periodMonths = monthsInRange(data.period.from, data.period.to);
  const catTotal = n(k.periodExpensesIncurred);
  const avgSpend = catTotal / periodMonths;
  const topCat = data.byCategory[0];
  const deptMax = Math.max(0, ...data.byDepartment.map((r) => n(r.amount)));
  const funders = data.byContributorFunding;
  const topFunders = funders.length > 5 ? funders.slice(0, 4) : funders;
  const otherFunders = funders.length > 5 ? funders.slice(4) : [];
  const claimsOutstanding = n(k.pendingReimbursements) + n(k.reimbursementsAwaitingReview);
  const topVendor = data.vendorPayablesByVendor[0];

  const actions: PendingAction[] = [];
  if (data.pending.reimbursementsAwaitingReview > 0)
    actions.push({ icon: "receipt", tone: "warn", title: `${plural(data.pending.reimbursementsAwaitingReview, "reimbursement claim")} awaiting review`, sub: `Total ${inr(k.reimbursementsAwaitingReview)}`, tab: "reimbursements" });
  if (data.pending.reimbursementsApprovedUnpaid > 0)
    actions.push({ icon: "users", tone: "info", title: `${plural(data.pending.reimbursementsApprovedUnpaid, "approved claim")} to pay out`, sub: `Owed to people ${inr(k.pendingReimbursements)}`, tab: "reimbursements" });
  if (data.pending.expensesAwaitingApproval > 0)
    actions.push({ icon: "check", tone: "warn", title: `${plural(data.pending.expensesAwaitingApproval, "expense")} awaiting approval`, sub: `Total ${inr(k.expensesAwaitingApproval)}`, tab: "expenses" });
  if (k.vendorBillsUnpaid > 0)
    actions.push({
      icon: "store",
      tone: "bad",
      title: `${plural(k.vendorBillsUnpaid, "vendor bill")} unpaid`,
      sub: topVendor ? `${topVendor.label} – ${inr(topVendor.amount)}${data.vendorPayablesByVendor.length > 1 ? ` · +${data.vendorPayablesByVendor.length - 1} more` : ""}` : inr(k.vendorPayables),
      tab: "vendors",
    });

  return (
    <div className={dash.root}>
      {filterBar}
      {error && <Banner tone="error">{error}</Banner>}
      {empty && (
        <Banner tone="info">
          No finance records yet. Start in Settings (company accounts), then Contributions & Funding and Expenses — every figure here is calculated from what you record.
        </Banner>
      )}
      <p className={dash.periodNote}>
        Showing {dayLabel(data.period.from)} – {dayLabel(data.period.to)} · compared with {dayLabel(data.previous.from)} – {dayLabel(data.previous.to)}
      </p>

      <div className={dash.kpiGrid}>
        <KpiCard icon="rupee" tone="cash" label="Available cash" value={whole(k.availableCash)} exact={inr(k.availableCash)}>
          <span className={dash.deltaNeutral}>Live balance · {plural(k.accountCount, "company account")}</span>
        </KpiCard>
        <KpiCard icon="trend" tone="burn" label="Monthly burn" value={k.averageGrossBurn === null ? "Insufficient data" : whole(k.averageGrossBurn)} exact={k.averageGrossBurn === null ? undefined : `${inr(k.averageGrossBurn)} per month`}>
          {k.averageGrossBurn === null ? (
            <span className={dash.deltaNeutral}>Needs a full month of records</span>
          ) : (
            <Delta value={burnChange} goodWhenUp={false}>
              {burnChange === null ? `Average of ${plural(k.burnMonthsUsed, "month")}` : `${Math.abs(burnChange).toFixed(1)}% last month vs. month before`}
            </Delta>
          )}
        </KpiCard>
        <KpiCard icon="users" tone="fund" label="Total funds contributed" value={whole(k.totalFundsContributed)} exact={inr(k.totalFundsContributed)}>
          <Delta value={fundChange}>
            {fundChange === null ? `${inr(k.periodFundingReceived)} received this period` : `${Math.abs(fundChange).toFixed(1)}% vs. previous period`}
          </Delta>
        </KpiCard>
        <KpiCard icon="receipt" tone="claims" label="Outstanding reimbursements" value={whole(claimsOutstanding)} exact={inr(claimsOutstanding.toFixed(2))}>
          <span className={dash.deltaNeutral}>Owed {inr(k.pendingReimbursements)} · In review {inr(k.reimbursementsAwaitingReview)}</span>
        </KpiCard>
        <KpiCard icon="store" tone="vendor" label="Vendor payables" value={whole(k.vendorPayables)} exact={inr(k.vendorPayables)}>
          <span className={dash.deltaNeutral}>{k.vendorBillsUnpaid ? `${plural(k.vendorBillsUnpaid, "approved bill")} unpaid` : "No unpaid vendor bills"}</span>
        </KpiCard>
        <KpiCard icon="chart" tone="net" label="Net cash flow" value={signedWhole(netNow)} exact={signedInr(netNow)}>
          <Delta value={netDiff}>{netDiff === 0 ? "Same as previous period" : `${signedWhole(netDiff)} vs. previous period`}</Delta>
        </KpiCard>
      </div>

      <div className={dash.grid}>
        <Panel
          title={`Cash flow (last ${chartMonths} months)`}
          icon="chart"
          sub="Company accounts · funding in vs. payments, payouts and repayments out"
          className={dash.span5}
          action={
            <div className={dash.segmented} role="group" aria-label="Chart range">
              {([6, 12] as const).map((m) => (
                <button key={m} type="button" aria-pressed={chartMonths === m} className={chartMonths === m ? dash.segOn : ""} onClick={() => setChartMonths(m)}>{m}M</button>
              ))}
            </div>
          }
        >
          {flowEmpty ? <Empty>No company cash moved in these months.</Empty> : <CashFlowChart points={flow} />}
        </Panel>

        <Panel title="Expense split by category" icon="tag" sub="Incurred in the selected period" className={dash.span4}>
          {data.byCategory.length === 0 ? <Empty>No approved expenses in this period.</Empty> : <CategoryDonut rows={data.byCategory} total={catTotal} />}
        </Panel>

        <Panel title="Key insights" icon="star" className={dash.span3}>
          <ul className={dash.insights}>
            <li>
              <span className={`${dash.insIcon} ${dash.tone_burn}`} aria-hidden="true"><Icon name="trend" size={16} /></span>
              <span className={dash.insLabel}>Burn rate</span>
              <span className={dash.insValue}>{k.averageGrossBurn === null ? "Insufficient data" : <>{whole(k.averageGrossBurn)}<small>per month</small></>}</span>
            </li>
            <li>
              <span className={`${dash.insIcon} ${dash.tone_fund}`} aria-hidden="true"><Icon name="clock" size={16} /></span>
              <span className={dash.insLabel}>Runway</span>
              <span className={dash.insValue}>{runway.value}<small>{runway.note}</small></span>
            </li>
            <li>
              <span className={`${dash.insIcon} ${dash.tone_cash}`} aria-hidden="true"><Icon name="calendar" size={16} /></span>
              <span className={dash.insLabel}>Avg. monthly spend</span>
              <span className={dash.insValue}>{whole(avgSpend)}<small>over {plural(periodMonths, "month")}</small></span>
            </li>
            <li>
              <span className={`${dash.insIcon} ${dash.tone_vendor}`} aria-hidden="true"><Icon name="tag" size={16} /></span>
              <span className={dash.insLabel}>Highest expense category</span>
              <span className={dash.insValue}>
                {topCat ? <>{topCat.label}<small>{catTotal > 0 ? `${((n(topCat.amount) / catTotal) * 100).toFixed(1)}% of spend` : ""}</small></> : "—"}
              </span>
            </li>
          </ul>
          <p className={dash.footnote}>Revenue isn&apos;t connected yet, so net burn equals gross burn. Runway = available cash ÷ average monthly burn.</p>
        </Panel>

        <Panel title="Spend by department" icon="team" sub="Incurred in the selected period" className={dash.span4}>
          {data.byDepartment.length === 0 ? (
            <Empty>No approved expenses in this period.</Empty>
          ) : (
            <ul className={dash.bars}>
              {data.byDepartment.slice(0, 8).map((r) => (
                <li key={r.key} title={`${r.label}: ${inr(r.amount)} across ${plural(r.count, "expense")}`}>
                  <span className={dash.barLabel}>{r.label}</span>
                  <span className={dash.barTrack} aria-hidden="true"><span className={dash.barFill} style={{ width: `${deptMax > 0 ? Math.max(2, (n(r.amount) / deptMax) * 100) : 0}%` }} /></span>
                  <span className={dash.barValue}>{inr(r.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Top contributors / funding"
          icon="users"
          sub="Cash received into company accounts, all time"
          className={dash.span4}
          action={onNavigate && <button type="button" className={dash.linkBtn} onClick={() => onNavigate("funding")}>View all</button>}
        >
          {funders.length === 0 ? (
            <Empty>No funding recorded yet.</Empty>
          ) : (
            <ol className={dash.ranked}>
              {topFunders.map((r, i) => (
                <li key={r.key}>
                  <span className={`${dash.rank} ${i === 0 ? dash.rankFirst : ""}`}>{i + 1}</span>
                  <span className={dash.rankName}>{r.label}</span>
                  <span className={dash.rankValue}>{inr(r.amount)}</span>
                </li>
              ))}
              {otherFunders.length > 0 && (
                <li>
                  <span className={dash.rank}>{topFunders.length + 1}</span>
                  <span className={dash.rankName}>Others ({otherFunders.length})</span>
                  <span className={dash.rankValue}>{inr(otherFunders.reduce((t, r) => t + n(r.amount), 0).toFixed(2))}</span>
                </li>
              )}
            </ol>
          )}
        </Panel>

        <Panel title="Pending actions & alerts" icon="bell" className={dash.span4} action={actions.length > 0 ? <span className={dash.countBadge}>{actions.length}</span> : undefined}>
          {actions.length === 0 ? (
            <Empty>Nothing needs attention right now.</Empty>
          ) : (
            <ul className={dash.actions}>
              {actions.map((a) => (
                <li key={a.title}>
                  <button type="button" className={`${dash.action} ${dash[`action_${a.tone}`]}`} onClick={() => onNavigate?.(a.tab)} disabled={!onNavigate}>
                    <span className={dash.actionIcon} aria-hidden="true"><Icon name={a.icon} size={18} /></span>
                    <span className={dash.actionText}><strong>{a.title}</strong><span>{a.sub}</span></span>
                    <span className={dash.chev} aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className={dash.footnote}>Budget alerts appear once budgets are set up.</p>
        </Panel>

        <RecentTransactions items={recent} onViewAll={onNavigate ? () => onNavigate("expenses") : undefined} />
      </div>
      <p className={ui.hint}>
        Generated {new Date(data.generatedAt).toLocaleString("en-IN")} · INR · Contributions are never counted as revenue; ownership is never derived from money contributed.
      </p>
    </div>
  );
}
