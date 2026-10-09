/// <reference types="jest" />
import { act, createElement } from 'react';
import { FlatList } from 'react-native';
import { uiStringsFor } from '@barbercue/shared';
import { DELHI, HAJIPUR, NO_CENTRE_CITY, PATNA, shop } from '../../lib/location/__fixtures__/cities';
import { allText, byTestId, flush, has, press, render } from '../../lib/location/__fixtures__/render';

const mockStore = new Map<string, string>();
jest.mock('../../lib/secure-storage', () => ({
  getItem: jest.fn(async (key: string) => (mockStore.has(key) ? mockStore.get(key)! : null)),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));

jest.mock('expo-location', () => ({
  hasServicesEnabledAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

jest.mock('../../lib/language-context', () => {
  const { uiStringsFor: strings } = require('@barbercue/shared');
  return { useLanguage: () => ({ language: 'EN', t: strings('EN') }) };
});

jest.mock('../../lib/api', () => {
  class MockApiError extends Error {}
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

import * as Location from 'expo-location';
import { apiFetch } from '../../lib/api';
import { FilterDropdown } from '../../components/ui';
import { LocationProvider, useLocationSelection, LOCATION_SELECTION_STORAGE_KEY, type LocationContextValue } from '../../lib/location/location-context';
import { serializeSelection, type SelectedLocation } from '../../lib/location/selection';
import SalonSearchScreen from '../SalonSearchScreen';

const apiMock = apiFetch as jest.Mock;
const t = uiStringsFor('EN');

let ctx!: LocationContextValue;
function Probe() {
  ctx = useLocationSelection();
  return null;
}

const navigation = { navigate: jest.fn() };
const route = { key: 'k', name: 'SalonSearch', params: undefined };

const mount = () =>
  render(
    createElement(
      LocationProvider,
      null,
      createElement(Probe),
      createElement(SalonSearchScreen as never, { navigation, route } as never),
    ),
  );

function seed(selection: SelectedLocation | null) {
  if (selection) mockStore.set(LOCATION_SELECTION_STORAGE_KEY, serializeSelection(selection));
}
const cityChoice = (city = HAJIPUR): SelectedLocation => ({ mode: 'city', city, selectedAt: 1 });
const deviceChoice: SelectedLocation = { mode: 'device', coords: { lat: 25.5941, lng: 85.1376 }, label: 'Patna', capturedAt: 2 };

const page = (items: ReturnType<typeof shop>[], nextCursor: string | null = null) => ({ items, nextCursor });
const salonCalls = () =>
  apiMock.mock.calls
    .map(([path]) => String(path))
    .filter((path) => path.startsWith('salons?') || path === 'salons');
const lastSalonParams = () => {
  const calls = salonCalls();
  const url = calls[calls.length - 1];
  return Object.fromEntries(new URLSearchParams(url.split('?')[1] ?? '').entries());
};

const NEAR = shop({ id: 'near', name: 'Near Salon', lat: 25.69, lng: 85.21, distanceKm: 0.5 });
const MID = shop({ id: 'mid', name: 'Mid Salon', lat: 25.7, lng: 85.25, distanceKm: 2.5 });
const NO_COORDS = shop({ id: 'nocoords', name: 'No Coords Salon' });

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  apiMock.mockImplementation(async (path: string) => {
    if (String(path).includes('service-suggestions')) return [];
    return page([NEAR, MID, NO_COORDS]);
  });
});

describe('Search screen: no location chosen yet', () => {
  it('asks the customer to choose one, loads nothing, and opens the selector (never GPS) from the prompt', async () => {
    const r = await mount();
    await flush();
    expect(salonCalls()).toHaveLength(0);
    expect(allText(r)).toContain(t.searchChooseLocationTitle);
    await press(r, 'search-location-bar');
    expect(ctx.selectorOpen).toBe(true);
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('picking a distance radius without a location sends the customer to choose one — no GPS, no request', async () => {
    const r = await mount();
    await flush();
    const dropdown = r.root.findAll((n: { type: unknown; props: Record<string, unknown> }) => n.type === FilterDropdown && n.props.label === t.distanceFilterLabel)[0];
    await act(async () => dropdown.props.onSelect('2'));
    expect(ctx.selectorOpen).toBe(true);
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(salonCalls()).toHaveLength(0);
  });
});

describe('Search screen: manual city mode (no GPS)', () => {
  it('shows every shop in the city; distance is measured from the city centre and never called "from you"', async () => {
    seed(cityChoice());
    const r = await mount();
    await flush(6);
    expect(lastSalonParams()).toMatchObject({ city: 'hajipur', countryCode: 'IN', originLat: '25.6853', originLng: '85.209', sort: 'nearest' });
    const params = lastSalonParams();
    expect(params).not.toHaveProperty('radiusKm');
    expect(params).not.toHaveProperty('lat');
    const text = allText(r);
    expect(text).toContain('Near Salon');
    expect(text).toContain('Mid Salon');
    expect(text).toContain('500 m from Hajipur centre');
    expect(text).toContain('2.5 km from Hajipur centre');
    expect(text).not.toMatch(/bfrom youb/i);
    expect(text).toContain(t.distanceFromCityCentreNote);
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('keeps a shop with missing coordinates visible with "Distance unavailable" (never 0, never hidden)', async () => {
    seed(cityChoice());
    const r = await mount();
    await flush(6);
    expect(allText(r)).toContain('No Coords Salon');
    expect(allText(r)).toContain(t.distanceUnavailable);
  });

  it('a city with no stored centre is still browsable: no origin params, every shop "Distance unavailable"', async () => {
    seed(cityChoice(NO_CENTRE_CITY));
    const r = await mount();
    await flush(6);
    const params = lastSalonParams();
    expect(params).toMatchObject({ city: 'smallville', countryCode: 'IN' });
    expect(params).not.toHaveProperty('originLat');
    expect(params).not.toHaveProperty('sort');
    expect(allText(r)).toContain('Near Salon');
    expect(allText(r)).not.toContain('from Smallville centre');
    expect(allText(r)).not.toContain(t.distanceFromCityCentreNote);
  });

  it('an explicit radius is sent only after the customer picks one', async () => {
    seed(cityChoice());
    const r = await mount();
    await flush(6);
    expect(lastSalonParams()).not.toHaveProperty('radiusKm');
    const dropdown = r.root.findAll((n: { type: unknown; props: Record<string, unknown> }) => n.type === FilterDropdown && n.props.label === t.distanceFilterLabel)[0];
    await act(async () => dropdown.props.onSelect('5'));
    await flush(4);
    expect(lastSalonParams()).toMatchObject({ radiusKm: '5', city: 'hajipur' });
    await act(async () => dropdown.props.onSelect('any'));
    await flush(4);
    expect(lastSalonParams()).not.toHaveProperty('radiusKm');
  });

  it('Name A–Z drops sort=nearest but keeps distances', async () => {
    seed(cityChoice());
    const r = await mount();
    await flush(6);
    await press(r, 'sort-name');
    await flush(4);
    const params = lastSalonParams();
    expect(params).not.toHaveProperty('sort');
    expect(params).toHaveProperty('originLat');
    await press(r, 'sort-nearest');
    await flush(4);
    expect(lastSalonParams()).toMatchObject({ sort: 'nearest' });
  });

  it('changing the city reloads for the new city (Hajipur -> Patna)', async () => {
    seed(cityChoice());
    await mount();
    await flush(6);
    await act(async () => ctx.selectCity(PATNA));
    await flush(6);
    expect(lastSalonParams()).toMatchObject({ city: 'patna', originLat: '25.5941' });
  });

  it('a slow response for the previous city can never overwrite the newly chosen city (stale protection)', async () => {
    seed(cityChoice());
    let releaseOld!: (value: unknown) => void;
    const OLD = shop({ id: 'old', name: 'Old Hajipur Shop', distanceKm: 1 });
    const FRESH = shop({ id: 'fresh', name: 'Fresh Patna Shop', distanceKm: 1 });
    apiMock.mockImplementation((path: string) => {
      if (String(path).includes('service-suggestions')) return Promise.resolve([]);
      if (String(path).includes('city=hajipur')) return new Promise((resolve) => (releaseOld = resolve));
      return Promise.resolve(page([FRESH]));
    });
    const r = await mount();
    await flush(6);
    await act(async () => ctx.selectCity(PATNA));
    await flush(6);
    expect(allText(r)).toContain('Fresh Patna Shop');
    await act(async () => releaseOld(page([OLD])));
    await flush(4);
    expect(allText(r)).toContain('Fresh Patna Shop');
    expect(allText(r)).not.toContain('Old Hajipur Shop');
  });
});

describe('Search screen: current location mode', () => {
  it('uses the GPS fix as the origin with no city filter and NO automatic radius; wording is "from you"', async () => {
    seed(deviceChoice);
    const r = await mount();
    await flush(6);
    const params = lastSalonParams();
    expect(params).toMatchObject({ originLat: '25.5941', originLng: '85.1376', sort: 'nearest' });
    expect(params).not.toHaveProperty('city');
    expect(params).not.toHaveProperty('radiusKm');
    expect(params).not.toHaveProperty('lat');
    const text = allText(r);
    expect(text).toContain('500 m from you');
    expect(text).toContain('2.5 km from you');
    expect(text).not.toContain('centre');
    expect(text).toContain('No Coords Salon');
    // The customer's own position is not a city centre, so no "measured from the centre" note.
    expect(text).not.toContain(t.distanceFromCityCentreNote);
  });

  it('respects an explicit user radius', async () => {
    seed(deviceChoice);
    const r = await mount();
    await flush(6);
    const dropdown = r.root.findAll((n: { type: unknown; props: Record<string, unknown> }) => n.type === FilterDropdown && n.props.label === t.distanceFilterLabel)[0];
    await act(async () => dropdown.props.onSelect('3'));
    await flush(4);
    expect(lastSalonParams()).toMatchObject({ radiusKm: '3' });
  });

  it('switching from a manual city to current location replaces the city filter with the GPS origin', async () => {
    seed(cityChoice());
    await mount();
    await flush(6);
    await act(async () => ctx.selectCity(DELHI));
    await flush(6);
    expect(lastSalonParams()).toMatchObject({ city: 'delhi' });
    const detect = jest.requireMock('expo-location');
    expect(detect.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
});

describe('Search screen: pagination, errors and older backends', () => {
  it('loads the next page with the same query and cursor, appends it, and never duplicates a shop', async () => {
    seed(cityChoice());
    const A = shop({ id: 'a', name: 'Alpha', distanceKm: 1 });
    const B = shop({ id: 'b', name: 'Bravo', distanceKm: 2 });
    const C = shop({ id: 'c', name: 'Charlie', distanceKm: 3 });
    apiMock.mockImplementation(async (path: string) => {
      if (String(path).includes('service-suggestions')) return [];
      if (String(path).includes('cursor=c1')) return page([B, C], null);
      return page([A, B], 'c1');
    });
    const r = await mount();
    await flush(6);
    expect(allText(r)).not.toContain('Charlie');
    await act(async () => r.root.findByType(FlatList).props.onEndReached());
    await flush(4);
    expect(lastSalonParams()).toMatchObject({ cursor: 'c1', city: 'hajipur', sort: 'nearest' });
    const text = allText(r);
    expect(text).toContain('Charlie');
    expect(text.match(/Bravo/g)).toHaveLength(1);
    // No further page: another end-reached does nothing.
    const before = salonCalls().length;
    await act(async () => r.root.findByType(FlatList).props.onEndReached());
    await flush(4);
    expect(salonCalls().length).toBe(before);
  });

  it('a failed "load more" shows a retry footer and keeps the shops already loaded', async () => {
    seed(cityChoice());
    let fail = true;
    apiMock.mockImplementation(async (path: string) => {
      if (String(path).includes('service-suggestions')) return [];
      if (String(path).includes('cursor=c1')) {
        if (fail) throw new Error('network');
        return page([shop({ id: 'z', name: 'Zulu', distanceKm: 9 })], null);
      }
      return page([NEAR], 'c1');
    });
    const r = await mount();
    await flush(6);
    await act(async () => r.root.findByType(FlatList).props.onEndReached());
    await flush(4);
    expect(allText(r)).toContain(t.searchLoadMoreFailed);
    expect(allText(r)).toContain('Near Salon');
    fail = false;
    await act(async () => r.root.findByType(FlatList).props.onEndReached());
    await flush(4);
    expect(allText(r)).toContain('Zulu');
  });

  it('an older backend that ignores the origin (no distances) still gets nearest-first and honest labels from the shared Haversine', async () => {
    seed(cityChoice());
    const FAR = shop({ id: 'far', name: 'Far Salon', lat: 25.5941, lng: 85.1376 });
    const CLOSE = shop({ id: 'close', name: 'Close Salon', lat: 25.686, lng: 85.21 });
    apiMock.mockImplementation(async (path: string) => {
      if (String(path).includes('service-suggestions')) return [];
      return page([FAR, NO_COORDS, CLOSE]);
    });
    const r = await mount();
    await flush(6);
    const text = allText(r);
    expect(text.indexOf('Close Salon')).toBeLessThan(text.indexOf('Far Salon'));
    expect(text.indexOf('Far Salon')).toBeLessThan(text.indexOf('No Coords Salon'));
    expect(text).toMatch(/\d+(\.\d)? (km|m) from Hajipur centre/);
    expect(text).toContain(t.distanceUnavailable);
  });

  it('says plainly that the order covers only the loaded shops when the server did not measure distances', async () => {
    seed(cityChoice());
    apiMock.mockImplementation(async (path: string) => {
      if (String(path).includes('service-suggestions')) return [];
      return page([shop({ id: 'far', name: 'Far Salon', lat: 25.5941, lng: 85.1376 })]);
    });
    const r = await mount();
    await flush(6);
    expect(has(r, 'approximate-order-note')).toBe(true);
    expect(allText(r)).toContain(t.searchOrderLoadedOnlyNote);
  });

  it('does not show that caveat when the server measured the distances itself', async () => {
    seed(cityChoice());
    const r = await mount();
    await flush(6);
    expect(has(r, 'approximate-order-note')).toBe(false);
  });

  it('an explicit radius is still respected on an older backend that ignored it', async () => {
    seed(cityChoice());
    apiMock.mockImplementation(async (path: string) => {
      if (String(path).includes('service-suggestions')) return [];
      return page([
        shop({ id: 'close', name: 'Close Salon', lat: 25.686, lng: 85.21 }),
        shop({ id: 'far', name: 'Far Patna Salon', lat: 25.5941, lng: 85.1376 }),
      ]);
    });
    const r = await mount();
    await flush(6);
    expect(allText(r)).toContain('Far Patna Salon');
    const dropdown = r.root.findAll((n: { type: unknown; props: Record<string, unknown> }) => n.type === FilterDropdown && n.props.label === t.distanceFilterLabel)[0];
    await act(async () => dropdown.props.onSelect('5'));
    await flush(4);
    expect(allText(r)).toContain('Close Salon');
    expect(allText(r)).not.toContain('Far Patna Salon');
  });

  it('shows an empty state (and keeps the location bar) when the city has no shops', async () => {
    seed(cityChoice());
    apiMock.mockImplementation(async (path: string) => (String(path).includes('service-suggestions') ? [] : page([])));
    const r = await mount();
    await flush(6);
    expect(allText(r)).toContain(t.noSalonsFoundTitle);
    expect(has(r, 'search-location-bar')).toBe(true);
  });

  it('a failed search shows an error and never leaves the screen loading', async () => {
    seed(cityChoice());
    apiMock.mockImplementation(async (path: string) => {
      if (String(path).includes('service-suggestions')) return [];
      throw new Error('boom');
    });
    const r = await mount();
    await flush(6);
    expect(allText(r)).toContain(t.couldNotSearchSalons);
  });
});

describe('Search screen: persistence', () => {
  it('after an app restart the saved city is applied and its shops load without any GPS', async () => {
    const first = await mount();
    await flush();
    await act(async () => ctx.selectCity(HAJIPUR));
    await flush(6);
    await act(async () => first.unmount());
    apiMock.mockClear();
    await mount();
    await flush(6);
    expect(lastSalonParams()).toMatchObject({ city: 'hajipur' });
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('the location bar shows the chosen place and re-opens the selector', async () => {
    seed(cityChoice());
    const r = await mount();
    await flush(6);
    const bar = byTestId(r, 'search-location-bar')[0];
    expect(bar.props.accessibilityLabel).toContain('Hajipur');
    await press(r, 'search-location-bar');
    expect(ctx.selectorOpen).toBe(true);
  });
});
