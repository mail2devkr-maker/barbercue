"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ADMIN_PATHS,
  ADMIN_TIMESERIES_MAX_METRICS,
  type AdminTimeseriesDto,
  type AdminTimeseriesGranularity,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../lib/api";
import { Icon } from "../../owner/icons";
import ui from "../../owner/owner.module.css";
import { useAdminFilters } from "../shell/admin-filters";
import { formatRangeLabel } from "../shop-activity-range";
import { ComboChart, SERIES_COLORS, type ComboSeries, type SeriesType } from "./ComboChart";
import {
  CHART_PRESETS,
  METRIC_OPTIONS,
  UNIT_LABEL,
  assignAxes,
  bucketLabel,
  clampMetrics,
  formatterFor,
  optionFor,
  seriesTypeFor,
  timeseriesCsv,
  type ChartKind,
} from "./chart-config";
import { downloadBlob, svgToPng } from "./export";
import css from "./chart-builder.module.css";

interface SavedView {
  name: string;
  metrics: string[];
  kind: ChartKind;
  granularity: AdminTimeseriesGranularity;
  compare: boolean;
  types: Record<string, SeriesType>;
}

const SAVED_KEY = "fastque.admin.chartViews";

function readSaved(): SavedView[] {
  try {
    return JSON.parse(window.localStorage.getItem(SAVED_KEY) ?? "[]") as SavedView[];
  } catch {
    return [];
  }
}

/**
 * Admin chart builder: up to six KPIs on one time axis, as lines, columns, areas or a line + column
 * combination, with a second y-axis when units differ. Data: GET admin/analytics/timeseries.
 */
