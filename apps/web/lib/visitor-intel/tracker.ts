"use client";

import { VI_PATHS, type ViCollectInput, type ViEventInput, type ViEventType, type ViModule } from "@barbercue/shared";
import { getAccessToken } from "../api";
import { readConsent } from "./consent";

/**
 * FastQue first-party tracker (docs/visitor-intelligence/TRACKING.md).
 *  - Does nothing until the visitor allows analytics cookies.
 *  - Events are queued in memory and sent in small batches (every 4 s, at 20 events, or when the tab is
 *    hidden) with fetch keepalive, so it never blocks rendering or navigation.
 *  - Each event has a client UUID, so retries are deduplicated server-side.
 *  - No keystrokes, form contents, passwords, payment details or screen recordings, ever. Search text is
 *    also redacted on the server.
 *  - Optional GA4 / Meta Pixel browser tags load only when configured AND the visitor consented.
 */
const VISITOR_ID_KEY = "fastque_site_visitor_id_v1"; // shared with UniqueVisitorTracker
const VISITOR_COOKIE = "fq_vid";
const SESSION_KEY = "fastque_vi_session_v1";
const ATTR_KEY = "fastque_vi_attr_v1";
const SESSION_IDLE_MS = 30 * 60_000;
const FLUSH_MS = 4_000;
const MAX_BATCH = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Internal dashboards are never tracked. */
export function isTrackablePath(path: string): boolean {
  const p = path.replace(/[?#].*/, "");
  return !/^\/(dashboard|employee|admin|forgot-password|reset-password)(\/|$)/.test(p);
}

function uuid(): string {
  return window.crypto.randomUUID();
}

function cookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function visitorId(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_ID_KEY);
    if (existing && UUID_RE.test(existing)) return existing;
  } catch {
    // fall through
  }
  const c = cookie(VISITOR_COOKIE);
  if (c && UUID_RE.test(c)) return c;
  const fresh = uuid();
  try {
    window.localStorage.setItem(VISITOR_ID_KEY, fresh);
  } catch {
    // The id lives for this page only.
  }
  return fresh;
}

interface SessionState {
  id: string;
  lastAt: number;
}

function session(now: number): { id: string; isNew: boolean } {
  let s: SessionState | null = null;
  try {
    s = JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? "null") as SessionState | null;
  } catch {
    s = null;
  }
  const isNew = !s || !UUID_RE.test(s.id) || now - s.lastAt > SESSION_IDLE_MS;
  const next = { id: isNew ? uuid() : s!.id, lastAt: now };
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return { id: next.id, isNew };
}

type Context = ViCollectInput["context"];

/** Attribution captured once per session from the landing URL (UTMs, campaign code, click ids, referrer). */
function attribution(isNew: boolean): Context {
  if (!isNew) {
    try {
      const saved = window.sessionStorage.getItem(ATTR_KEY);
      if (saved) return JSON.parse(saved) as Context;
    } catch {
      // ignore
    }
  }
  const p = new URLSearchParams(window.location.search);
  const get = (k: string, max: number) => p.get(k)?.slice(0, max) || null;
  const ctx: Context = {
    landingPath: window.location.pathname.slice(0, 300),
    referrer: document.referrer ? document.referrer.slice(0, 500) : null,
    utmSource: get("utm_source", 120),
    utmMedium: get("utm_medium", 120),
    utmCampaign: get("utm_campaign", 160),
    utmContent: get("utm_content", 160),
    utmTerm: get("utm_term", 160),
    campaignCode: get("fq_c", 40),
    gclid: get("gclid", 200),
    fbclid: get("fbclid", 200),
    language: navigator.language?.slice(0, 20) ?? null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 60) ?? null,
    screenWidth: Math.round(window.screen?.width ?? 0) || null,
  };
  try {
    window.sessionStorage.setItem(ATTR_KEY, JSON.stringify(ctx));
  } catch {
    // ignore
  }
  return ctx;
}

let queue: ViEventInput[] = [];
let timer: number | null = null;
let ctx: Context | null = null;
let sessionId: string | null = null;
let listening = false;

function flush(useBeacon = false): void {
  if (timer) {
    window.clearTimeout(timer);
    timer = null;
  }
  const consent = readConsent();
  if (!queue.length || !consent?.analytics || !sessionId || !ctx) {
    if (!consent?.analytics) queue = [];
    return;
  }
  const events = queue.splice(0, 50);
  const body: ViCollectInput = { visitorId: visitorId(), sessionId, consent: { analytics: true, marketing: consent.marketing }, context: ctx, events };
  const json = JSON.stringify(body);
  const url = `/api/v1/${VI_PATHS.root}/${VI_PATHS.collect}`;
  const token = getAccessToken();
  if (useBeacon && !token && navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([json], { type: "application/json" }));
  } else {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: json,
      keepalive: json.length < 60_000,
      credentials: "same-origin",
    }).catch(() => {
      // Analytics never retries aggressively; a lost batch is acceptable.
    });
  }
  if (queue.length) schedule();
}

function schedule(): void {
  if (timer) return;
  timer = window.setTimeout(() => flush(), FLUSH_MS);
}

function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
  window.addEventListener("pagehide", () => flush(true));
}

