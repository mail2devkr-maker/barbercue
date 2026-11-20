import { SITE_URL } from "../../lib/seo";

const GUIDE_PATHS = [
  "/how-to-book",
  "/how-live-queue-works",
  "/salon-management-software",
  "/list-your-salon",
] as const;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** A small, static sitemap kept separate from the rate-limited live-inventory sitemap. */
export function GET(): Response {
  const entries = GUIDE_PATHS.map((path) =>
    "  <url><loc>" + escapeXml(SITE_URL + path) + "</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>"
  ).join("\n");
  const xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
    + "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n"
    + entries + "\n</urlset>\n";

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
