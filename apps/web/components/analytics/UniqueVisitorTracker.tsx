"use client";

import { useEffect } from "react";
import { SITE_METRICS_PATHS } from "@barbercue/shared";

const VISITOR_ID_KEY = "fastque_site_visitor_id_v1";
const REGISTERED_KEY = "fastque_site_visitor_registered_v1";
const COOKIE_NAME = "fq_vid";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cookieVisitorId(): string | null {
  const prefix = `${COOKIE_NAME}=`;
  for (const part of document.cookie.split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) {
      const candidate = decodeURIComponent(value.slice(prefix.length));
      if (UUID_RE.test(candidate)) return candidate;
    }
  }
  return null;
}

function persistVisitorId(id: string): void {
  try {
    window.localStorage.setItem(VISITOR_ID_KEY, id);
  } catch {
    // Cookie remains the durable fallback when storage is blocked.
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(id)}; Max-Age=34560000; Path=/; SameSite=Lax${secure}`;
}

function getOrCreateVisitorId(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_ID_KEY);
    if (existing && UUID_RE.test(existing)) {
      persistVisitorId(existing);
      return existing;
    }
  } catch {
    // Fall through to the first-party cookie.
  }

  const fromCookie = cookieVisitorId();
  if (fromCookie) {
    persistVisitorId(fromCookie);
    return fromCookie;
  }

  const fresh = window.crypto.randomUUID();
  persistVisitorId(fresh);
  return fresh;
}

function alreadyRegistered(): boolean {
  try {
    return window.localStorage.getItem(REGISTERED_KEY) === "1";
  } catch {
    return false;
  }
}

function markRegistered(): void {
  try {
    window.localStorage.setItem(REGISTERED_KEY, "1");
  } catch {
    // If storage is unavailable, the backend's unique PK still prevents double counting.
  }
}

export function UniqueVisitorTracker() {
  useEffect(() => {
    if (alreadyRegistered()) return;

    const visitorId = getOrCreateVisitorId();
    const controller = new AbortController();

    void fetch(`/api/v1/${SITE_METRICS_PATHS.siteMetrics}/${SITE_METRICS_PATHS.visit}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId }),
      credentials: "same-origin",
      keepalive: true,
      signal: controller.signal,
    })
      .then((response) => {
        if (response.ok) markRegistered();
      })
      .catch(() => {
        // Do not mark success. A future public-page navigation will retry.
      });

    return () => controller.abort();
  }, []);

  return null;
}
