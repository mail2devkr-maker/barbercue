"use client";

import { useSyncExternalStore } from "react";

/**
 * Phase 15 (Low-Network / Resilience Mode). `navigator.onLine` reflects the OS/browser's own
 * network-interface state (Wi-Fi/cellular up or down) — it can be true while the backend itself
 * is unreachable, but a false reading is always a real "no network path at all" signal, which is
 * the case worth surfacing to the user (a reachability check against the backend is already
 * covered by apiFetch's own NETWORK_OFFLINE ApiError on individual failed requests; this hook is
 * for the persistent, app-wide banner, not per-request error handling).
 *
 * useSyncExternalStore, not useState+useEffect: `navigator.onLine` is external mutable state, and
 * this is precisely the API React provides for subscribing to it safely across SSR. Its
 * getServerSnapshot always returns `true` (the server has no `navigator` at all), and React
 * intentionally uses that value for the first client render too — the real `navigator.onLine`
 * reading only takes effect once hydration is done, so a browser that's genuinely offline at load
 * time can never disagree with the server-rendered HTML and trigger a hydration error.
 */
function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
