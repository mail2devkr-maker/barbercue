import {
  ADMIN_TIMESERIES_MAX_METRICS,
  type AdminMetricUnit,
  type AdminTimeseriesDto,
  type AdminTimeseriesGranularity,
  type AdminTimeseriesMetric,
} from "@barbercue/shared";
import { csvCell } from "../command-center/format";
import type { SeriesType } from "./ComboChart";

export interface MetricOption {
  key: AdminTimeseriesMetric | string;
  label: string;
  unit: AdminMetricUnit;
  group: string;
  tracked: boolean;
  /** Why an untracked KPI cannot be charted yet. */
  reason?: string;
}

// Chartable KPIs (served by GET admin/analytics/timeseries) plus the blueprint KPIs FastQue does not
// record yet, listed disabled with the reason instead of being silently left out or faked.
export const METRIC_OPTIONS: readonly MetricOption[] = [
  { key: "appointmentsBooked", label: "Appointments booked", unit: "count", group: "Bookings", tracked: true },
  { key: "appointmentsCompleted", label: "Completed appointments", unit: "count", group: "Bookings", tracked: true },
  { key: "walkInsServed", label: "Walk-ins served (live)", unit: "count", group: "Bookings", tracked: true },
  { key: "completedVisits", label: "Completed visits", unit: "count", group: "Bookings", tracked: true },
  { key: "cancelled", label: "Cancelled appointments", unit: "count", group: "Bookings", tracked: true },
  { key: "noShow", label: "No-shows", unit: "count", group: "Bookings", tracked: true },
  { key: "cancellationRatePercent", label: "Cancellation rate", unit: "percent", group: "Bookings", tracked: true },
  { key: "completedServiceValuePaise", label: "Completed service value", unit: "inr", group: "Value", tracked: true },
  { key: "serviceHours", label: "Service hours", unit: "hours", group: "Operations", tracked: true },
  { key: "averageWaitMinutes", label: "Average wait (queue)", unit: "minutes", group: "Operations", tracked: true },
  { key: "newSalons", label: "New salons", unit: "count", group: "Shops", tracked: true },
  { key: "uniqueCustomers", label: "Unique customers served", unit: "count", group: "Customers", tracked: true },
  { key: "newCustomers", label: "New customers", unit: "count", group: "Customers", tracked: true },
  { key: "platformRevenue", label: "FastQue platform revenue", unit: "inr", group: "Value", tracked: false, reason: "No platform-fee ledger yet" },
  { key: "merchantActivity", label: "Merchant app activity", unit: "count", group: "Shops", tracked: false, reason: "Merchant activity events are not recorded" },
  { key: "activatedSalons", label: "Activated salons", unit: "count", group: "Shops", tracked: false, reason: "Salon lifecycle history is not recorded" },
  { key: "openSalonsHistory", label: "Open salons (history)", unit: "count", group: "Shops", tracked: false, reason: "Schedule history is not recorded — see Open / Closed Shops for today" },
  { key: "chairUtilization", label: "Chair utilisation", unit: "percent", group: "Operations", tracked: false, reason: "Utilisation model is Phase 3" },
];

export const optionFor = (key: string) => METRIC_OPTIONS.find((m) => m.key === key);

export const UNIT_LABEL: Record<AdminMetricUnit, string> = {
  count: "Count",
  inr: "₹ (INR)",
  percent: "Percent",
  hours: "Hours",
  minutes: "Minutes",
};

const num = (digits: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits });
export function formatterFor(unit: AdminMetricUnit): (value: number) => string {
  switch (unit) {
    case "inr":
      // Server values are paise.
      return (v) => `₹${new Intl.NumberFormat("en-IN", { notation: v >= 1e7 ? "compact" : "standard", maximumFractionDigits: v >= 1e7 ? 1 : 0 }).format(v / 100)}`;
    case "percent":
      return (v) => `${num(1).format(v)}%`;
    case "hours":
      return (v) => `${num(1).format(v)} h`;
    case "minutes":
      return (v) => `${num(1).format(v)} min`;
    default:
      return (v) => num(1).format(v);
  }
}

