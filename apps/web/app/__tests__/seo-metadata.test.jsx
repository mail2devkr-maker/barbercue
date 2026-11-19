import robots from "../robots";
import { metadata as authMetadata } from "../(auth)/layout";
import { metadata as customerMetadata } from "../(customer)/layout";
import { metadata as dashboardMetadata } from "../(dashboard)/layout";
import { metadata as employeeMetadata } from "../employee/layout";
import { metadata as bookingGuideMetadata } from "../(public)/how-to-book/page";
import { metadata as queueGuideMetadata } from "../(public)/how-live-queue-works/page";
import { metadata as ownerGuideMetadata } from "../(public)/salon-management-software/page";
import { SITE_URL } from "../../lib/seo";

describe("SEO route metadata", () => {
  it("publishes a canonical sitemap and leaves indexable routes crawlable", () => {
    const metadata = robots();
    expect(metadata.rules.allow).toBe("/");
    expect(metadata.rules.disallow).toContain("/search?");
    expect(metadata.sitemap).toEqual([`${SITE_URL}/sitemap.xml`, `${SITE_URL}/sitemap-guides.xml`]);
  });

  it("marks authenticated account and workspace route groups noindex", () => {
    for (const metadata of [authMetadata, customerMetadata, dashboardMetadata, employeeMetadata]) {
      expect(metadata.robots).toEqual({ index: false, follow: false });
    }
  });

  it("gives original customer and owner guides distinct canonical and social metadata", () => {
    const guides = [bookingGuideMetadata, queueGuideMetadata, ownerGuideMetadata];
    const canonicalUrls = guides.map((metadata) => metadata.alternates.canonical);
    const titles = guides.map((metadata) => metadata.title);
    const descriptions = guides.map((metadata) => metadata.description);

    expect(new Set(canonicalUrls).size).toBe(guides.length);
    expect(new Set(titles).size).toBe(guides.length);
    expect(new Set(descriptions).size).toBe(guides.length);
    for (const metadata of guides) {
      expect(metadata.alternates.canonical).toBe(`${SITE_URL}${new URL(metadata.alternates.canonical).pathname}`);
      expect(metadata.openGraph.url).toBe(metadata.alternates.canonical);
      expect(`${metadata.title} ${metadata.description}`).not.toMatch(/railway\.app/i);
    }
  });
});
