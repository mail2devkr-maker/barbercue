import type { SalonListItemDto } from '@barbercue/shared';
import type { SelectableCity } from '../selection';

/** Test fixtures only — production city data always comes from the backend. */
export const HAJIPUR: SelectableCity = {
  id: 'city-hajipur',
  name: 'Hajipur',
  slug: 'hajipur',
  countryCode: 'IN',
  regionName: 'Bihar',
  countryName: 'India',
  latitude: 25.6853,
  longitude: 85.209,
};

export const PATNA: SelectableCity = {
  id: 'city-patna',
  name: 'Patna',
  slug: 'patna',
  countryCode: 'IN',
  regionName: 'Bihar',
  countryName: 'India',
  latitude: 25.5941,
  longitude: 85.1376,
};

export const DELHI: SelectableCity = {
  id: 'city-delhi',
  name: 'Delhi',
  slug: 'delhi',
  countryCode: 'IN',
  regionName: 'Delhi',
  countryName: 'India',
  latitude: 28.6139,
  longitude: 77.209,
};

/** A city whose centre is not stored: distance from it must be "unavailable", never guessed. */
export const NO_CENTRE_CITY: SelectableCity = {
  id: 'city-nocentre',
  name: 'Smallville',
  slug: 'smallville',
  countryCode: 'IN',
  regionName: 'Bihar',
  countryName: 'India',
  latitude: null,
  longitude: null,
};

export const LONDON_GB: SelectableCity = {
  id: 'city-london-gb',
  name: 'London',
  slug: 'london',
  countryCode: 'GB',
  regionName: 'England',
  countryName: 'United Kingdom',
  latitude: 51.5072,
  longitude: -0.1276,
};

export const LONDON_CA: SelectableCity = {
  id: 'city-london-ca',
  name: 'London',
  slug: 'london',
  countryCode: 'CA',
  regionName: 'Ontario',
  countryName: 'Canada',
  latitude: 42.9849,
  longitude: -81.2453,
};

export function shop(overrides: Partial<SalonListItemDto> & { id: string; name: string }): SalonListItemDto {
  return {
    slug: overrides.id,
    countryCode: 'IN',
    citySlug: 'hajipur',
    addressLine: 'Main Road',
    coverPhotoUrl: null,
    verified: false,
    ratingAverage: null,
    ratingCount: 0,
    priceMin: null,
    priceMax: null,
    waitingCount: 0,
    currency: 'INR',
    isOpenNow: null,
    isClosedForToday: false,
    lat: null,
    lng: null,
    distanceKm: null,
    ...overrides,
  } as SalonListItemDto;
}
