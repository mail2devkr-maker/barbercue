"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ViKpi } from "@barbercue/shared";
import { PALETTE, fmtNum } from "./vi-api";
import s from "./vi.module.css";

export function Info({ text }: { text: string }) {
  return (
    <span className={s.info} title={text} aria-label={text} role="img">
      i
    </span>
  );
}

export function Kpi({ label, kpi, value, format = fmtNum, help, onClick, invert }: { label: string; kpi?: ViKpi; value?: number | null; format?: (v: number | null) => string; help?: string; onClick?: () => void; invert?: boolean }) {
  const current = kpi ? kpi.current : (value ?? null);
  const change = kpi?.changePct ?? null;
  const good = change == null ? null : invert ? change < 0 : change > 0;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`${s.kpi} ${onClick ? "" : s.kpiStatic}`} onClick={onClick} title={help}>
      <h3>
        {label}
        {help && <Info text={help} />}
      </h3>
      <strong>{format(current)}</strong>
      {kpi && (
        <p className={`${s.delta} ${good == null || change === 0 ? "" : good ? s.up : s.down}`}>
          {change == null ? "No comparison" : `${change > 0 ? "▲" : change < 0 ? "▼" : "•"} ${Math.abs(change)}% vs previous`}
        </p>
      )}
    </Tag>
  );
}

