"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { niceMax } from "../../owner/chart-math";
import css from "./combo-chart.module.css";

// Categorical series colours, validated (dataviz validate_palette.js) on the dark admin surface
// #211e29: lightness band, chroma, adjacent CVD ΔE ≥ 8.4, normal-vision ΔE ≥ 19.3, contrast ≥ 3:1.
// Assigned by series position, in this fixed order - never cycled (max 6 series).
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"] as const;

export type SeriesType = "line" | "column" | "area";

export interface ComboSeries {
  key: string;
  label: string;
  values: Array<number | null>;
  type: SeriesType;
  axis: "left" | "right";
  color: string;
  /** Previous-period overlay: drawn dashed, not in the legend. */
  dashed?: boolean;
  format: (value: number) => string;
  /** Whole-number measure (counts): its axis gets whole-number ticks. */
  integer?: boolean;
}

export interface ComboChartProps {
  labels: string[];
  series: ComboSeries[];
  leftAxisLabel?: string;
  rightAxisLabel?: string;
  ariaLabel: string;
  height?: number;
  /** Series keys the viewer has hidden from the legend. */
  hidden?: ReadonlySet<string>;
  onToggle?: (key: string) => void;
}

function useWidth(fallback: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const update = () => setWidth(Math.max(300, Math.round(node.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Dependency-free SVG combination chart: lines, columns and areas on up to two labelled y-axes over
 * a shared category axis. A null value is a gap (nothing measurable), never drawn as zero. Every
 * series is listed in the legend (toggles visibility) and in a screen-reader table.
 */
export const ComboChart = forwardRef<SVGSVGElement, ComboChartProps>(function ComboChart(
  { labels, series, leftAxisLabel, rightAxisLabel, ariaLabel, height = 320, hidden, onToggle },
  svgRef,
) {
  const [wrapRef, W] = useWidth(720);
  const [hover, setHover] = useState<number | null>(null);
  const visible = series.filter((s) => !hidden?.has(s.key.replace(/:previous$/, "")));
  const hasRight = visible.some((s) => s.axis === "right");
  const H = height;
  const pad = { l: 60, r: hasRight ? 60 : 16, t: 16, b: 34 };
  const plotW = Math.max(1, W - pad.l - pad.r);
  const plotH = H - pad.t - pad.b;
  const n = Math.max(labels.length, 1);
  const band = plotW / n;
  const cx = (i: number) => pad.l + band * i + band / 2;

  const maxFor = (axis: "left" | "right") => {
    const onAxis = visible.filter((s) => s.axis === axis);
    const top = niceMax(Math.max(0, ...onAxis.flatMap((s) => s.values.filter((v): v is number => v !== null))));
    // Four equal steps: a count axis must land on whole numbers (never "0.3 shops").
    return onAxis.length > 0 && onAxis.every((s) => s.integer) ? Math.max(4, Math.ceil(top / 4) * 4) : top;
  };
  const max = { left: maxFor("left"), right: maxFor("right") };
  const y = (axis: "left" | "right", v: number) => pad.t + (1 - v / max[axis]) * plotH;
  const baseY = pad.t + plotH;

  const columns = visible.filter((s) => s.type === "column");
  const colGap = 2;
  const colW = columns.length ? Math.max(2, Math.min(28, (band * 0.72 - colGap * (columns.length - 1)) / columns.length)) : 0;
  const groupW = columns.length * colW + (columns.length - 1) * colGap;

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 72))));
  const firstLeft = visible.find((s) => s.axis === "left");
  const firstRight = visible.find((s) => s.axis === "right");

  // Line/area path broken at nulls.
  const segments = (s: ComboSeries) => {
    const out: string[] = [];
    let current = "";
    s.values.forEach((v, i) => {
      if (v === null) {
        if (current) out.push(current);
        current = "";
        return;
      }
      current += `${current ? "L" : "M"}${cx(i).toFixed(1)},${y(s.axis, v).toFixed(1)}`;
    });
    if (current) out.push(current);
    return out;
  };

  const legendSeries = series.filter((s) => !s.dashed);
  const tipLeft = hover === null ? 0 : Math.min(Math.max(cx(hover) + 12, 0), W - 220);

  return (
    <div className={css.wrap}>
      <ul className={css.legend} aria-label="Series">
        {legendSeries.map((s) => {
          const off = hidden?.has(s.key);
          return (
            <li key={s.key}>
              <button
                type="button"
                className={css.legendItem}
                aria-pressed={!off}
                onClick={() => onToggle?.(s.key)}
                disabled={!onToggle}
                title={off ? `Show ${s.label}` : `Hide ${s.label}`}
              >
                <span className={`${css.swatch} ${s.type === "column" ? css.swatchColumn : ""}`} style={{ background: off ? "transparent" : s.color, borderColor: s.color }} aria-hidden="true" />
                <span className={off ? css.legendOff : undefined}>{s.label}</span>
                {hasRight && <span className={css.legendAxis}>{s.axis === "left" ? "left axis" : "right axis"}</span>}
              </button>
            </li>
          );
        })}
        {series.some((s) => s.dashed) && (
          <li className={css.legendNote}>
            <span className={css.dashSample} aria-hidden="true" /> previous period
          </li>
        )}
      </ul>

      <div className={css.plot} ref={wrapRef} onMouseLeave={() => setHover(null)}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={ariaLabel} className={css.svg} xmlns="http://www.w3.org/2000/svg">
          <rect x={0} y={0} width={W} height={H} fill="var(--chart-surface, #211e29)" />
          {ticks.map((f) => (
            <g key={f}>
              <line className={css.grid} x1={pad.l} x2={W - pad.r} y1={pad.t + (1 - f) * plotH} y2={pad.t + (1 - f) * plotH} />
              {firstLeft && (
                <text className={css.axis} x={pad.l - 8} y={pad.t + (1 - f) * plotH + 4} textAnchor="end">
                  {firstLeft.format(f * max.left)}
                </text>
              )}
              {firstRight && (
                <text className={css.axis} x={W - pad.r + 8} y={pad.t + (1 - f) * plotH + 4} textAnchor="start">
                  {firstRight.format(f * max.right)}
                </text>
              )}
            </g>
          ))}
          {leftAxisLabel && firstLeft && (
            <text className={css.axisTitle} transform={`translate(12 ${pad.t + plotH / 2}) rotate(-90)`} textAnchor="middle">
              {leftAxisLabel}
            </text>
          )}
          {rightAxisLabel && firstRight && (
            <text className={css.axisTitle} transform={`translate(${W - 10} ${pad.t + plotH / 2}) rotate(90)`} textAnchor="middle">
              {rightAxisLabel}
            </text>
          )}

          {hover !== null && <rect x={pad.l + band * hover} y={pad.t} width={band} height={plotH} className={css.hoverBand} />}

          {/* columns first, so lines sit on top */}
          {columns.map((s, ci) =>
            s.values.map((v, i) => {
              if (v === null || v === 0) return null;
              const x = cx(i) - groupW / 2 + ci * (colW + colGap);
              const top = y(s.axis, v);
              const h = Math.max(1, baseY - top);
              const r = Math.min(4, colW / 2, h);
              // Rounded data end, square at the baseline.
              const d = `M${x},${baseY}V${top + r}Q${x},${top} ${x + r},${top}H${x + colW - r}Q${x + colW},${top} ${x + colW},${top + r}V${baseY}Z`;
              return <path key={`${s.key}-${i}`} d={d} fill={s.color} opacity={s.dashed ? 0.35 : 1} />;
            }),
          )}
          {visible
            .filter((s) => s.type === "area")
            .map((s) =>
              segments(s).map((d, k) => {
                const xs = d.match(/[ML]([\d.]+),/g)!.map((m) => Number(m.slice(1, -1)));
                return <path key={`${s.key}-a${k}`} d={`${d}L${xs[xs.length - 1]},${baseY}L${xs[0]},${baseY}Z`} fill={s.color} opacity={0.16} />;
              }),
            )}
          {visible
            .filter((s) => s.type !== "column")
            .map((s) =>
              segments(s).map((d, k) => (
                <path key={`${s.key}-l${k}`} d={d} fill="none" stroke={s.color} strokeWidth={s.dashed ? 1.5 : 2} strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
              )),
            )}
          {n <= 45 &&
            visible
              .filter((s) => s.type !== "column" && !s.dashed)
              .map((s) =>
                s.values.map((v, i) =>
                  v === null ? null : <circle key={`${s.key}-p${i}`} cx={cx(i)} cy={y(s.axis, v)} r={hover === i ? 5 : 3} fill="var(--chart-surface, #211e29)" stroke={s.color} strokeWidth={2} />,
                ),
              )}

          <line className={css.baseline} x1={pad.l} x2={W - pad.r} y1={baseY} y2={baseY} />
          {labels.map((label, i) =>
            i % every === 0 ? (
              <text key={label + i} className={css.axis} x={cx(i)} y={H - 10} textAnchor="middle">
                {label}
              </text>
            ) : null,
          )}

          {labels.map((label, i) => (
            <rect key={`hit-${i}`} x={pad.l + band * i} y={0} width={band} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onMouseMove={() => setHover(i)} />
          ))}
        </svg>

        {hover !== null && (
          <div className={css.tip} style={{ left: tipLeft }} role="presentation">
            <div className={css.tipTitle}>{labels[hover]}</div>
            {visible.map((s) => {
              const v = s.values[hover];
              return (
                <div key={s.key} className={css.tipRow}>
                  <span className={css.tipSwatch} style={{ background: s.color, opacity: s.dashed ? 0.5 : 1 }} aria-hidden="true" />
                  <span className={css.tipLabel}>{s.label}</span>
                  <span className={css.tipValue}>{v === null ? "—" : s.format(v)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <table className={css.srOnly}>
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.map((s) => (
              <th key={s.key} scope="col">{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, i) => (
            <tr key={label + i}>
              <th scope="row">{label}</th>
              {series.map((s) => (
                <td key={s.key}>{s.values[i] === null ? "not measurable" : s.format(s.values[i]!)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
