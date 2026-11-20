import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // noindex pages remain crawlable so compliant crawlers can see their directives.
      // Query-filter variants are excluded; the bare /search page remains crawlable.
      disallow: ["/account", "/dashboard", "/book", "/search?"],
    },
    sitemap: [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/sitemap-guides.xml`],
  };
}
