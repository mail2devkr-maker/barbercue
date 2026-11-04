import * as Location from 'expo-location';
import {
  DISCOVERY_PATHS,
  haversineDistanceKm,
  type CityDto,
  type SalonListItemDto,
} from '@barbercue/shared';
import { apiFetch } from './api';

// Unpinned salons are excluded from GPS-only ranking. Display *city-matching*
// unpinned shops separately without pretending their distance is known.
// Never use a guessed PIN/city centroid as a shop's exact coordinates.
type Coords = { lat: number; lng: number };
let lastCity: { key: string; city: CityDto } | null = null;
const LOOKUP_TIMEOUT_MS = 6_000;

function bounded<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), LOOKUP_TIMEOUT_MS);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

function normalized(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
}

export async function findCityForDeviceLocation(coords: Coords): Promise<CityDto | null> {
  // In-memory only; no precise location is stored or logged.
  const key = `${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}`;
  if (lastCity?.key === key) return lastCity.city;

  const addresses = await bounded(
    Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lng }),
    [] as Location.LocationGeocodedAddress[],
  );
  const address = addresses[0];
  const cityLabel = address?.city || address?.subregion;
  if (!cityLabel) return null; // Never substitute a state or a country.
  const name = normalized(cityLabel);
  if (!name) return null;
  const cities = await bounded(apiFetch<CityDto[]>(DISCOVERY_PATHS.cities), [] as CityDto[]);
  const matches = cities.filter((candidate) =>
    (normalized(candidate.name) === name || normalized(candidate.slug) === name) &&
    (!address.isoCountryCode || candidate.countryCode.toUpperCase() === address.isoCountryCode.toUpperCase()),
  );
  if (matches.length !== 1) return null; // Do not guess between homonymous cities.
  lastCity = { key, city: matches[0] };
  return matches[0];
}

export function buildCityFallbackQuery(gpsQuery: string, city: Pick<CityDto, 'slug' | 'countryCode'>): string {
  const params = new URLSearchParams(gpsQuery);
  params.delete('lat');
  params.delete('lng');
  params.delete('radiusKm');
  if (params.get('sort') === 'distance') params.delete('sort');
  params.set('city', city.slug);
  params.set('countryCode', city.countryCode);
  // Retain service, salon type, rating, price, open-now and favorites filters.
  return params.toString();
}

export function appendCityMatchesToNearby(
  located: SalonListItemDto[],
  inSameCity: SalonListItemDto[],
  from: Coords,
): SalonListItemDto[] {
  const seen = new Set(located.map((shop) => shop.id));
  const extra = inSameCity.flatMap((shop) => {
    if (seen.has(shop.id)) return [];
    seen.add(shop.id);
    // A verified pin can show a real straight-line distance from the user's
    // permission-granted GPS; an unpinned shop must explicitly show null.
    const distanceKm = shop.lat != null && shop.lng != null
      ? Math.round(haversineDistanceKm(from.lat, from.lng, shop.lat, shop.lng) * 10) / 10
      : null;
    return [{ ...shop, distanceKm }];
  });
  // Keep verified nearby results first; city listings are supplemental, NOT
  // promises that any shop lies inside a selected radius.
  return [...located, ...extra];
}

export function __resetCityFallbackCacheForTests() {
  lastCity = null;
}
