// Small, shared by every public page's generateMetadata (canonical URL, OG url) and by
// breadcrumbJsonLd — avoids each page re-deriving the site origin independently.
const LOCAL_SITE_URL = "http://localhost:3001";
const PRODUCTION_SITE_URL = "https://barbercueweb-production.up.railway.app";

// Railway currently has no NEXT_PUBLIC_SITE_URL configured. Production metadata must never
// advertise localhost, so use the verified public web service as the production fallback while
// keeping local development local. A future custom domain can override both with the existing
// environment variable—no API, backend, or deployment-contract change required.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NODE_ENV === "production" ? PRODUCTION_SITE_URL : LOCAL_SITE_URL);

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

// Foundation-phase ISR window (PROJECT_STRUCTURE.md "SEO details": time-based ISR for now,
// on-demand revalidation once the owner dashboard can edit salon data).
export const DISCOVERY_REVALIDATE_SECONDS = 300;
