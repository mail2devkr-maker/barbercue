import { AUTH_PATHS } from '@barbercue/shared';
import { deleteItem, getItem, setItem } from './secure-storage';
import { reportNetworkFailure, reportNetworkSuccess } from './network-status';
import { getCurrentUiStrings } from './current-language';

// A release binary must never silently point at localhost when an EAS public variable is absent.
// EAS environments still provide EXPO_PUBLIC_API_BASE_URL for preview/production builds; this
// fallback protects the customer-facing binary from a misconfigured environment while retaining
// the convenient local backend default for Metro development.
const DEVELOPMENT_API_BASE_URL = 'http://localhost:3000/api/v1';
const PRODUCTION_API_BASE_URL = 'https://barbercuebackend-production.up.railway.app/api/v1';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? (__DEV__ ? DEVELOPMENT_API_BASE_URL : PRODUCTION_API_BASE_URL);
const REFRESH_TOKEN_KEY = 'barbercue_refresh_token';
const REFRESH_PATH = `auth/${AUTH_PATHS.refresh}`;

// In-memory only, exactly like the web client (lib/api.ts in apps/web) — lost on app restart by
// design; restoreSession() in auth-context.tsx re-establishes it from the persisted refresh
// token. See ARCHITECTURE.md §4.
let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export function persistRefreshToken(token: string): Promise<void> {
  return setItem(REFRESH_TOKEN_KEY, token);
}

export function getPersistedRefreshToken(): Promise<string | null> {
  return getItem(REFRESH_TOKEN_KEY);
}

export function clearPersistedRefreshToken(): Promise<void> {
  return deleteItem(REFRESH_TOKEN_KEY);
}

interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message ?? 'Request failed');
    this.code = body.error?.code ?? 'UNKNOWN_ERROR';
    this.status = status;
    this.details = body.error?.details;
  }
}

function rawFetch(path: string, options: RequestInit): Promise<Response> {
  const headers = new Headers(options.headers);
  // FormData (multipart uploads, e.g. the AI Style Advisor) must NOT get a manual Content-Type —
  // React Native's fetch sets one itself with the correct multipart boundary.
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!isFormData && !headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  // No cookies on native — the refresh token travels explicitly in the request body instead
  // (see AuthController: body takes precedence over cookie, and mobile never sets a cookie).
  return fetch(`${API_BASE_URL}/${path}`, { ...options, headers });
}

async function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const refreshToken = await getPersistedRefreshToken();
      if (!refreshToken) return false;
      const res = await rawFetch(REFRESH_PATH, { method: 'POST', body: JSON.stringify({ refreshToken }) });
      if (!res.ok) return false;
      const body = (await res.json()) as { accessToken: string; refreshToken: string };
      accessToken = body.accessToken;
      await persistRefreshToken(body.refreshToken); // rotated — old token is now revoked server-side
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// Phase 15 (Low-Network / Resilience Mode) — same rationale as apps/web/lib/api.ts's own
// networkOfflineError: a network-level failure (no connectivity, backend unreachable) makes
// fetch() itself reject with no status code at all, which is a different failure mode from a real
// 4xx/5xx and deserves a message that says so. Status 0 is not a real HTTP status; it exists only
// to make this distinguishable from every server-issued ApiError.
function networkOfflineError(): ApiError {
  return new ApiError(0, { error: { code: 'NETWORK_OFFLINE', message: getCurrentUiStrings().networkOfflineMessage } });
}
async function fetchOrOffline(path: string, options: RequestInit): Promise<Response> {
  try {
    const res = await rawFetch(path, options);
    reportNetworkSuccess();
    return res;
  } catch {
    reportNetworkFailure();
    throw networkOfflineError();
  }
}

/**
 * Same contract as apps/web/lib/api.ts: on a 401 (expired access token — expected roughly every
 * 15 minutes), attempts exactly one silent refresh using the persisted refresh token and retries
 * once. This is "handle expired access tokens via refresh token" for mobile.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res = await fetchOrOffline(path, options);

  if (res.status === 401 && path !== REFRESH_PATH) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await fetchOrOffline(path, options);
    }
  }

  // A controller returning null sends a genuinely empty body (not the literal text "null") —
  // res.json() throws on that, and blindly falling back to `{}` would turn every such response
  // into a truthy empty object, breaking any caller checking the result for null (e.g. "do I have
  // an active queue entry?"). Parse the raw text instead so an empty body correctly becomes null.
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
