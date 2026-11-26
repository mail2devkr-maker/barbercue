"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VI_PATHS, type ViFilters } from "@barbercue/shared";
import { apiFetch, ApiError, getAccessToken } from "../../../lib/api";

export const viPath = (p: string) => `${VI_PATHS.root}/${p}`;

export function filtersQuery(f: Partial<ViFilters>, extra: Record<string, string | number | undefined | null> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  return params.toString();
}

/** Loads a Visitor Intelligence endpoint; refetches when `key` changes; keeps the last good data while reloading. */
export function useVi<T>(path: string | null, key: string, opts: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const active = useRef(true);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    active.current = true;
    if (!path) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      apiFetch<T>(path)
        .then((d) => {
          if (!active.current) return;
          setData(d);
          setError(null);
        })
        .catch((e: unknown) => {
          if (active.current) setError(e instanceof ApiError ? e.message : "Could not load this data.");
        })
        .finally(() => {
          if (active.current) setLoading(false);
        });
    }, 0);
    return () => {
      active.current = false;
      window.clearTimeout(timer);
    };
  }, [path, key, tick]);

  useEffect(() => {
    if (!opts.pollMs) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, opts.pollMs);
    return () => window.clearInterval(id);
  }, [opts.pollMs, reload]);

  return { data, error, loading, reload, setData };
}

export async function viSend<T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

/** Authenticated file download (exports are audited on the server). */
export async function viDownload(path: string, fallbackName: string): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`/api/v1/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: "include" });
  if (!res.ok) {
    let message = "Export failed.";
    try {
      message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      // keep default
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- Formatting ----------

const nf = new Intl.NumberFormat("en-IN");
export const fmtNum = (v: number | null | undefined) => (v == null ? "—" : nf.format(Math.round(v)));
export const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);
export const fmtInr = (rupees: number | null | undefined) =>
  rupees == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(rupees);
export const fmtPaise = (paise: number | null | undefined) => (paise == null ? "—" : fmtInr(paise / 100));
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
export function fmtAgo(iso: string | Date): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export const fmtDateTime = (iso: string | Date | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso)) : "—";
export const fmtTime = (iso: string | Date) => new Intl.DateTimeFormat("en-IN", { timeStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(iso));

export const PALETTE = ["#ff6f91", "#ff8448", "#ffc566", "#4fd1a1", "#6bb8ff", "#b18cff", "#ff9ecf", "#9fe870", "#7ad7f0", "#f4a261", "#c9c9d6", "#8e8ea0"];
