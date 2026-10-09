import { DISCOVERY_PATHS, type CityDto, type CitySearchResultDto } from '@barbercue/shared';
import { apiFetch } from '../api';
import { cityFromDto, cityFromSearchResult, type SelectableCity } from './selection';

/**
 * City data for the location selector. Both calls reuse the existing backend (no second city
 * database): `GET cities` is the public list of cities that already have an ACTIVE shop, and
 * `GET cities/search` is the existing pg_trgm-backed search, scoped by `hasShops=true`.
 */

export const CITY_SEARCH_MIN_LENGTH = 2;
const CITY_SEARCH_LIMIT = 20;

let availableCache: SelectableCity[] | null = null;
let availableInFlight: Promise<SelectableCity[]> | null = null;

/** Cities that currently have at least one ACTIVE shop, alphabetical. Cached for the session. */
export async function fetchAvailableCities(options: { forceRefresh?: boolean } = {}): Promise<SelectableCity[]> {
  if (!options.forceRefresh && availableCache) return availableCache;
  if (availableInFlight) return availableInFlight;
  availableInFlight = apiFetch<CityDto[]>(DISCOVERY_PATHS.cities)
    .then((rows) => {
      const cities = rows.map(cityFromDto).sort((a, b) => a.name.localeCompare(b.name));
      availableCache = cities;
      return cities;
    })
    .finally(() => {
      availableInFlight = null;
    });
  return availableInFlight;
}

/** Synchronous peek at what is already cached, so the selector can render instantly. */
export function cachedAvailableCities(): SelectableCity[] | null {
  return availableCache;
}

/**
 * Backend city search. `hasShops=true` scopes it to cities with an ACTIVE shop (a small, bounded set
 * across all countries). Rejects on network/HTTP failure so the caller can fall back to the
 * available-cities list instead of showing a dead end.
 */
export async function searchCities(query: string): Promise<SelectableCity[]> {
  const q = query.trim();
  if (q.length < CITY_SEARCH_MIN_LENGTH) return [];
  const params = new URLSearchParams({ q, hasShops: 'true', limit: String(CITY_SEARCH_LIMIT) });
  const rows = await apiFetch<CitySearchResultDto[]>(`${DISCOVERY_PATHS.cities}/${DISCOVERY_PATHS.citySearch}?${params.toString()}`);
  return rows.map(cityFromSearchResult);
}

/** Test seam: drops the session cache. */
export function __resetCityCacheForTests(): void {
  availableCache = null;
  availableInFlight = null;
}
