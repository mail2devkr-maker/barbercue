"use client";

import { useId } from "react";
import ui from "./owner.module.css";

export interface ChartPoint {
  label: string;
  value: number;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
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
  const W = 640;
  const H = height;
  const pad = { l: 46, r: 12, t: 12, b: 26 };
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const slot = (W - pad.l - pad.r) / Math.max(points.length, 1);
  const barW = Math.min(46, slot * 0.6);
  const ys = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const total = points.reduce((sum, p) => sum + p.value, 0);
  return (
    <svg className={ui.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${ariaLabel}. Total ${formatValue(total)} across ${points.length} bars.`}>
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
