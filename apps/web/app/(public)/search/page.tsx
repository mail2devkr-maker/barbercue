import type { Metadata } from "next";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { CityDto, PaginatedResult, SalonListItemDto } from "@barbercue/shared";
import { Suspense } from "react";
import { fetchDiscovery } from "../../../lib/discovery-api";
import { absoluteUrl } from "../../../lib/seo";
import SearchClient from "./SearchClient";

// The bare /search (no filters) is the indexable "browse all salons" page — canonical to itself.
// Filtered variations canonicalize to /search. A city slug on its own cannot produce the
// country-scoped canonical route safely, so this deliberately avoids inventing a flat /city URL.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const keys = Object.keys(params).filter((k) => params[k]);

  return {
    title: "Search barbershops",
    description: "Search FastQue shops by service and location.",
    alternates: { canonical: absoluteUrl("/search") },
    robots: keys.length > 0 ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const hasFilters = Object.values(params).some((value) => Array.isArray(value) ? value.some(Boolean) : Boolean(value));

  let initialCities: CityDto[] | undefined;
  let initialResults: PaginatedResult<SalonListItemDto> | undefined;
  if (!hasFilters) {
    [initialCities, initialResults] = await Promise.all([
      fetchDiscovery<CityDto[]>(DISCOVERY_PATHS.cities, 300).catch(() => undefined),
      fetchDiscovery<PaginatedResult<SalonListItemDto>>(`${DISCOVERY_PATHS.salons}?limit=12`, 300).catch(() => undefined),
    ]);
  }

  return (
    <Suspense fallback={null}>
      <SearchClient
        initialCities={initialCities}
        initialResults={initialResults?.items}
        initialHasMore={initialResults ? initialResults.nextCursor !== null : undefined}
      />
    </Suspense>
  );
}
