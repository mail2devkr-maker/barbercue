import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";

// Kept separate from the live-inventory sitemap so educational pages can be discovered without
// changing the inventory pagination/rate-limit work in the parallel #447 branch.
export default function sitemapGuides(): MetadataRoute.Sitemap {
  return ["/how-to-book", "/how-live-queue-works", "/salon-management-software"].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "monthly",
    priority: 0.6,
  }));
}
