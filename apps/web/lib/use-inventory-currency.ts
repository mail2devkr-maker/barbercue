"use client";

import { useEffect, useState } from "react";
import { INVENTORY_PATHS } from "@barbercue/shared";
import type { InventoryReportDto } from "@barbercue/shared";
import { apiFetch } from "./api";
import { inventoryBase } from "./use-inventory-lookups";

/** The shop's currency as the inventory report states it, or null (no symbol is then invented). A failure is not an error here. */
export function useInventoryCurrency(salonId: string): string | null {
  const [currency, setCurrency] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<InventoryReportDto>(`${inventoryBase(salonId)}/${INVENTORY_PATHS.report}`)
      .then((r) => {
        if (!cancelled) setCurrency(typeof r.currency === "string" ? r.currency : null);
      })
      .catch(() => {
        if (!cancelled) setCurrency(null);
      });
    return () => {
      cancelled = true;
    };
  }, [salonId]);
  return currency;
}
