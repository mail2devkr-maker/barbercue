"use client";

import { isBackendMaintenanceResponse } from "@barbercue/shared";

// A tiny event bus: lib/api.ts reports a "backend unreachable" answer, MaintenanceOverlay listens.
const EVENT = "fastque:maintenance";

export function reportMaintenance(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function onMaintenance(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** Checks a response without consuming it; flags maintenance when the backend is not reachable. */
export async function checkMaintenance(res: Response): Promise<void> {
  if (res.ok || ![404, 502, 503, 504].includes(res.status)) return;
  let text = "";
  try {
    text = res.status === 404 ? await res.clone().text() : "";
  } catch {
    text = "";
  }
  if (isBackendMaintenanceResponse(res.status, text)) reportMaintenance();
}
