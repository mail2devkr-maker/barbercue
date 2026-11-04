import * as Location from 'expo-location';
import {
  DISCOVERY_PATHS,
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
  if (!address?.city) return null; // A district/state is not proof of an exact city.
  const name = normalized(address.city);
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

export function appendUnpinnedCitySalons(
  located: SalonListItemDto[],
  inSameCity: SalonListItemDto[],
): SalonListItemDto[] {
  const seen = new Set(located.map((shop) => shop.id));
  const extra = inSameCity.filter((shop) => {
    if (seen.has(shop.id) || (shop.lat != null && shop.lng != null)) return false;
    seen.add(shop.id);
    return true;
  });
  return [...located, ...extra];
}

export function __resetCityFallbackCacheForTests() {
  lastCity = null;
}