export interface ViTrackData {
  path?: string;
  module?: ViModule;
  entityType?: string;
  entityId?: string;
  salonId?: string;
  props?: Record<string, string | number | boolean | null | undefined>;
}

/** Queue one event. Safe to call anywhere on the client; a no-op without analytics consent. */
export function viTrack(type: ViEventType, data: ViTrackData = {}): void {
  if (typeof window === "undefined") return;
  const consent = readConsent();
  if (!consent?.analytics) return;
  const path = (data.path ?? window.location.pathname).slice(0, 300);
  if (!isTrackablePath(path)) return;
  const now = Date.now();
  const s = session(now);
  if (s.isNew || !ctx || sessionId !== s.id) {
    sessionId = s.id;
    ctx = attribution(s.isNew);
  }
  const props = data.props ? Object.fromEntries(Object.entries(data.props).filter(([, v]) => v !== undefined)) as Record<string, string | number | boolean | null> : undefined;
  const event: ViEventInput = { id: uuid(), type, ts: now, path, module: data.module, entityType: data.entityType, entityId: data.entityId, salonId: data.salonId, props };
  queue.push(event);
  forwardToTags(event, consent.marketing);
  listen();
  if (queue.length >= MAX_BATCH) flush();
  else schedule();
}

/** Maps the /search URL to a search event (only known filter names; free text is redacted server-side). */
export function viTrackSearchFromParams(params: URLSearchParams, resultCount: number): void {
  const query = params.get("service") || params.get("q") || params.get("shopName") || params.get("popularService") || "";
  if (!query && !params.get("city") && !params.get("lat")) return;
  const num = (k: string) => {
    const v = Number(params.get(k));
    return params.get(k) && Number.isFinite(v) ? v : undefined;
  };
  viTrack(query ? "search" : "search_results", {
    module: "SALON_BOOKING",
    props: {
      query: query.slice(0, 120) || undefined,
      searchKind: params.get("shopName") ? "SALON" : "SERVICE",
      location: params.get("locality") || params.get("city") || (params.get("lat") ? "near me" : undefined),
      city: params.get("city") ? cityLabel(params.get("city")!) : undefined,
      resultCount,
      priceMin: num("priceMin"),
      priceMax: num("priceMax"),
      distanceKm: num("radiusKm"),
      minRating: num("minRating"),
      gender: params.get("salonType") || undefined,
      preferredTime: params.get("openNow") ? "open_now" : undefined,
    },
  });
}

function cityLabel(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80);
}

// ---------- Optional third-party browser tags (consent + configuration required) ----------

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; callMethod?: (...a: unknown[]) => void };
  }
}

const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID;
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;
const GA4_NAMES: Partial<Record<ViEventType, string>> = { page_view: "page_view", search: "search", salon_view: "view_item", product_view: "view_item", add_to_cart: "add_to_cart", booking_start: "begin_checkout", sign_up: "sign_up_start" };
const META_NAMES: Partial<Record<ViEventType, string>> = { page_view: "PageView", salon_view: "ViewContent", product_view: "ViewContent", search: "Search", add_to_cart: "AddToCart", checkout_start: "InitiateCheckout" };

let tagsLoaded = { ga: false, meta: false };

function loadScript(src: string): void {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

function forwardToTags(e: ViEventInput, marketing: boolean): void {
  // GA4 (analytics consent already checked). Conversions with money go server-side only (Measurement Protocol).
  if (GA4_ID && GA4_NAMES[e.type]) {
    if (!tagsLoaded.ga) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function gtag(...args: unknown[]) {
        window.dataLayer!.push(args);
      };
      window.gtag("consent", "default", { analytics_storage: "granted", ad_storage: marketing ? "granted" : "denied", ad_user_data: marketing ? "granted" : "denied", ad_personalization: marketing ? "granted" : "denied" });
      window.gtag("js", new Date());
      window.gtag("config", GA4_ID, { send_page_view: false, anonymize_ip: true });
      loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_ID)}`);
      tagsLoaded = { ...tagsLoaded, ga: true };
    }
    window.gtag?.("event", GA4_NAMES[e.type], { page_path: e.path, event_id: e.id });
  }
  // Meta Pixel only with marketing consent; the server copy uses the same event id for deduplication.
  if (META_PIXEL_ID && marketing && META_NAMES[e.type]) {
    if (!tagsLoaded.meta) {
      const fbq = function (...args: unknown[]) {
        if (fbq.callMethod) fbq.callMethod(...args);
        else fbq.queue!.push(args);
      } as NonNullable<Window["fbq"]>;
      fbq.queue = [];
      fbq.loaded = true;
      fbq.version = "2.0";
      window.fbq = fbq;
      loadScript("https://connect.facebook.net/en_US/fbevents.js");
      window.fbq("init", META_PIXEL_ID);
      tagsLoaded = { ...tagsLoaded, meta: true };
    }
    window.fbq?.("track", META_NAMES[e.type], {}, { eventID: e.id });
  }
}

/** Test hook. */
export function __resetViTrackerForTests(): void {
  queue = [];
  ctx = null;
  sessionId = null;
  if (timer) window.clearTimeout(timer);
  timer = null;
}

export function __pendingViEvents(): ViEventInput[] {
  return queue;
}
