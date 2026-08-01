// Small, shared by every public page's generateMetadata (canonical URL, OG url) and by
// breadcrumbJsonLd — avoids each page re-deriving the site origin independently.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

// Foundation-phase ISR window (PROJECT_STRUCTURE.md "SEO details": time-based ISR for now,
// on-demand revalidation once the owner dashboard can edit salon data).
export const DISCOVERY_REVALIDATE_SECONDS = 300;
