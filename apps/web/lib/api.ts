"use client";

import { AUTH_PATHS } from "@barbercue/shared";

// Keep browser API calls same-origin. Next.js proxies /api/v1/* to the backend in both local and
// Railway deployments, which makes the httpOnly refresh cookie first-party to the web origin.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";
const REFRESH_PATH = `auth/${AUTH_PATHS.refresh}`;

// In-memory only — never localStorage/sessionStorage (XSS-readable). Lost on full page reload by
// design; AuthProvider re-establishes it via the httpOnly refresh cookie on mount. See
// ARCHITECTURE.md §4: "rotating refresh token (httpOnly cookie on web, secure storage on mobile)".
let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message ?? "Request failed");
    this.code = body.error?.code ?? "UNKNOWN_ERROR";
    this.status = status;
    this.details = body.error?.details;
  }
}

function rawFetch(path: string, options: RequestInit): Promise<Response> {
  const headers = new Headers(options.headers);
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (!isFormData && !headers.has("Content-Type") && options.body) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  // Do not set Accept-Encoding here. Browsers own that forbidden request header and advertise only
  // codecs they can actually decode. The backend negotiates zstd/br/gzip/identity from that real
  // capability signal, and fetch transparently decodes the selected Content-Encoding.
  //
  // Same-origin in production and development: the web app's Next.js rewrite forwards these
  // requests to the backend while the browser keeps the refresh cookie on the web origin.
  return fetch(`${API_BASE_URL}/${path}`, { ...options, headers, credentials: "include" });
}

/** Single-flight: concurrent 401s trigger one refresh call, not one per failed request. */
async function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await rawFetch(REFRESH_PATH, { method: "POST", body: "{}" });
      if (!res.ok) return false;
      const body = (await res.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// Phase 15 (Low-Network / Resilience Mode). A network-level failure (offline, DNS failure, the
// backend unreachable) makes `fetch()` itself reject — no Response, no status code — which is a
// completely different failure mode from a real 4xx/5xx and deserves a message that says so
// rather than the generic fallback every caller's `catch` already uses for ApiError-shaped
// errors. Status 0 is not a real HTTP status; it exists only to make this ApiError distinguishable
// from every server-issued one (whose status is always >= 100).
const NETWORK_OFFLINE_MESSAGE = "You appear to be offline. Check your connection and try again.";
function networkOfflineError(): ApiError {
  return new ApiError(0, { error: { code: "NETWORK_OFFLINE", message: NETWORK_OFFLINE_MESSAGE } });
}
async function fetchOrOffline(path: string, options: RequestInit): Promise<Response> {
  try {
    return await rawFetch(path, options);
  } catch {
    throw networkOfflineError();
  }
}

export const PASSWORD_CHANGE_PATH = "/change-password-required";

/**
 * The backend refuses every route for an account that still holds an administrator-issued temporary password
 * (PASSWORD_CHANGE_REQUIRED). Whatever the person was doing, the only way forward is the change-password page, so send
 * them there once instead of leaving every screen showing a vague error.
 */
export function redirectIfPasswordChangeRequired(error: ApiError): void {
  if (error.status !== 403 || error.code !== "PASSWORD_CHANGE_REQUIRED") return;
  if (typeof window === "undefined" || window.location.pathname === PASSWORD_CHANGE_PATH) return;
  // No router is available outside React; a full navigation also drops any half-rendered state of the blocked screen.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(PASSWORD_CHANGE_PATH);
}

/**
 * Authenticated binary download (e.g. an invoice PDF) with the same one-shot silent refresh as
 * apiFetch. Returns the file as a Blob plus the server-suggested filename. The bytes are never
 * placed in a URL or in storage - the caller turns the Blob into a temporary object URL.
 */
export async function apiFetchBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  let res = await fetchOrOffline(path, { method: "GET" });
  if (res.status === 401 && path !== REFRESH_PATH) {
    if (await tryRefresh()) res = await fetchOrOffline(path, { method: "GET" });
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = JSON.parse(await res.text());
    } catch {
      body = null;
    }
    throw new ApiError(res.status, (body ?? {}) as ApiErrorBody);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return { blob: await res.blob(), filename: match ? match[1] : null };
}

/**
 * Every authenticated call goes through here. On a 401 (access token expired — a normal,
 * expected event every ~15 minutes per ARCHITECTURE.md §4), it attempts exactly one silent
 * refresh via the httpOnly cookie and retries the original request once. If that also fails, the
 * 401 propagates so the caller (AuthProvider) can clear state and redirect to login.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res = await fetchOrOffline(path, options);

  if (res.status === 401 && path !== REFRESH_PATH) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await fetchOrOffline(path, options);
    }
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const error = new ApiError(res.status, (body ?? {}) as ApiErrorBody);
    redirectIfPasswordChangeRequired(error);
    throw error;
  }
  return body as T;
}
