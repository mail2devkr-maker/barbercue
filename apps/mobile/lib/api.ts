import { AUTH_PATHS } from '@barbercue/shared';
import * as FileSystem from 'expo-file-system/legacy';
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
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // Transport diagnostics are development-only and deliberately exclude headers/bodies, so
      // access tokens, refresh tokens, image bytes and QR contents can never reach the console.
      console.warn('[api] transport request failed', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    reportNetworkFailure();
    throw networkOfflineError();
  }
}

/**
 * Raised when the native file uploader fails before it receives an HTTP response, but an ordinary
 * authenticated backend probe proves that the device can still reach the API. This must remain
 * separate from NETWORK_OFFLINE so a local/native upload problem cannot poison global network
 * state.
 */
export class NativeUploadError extends Error {
  readonly code = 'NATIVE_UPLOAD_FAILED';

  constructor() {
    super('Could not upload this image. Please try again.');
    this.name = 'NativeUploadError';
  }
}

function parseApiPayload<T>(status: number, text: string): T {
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (status < 200 || status >= 300) {
    throw new ApiError(status, (body ?? {}) as ApiErrorBody);
  }
  return body as T;
}

function parseApiResponse<T>(res: Response): Promise<T> {
  return res.text().then((text) => parseApiPayload<T>(res.status, text));
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
  // parseApiResponse preserves that existing behavior while also being shared by multipart calls.
  return parseApiResponse<T>(res);
}

async function probeBackendReachability(): Promise<boolean> {
  try {
    // A 2xx/4xx/5xx response all prove transport reachability. auth/me is deliberately used as a
    // small existing endpoint rather than introducing a new health API or changing auth behavior.
    await rawFetch('auth/me', { method: 'GET' });
    reportNetworkSuccess();
    return true;
  } catch {
    reportNetworkFailure();
    return false;
  }
}

async function nativeMultipartUpload(
  path: string,
  file: { uri: string; name: string; type: string },
  parameters: Record<string, string>,
): Promise<FileSystem.FileSystemUploadResult> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  try {
    const result = await FileSystem.uploadAsync(`${API_BASE_URL}/${path}`, file.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'image',
      mimeType: file.type,
      parameters,
      headers,
    });
    reportNetworkSuccess();
    return result;
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // Never include the local URI, headers, tokens, request body, or image/QR data in logs.
      console.warn('[api] native image upload failed', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (await probeBackendReachability()) throw new NativeUploadError();
    throw networkOfflineError();
  }
}

/**
 * Upload a verified local image with Expo's native multipart transport. The same file URI is held
 * by the caller across this method, and the native upload is invoked once more only after a
 * successful refresh-token rotation. No multipart boundary is manufactured in JavaScript.
 */
export async function apiUploadImage<T>(
  path: string,
  file: { uri: string; name: string; type: string },
  parameters: Record<string, string> = {},
): Promise<T> {
  let result = await nativeMultipartUpload(path, file, parameters);

  if (result.status === 401 && path !== REFRESH_PATH) {
    const refreshed = await tryRefresh();
    if (refreshed) result = await nativeMultipartUpload(path, file, parameters);
  }

  return parseApiPayload<T>(result.status, result.body);
}
