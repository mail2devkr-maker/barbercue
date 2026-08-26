// Server-only (RSC data fetching, including Next's build-time static generation, which has no
// request/browser context to resolve a relative URL against). NEXT_PUBLIC_API_BASE_URL is a
// relative "/api/v1" in production on purpose (see lib/api.ts) so the BROWSER keeps API calls
// same-origin for the httpOnly refresh cookie — but that value is meaningless here: a relative
// URL passed to fetch() from Node (no window/location) fails outright, and during `next build`
// there is no running server yet for it to resolve against regardless. BACKEND_INTERNAL_URL
// (Railway's private service-to-service origin, e.g. http://barbercuebackend.railway.internal:8080)
// is what this process can actually reach; NEXT_PUBLIC_API_BASE_URL is kept only as the local-dev
// fallback, where it is still the absolute http://localhost:3000/api/v1 apps/web/.env.local sets.
const API_BASE_URL = process.env.BACKEND_INTERNAL_URL
  ? `${process.env.BACKEND_INTERNAL_URL.replace(/\/+$/, "")}/api/v1`
  : (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1");

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

/**
 * Server-safe fetch for the public discovery API (cities/localities/salons) — no auth, no
 * cookies, safe to call from Server Components, which is where every public SEO page fetches its
 * data. `revalidateSeconds` maps directly to Next's fetch cache / ISR window (PROJECT_STRUCTURE.md
 * "SEO details": time-based ISR for now, on-demand revalidation once the owner dashboard can edit
 * salon data).
 */
export async function fetchDiscovery<T>(path: string, revalidateSeconds: number): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/${path}`, { next: { revalidate: revalidateSeconds } });
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
export async function fetchDiscoveryOrNull<T>(path: string, revalidateSeconds: number): Promise<T | null> {
  try {
    return await fetchDiscovery<T>(path, revalidateSeconds);
  } catch (err) {
    if (err instanceof DiscoveryApiError && err.status === 404) return null;
    throw err;
  }
}
