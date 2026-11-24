"use client";

import { DISCOVERY_PATHS, type PincodeLookupDto } from "@barbercue/shared";
import { apiFetch } from "./api";

/** Indian PIN -> district, state and matching city; null when unknown or unavailable (a typing aid only). */
export async function lookupPincode(pin: string): Promise<PincodeLookupDto | null> {
  if (!/^[1-9]\d{5}$/.test(pin)) return null;
  try {
    return await apiFetch<PincodeLookupDto>(`${DISCOVERY_PATHS.cities}/pincode/${pin}`);
  } catch {
    return null;
  }
}
