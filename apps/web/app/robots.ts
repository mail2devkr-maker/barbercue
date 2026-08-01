import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // "/search?" (note the trailing "?") disallows only query-string variants of the search
      // page — crawl-budget hygiene, since every filter combination isn't worth indexing
      // separately. The bare /search page (no query string) does NOT match this prefix, so it
      // stays crawlable/indexable via its own canonical (see app/(public)/search/page.tsx) —
      // disallowing "/search" outright would have blocked Googlebot from ever seeing that page
      // at all, including its canonical/noindex signals.
      disallow: ["/account", "/dashboard", "/search?"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
