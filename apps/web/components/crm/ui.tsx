"use client";

import { useEffect, type ReactNode } from "react";
import s from "./crm.module.css";

/** Right-hand drawer (Escape / backdrop closes). */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={s.drawer} role="dialog" aria-modal="true" aria-label={title}>
        <div className={s.cardHead}>
          <h2 className={s.cardTitle}>{title}</h2>
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </aside>
    </div>
  );
}

/** Centered dialog. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className={s.overlay} style={{ justifyContent: "center" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <div className={s.cardHead}>
          <h2 className={s.cardTitle}>{title}</h2>
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={s.field} style={wide ? { gridColumn: "1 / -1" } : undefined}>
      {label}
      {children}
    </label>
  );
}

const TONE: Record<string, string> = {
  ok: s.statusOk,
  warn: s.statusWarn,
  bad: s.statusBad,
  brand: s.statusBrand,
};
export function Pill({ tone, children }: { tone?: "ok" | "warn" | "bad" | "brand"; children: ReactNode }) {
  return <span className={`${s.status} ${tone ? TONE[tone] : ""}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className={s.empty}>{children}</p>;
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className={s.toolbar} style={{ justifyContent: "flex-end", marginTop: 12 }}>
      <button type="button" className={`${s.btn} ${s.btnSm}`} disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button>
      <span className={s.faint}>Page {page} of {pages} · {total} total</span>
      <button type="button" className={`${s.btn} ${s.btnSm}`} disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
    </div>
  );
}

/** Strip empty strings → null/undefined so zod optional fields accept the form. */
export function clean<T extends Record<string, unknown>>(v: T, nullEmpty = false): T {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === "" || val === undefined) {
      if (nullEmpty) out[k] = null;
      continue;
    }
    out[k] = val;
  }
  return out as T;
}
