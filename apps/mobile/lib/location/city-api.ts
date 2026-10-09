import {
  COUNTRY_PATHS,
  DISCOVERY_PATHS,
  type CityDto,
  type CitySearchResultDto,
  type CountryDto,
} from '@barbercue/shared';
import { ApiError, apiFetch } from '../api';
import { cityFromDto, cityFromSearchResult, cityKey, type SelectableCity } from './selection';

/**
 * City data for the location selector, written to work against BOTH backend generations without a
 * second city database and without downloading the ~100k-city catalogue:
 *
 *  - Current backend (PR #170): `GET cities/search?q&hasShops=true` — one scoped, pg_trgm-backed call.
 *  - Older deployed backend: that query is rejected with HTTP 400 `VALIDATION_ERROR` because its
 *    schema still requires `countryId`. The app detects exactly that rejection (never a guess from a
 *    network failure), remembers it for the session, and searches per country instead: it takes the
 *    countries that already have an active shop (from `GET cities`), resolves their ids from the
 *    public `GET countries` list, and calls the same `cities/search?countryId=…` endpoint for each.
 *    No UUID is hard-coded and no country is assumed.
 *
 * Failures are typed so the screen never says "no cities found" when the request was actually
 * refused or never arrived (see CitySearchError).
 */

export const CITY_SEARCH_MIN_LENGTH = 2;
const CITY_SEARCH_LIMIT = 20;
/** A shop network spans a handful of countries; bound the fan-out regardless. */
const LEGACY_MAX_COUNTRIES = 5;

export type CitySearchFailureKind =
  /** No response, a timeout, or a 5xx: the customer should retry. */
  | 'NETWORK_ERROR'
  /** The backend answered but cannot serve a city search for this app version. */
  | 'BACKEND_UNSUPPORTED';

export class CitySearchError extends Error {
  constructor(readonly kind: CitySearchFailureKind) {
    super(kind);
    this.name = 'CitySearchError';
  }
}

export interface CitySearchOutcome {
  cities: SelectableCity[];
  /** Which backend contract answered. */
  mode: 'server' | 'legacy';
  /**
   * Legacy mode only: the `cityKey`s that have an active shop. A result NOT in this set is a real
   * city with no active shop yet (CITY_FOUND_NO_ACTIVE_SHOPS). Null in server mode, where the
   * backend already returned only cities with active shops.
   */
  activeShopKeys: ReadonlySet<string> | null;
}

let availableCache: SelectableCity[] | null = null;
let availableInFlight: Promise<SelectableCity[]> | null = null;
let countriesCache: CountryDto[] | null = null;
/** null = not yet known; false = this backend rejected the hasShops contract (remembered for the session). */
let serverSearchSupported: boolean | null = null;

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

async function fetchCountries(): Promise<CountryDto[]> {
  if (countriesCache) return countriesCache;
  const countries = await apiFetch<CountryDto[]>(COUNTRY_PATHS.countries);
  countriesCache = countries;
  return countries;
}

/** The deployed backend refused the new query because it predates `hasShops` (countryId required). */
function isLegacyContractRejection(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if ((err.status !== 400 && err.status !== 422) || err.code !== 'VALIDATION_ERROR') return false;
  const issues = (err.details as { issues?: Array<{ path?: unknown }> } | undefined)?.issues;
  return (
    Array.isArray(issues) &&
    issues.some((issue) => issue?.path === 'countryId' || (Array.isArray(issue?.path) && issue.path.includes('countryId')))
  );
}

function classifyFailure(err: unknown): CitySearchError {
  if (err instanceof CitySearchError) return err;
  // A 4xx that is not the known contract rejection means this backend cannot answer the request at
  // all; everything else (offline, timeout, 5xx) is worth retrying.
  if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
    return new CitySearchError('BACKEND_UNSUPPORTED');
  }
  return new CitySearchError('NETWORK_ERROR');
}

function searchPath(params: Record<string, string>): string {
  return `${DISCOVERY_PATHS.cities}/${DISCOVERY_PATHS.citySearch}?${new URLSearchParams(params).toString()}`;
}

async function searchLegacy(q: string): Promise<CitySearchOutcome> {
  let available: SelectableCity[];
  let countries: CountryDto[];
  try {
    available = await fetchAvailableCities();
    if (available.length === 0) throw new CitySearchError('BACKEND_UNSUPPORTED');
    countries = await fetchCountries();
  } catch (err) {
    throw classifyFailure(err);
  }

  const codes = [...new Set(available.map((c) => c.countryCode.toUpperCase()))].slice(0, LEGACY_MAX_COUNTRIES);
  const targets = codes
    .map((code) => countries.find((country) => country.isoCode2.toUpperCase() === code))
    .filter((country): country is CountryDto => country !== undefined);
  if (targets.length === 0) throw new CitySearchError('BACKEND_UNSUPPORTED');

  const settled = await Promise.allSettled(
    targets.map((country) =>
      apiFetch<CitySearchResultDto[]>(searchPath({ countryId: country.id, q, limit: String(CITY_SEARCH_LIMIT) })).then((rows): SelectableCity[] =>
        rows.map((row) => ({ ...cityFromSearchResult(row), countryName: country.name })),
      ),
    ),
  );
  const fulfilled = settled.filter((s): s is PromiseFulfilledResult<SelectableCity[]> => s.status === 'fulfilled');
  if (fulfilled.length === 0) {
    const firstFailure = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    throw classifyFailure(firstFailure?.reason);
  }

  const activeShopKeys = new Set(available.map(cityKey));
  const seen = new Set<string>();
  const cities = fulfilled
    .flatMap((s) => s.value)
    .filter((city) => {
      const key = cityKey(city);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    // Cities that have shops first, then the rest; alphabetical inside each group.
    .sort(
      (a, b) =>
        Number(activeShopKeys.has(cityKey(b))) - Number(activeShopKeys.has(cityKey(a))) || a.name.localeCompare(b.name),
    );
  return { cities, mode: 'legacy', activeShopKeys };
}

/**
 * Backend city search. Rejects with a CitySearchError (never a bare error) so the caller can tell a
 * retryable network problem from an unsupported backend, and an empty array only ever means the
 * search succeeded and found nothing (CITY_NOT_FOUND).
 */
export async function searchCities(query: string): Promise<CitySearchOutcome> {
  const q = query.trim();
  if (q.length < CITY_SEARCH_MIN_LENGTH) {
    return { cities: [], mode: serverSearchSupported === false ? 'legacy' : 'server', activeShopKeys: null };
  }

  if (serverSearchSupported !== false) {
    try {
      const rows = await apiFetch<CitySearchResultDto[]>(
        searchPath({ q, hasShops: 'true', limit: String(CITY_SEARCH_LIMIT) }),
      );
      serverSearchSupported = true;
      return { cities: rows.map(cityFromSearchResult), mode: 'server', activeShopKeys: null };
    } catch (err) {
      if (!isLegacyContractRejection(err)) throw classifyFailure(err);
      serverSearchSupported = false;
    }
  }
  return searchLegacy(q);
}

/** Test seam: drops every session cache. */
export function __resetCityCacheForTests(): void {
  availableCache = null;
  availableInFlight = null;
  countriesCache = null;
  serverSearchSupported = null;
}
