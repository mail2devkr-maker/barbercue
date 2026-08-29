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
    throw new ApiError(res.status, (body ?? {}) as ApiErrorBody);
  }
  return body as T;
}
