"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { presetRange, rangeError, type ShopActivityPreset } from "../shop-activity-range";

// The admin app's shared reporting period. It lives above every page so it survives sidebar
// navigation, and is remembered for the browser session (a per-viewer convenience only).

export interface AdminRange {
  preset: ShopActivityPreset;
  from: string;
  to: string;
}

interface AdminFiltersValue {
  range: AdminRange;
  setPreset: (preset: Exclude<ShopActivityPreset, "custom">) => void;
  /** Applies a custom range; returns the validation message instead when it is invalid. */
  setCustom: (from: string, to: string) => string | null;
}

const STORAGE_KEY = "fastque.admin.range";
const DEFAULT_PRESET = "last30" as const;

const AdminFiltersContext = createContext<AdminFiltersValue | null>(null);

function readStored(): AdminRange | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminRange;
    if (parsed.preset !== "custom") return { preset: parsed.preset, ...presetRange(parsed.preset) };
    return rangeError(parsed.from, parsed.to) ? null : parsed;
  } catch {
    return null;
  }
}

export function AdminFiltersProvider({ children }: { children: ReactNode }) {
  const [range, setRange] = useState<AdminRange>(() => ({ preset: DEFAULT_PRESET, ...presetRange(DEFAULT_PRESET) }));

  useEffect(() => {
    const stored = readStored();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage only exists in the browser
    if (stored) setRange(stored);
  }, []);

  const remember = useCallback((next: AdminRange) => {
    setRange(next);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode: the range still applies for this page view */
    }
  }, []);

  const value = useMemo<AdminFiltersValue>(
    () => ({
      range,
      setPreset: (preset) => remember({ preset, ...presetRange(preset) }),
      setCustom: (from, to) => {
        const error = rangeError(from, to);
        if (!error) remember({ preset: "custom", from, to });
        return error;
      },
    }),
    [range, remember],
  );

  return <AdminFiltersContext.Provider value={value}>{children}</AdminFiltersContext.Provider>;
}

export function useAdminFilters(): AdminFiltersValue {
  const ctx = useContext(AdminFiltersContext);
  if (!ctx) throw new Error("useAdminFilters must be used inside <AdminFiltersProvider>");
  return ctx;
}
