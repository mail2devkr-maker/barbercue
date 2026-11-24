"use client";

import { useCallback, useEffect, useState } from "react";
import type { CrmMeDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "./api";

// Employee CRM 2.0 client helpers. Every number and list comes from the crm/ API; the server decides
// what the signed-in person may see, so these helpers never filter for security.

export const errorText = (err: unknown, fallback = "Something went wrong. Try again.") => (err instanceof ApiError ? err.message || fallback : fallback);

export function useCrmMe() {
  const [me, setMe] = useState<CrmMeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = (attempt: number) => {
      apiFetch<CrmMeDto>("crm/me")
        .then((m) => alive && setMe(m))
        .catch((err) => {
          if (!alive) return;
          if (attempt < 2) setTimeout(() => alive && load(attempt + 1), 1500 * (attempt + 1));
          else setError(errorText(err, "Could not load your CRM profile."));
        });
    };
    load(0);
    return () => {
      alive = false;
    };
  }, []);
  return { me, error };
}

/** Load-on-change helper: `load` re-runs whenever `key` changes; `reload` re-runs on demand. */
export function useCrmData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    apiFetch<T>(path)
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((err) => alive && setError(errorText(err)));
    return () => {
      alive = false;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload, setData };
}

export const jsonBody = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

const IST = "Asia/Kolkata";
export function when(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, ...opts }).format(new Date(iso));
}
export const dayOnly = (iso: string | null | undefined) => when(iso, { day: "numeric", month: "short", year: "numeric" });

/** <input type="datetime-local"> value (IST) ↔ ISO instant. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return d.toISOString().slice(0, 16);
}
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}:00+05:30`).toISOString();
}

export const pretty = (s: string | null | undefined) => (s ? s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—");

export function newSubmissionKey(prefix = "crm"): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Read a one-shot query flag (e.g. ?new=1 from a dashboard quick action) after mount. */
export function useQueryFlag(name: string): [boolean, (v: boolean) => void] {
  // CRM modules mount only on the client (behind the auth gate), so reading the URL here is safe.
  const [on, setOn] = useState(() => !!queryParam(name));
  return [on, setOn];
}
export function queryParam(name: string): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name);
}
