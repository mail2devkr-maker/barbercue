import { AUTH_PATHS } from '@barbercue/shared';
import { deleteItem, getItem, setItem } from './secure-storage';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
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
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
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

/**
 * Same contract as apps/web/lib/api.ts: on a 401 (expired access token — expected roughly every
 * 15 minutes), attempts exactly one silent refresh using the persisted refresh token and retries
 * once. This is "handle expired access tokens via refresh token" for mobile.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res = await rawFetch(path, options);

  if (res.status === 401 && path !== REFRESH_PATH) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await rawFetch(path, options);
    }
  }

  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body as ApiErrorBody);
  }
  return body as T;
}
