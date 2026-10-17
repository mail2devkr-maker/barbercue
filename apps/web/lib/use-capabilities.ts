"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import { apiFetch } from "./api";
import { parseCapabilities, type CapabilityMap } from "./capabilities";

export type CapabilityPhase = "loading" | "ready" | "unavailable";

export interface CapabilityState {
  phase: CapabilityPhase;
  /** Empty until ready, and empty again if the server could not answer: nothing is assumed to be enabled. */
  features: CapabilityMap;
}

const OK_CACHE_MS = 60_000;
const FAILED_CACHE_MS = 15_000;

interface Entry {
  at: number;
  /** null means the server could not answer (including "no such route yet"). */
  features: CapabilityMap | null;
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<CapabilityMap | null>>();

/** Test helper: forget what was fetched. */
export function resetCapabilitiesCache(): void {
  cache.clear();
  inFlight.clear();
}

function freshEntry(salonId: string): Entry | null {
  const hit = cache.get(salonId);
  if (!hit) return null;
  return Date.now() - hit.at < (hit.features ? OK_CACHE_MS : FAILED_CACHE_MS) ? hit : null;
}

/** One request per shop at a time, shared by every caller (the menu and a page that depends on a feature). */
function loadCapabilities(salonId: string): Promise<CapabilityMap | null> {
  const pending = inFlight.get(salonId);
  if (pending) return pending;
  const request = apiFetch<unknown>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/capabilities`)
    .then((raw) => parseCapabilities(raw))
    .catch(() => null)
    .then((features) => {
      cache.set(salonId, { at: Date.now(), features });
      inFlight.delete(salonId);
      return features;
    });
  inFlight.set(salonId, request);
  return request;
}

function toState(features: CapabilityMap | null): CapabilityState {
  return features ? { phase: "ready", features } : { phase: "unavailable", features: {} };
}

/**
 * Reads this shop's feature capabilities and shares the answer, so the menu and a page that depends on a feature do not
 * each ask. Any failure (including a server that does not have the endpoint yet) is reported as "unavailable" with no
 * features, so nothing unfinished is ever shown as working. Pass `enabled: false` for a caller that is not allowed to
 * read capabilities (a barber), which skips the request.
 */
export function useCapabilities(salonId: string, enabled: boolean = true): CapabilityState {
  // The answer is stored with the shop it belongs to, so after switching shops the old shop's features are never shown.
  const [answer, setAnswer] = useState<{ salonId: string; state: CapabilityState } | null>(() => {
    const hit = freshEntry(salonId);
    return hit ? { salonId, state: toState(hit.features) } : null;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const hit = freshEntry(salonId);
    const answered = hit ? Promise.resolve(hit.features) : loadCapabilities(salonId);
    void answered.then((features) => {
      if (!cancelled) setAnswer({ salonId, state: toState(features) });
    });
    return () => {
      cancelled = true;
    };
  }, [salonId, enabled]);

  if (!enabled) return { phase: "unavailable", features: {} };
  return answer && answer.salonId === salonId ? answer.state : { phase: "loading", features: {} };
}
