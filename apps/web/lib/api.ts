"use client";

import { AUTH_PATHS } from "@barbercue/shared";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";
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
  // FormData (multipart uploads, e.g. the AI Style Advisor) must NOT get a manual Content-Type —
  // the browser sets one itself with the correct multipart boundary; a JSON content-type here
  // would make the backend fail to parse the body at all.
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (!isFormData && !headers.has("Content-Type") && options.body) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  // credentials: "include" is required for the browser to send the httpOnly refresh cookie —
  // web and backend are different origins (ports) in dev.
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

/**
 * Every authenticated call goes through here. On a 401 (access token expired — a normal,
 * expected event every ~15 minutes per ARCHITECTURE.md §4), it attempts exactly one silent
 * refresh via the httpOnly cookie and retries the original request once. If that also fails, the
 * 401 propagates so the caller (AuthProvider) can clear state and redirect to login — this is
 * the "handle expired access tokens via refresh token" requirement, implemented once here rather
 * than duplicated at every call site.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res = await rawFetch(path, options);

  if (res.status === 401 && path !== REFRESH_PATH) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await rawFetch(path, options);
    }
  }

  // Nest sends a genuinely empty body (not the literal text "null") for a controller returning
  // null — `res.json()` throws on that, and the old `.catch(() => ({}))` fallback silently turned
  // every such response into a truthy `{}`, which broke any caller checking the result for
  // null (e.g. "do I have an active queue entry?"). Parse the raw text instead so an empty body
  // correctly becomes `null`, not an empty object.
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
