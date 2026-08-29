"use client";

import { useEffect, useState } from "react";

/**
 * Phase 15 (Low-Network / Resilience Mode). `navigator.onLine` reflects the OS/browser's own
 * network-interface state (Wi-Fi/cellular up or down) — it can be true while the backend itself
 * is unreachable, but a false reading is always a real "no network path at all" signal, which is
 * the case worth surfacing to the user (a reachability check against the backend is already
 * covered by apiFetch's own NETWORK_OFFLINE ApiError on individual failed requests; this hook is
 * for the persistent, app-wide banner, not per-request error handling).
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    function goOnline() {
      setOnline(true);
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