export function ChartBuilder() {
  const params = useSearchParams();
  const presetKey = params.get("preset") ?? "visits";
  const preset = CHART_PRESETS[presetKey] ?? CHART_PRESETS.visits;
  const { range } = useAdminFilters();

  const [metrics, setMetrics] = useState<string[]>(preset.metrics);
  const [kind, setKind] = useState<ChartKind>(preset.kind);
  const [granularity, setGranularity] = useState<AdminTimeseriesGranularity>(preset.granularity);
  const [compare, setCompare] = useState(false);
  const [types, setTypes] = useState<Record<string, SeriesType>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [data, setData] = useState<AdminTimeseriesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<SavedView[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cardRef = useRef<HTMLElement>(null);

  // A sidebar preset link resets the builder to that preset.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the preset comes from the URL
    setMetrics(preset.metrics);
    setKind(preset.kind);
    setGranularity(preset.granularity);
    setTypes({});
    setHidden(new Set());
  }, [preset]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists in the browser
    setSaved(readSaved());
  }, []);

  const { axes, units, blocked } = useMemo(() => assignAxes(metrics), [metrics]);
  const plotted = useMemo(() => metrics.filter((m) => axes.has(m)), [metrics, axes]);

  const load = useCallback(async () => {
    if (plotted.length === 0) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        from: range.from,
        to: range.to,
        granularity,
        metrics: plotted.join(","),
        compare: compare ? "previous" : "none",
      });
      setData(await apiFetch<AdminTimeseriesDto>(`${ADMIN_PATHS.admin}/${ADMIN_PATHS.analytics}/${ADMIN_PATHS.timeseries}?${qs}`));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not load chart data.");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, granularity, compare, plotted]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const labels = useMemo(() => (data ? data.buckets.map((b) => bucketLabel(b, data.granularity)) : []), [data]);

  const series: ComboSeries[] = useMemo(() => {
    if (!data) return [];
    const out: ComboSeries[] = [];
    data.series.forEach((s) => {
      const axis = axes.get(s.metric) ?? "left";
      const color = SERIES_COLORS[metrics.indexOf(s.metric) % SERIES_COLORS.length];
      const type = types[s.metric] ?? seriesTypeFor(kind, axis);
      const format = formatterFor(s.unit);
      const integer = s.unit === "count";
      out.push({ key: s.metric, label: s.label, values: s.values, type, axis, color, format, integer });
      if (s.previousValues) {
        out.push({ key: `${s.metric}:previous`, label: `${s.label} (previous)`, values: s.previousValues, type: "line", axis, color, dashed: true, format, integer });
      }
    });
    return out;
  }, [data, kind, types, metrics, axes]);

  function toggleMetric(key: string) {
    setNotice(null);
    setMetrics((current) => {
      if (current.includes(key)) return current.filter((m) => m !== key);
      if (current.length >= ADMIN_TIMESERIES_MAX_METRICS) {
        setNotice(`Up to ${ADMIN_TIMESERIES_MAX_METRICS} KPIs per chart.`);
        return current;
      }
      return [...current, key];
    });
  }

  function saveView() {
    const name = window.prompt("Name this chart view", CHART_PRESETS[presetKey]?.title ?? "My chart");
    if (!name) return;
    const next = [...saved.filter((v) => v.name !== name), { name, metrics, kind, granularity, compare, types }];
    setSaved(next);
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      setNotice(`Saved “${name}” in this browser.`);
    } catch {
      setNotice("Could not save in this browser (storage is blocked).");
    }
  }

  function applyView(name: string) {
    const view = saved.find((v) => v.name === name);
    if (!view) return;
    setMetrics(clampMetrics(view.metrics));
    setKind(view.kind);
    setGranularity(view.granularity);
    setCompare(view.compare);
    setTypes(view.types ?? {});
    setHidden(new Set());
  }

  const filteredOptions = METRIC_OPTIONS.filter((m) => !query.trim() || `${m.label} ${m.group}`.toLowerCase().includes(query.trim().toLowerCase()));
  const leftUnit = units[0];
  const rightUnit = units[1];
  const allEmpty = data !== null && data.series.every((s) => s.values.every((v) => v === null || v === 0));
  const fileBase = `fastque-chart-${range.from}-to-${range.to}-${granularity}`;

  return (
    <main className={ui.grid} aria-labelledby="chart-builder-title">
      <div className={ui.pageHead}>
        <div>
          <div className={ui.eyebrow}>Analytics</div>
          <h1 id="chart-builder-title" className={ui.pageTitle}>{CHART_PRESETS[presetKey]?.title ?? "Chart builder"}</h1>
          <p className={ui.pageSub}>
            {formatRangeLabel(range.from, range.to)} · India time · pick up to {ADMIN_TIMESERIES_MAX_METRICS} KPIs; different units get their own axis.
          </p>
        </div>
        <div className={ui.headActions}>
          {saved.length > 0 && (
            <select className={css.select} aria-label="Open a saved view" value="" onChange={(e) => applyView(e.target.value)}>
              <option value="" disabled>Saved views…</option>
              {saved.map((v) => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </select>
          )}
          <button type="button" className={`${ui.btn} ${ui.btnSecondary} ${ui.btnSm}`} onClick={saveView}>Save view</button>
        </div>
      </div>

      <section className={ui.card} aria-label="Chart settings">
        <div className={css.controls}>
          <div className={css.control}>
            <span className={css.controlLabel} id="kpi-label">KPIs</span>
            <div className={css.chips} aria-labelledby="kpi-label">
              {metrics.map((key, i) => {
                const option = optionFor(key);
                const isBlocked = blocked.includes(key);
                return (
                  <span key={key} className={`${css.chip} ${isBlocked ? css.chipBlocked : ""}`} title={isBlocked ? "A third unit can't share this chart — remove another unit first" : undefined}>
                    <span className={css.chipDot} style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} aria-hidden="true" />
                    {option?.label ?? key}
                    {isBlocked && <span className={css.chipNote}> · needs its own chart</span>}
                    <button type="button" className={css.chipRemove} aria-label={`Remove ${option?.label ?? key}`} onClick={() => toggleMetric(key)}>
                      <Icon name="close" size={14} />
                    </button>
                  </span>
                );
              })}
              <button type="button" className={`${ui.btn} ${ui.btnQuiet} ${ui.btnSm}`} aria-expanded={pickerOpen} aria-controls="kpi-picker" onClick={() => setPickerOpen((o) => !o)}>
                <Icon name="plus" size={16} /> Add KPI
              </button>
            </div>
          </div>

          <div className={css.inline}>
            <label className={css.control}>
              <span className={css.controlLabel}>Chart type</span>
              <select className={css.select} value={kind} onChange={(e) => { setKind(e.target.value as ChartKind); setTypes({}); }}>
                <option value="line">Line</option>
                <option value="column">Columns</option>
                <option value="area">Area</option>
                <option value="combo">Combination (columns + line)</option>
              </select>
            </label>
            <label className={css.control}>
              <span className={css.controlLabel}>Interval</span>
              <select className={css.select} value={granularity} onChange={(e) => setGranularity(e.target.value as AdminTimeseriesGranularity)}>
                <option value="day">Daily</option>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
              </select>
            </label>
            <label className={css.check}>
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
              Compare with previous period
            </label>
          </div>
        </div>

        {pickerOpen && (
          <div id="kpi-picker" className={css.picker}>
            <input type="search" className={css.search} placeholder="Search KPIs" aria-label="Search KPIs" value={query} onChange={(e) => setQuery(e.target.value)} />
            <ul className={css.options}>
              {filteredOptions.map((m) => {
                const checked = metrics.includes(m.key);
                return (
                  <li key={m.key}>
                    <label className={`${css.option} ${m.tracked ? "" : css.optionOff}`}>
                      <input type="checkbox" checked={checked} disabled={!m.tracked} onChange={() => toggleMetric(m.key)} />
                      <span>
                        {m.label}
                        <small>{m.tracked ? `${m.group} · ${UNIT_LABEL[m.unit]}` : `Not tracked yet — ${m.reason}`}</small>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {plotted.length > 0 && (
          <div className={css.seriesTable} role="group" aria-label="Series display">
            {plotted.map((key, i) => (
              <label key={key} className={css.seriesRow}>
                <span className={css.chipDot} style={{ background: SERIES_COLORS[metrics.indexOf(key) % SERIES_COLORS.length] }} aria-hidden="true" />
                <span className={css.seriesName}>{optionFor(key)?.label}</span>
                <span className={css.seriesAxis}>{axes.get(key) === "left" ? "Left" : "Right"} axis · {UNIT_LABEL[optionFor(key)!.unit]}</span>
                <select
                  className={css.selectSm}
                  aria-label={`Display ${optionFor(key)?.label} as`}
                  value={types[key] ?? seriesTypeFor(kind, axes.get(key) ?? "left")}
                  onChange={(e) => setTypes((t) => ({ ...t, [key]: e.target.value as SeriesType }))}
                  data-index={i}
                >
                  <option value="line">Line</option>
                  <option value="column">Column</option>
                  <option value="area">Area</option>
                </select>
              </label>
            ))}
          </div>
        )}
        {notice && <p className={css.notice} role="status">{notice}</p>}
      </section>

      <section className={`${ui.card} ${css.chartCard}`} ref={cardRef} aria-label="Chart">
        <div className={ui.cardHead}>
          <div>
            <h2 className={ui.cardTitle}>{plotted.map((k) => optionFor(k)?.label).join(" · ") || "Choose a KPI"}</h2>
            <p className={ui.cardSub}>
              {data ? `${formatRangeLabel(data.from, data.to)}${data.previousFrom ? ` vs ${formatRangeLabel(data.previousFrom, data.previousTo!)}` : ""}` : " "}
            </p>
          </div>
          <div className={css.tools}>
            <button type="button" className={`${ui.btn} ${ui.btnQuiet} ${ui.btnSm}`} disabled={!data} onClick={() => data && downloadBlob(new Blob([`﻿${timeseriesCsv(data)}`], { type: "text/csv;charset=utf-8" }), `${fileBase}.csv`)}>
              <Icon name="download" size={16} /> CSV
            </button>
            <button
              type="button"
              className={`${ui.btn} ${ui.btnQuiet} ${ui.btnSm}`}
              disabled={!data}
              onClick={async () => {
                if (!svgRef.current) return;
                try {
                  downloadBlob(await svgToPng(svgRef.current), `${fileBase}.png`);
                } catch {
                  setNotice("This browser could not export the chart as an image.");
                }
              }}
            >
              <Icon name="download" size={16} /> PNG
            </button>
            <button type="button" className={`${ui.btn} ${ui.btnQuiet} ${ui.btnSm}`} onClick={() => void cardRef.current?.requestFullscreen?.()}>
              <Icon name="eye" size={16} /> Full screen
            </button>
          </div>
        </div>

        {error && <p className={`${ui.banner} ${ui.bannerError}`} role="alert">{error}</p>}
        {plotted.length === 0 && <p className={ui.empty}>Add a KPI to draw a chart.</p>}
        {loading && !data && plotted.length > 0 && <div className={`${ui.skeleton} ${css.skeleton}`} role="status" aria-label="Loading chart" />}
        {data && (
          <>
            {allEmpty && <p className={css.emptyNote}>Nothing was recorded for these KPIs in this period — the chart shows a flat baseline, not missing data.</p>}
            <ComboChart
              ref={svgRef}
              labels={labels}
              series={series}
              leftAxisLabel={leftUnit ? UNIT_LABEL[leftUnit] : undefined}
              rightAxisLabel={rightUnit ? UNIT_LABEL[rightUnit] : undefined}
              ariaLabel={`${plotted.map((k) => optionFor(k)?.label).join(", ")} by ${granularity}, ${formatRangeLabel(data.from, data.to)}`}
              hidden={hidden}
              onToggle={(key) =>
                setHidden((h) => {
                  const next = new Set(h);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
            />
            <p className={css.footnote}>
              Gaps mean nothing measurable in that period (for example a rate with no resolved appointments). Service value is salon money, not FastQue revenue; walk-in value is an estimate from current menu prices. Saved views are kept in this browser only.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
