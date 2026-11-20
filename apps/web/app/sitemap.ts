import type { MetadataRoute } from "next";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { CityDto, LocalityDto, PaginatedResult, SalonListItemDto } from "@barbercue/shared";
import { fetchDiscovery } from "../lib/discovery-api";
import { SITE_URL } from "../lib/seo";
import { SEO_SERVICES } from "../lib/seo-services";
import { isDelhiNcrCity } from "../lib/seo-region";

export const revalidate = 3600;
// Rendered per request (Next caches the fetches for `revalidate`), never baked at build time: the
// build cannot always reach the backend, and a sitemap built during a backend/DB cold start used to
// be cached for an hour with no city, area or salon pages at all.
export const dynamic = "force-dynamic";

// Google's per-file limit is 50,000 URLs; stay far below it and fail loudly if we ever get close.
const MAX_URLS = 45_000;
// Safety cap on cursor pages per city (50 salons per page).
const MAX_SALON_PAGES_PER_CITY = 40;

async function withRetry<T>(load: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await load();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

/** Every public salon in a city (cursor pagination; the API returns at most 50 per page). */
async function allCitySalons(city: CityDto): Promise<SalonListItemDto[]> {
  const out: SalonListItemDto[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_SALON_PAGES_PER_CITY; page += 1) {
    const path: string =
      `${DISCOVERY_PATHS.salons}?city=${city.slug}&countryCode=${city.countryCode}&limit=50` +
      (cursor ? `&cursor=${cursor}` : "");
    const res: PaginatedResult<SalonListItemDto> = await withRetry(() =>
      fetchDiscovery<PaginatedResult<SalonListItemDto>>(path, revalidate),
    );
    out.push(...res.items);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return out;
}

/** Run `fn` over `items` with at most `limit` in flight (keeps the backend/DB load gentle). */
async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Only canonical, indexable URLs. Rules (super SEO pass / issue #429):
 * - lastModified only where the data has a real timestamp; never "now" for every page.
 * - a city or area page is listed only when it shows at least one real shop (empty ones are
 *   noindex and would contradict the sitemap);
 * - keep the backend call count low: the backend allows 60 requests per minute per caller.
 * - all salons per city via cursor pagination (the old first-50 cap is gone).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/search`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${SITE_URL}/shop`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/shop/browse`, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/about-us`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/contact-us`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/careers`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/faq`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/hr-policy`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/privacy-policy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/account-deletion`, changeFrequency: "yearly", priority: 0.3 },
  ];

  // Marketplace product pages: verified, public, non-test products only (decided by the backend).
  try {
    const products = await fetchDiscovery<Array<{ id: string; updatedAt: string }>>("shop/sitemap-products", revalidate);
    for (const p of products)
      entries.push({ url: `${SITE_URL}/shop/p/${p.id}`, lastModified: new Date(p.updatedAt), changeFrequency: "daily", priority: 0.5 });
  } catch {
    // Shop unavailable: keep the rest of the sitemap.
  }

  // National service hubs: always useful (they list cities and nearby shops).
  entries.push({ url: `${SITE_URL}/services`, changeFrequency: "weekly", priority: 0.8 });
  for (const svc of SEO_SERVICES) {
    entries.push({ url: `${SITE_URL}/services/${svc.slug}`, changeFrequency: "weekly", priority: 0.7 });
  }

  let cities: CityDto[] = [];
  try {
    cities = await withRetry(() => fetchDiscovery<CityDto[]>(DISCOVERY_PATHS.cities, revalidate));
  } catch (err) {
    // Backend unreachable: degrade to the static entries above rather than failing the whole
    // sitemap, but leave a trace in the logs so an incomplete sitemap is never silent.
    console.error("[sitemap] city list unavailable; serving static entries only", err);
    return entries;
  }

  let ncrHasShops = false;
  await mapLimited(cities, 2, async (city) => {
    // B9: country-scoped public URLs. countryCode is lowercased for the URL by convention; the
    // backend uppercases it before the (countryCode, slug) lookup either way.
    const countrySegment = city.countryCode.toLowerCase();
    const cityPath = `${countrySegment}/${city.slug}`;

    const [localities, salons] = await Promise.all([
      fetchDiscovery<LocalityDto[]>(`${DISCOVERY_PATHS.cities}/${countrySegment}/${city.slug}/localities`, revalidate).catch(
        () => [] as LocalityDto[],
      ),
      allCitySalons(city).catch((err) => {
        console.error(`[sitemap] salons unavailable for ${cityPath}`, err);
        return [] as SalonListItemDto[];
      }),
    ]);
    if (salons.length === 0) return; // no shop yet: the city page is thin, keep it out
    if (isDelhiNcrCity(city)) ncrHasShops = true;

    entries.push({ url: `${SITE_URL}/${cityPath}`, changeFrequency: "daily", priority: 0.8 });

    // Areas that actually contain a listed shop.
    const liveAreas = new Set(salons.map((s) => s.localitySlug).filter(Boolean));
    for (const locality of localities) {
      if (!liveAreas.has(locality.slug)) continue;
      entries.push({ url: `${SITE_URL}/${cityPath}/areas/${locality.slug}`, changeFrequency: "weekly", priority: 0.6 });
    }

    for (const salon of salons) {
      entries.push({
        url: `${SITE_URL}/${salon.countryCode.toLowerCase()}/${salon.citySlug}/${salon.slug}`,
        changeFrequency: "weekly",
        priority: 0.9,
      });
    }

    // "Service in city" pages for every city that has shops. No per-service check here: that was
    // ~54 extra backend calls per city, and the backend rate-limits one caller to 60 requests per
    // minute, which dropped whole cities from the sitemap (19 Nov). A page whose service no shop
    // here offers is noindex itself.
    for (const svc of SEO_SERVICES) {
      entries.push({ url: `${SITE_URL}/${cityPath}/services/${svc.slug}`, changeFrequency: "weekly", priority: 0.7 });
    }
  });

  // Region hub: listed only when it shows at least one real shop (same rule as city pages).
  if (ncrHasShops) entries.push({ url: `${SITE_URL}/delhi-ncr`, changeFrequency: "daily", priority: 0.8 });

  if (entries.length > MAX_URLS) {
    console.error(`[sitemap] ${entries.length} URLs is near Google's 50,000 limit; split into a sitemap index`);
  }
  return entries;
}
