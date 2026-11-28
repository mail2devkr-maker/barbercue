"use client";

import { useEffect, useState } from "react";
import { INVENTORY_PATHS } from "@barbercue/shared";
import type { InventoryCategoryDto, InventorySupplierDto } from "@barbercue/shared";
import { apiFetch } from "./api";
import { listQuery } from "./inventory";
import type { CursorPage } from "./use-cursor-list";

export const MAX_LOOKUP_PAGES = 5;

export function inventoryBase(salonId: string): string {
  return `dashboard/salons/${salonId}/${INVENTORY_PATHS.root}`;
}

/** Loads every page (up to a cap) of a small lookup list. `complete` is false when the cap stopped it. */
export async function loadAll<T>(path: string, fetchPage: (url: string) => Promise<CursorPage<T>> = (u) => apiFetch<CursorPage<T>>(u)): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_LOOKUP_PAGES; page++) {
    const result: CursorPage<T> = await fetchPage(`${path}?${listQuery({}, cursor, 100)}`);
    items.push(...result.items);
    if (!result.hasMore || !result.nextCursor) return { items, complete: true };
    cursor = result.nextCursor;
  }
  return { items, complete: false };
}

export interface Lookups {
  categories: InventoryCategoryDto[];
  suppliers: InventorySupplierDto[];
  /** False when there are more categories or suppliers than could be loaded here. */
  complete: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Categories and suppliers for pickers and filters. Failing to load them never blocks the page that uses them. */
export function useInventoryLookups(salonId: string): Lookups {
  const [state, setState] = useState<{ categories: InventoryCategoryDto[]; suppliers: InventorySupplierDto[]; complete: boolean; loading: boolean; error: string | null }>({
    categories: [],
    suppliers: [],
    complete: true,
    loading: true,
    error: null,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const base = inventoryBase(salonId);
    void Promise.resolve()
      .then(() => Promise.all([loadAll<InventoryCategoryDto>(`${base}/${INVENTORY_PATHS.categories}`), loadAll<InventorySupplierDto>(`${base}/${INVENTORY_PATHS.suppliers}`)]))
      .then(([categories, suppliers]) => {
        if (!cancelled) setState({ categories: categories.items, suppliers: suppliers.items, complete: categories.complete && suppliers.complete, loading: false, error: null });
      })
      .catch(() => {
        if (!cancelled) setState({ categories: [], suppliers: [], complete: true, loading: false, error: "Could not load categories and suppliers." });
      });
    return () => {
      cancelled = true;
    };
  }, [salonId, version]);

  return { ...state, reload: () => setVersion((v) => v + 1) };
}