/**
 * Units never share an axis: the first selected unit takes the left axis, the second the right.
 * A metric with a third unit cannot be plotted against the other two and is reported as blocked,
 * so counts, rupees and rates are never drawn on one scale as if they meant the same thing.
 */
export function assignAxes(metrics: readonly string[]): { axes: Map<string, "left" | "right">; units: AdminMetricUnit[]; blocked: string[] } {
  const units: AdminMetricUnit[] = [];
  const axes = new Map<string, "left" | "right">();
  const blocked: string[] = [];
  for (const key of metrics) {
    const unit = optionFor(key)?.unit;
    if (!unit) continue;
    if (!units.includes(unit)) {
      if (units.length === 2) {
        blocked.push(key);
        continue;
      }
      units.push(unit);
    }
    axes.set(key, units.indexOf(unit) === 0 ? "left" : "right");
  }
  return { axes, units, blocked };
}

export type ChartKind = "line" | "column" | "area" | "combo";

/** Default mark per series: in a combo, the left-axis (first) unit is columns and the rest lines. */
export function seriesTypeFor(kind: ChartKind, axis: "left" | "right"): SeriesType {
  if (kind === "combo") return axis === "left" ? "column" : "line";
  return kind;
}

export interface ChartPreset {
  metrics: AdminTimeseriesMetric[];
  kind: ChartKind;
  granularity: AdminTimeseriesGranularity;
  title: string;
}

export const CHART_PRESETS: Record<string, ChartPreset> = {
  visits: { metrics: ["appointmentsCompleted", "walkInsServed", "completedVisits"], kind: "line", granularity: "day", title: "Performance trends" },
  bookings: { metrics: ["appointmentsBooked", "appointmentsCompleted", "cancelled", "noShow"], kind: "line", granularity: "day", title: "Booking trends" },
  value: { metrics: ["completedVisits", "completedServiceValuePaise"], kind: "combo", granularity: "day", title: "Bookings vs service value" },
  customers: { metrics: ["uniqueCustomers", "newCustomers"], kind: "line", granularity: "week", title: "Customer booking trends" },
  wait: { metrics: ["walkInsServed", "averageWaitMinutes"], kind: "combo", granularity: "day", title: "Waiting time analysis" },
  quality: { metrics: ["completedVisits", "cancellationRatePercent"], kind: "combo", granularity: "week", title: "Booking quality" },
};

export function clampMetrics(metrics: readonly string[]): string[] {
  return [...new Set(metrics)].filter((m) => optionFor(m)?.tracked).slice(0, ADMIN_TIMESERIES_MAX_METRICS);
}

export function bucketLabel(bucket: string, granularity: AdminTimeseriesGranularity): string {
  const date = new Date(`${bucket}T00:00:00Z`);
  if (granularity === "month") return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  return granularity === "week" ? `Wk of ${day}` : day;
}

/** Chart source data as CSV: one row per bucket, raw values (rupees, not paise), blank = not measurable. */
export function timeseriesCsv(data: AdminTimeseriesDto): string {
  const header = ["Period start (IST)"];
  for (const s of data.series) {
    const unit = s.unit === "inr" ? " (INR)" : s.unit === "percent" ? " (%)" : s.unit === "hours" ? " (hours)" : s.unit === "minutes" ? " (minutes)" : "";
    header.push(`${s.label}${unit}`);
    if (s.previousValues) header.push(`${s.label}${unit} — previous period`);
  }
  const value = (v: number | null, unit: AdminMetricUnit) => (v === null ? "" : unit === "inr" ? (v / 100).toFixed(2) : v);
  const rows = data.buckets.map((bucket, i) => {
    const row: Array<string | number> = [bucket];
    for (const s of data.series) {
      row.push(value(s.values[i], s.unit));
      if (s.previousValues) row.push(value(s.previousValues[i], s.unit));
    }
    return row;
  });
  const meta = [`${data.from} to ${data.to}, ${data.granularity}, ${data.timeZone}; generated ${data.generatedAt}`];
  return [meta, header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
