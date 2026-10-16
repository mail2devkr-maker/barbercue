import type { SalonListItemDto } from '@barbercue/shared';
import { distanceOrigin, resolveShopDistanceKm, type DistanceOrigin, type SelectedLocation } from './selection';

/**
 * How the customer's selection becomes a GET /salons request. Pure, so every rule is unit-tested
 * without rendering a screen.
 *
 *  - City mode:   filter to the city (`city` + `countryCode`) and, when the city has a stored
 *                 centre, send it as `originLat/originLng` — a reference point for distance ONLY.
 *                 It is never sent as `lat/lng` (Near Me), which would cap and truncate the city.
 *  - Device mode: no city filter; the GPS fix is the `originLat/originLng`. Without a radius the
 *                 whole platform is listed nearest-first, never silently cut off by an automatic
 *                 nearby radius.
 *  - `radiusKm` is sent ONLY when the customer picked one, and only alongside an origin.
 *    Picking a city never applies a radius.
 */

export type SortChoice = 'nearest' | 'name';

export interface SearchFilters {
  radiusKm: number | null;
  priceMin: number | null;
  priceMax: number | null;
  service: string | null;
  sort: SortChoice;
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  radiusKm: null,
  priceMin: null,
  priceMax: null,
  service: null,
  sort: 'nearest',
};

export function buildSalonSearchParams(args: {
  selection: SelectedLocation | null;
  filters: SearchFilters;
  queryText: string;
  cursor?: string | null;
}): URLSearchParams {
  const { selection, filters, cursor } = args;
  const params = new URLSearchParams();
  const typed = args.queryText.trim();
  if (typed) params.set('service', typed);
  else if (filters.service) params.set('service', filters.service);

  if (selection?.mode === 'city') {
    params.set('city', selection.city.slug);
    params.set('countryCode', selection.city.countryCode.toUpperCase());
  }

  const origin = distanceOrigin(selection);
  if (origin) {
    params.set('originLat', String(origin.lat));
    params.set('originLng', String(origin.lng));
    if (filters.sort === 'nearest') params.set('sort', 'nearest');
    if (filters.radiusKm !== null) params.set('radiusKm', String(filters.radiusKm));
  }

  if (filters.priceMin !== null) params.set('priceMin', String(filters.priceMin));
  if (filters.priceMax !== null) params.set('priceMax', String(filters.priceMax));
  if (cursor) params.set('cursor', cursor);
  return params;
}

/** A stable identity for the selection, so a screen can tell "the location actually changed". */
export function locationKey(selection: SelectedLocation | null): string {
  if (!selection) return 'none';
  if (selection.mode === 'city') return `city:${selection.city.countryCode}:${selection.city.slug}`;
  // ~110 m granularity: a tiny GPS wobble must not re-run the whole search.
  return `device:${selection.coords.lat.toFixed(3)},${selection.coords.lng.toFixed(3)}`;
}

/**
 * True when the server evidently measured distances itself. A server that predates the
 * originLat/originLng parameters ignores them, so every shop that has coordinates comes back with
 * `distanceKm: null` — the signal to fall back to client-side figures.
 */
export function serverSuppliedDistances(items: readonly SalonListItemDto[]): boolean {
  const withCoords = items.filter((item) => item.lat !== null && item.lng !== null);
  if (withCoords.length === 0) return true; // nothing the server could have measured
  return withCoords.some((item) => item.distanceKm !== null);
}

/**
 * What to show when the server may not have measured distances itself.
 *
 * A server that predates originLat/originLng ignores them AND ignores `radiusKm` (it only honours a
 * radius together with legacy lat/lng), so every shop that has coordinates comes back with
 * `distanceKm: null`. In that case the app can only order — and apply the customer's explicit radius
 * to — the shops it has actually downloaded. That is NOT a globally correct nearest-first list, so
 * the result is flagged `approximate` and the screen says so instead of implying otherwise.
 * With a server that did measure distances, the server's order and filtering are used untouched.
 */
export function applyLoadedDistanceFallback(
  items: readonly SalonListItemDto[],
  origin: DistanceOrigin | null,
  filters: Pick<SearchFilters, 'sort' | 'radiusKm'>,
): { items: SalonListItemDto[]; approximate: boolean } {
  if (!origin || serverSuppliedDistances(items)) return { items: [...items], approximate: false };
  let shown = [...items];
  if (filters.radiusKm !== null) {
    const limit = filters.radiusKm;
    shown = shown.filter((item) => {
      const km = resolveShopDistanceKm(item, origin);
      return km !== null && km <= limit;
    });
  }
  if (filters.sort === 'nearest') shown = sortLoadedByDistance(shown, origin);
  return { items: shown, approximate: true };
}

/**
 * Best-effort nearest-first for the shops already loaded, used ONLY when the server did not do it.
 * Shops without a distance stay (last); nothing is dropped and nothing is invented.
 */
export function sortLoadedByDistance(items: readonly SalonListItemDto[], origin: DistanceOrigin): SalonListItemDto[] {
  return [...items].sort((a, b) => {
    const da = resolveShopDistanceKm(a, origin);
    const db = resolveShopDistanceKm(b, origin);
    if (da === null && db === null) return a.name.localeCompare(b.name);
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db || a.name.localeCompare(b.name);
  });
}

/** Appends a page, ignoring any shop already present (cursor restarts can repeat items). */
export function mergePage(existing: readonly SalonListItemDto[], incoming: readonly SalonListItemDto[]): SalonListItemDto[] {
  const seen = new Set(existing.map((item) => item.id));
  return [...existing, ...incoming.filter((item) => !seen.has(item.id))];
}
