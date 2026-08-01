import type { MetadataRoute } from "next";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { CityDto, LocalityDto, PaginatedResult, SalonListItemDto } from "@barbercue/shared";
import { fetchDiscovery } from "../lib/discovery-api";
import { SITE_URL } from "../lib/seo";

export const revalidate = 3600;

// Dynamic per PROJECT_STRUCTURE.md's "SEO details": generated from live backend data, not
// hand-maintained. Priority tiers: homepage highest, salon pages next (the actual conversion
// content), city/locality pages after.
//
// Known scaling limit, not a bug: fetches only the first 50 salons per city (the API's max page
// size). Fine at the current data volume (one seeded salon); revisit with full pagination once a
// city has more listings than that.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/search`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
  ];

  let cities: CityDto[] = [];
  try {
    cities = await fetchDiscovery<CityDto[]>(DISCOVERY_PATHS.cities, revalidate);
  } catch {
    // Backend unreachable at build/request time — degrade to the static entries above rather
    // than failing the whole sitemap.
    return entries;
  }

  for (const city of cities) {
    entries.push({ url: `${SITE_URL}/${city.slug}`, lastModified: now, changeFrequency: "daily", priority: 0.8 });

    const [localities, salons] = await Promise.all([
      fetchDiscovery<LocalityDto[]>(`${DISCOVERY_PATHS.cities}/${city.slug}/localities`, revalidate).catch(
        () => [] as LocalityDto[],
      ),
      fetchDiscovery<PaginatedResult<SalonListItemDto>>(
        `${DISCOVERY_PATHS.salons}?city=${city.slug}&limit=50`,
        revalidate,
      ).catch(() => ({ items: [] as SalonListItemDto[], nextCursor: null })),
    ]);

    for (const locality of localities) {
      entries.push({
        url: `${SITE_URL}/${city.slug}/areas/${locality.slug}`,
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }

    for (const salon of salons.items) {
      entries.push({
        url: `${SITE_URL}/${salon.citySlug}/${salon.slug}`,
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.9,
      });
    }
  }

  return entries;
}
