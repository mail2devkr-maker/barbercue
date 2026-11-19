"use client";

import { useEffect, useState } from "react";
import { FINANCE_PATHS, formatInr, type FinanceMeDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../lib/api";

export const FIN = FINANCE_PATHS.root;

export const inr = (v: string | number | null | undefined) => (v === null || v === undefined ? "—" : formatInr(v));

export const errorText = (err: unknown, fallback = "That did not go through.") =>
  err instanceof ApiError ? err.message || fallback : fallback;

export const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export const pretty = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");

export const newRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

/** The signed-in user's finance permissions (from the server, which enforces them). */
export function useFinanceMe() {
  const [me, setMe] = useState<FinanceMeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<FinanceMeDto>(`${FIN}/${FINANCE_PATHS.me}`).then(setMe).catch((err) => setError(errorText(err, "Could not load finance access.")));
  }, []);
  return { me, error };
}

/** Percentage width for a bar, against the largest value. */
export const barWidth = (value: string, max: number) => `${max > 0 ? Math.max(2, Math.round((Number(value) / max) * 100)) : 0}%`;
