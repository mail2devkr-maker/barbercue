/// <reference types="jest" />
jest.mock('expo-location', () => ({
  reverseGeocodeAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
jest.mock('../api', () => ({ apiFetch: jest.fn() }));

import * as Location from 'expo-location';
import { apiFetch } from '../api';
import {
  appendCityMatchesToNearby,
  buildCityFallbackQuery,
  findCityForDeviceLocation,
  getSearchGpsCoordinates,
  __resetCityFallbackCacheForTests,
} from '../nearby-city-fallback';
import type { CityDto, SalonListItemDto } from '@barbercue/shared';

const hajipur = { id: 'city-1', name: 'Hajipur', slug: 'hajipur', countryCode: 'IN' } as CityDto;
const citySearch = apiFetch as jest.Mock;
const geo = Location.reverseGeocodeAsync as jest.Mock;
const salon = (id: string, lat: number | null, lng: number | null) => ({ id, lat, lng } as SalonListItemDto);

beforeEach(() => {
  jest.clearAllMocks();
  __resetCityFallbackCacheForTests();
});

test('resolves a reverse-geocoded city against canonical city records', async () => {
  geo.mockResolvedValue([{ city: 'Hajipur', isoCountryCode: 'IN' }]);
  citySearch.mockResolvedValue([hajipur, { ...hajipur, id: 'other', name: 'Patna', slug: 'patna' }]);
  await expect(findCityForDeviceLocation({ lat: 25.69, lng: 85.22 })).resolves.toEqual(hajipur);
  await findCityForDeviceLocation({ lat: 25.69, lng: 85.22 });
  expect(citySearch).toHaveBeenCalledTimes(1);
});

test('accepts an exact canonical city subregion and rejects state, country, or ambiguous matches', async () => {
  geo.mockResolvedValue([{ city: null, subregion: 'Hajipur', isoCountryCode: 'IN' }]);
  citySearch.mockResolvedValue([hajipur]);
  await expect(findCityForDeviceLocation({ lat: 25.69, lng: 85.22 })).resolves.toEqual(hajipur);

  geo.mockResolvedValue([{ city: null, region: 'Bihar' }]);
  await expect(findCityForDeviceLocation({ lat: 25.59, lng: 85.12 })).resolves.toBeNull();
  geo.mockResolvedValue([{ city: 'Hajipur', isoCountryCode: 'US' }]);
  await expect(findCityForDeviceLocation({ lat: 25.49, lng: 85.12 })).resolves.toBeNull();
  geo.mockResolvedValue([{ city: 'Hajipur', isoCountryCode: 'IN' }]);
  citySearch.mockResolvedValue([hajipur, { ...hajipur, id: 'duplicate' }]);
  await expect(findCityForDeviceLocation({ lat: 25.39, lng: 85.12 })).resolves.toBeNull();
});

test('city fallback drops location/radius sorting but retains business filters', () => {
  const query = buildCityFallbackQuery(
    'lat=25.69&lng=85.22&radiusKm=1&service=hair&sort=distance&openNow=true&salonType=UNISEX',
    hajipur,
  );
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

test('keeps GPS results first and assigns real distance or null without duplicate salons', () => {
  const located = [salon('nearby', 25.68, 85.21)];
  const city = [salon('nearby', 25.68, 85.21), salon('unknown', null, null), salon('pinned', 25.5, 85.1)];
  const result = appendCityMatchesToNearby(located, city, { lat: 25.69, lng: 85.22 });
  expect(result.map((shop) => shop.id)).toEqual(['nearby', 'unknown', 'pinned']);
  expect(result[1].distanceKm).toBeNull();
  expect(result[2].distanceKm).toBeGreaterThan(0);
  expect(result[0]).toBe(located[0]);
});

test('uses fresh GPS for radius search and never falls back to cached coordinates', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: 25.69, longitude: 85.22 } });
  await expect(getSearchGpsCoordinates(false)).resolves.toEqual({ kind: 'ok', coords: { lat: 25.69, lng: 85.22 } });
  expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
});

test('unrestricted nearby search accepts only a recent cached fix if current GPS fails', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValue(new Error('GPS unavailable'));
  (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: 25.69, longitude: 85.22 } });
  await expect(getSearchGpsCoordinates(true)).resolves.toEqual({ kind: 'ok', coords: { lat: 25.69, lng: 85.22 } });
  expect(Location.getLastKnownPositionAsync).toHaveBeenCalledWith({ maxAge: 120_000, requiredAccuracy: 1_000 });
  await expect(getSearchGpsCoordinates(false)).resolves.toEqual({ kind: 'unavailable' });
});

test('permission denial returns without reading GPS', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  await expect(getSearchGpsCoordinates(true)).resolves.toEqual({ kind: 'denied' });
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
});
