import type { MetadataRoute } from "next";

// Foundation-level placeholder: returns only the homepage. Once the backend's /cities and
// /salons endpoints exist, this generates entries dynamically per PROJECT_STRUCTURE.md's SEO
// section — not hand-maintained.
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";
  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
