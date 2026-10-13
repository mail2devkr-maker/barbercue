"use client";

import { useEffect, useId, useRef, useState } from "react";
import { average, monotonePath, niceMax } from "./chart-math";
import ui from "./owner.module.css";

/**
 * The pixel width of a chart's container, so the SVG is drawn at its real size and its text stays the
 * size it was designed at (a fixed-viewBox SVG shrinks its labels along with the card).
 */
function useMeasuredWidth(fallback: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const update = () => setWidth(Math.max(280, Math.round(node.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export interface ChartPoint {
  label: string;
  value: number;
}

/**
 * Dependency-free SVG line chart. Accessible by construction: the SVG carries an accessible summary
 * and every point has a <title>; `formatValue` renders money in the shop's currency. An all-zero
 * series is drawn as a flat baseline (never an invented trend) - callers show an empty-state
 * message above it when nothing has been recorded.
 */
export function LineChart({
  points,
  formatValue,
  ariaLabel,
  height = 220,
}: {
  points: ChartPoint[];
  formatValue: (value: number) => string;
  ariaLabel: string;
  height?: number;
}) {
  const gradientId = useId().replace(/:/g, "");
  const W = 640;
  const H = height;
  const pad = { l: 46, r: 12, t: 12, b: 26 };
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const xs = (i: number) => pad.l + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const ys = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${xs(i).toFixed(1)},${ys(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${xs(points.length - 1).toFixed(1)},${(H - pad.b).toFixed(1)} L${xs(0).toFixed(1)},${(H - pad.b).toFixed(1)} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(points.length / 7));
  const total = points.reduce((sum, p) => sum + p.value, 0);

  return (
    <svg className={ui.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${ariaLabel}. Total ${formatValue(total)} across ${points.length} points.`}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c8104d" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#c8104d" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line className={ui.chartGrid} x1={pad.l} x2={W - pad.r} y1={ys(t)} y2={ys(t)} />
          <text className={ui.chartAxis} x={pad.l - 8} y={ys(t) + 4} textAnchor="end">
            {formatValue(t)}
          </text>
        </g>
      ))}
      {points.length > 1 && <path d={area} fill={`url(#${gradientId})`} />}
      <path className={ui.chartLine} d={line} />
      {points.map((p, i) => (
        <g key={`${p.label}-${i}`}>
          {i % every === 0 && (
            <text className={ui.chartAxis} x={xs(i)} y={H - 7} textAnchor="middle">
              {p.label}
            </text>
          )}
          <circle className={ui.chartDot} cx={xs(i)} cy={ys(p.value)} r={3.5}>
            <title>{`${p.label}: ${formatValue(p.value)}`}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}

/** Vertical bars, e.g. weekly / monthly revenue. */
export function BarChart({
  points,
  formatValue,
  ariaLabel,
  height = 220,
}: {
  points: ChartPoint[];
  formatValue: (value: number) => string;
  ariaLabel: string;
  height?: number;
}) {
  const [wrapRef, W] = useMeasuredWidth(520);
  const H = height;
  const pad = { l: 46, r: 12, t: 12, b: 26 };
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const slot = (W - pad.l - pad.r) / Math.max(points.length, 1);
  const barW = Math.min(46, slot * 0.6);
  const ys = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const total = points.reduce((sum, p) => sum + p.value, 0);
  return (
    <div ref={wrapRef}>
    <svg className={ui.chart} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${ariaLabel}. Total ${formatValue(total)} across ${points.length} bars.`}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line className={ui.chartGrid} x1={pad.l} x2={W - pad.r} y1={ys(f * max)} y2={ys(f * max)} />
          <text className={ui.chartAxis} x={pad.l - 8} y={ys(f * max) + 4} textAnchor="end">
            {formatValue(f * max)}
          </text>
        </g>
      ))}
      {points.map((p, i) => {
        const x = pad.l + slot * i + (slot - barW) / 2;
        const y = ys(p.value);
        return (
          <g key={`${p.label}-${i}`}>
            <rect className={i === points.length - 1 ? ui.chartBar : ui.chartBarAlt} x={x} y={y} width={barW} height={Math.max(H - pad.b - y, p.value > 0 ? 2 : 0)} rx={5}>
              <title>{`${p.label}: ${formatValue(p.value)}`}</title>
            </rect>
            <text className={ui.chartAxis} x={x + barW / 2} y={H - 7} textAnchor="middle">
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

/** Horizontal stacked share bar with a legend (used for cancellations by who cancelled). */
export function ShareBar({ parts, ariaLabel }: { parts: { label: string; value: number; color: string }[]; ariaLabel: string }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  return (
    <div>
      <div
        role="img"
        aria-label={`${ariaLabel}: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`}
        style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "#eceff6" }}
      >
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} />
          ))}
      </div>
      <div className={`${ui.legend} ${ui.mt12}`}>
        {parts.map((p) => (
          <span key={p.label}>
            <span className={ui.legendSwatch} style={{ background: p.color }} />
            {p.label} <strong style={{ color: "var(--os-ink)" }}>{p.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Smooth recorded-revenue area chart in the dashboard's reference style: a soft green area, a dashed
 * line at the period average, and a pill that follows the pointer with the exact day and amount.
 * Nothing here is invented - the curve is monotone (it cannot dip below zero between two zero days),
 * the dashed line is the plain mean of the plotted values, and the same numbers are available to
 * screen readers as a table. An all-zero series is a flat baseline.
 */
export function AreaChart({
  points,
  formatValue,
  ariaLabel,
  height = 236,
}: {
  points: ChartPoint[];
  formatValue: (value: number) => string;
  ariaLabel: string;
  height?: number;
}) {
  const gradientId = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, W] = useMeasuredWidth(520);
  const H = height;
  const pad = { l: 52, r: 14, t: 22, b: 28 };
  const values = points.map((p) => p.value);
  const max = niceMax(Math.max(...values, 0));
  const xs = (i: number) => pad.l + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const ys = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const coords = points.map((p, i) => ({ x: xs(i), y: ys(p.value) }));
  const line = monotonePath(coords);
  const baseY = H - pad.b;
  const area = points.length > 1 ? `${line} L${xs(points.length - 1).toFixed(1)},${baseY.toFixed(1)} L${xs(0).toFixed(1)},${baseY.toFixed(1)} Z` : "";
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(points.length / 6));
  const mean = average(values);
  const total = values.reduce((sum, v) => sum + v, 0);
  const slot = points.length > 1 ? (W - pad.l - pad.r) / (points.length - 1) : W - pad.l - pad.r;
  const tipW = 132;
  const tip = hover === null ? null : { x: Math.min(Math.max(xs(hover) - tipW / 2, pad.l - 30), W - tipW - 4), y: Math.max(ys(points[hover].value) - 58, 2) };

  return (
    <div className={ui.chartWrap} ref={wrapRef}>
      <svg
        className={ui.chart}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`${ariaLabel}. Total ${formatValue(total)} across ${points.length} points.`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#12a05a" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#12a05a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line className={ui.chartGrid} x1={pad.l} x2={W - pad.r} y1={ys(t)} y2={ys(t)} />
            <text className={ui.chartAxis} x={pad.l - 8} y={ys(t) + 4} textAnchor="end">
              {formatValue(t)}
            </text>
          </g>
        ))}
        {area && <path d={area} fill={`url(#${gradientId})`} />}
        {mean !== null && mean > 0 && (
          <g>
            <line className={ui.chartAverage} x1={pad.l} x2={W - pad.r} y1={ys(mean)} y2={ys(mean)} />
            <text className={`${ui.chartAxis} ${ui.chartHalo}`} x={W - pad.r} y={ys(mean) - 5} textAnchor="end">
              {`Average ${formatValue(mean)}`}
            </text>
          </g>
        )}
        <path className={ui.chartAreaLine} d={line} />
        {points.map((p, i) => (
          <text key={`${p.label}-${i}`} className={ui.chartAxis} x={xs(i)} y={H - 8} textAnchor="middle" style={i % every === 0 ? undefined : { display: "none" }}>
            {p.label}
          </text>
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line className={ui.chartCursor} x1={xs(hover)} x2={xs(hover)} y1={pad.t} y2={baseY} />
            <circle className={ui.chartHoverDot} cx={xs(hover)} cy={ys(points[hover].value)} r={5} />
          </g>
        )}
        {points.map((p, i) => (
          <rect key={`hit-${i}`} x={xs(i) - slot / 2} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onMouseMove={() => setHover(i)}>
            <title>{`${p.label}: ${formatValue(p.value)}`}</title>
          </rect>
        ))}
        {tip && hover !== null && (
          <g pointerEvents="none" transform={`translate(${tip.x},${tip.y})`}>
            <rect className={ui.chartTip} width={tipW} height={46} rx={10} />
            <text className={ui.chartTipLabel} x={12} y={18}>
              {points[hover].label}
            </text>
            <text className={ui.chartTipValue} x={12} y={37}>
              {formatValue(points[hover].value)}
            </text>
          </g>
        )}
      </svg>
      <table className={ui.srOnly}>
        <caption>{ariaLabel}</caption>
        <tbody>
          {points.map((p, i) => (
            <tr key={`${p.label}-${i}`}>
              <th scope="row">{p.label}</th>
              <td>{formatValue(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
