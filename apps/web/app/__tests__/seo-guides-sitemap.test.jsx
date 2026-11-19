import robots from "../robots";
import sitemapGuides from "../sitemap-guides";
import { SITE_URL } from "../../lib/seo";
import { canonicalHostRedirectUrl } from "../../lib/canonical-host";

describe("education sitemap", () => {
  it("declares the canonical inventory and education sitemaps in robots.txt", () => {
    expect(robots().sitemap).toEqual([
      `${SITE_URL}/sitemap.xml`,
      `${SITE_URL}/sitemap-guides.xml`,
    ]);
    expect(robots().rules.disallow).toContain("/search?");
  });

  it("contains only the original customer and owner education routes", () => {
    const entries = sitemapGuides();
    expect(entries.map((entry) => entry.url)).toEqual([
      `${SITE_URL}/how-to-book`,
      `${SITE_URL}/how-live-queue-works`,
      `${SITE_URL}/salon-management-software`,
    ]);
    expect(entries.every((entry) => entry.lastModified === undefined)).toBe(true);
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(entries.length);
  });

  it("redirects only the exact www alias to HTTPS canonical host and preserves query data", () => {
    expect(canonicalHostRedirectUrl("http://www.fastque.com/in/hajipur?source=share", "www.fastque.com")?.toString())
      .toBe("https://fastque.com/in/hajipur?source=share");
    expect(canonicalHostRedirectUrl("https://fastque.com/search", "fastque.com")).toBeNull();
    expect(canonicalHostRedirectUrl("https://attacker.example/", "attacker.example")).toBeNull();
  });
});