export function Panel({ title, subtitle, help, actions, children, className }: { title: string; subtitle?: string; help?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${s.panel} ${className ?? ""}`}>
      <div className={s.panelHead}>
        <div>
          <h2>
            {title}
            {help && <Info text={help} />}
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className={s.panelActions}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title = "No data yet", children }: { title?: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className={s.error} role="alert">
      {message}{" "}
      {onRetry && (
        <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Skeleton({ height = 120, count = 1 }: { height?: number; count?: number }) {
  return (
    <div className={s.stack} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={s.skeleton} style={{ height }} />
      ))}
    </div>
  );
}

export function Donut({ parts, format = fmtNum, onSelect, ariaLabel }: { parts: Array<{ key: string; label: string; value: number }>; format?: (v: number) => string; onSelect?: (key: string) => void; ariaLabel: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  if (!total) return <Empty title="Nothing recorded" />;
  const offsets = parts.reduce<number[]>((acc, p, i) => [...acc, i === 0 ? 0 : acc[i - 1] + (parts[i - 1].value / total) * C], []);
  return (
    <div className={s.donutWrap}>
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={`${ariaLabel}: ${parts.map((p) => `${p.label} ${format(p.value)}`).join(", ")}`}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--vi-card-2)" strokeWidth="18" />
        {parts.map((p, i) => {
          const len = (p.value / total) * C;
          return (
            <circle key={p.key} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="18" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offsets[i]} transform="rotate(-90 70 70)" style={{ cursor: onSelect ? "pointer" : "default" }} onClick={() => onSelect?.(p.key)}>
              <title>{`${p.label}: ${format(p.value)} (${Math.round((p.value / total) * 100)}%)`}</title>
            </circle>
          );
        })}
        <text x="70" y="66" textAnchor="middle" fill="var(--os-ink)" fontSize="18" fontWeight="600">
          {format(total)}
        </text>
        <text x="70" y="84" textAnchor="middle" fill="var(--vi-muted)" fontSize="10">
          total
        </text>
      </svg>
      <div className={s.legend}>
        {parts.slice(0, 10).map((p, i) => (
          <button key={p.key} type="button" onClick={() => onSelect?.(p.key)} disabled={!onSelect}>
            <span className={s.row} style={{ gap: 8 }}>
              <span className={s.swatch} style={{ background: PALETTE[i % PALETTE.length] }} />
              {p.label}
            </span>
            <span className={s.muted}>
              {format(p.value)} · {Math.round((p.value / total) * 100)}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function HBars({ rows, format = fmtNum, onSelect }: { rows: Array<{ key: string; label: string; value: number }>; format?: (v: number) => string; onSelect?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <Empty title="Nothing recorded" />;
  return (
    <div className={s.hbar}>
      {rows.map((r) => (
        <div key={r.key} className={s.hbarRow} onClick={() => onSelect?.(r.key)} style={{ cursor: onSelect ? "pointer" : "default" }} title={`${r.label}: ${format(r.value)}`}>
          <span>{r.label}</span>
          <span className={s.hbarTrack}>
            <span className={s.hbarFill} style={{ display: "block", width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className={s.right}>{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export interface FunnelStageView {
  key: string;
  label: string;
  sessions: number;
  conversionFromPrevPct: number | null;
  dropOffPct: number | null;
  medianSecondsFromPrev: number | null;
  optional?: boolean;
}

export function Funnel({ stages }: { stages: FunnelStageView[] }) {
  const top = Math.max(1, stages[0]?.sessions ?? 1);
  return (
    <div className={s.funnel}>
      {stages.map((st, i) => (
        <div key={st.key} className={`${s.funnelRow} ${st.optional ? s.funnelOptional : ""}`}>
          <span>
            {st.label}
            {st.optional && <span className={s.muted}> (optional)</span>}
          </span>
          <span className={s.funnelBar}>
            <span className={s.funnelFill} style={{ display: "block", width: `${(st.sessions / top) * 100}%` }} />
          </span>
          <span className={s.funnelMeta}>
            <strong>{fmtNum(st.sessions)}</strong>
            {i > 0 && st.conversionFromPrevPct != null && ` · ${st.conversionFromPrevPct}%`}
            {i > 0 && st.dropOffPct != null && st.dropOffPct > 0 && <span className={s.down}> −{st.dropOffPct}%</span>}
            {st.medianSecondsFromPrev != null && <span> · ~{Math.round(st.medianSecondsFromPrev / 6) / 10}m</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
  num?: boolean;
  hidden?: boolean;
}

function csvCell(v: unknown): string {
  const str = v == null ? "" : String(v);
  const safe = /^[=+\-@]/.test(str) ? `'${str}` : str;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Searchable, sortable table with column customisation and CSV of the visible rows. */
export function DataTable<T>({ rows, columns, onRowClick, pageSize = 25, exportName, searchable = true, emptyText = "No rows for these filters." }: { rows: T[]; columns: Column<T>[]; onRowClick?: (row: T) => void; pageSize?: number; exportName?: string; searchable?: boolean; emptyText?: string }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(1);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.hidden).map((c) => c.key)));
  const [menu, setMenu] = useState(false);
  const visible = columns.filter((c) => !hidden.has(c.key));
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle ? rows.filter((r) => columns.some((c) => String(c.value(r) ?? "").toLowerCase().includes(needle))) : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) out = [...out].sort((a, b) => {
        const x = col.value(a);
        const y = col.value(b);
        if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir;
        return String(x ?? "").localeCompare(String(y ?? "")) * sort.dir;
      });
    }
    return out;
  }, [rows, columns, q, sort]);
  useEffect(() => {
    const t = window.setTimeout(() => setPage(1), 0);
    return () => window.clearTimeout(t);
  }, [q, rows]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  const exportCsv = () => {
    const lines = [visible.map((c) => csvCell(c.label)).join(","), ...filtered.map((r) => visible.map((c) => csvCell(c.value(r))).join(","))];
    const blob = new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName ?? "fastque-export"}.csv`;
    a.click();
  };
  return (
    <div>
      <div className={s.tableTools}>
        {searchable && <input className={s.input} placeholder="Search rows…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search rows" />}
        <span className={s.filterSpacer} />
        <div className={s.colMenu}>
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            Columns
          </button>
          {menu && (
            <div>
              {columns.map((c) => (
                <label key={c.key}>
                  <input
                    type="checkbox"
                    checked={!hidden.has(c.key)}
                    onChange={() =>
                      setHidden((h) => {
                        const n = new Set(h);
                        if (n.has(c.key)) n.delete(c.key);
                        else n.add(c.key);
                        return n;
                      })
                    }
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        {exportName && (
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={exportCsv} disabled={!filtered.length}>
            CSV
          </button>
        )}
      </div>
      {filtered.length ? (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                {visible.map((c) => (
                  <th key={c.key} className={c.num ? s.num : undefined} onClick={() => setSort((cur) => ({ key: c.key, dir: cur?.key === c.key && cur.dir === -1 ? 1 : -1 }))} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                    {c.label}
                    {sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slice.map((r, i) => (
                <tr key={i} className={onRowClick ? s.clickable : undefined} onClick={() => onRowClick?.(r)}>
                  {visible.map((c) => (
                    <td key={c.key} className={c.num ? s.num : undefined}>
                      {c.render ? c.render(r) : typeof c.value(r) === "number" ? fmtNum(c.value(r) as number) : (c.value(r) ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={emptyText} />
      )}
      {pages > 1 && (
        <div className={s.pager}>
          <span>
            {fmtNum(filtered.length)} rows · page {page} of {pages}
          </span>
          <span className={s.row}>
            <button type="button" className={`${s.btn} ${s.btnSm}`} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button type="button" className={`${s.btn} ${s.btnSm}`} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className={s.drawerBackdrop} onClick={onClose} />
      <aside className={s.drawer} role="dialog" aria-modal="true" aria-label={title}>
        <div className={s.drawerHead}>
          <h2>{title}</h2>
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}

export function LevelPill({ level }: { level: string }) {
  return <span className={`${s.pill} ${level === "HIGH" ? s.pillHigh : level === "MEDIUM" ? s.pillMedium : s.pillLow}`}>{level}</span>;
}
