import { SALON_SEARCH_MAX_IDS, type SalonSortOption, type SalonTypeFilter } from '@barbercue/shared';

// Discovery upgrade (mobile parity with apps/web's /search): every filter the search screen can
// send, and the one rule set that turns them into the public search API's query string.

export interface DiscoveryFilters {
  radiusKm: number | null;
  priceMin: number | null;
  priceMax: number | null;
  service: string | null;
  salonType: SalonTypeFilter | null;
  popularService: string | null;
  sort: SalonSortOption;
  minRating: number | null;
  openNow: boolean;
  favoritesOnly: boolean;
}

export const DEFAULT_DISCOVERY_FILTERS: DiscoveryFilters = {
  radiusKm: null,
  priceMin: null,
  priceMax: null,
  service: null,
  salonType: null,
  popularService: null,
  sort: 'relevance',
  minRating: null,
  openNow: false,
  favoritesOnly: false,
};

export type DiscoveryQuery =
  | { kind: 'search'; query: string }
  // Nothing to search: "Favorites" while signed out, or with nothing saved yet.
  | { kind: 'favorites-sign-in' }
  | { kind: 'favorites-empty' };

export function buildDiscoveryQuery(input: {
  text: string;
  coords: { lat: number; lng: number } | null;
  filters: DiscoveryFilters;
  favoriteIds: ReadonlySet<string> | null;
}): DiscoveryQuery {
  const { text, coords, filters, favoriteIds } = input;
  if (filters.favoritesOnly) {
    if (!favoriteIds) return { kind: 'favorites-sign-in' };
    if (favoriteIds.size === 0) return { kind: 'favorites-empty' };
  }
  const params = new URLSearchParams();
  const typed = text.trim();
  if (typed) params.set('service', typed);
  else if (filters.service) params.set('service', filters.service);
  if (coords) {
    params.set('lat', String(coords.lat));
    params.set('lng', String(coords.lng));
    // radiusKm is meaningless without a query point, so it only ever gets sent alongside one.
    if (filters.radiusKm !== null) params.set('radiusKm', String(filters.radiusKm));
  }
  if (filters.priceMin !== null) params.set('priceMin', String(filters.priceMin));
  if (filters.priceMax !== null) params.set('priceMax', String(filters.priceMax));
  if (filters.salonType) params.set('salonType', filters.salonType);
  if (filters.popularService) params.set('popularService', filters.popularService);
  // The API rejects a price sort without a service and a distance sort without a location.
  const sortAllowed =
    filters.sort === 'price'
      ? !!(filters.popularService || params.has('service'))
      : filters.sort === 'distance'
        ? !!coords
        : filters.sort !== 'relevance';
  if (sortAllowed) params.set('sort', filters.sort);
  if (filters.minRating !== null) params.set('minRating', String(filters.minRating));
  if (filters.openNow) params.set('openNow', 'true');
  if (filters.favoritesOnly && favoriteIds) {
    params.set('ids', [...favoriteIds].slice(0, SALON_SEARCH_MAX_IDS).join(','));
  }
  return { kind: 'search', query: params.toString() };
}
