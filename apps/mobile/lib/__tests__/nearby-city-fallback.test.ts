/// <reference types="jest" />
jest.mock('expo-location', () => ({ reverseGeocodeAsync: jest.fn() }));
jest.mock('../api', () => ({ apiFetch: jest.fn() }));

import * as Location from 'expo-location';
import { apiFetch } from '../api';
import {
  findCityForDeviceLocation, buildCityFallbackQuery,
  appendCityMatchesToNearby, __resetCityFallbackCacheForTests,
} from '../nearby-city-fallback';
import type { CityDto, SalonListItemDto } from '@barbercue/shared';

const hajipur = { id: 'city-1', name: 'Hajipur', slug: 'hajipur', countryCode: 'IN' } as CityDto;
const citySearch = apiFetch as jest.Mock;
const geo = Location.reverseGeocodeAsync as jest.Mock;
const salon = (id: string, lat: number | null, lng: number | null) =>
  ({ id, lat, lng } as SalonListItemDto);

beforeEach(() => {
  jest.clearAllMocks();
  __resetCityFallbackCacheForTests();
});

test('resolves Hajipur against canonical active city records, not a guessed slug', async () => {
  geo.mockResolvedValue([{ city: 'Hajipur', isoCountryCode: 'IN' }]);
  citySearch.mockResolvedValue([hajipur, { ...hajipur, id: 'other', name: 'Patna', slug: 'patna' }]);
  await expect(findCityForDeviceLocation({ lat: 25.69, lng: 85.22 })).resolves.toEqual(hajipur);
  await findCityForDeviceLocation({ lat: 25.69, lng: 85.22 });
  expect(citySearch).toHaveBeenCalledTimes(1);
});

test('accepts a geocoder subregion only when it exactly matches a canonical city', async () => {
  geo.mockResolvedValue([{ city: null, subregion: 'Hajipur', isoCountryCode: 'IN' }]);
  citySearch.mockResolvedValue([hajipur]);
  await expect(findCityForDeviceLocation({ lat: 25.69, lng: 85.22 })).resolves.toEqual(hajipur);
});

test('rejects an unresolved state, wrong country or duplicate city', async () => {
  geo.mockResolvedValue([{ city: null, region: 'Bihar' }]);
  citySearch.mockResolvedValue([hajipur]);
  await expect(findCityForDeviceLocation({ lat: 25.69, lng: 85.22 })).resolves.toBeNull();
  geo.mockResolvedValue([{ city: 'Hajipur', isoCountryCode: 'US' }]);
  await expect(findCityForDeviceLocation({ lat: 25.59, lng: 85.12 })).resolves.toBeNull();
  geo.mockResolvedValue([{ city: 'Hajipur', isoCountryCode: 'IN' }]);
  citySearch.mockResolvedValue([hajipur, { ...hajipur, id: 'duplicate' }]);
  await expect(findCityForDeviceLocation({ lat: 25.49, lng: 85.12 })).resolves.toBeNull();
});

test('city query removes GPS and distance sort, retains filtering', () => {
  const query = buildCityFallbackQuery('lat=25.69&lng=85.22&service=hair&sort=distance&openNow=true&salonType=UNISEX', hajipur);
  const params = new URLSearchParams(query);
  expect(params.has('lat')).toBe(false);
  expect(params.has('lng')).toBe(false);
  expect(params.has('radiusKm')).toBe(false);
  expect(params.has('sort')).toBe(false);
  expect(params.get('service')).toBe('hair');
  expect(params.get('openNow')).toBe('true');
  expect(params.get('salonType')).toBe('UNISEX');
  expect(params.get('city')).toBe('hajipur');
  expect(params.get('countryCode')).toBe('IN');
});

test('appends unique city shops after GPS matches with real or unknown distance', () => {
  const located = [salon('nearby', 25.68, 85.21)];
  const city = [salon('nearby', 25.68, 85.21), salon('unknown', null, null), salon('pinned', 25.5, 85.1), salon('unknown', null, null)];
  const result = appendCityMatchesToNearby(located, city, { lat: 25.69, lng: 85.22 });
  expect(result.map((s) => s.id)).toEqual(['nearby', 'unknown', 'pinned']);
  expect(result[1].distanceKm).toBeNull();
  expect(result[2].distanceKm).toBeGreaterThan(0);
  expect(result[0]).toBe(located[0]);
});
