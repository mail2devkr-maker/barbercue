import robots from "../robots";
import { GET as getGuidesSitemap } from "../sitemap-guides.xml/route";
import { SITE_URL } from "../../lib/seo";
import { canonicalHostRedirectUrl } from "../../lib/canonical-host";

describe("education sitemap", () => {
  it("declares the canonical inventory and education sitemaps in robots.txt", () => {
    expect(robots().sitemap).toEqual([
      SITE_URL + "/sitemap.xml",
      SITE_URL + "/sitemap-guides.xml",
    ]);
    expect(robots().rules.disallow).toContain("/search?");
  });

  it("serves unique canonical guide URLs as valid sitemap XML", async () => {
    const response = getGuidesSitemap();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/xml/i);
    const xml = await response.text();
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toMatch(/<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    expect(xml).toMatch(/<\/urlset>\s*$/);
    const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
    expect(urls).toEqual([
      SITE_URL + "/how-to-book",
      SITE_URL + "/how-live-queue-works",
      SITE_URL + "/salon-management-software",
      SITE_URL + "/list-your-salon",
    ]);
    expect(new Set(urls).size).toBe(urls.length);
    expect(xml).not.toMatch(/<lastmod>/);
  });

  it("redirects only the exact www alias to HTTPS canonical host and preserves query data", () => {
    expect(canonicalHostRedirectUrl("http://www.fastque.com/in/hajipur?source=share", "www.fastque.com")?.toString())
      .toBe("https://fastque.com/in/hajipur?source=share");
    expect(canonicalHostRedirectUrl("https://fastque.com/search", "fastque.com")).toBeNull();
    expect(canonicalHostRedirectUrl("https://attacker.example/", "attacker.example")).toBeNull();
  });
});
