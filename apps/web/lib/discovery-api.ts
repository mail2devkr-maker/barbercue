import { DISCOVERY_PATHS } from "@barbercue/shared";

// Server-only (RSC data fetching, including Next's build-time static generation, which has no
// request/browser context to resolve a relative URL against). Browser API calls intentionally use
// the web app's same-origin /api/v1 proxy, but Server Components must always talk to an absolute
// backend origin because Node has no window/location against which a relative URL can resolve.
//
// Railway supplies BACKEND_INTERNAL_URL. For local review, fall back to an explicitly configured
// absolute NEXT_PUBLIC_API_BASE_URL only if one exists; otherwise use the local Nest backend on
// port 3000. This intentionally ignores relative values such as "/api/v1" on the server side.
const configuredPublicApi = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
const API_BASE_URL = process.env.BACKEND_INTERNAL_URL
  ? `${process.env.BACKEND_INTERNAL_URL.replace(/\/+$/, "")}/api/v1`
  : configuredPublicApi && /^https?:\/\//i.test(configuredPublicApi)
    ? configuredPublicApi.replace(/\/+$/, "")
    : "http://localhost:3000/api/v1";

export interface DiscoveryApiErrorBody {
  error: { code: string; message: string };
}

/**
 * Deliberately separate from apps/web/lib/api.ts's ApiError — that module is "use client"
 * (in-memory access token, credentials:'include' for the auth cookie), which is the wrong tool
 * for Server Component data fetching and risks Next's RSC client-boundary rules if imported here.
 * Public discovery data needs no auth at all.
 */
export class DiscoveryApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, body: DiscoveryApiErrorBody) {
    super(body.error?.message ?? "Request failed");
    this.code = body.error?.code ?? "UNKNOWN_ERROR";
    this.status = status;
  }
}

function isSalonVisibilityPath(path: string): boolean {
  const normalizedPath = path.replace(/^\/+/, "").split(/[?#]/, 1)[0];
  return (
    normalizedPath === DISCOVERY_PATHS.salons ||
    normalizedPath.startsWith(`${DISCOVERY_PATHS.salons}/`)
  );
}

/**
 * Server-safe fetch for the public discovery API (cities/localities/salons) — no auth, no
 * cookies, safe to call from Server Components, which is where every public SEO page fetches its
 * data. `revalidateSeconds` maps directly to Next's fetch cache / ISR window for city/locality
 * metadata. Salon profile/list paths are visibility-sensitive and bypass that cache so a
 * quarantine takes effect immediately rather than waiting for the SEO ISR window.
 */
export async function fetchDiscovery<T>(
  path: string,
  revalidateSeconds: number,
): Promise<T> {
  // Salon visibility can change immediately when an administrator quarantines a shop. Do not
  // serve cached public profiles or discovery results after that state transition; keep the
  // existing ISR policy for city/locality/editorial data that is not a shop-visibility decision.
  const cacheOptions = isSalonVisibilityPath(path)
    ? { cache: "no-store" as const }
    : { next: { revalidate: revalidateSeconds } };
  const res = await fetch(`${API_BASE_URL}/${path}`, cacheOptions);
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new DiscoveryApiError(res.status, body as DiscoveryApiErrorBody);
  }
  return body as T;
}

/**
 * Same as fetchDiscovery, but a 404 resolves to `null` instead of throwing — for pages that
 * should render Next's notFound() rather than an error boundary when the slug doesn't exist.
 */
export async function fetchDiscoveryOrNull<T>(
  path: string,
  revalidateSeconds: number,
): Promise<T | null> {
  try {
    return await fetchDiscovery<T>(path, revalidateSeconds);
  } catch (err) {
    if (err instanceof DiscoveryApiError && err.status === 404) return null;
    throw err;
  }
}
