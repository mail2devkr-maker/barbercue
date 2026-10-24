/// <reference types="jest" />

// The first test in a file pays for loading React Native and the screen cold; under a loaded CI/parallel
// run that can exceed jest's 5s default, so give these render tests a realistic ceiling.
jest.setTimeout(30_000);
import { act, createElement } from 'react';
import { uiStringsFor } from '@barbercue/shared';
import { DELHI, HAJIPUR, LONDON_CA, LONDON_GB, PATNA } from '../../../lib/location/__fixtures__/cities';
import { advance, allText, byTestId, byTestIdPrefix, flush, has, press, render, type as typeText } from '../../../lib/location/__fixtures__/render';

const mockStore = new Map<string, string>();
jest.mock('../../../lib/secure-storage', () => ({
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
}));

let mockLanguage: 'EN' | 'HI' = 'EN';
jest.mock('../../../lib/language-context', () => {
  const { uiStringsFor: strings } = require('@barbercue/shared');
  return { useLanguage: () => ({ language: mockLanguage, t: strings(mockLanguage) }) };
});

jest.mock('../../../lib/location/device-location', () => ({
  detectDeviceLocation: jest.fn(),
  readLastKnownDeviceCoords: jest.fn(),
  openLocationSettings: jest.fn(),
}));

jest.mock('../../../lib/location/city-api', () => ({
  CITY_SEARCH_MIN_LENGTH: 2,
  CitySearchError: class CitySearchError extends Error {
    readonly kind: string;
    constructor(kind: string) {
      super(kind);
      this.kind = kind;
    }
  },
  cachedAvailableCities: jest.fn(() => null),
  fetchAvailableCities: jest.fn(),
  searchCities: jest.fn(),
}));

import { LocationSelectorHost } from '../LocationSelectorModal';
import { LocationProvider, useLocationSelection, type LocationContextValue } from '../../../lib/location/location-context';
import { detectDeviceLocation, openLocationSettings } from '../../../lib/location/device-location';
import { CitySearchError, fetchAvailableCities, searchCities } from '../../../lib/location/city-api';

// The search API now answers with an outcome, never a bare list.
const found = (cities: unknown[], activeShopKeys: Set<string> | null = null) => ({ cities, mode: activeShopKeys ? 'legacy' : 'server', activeShopKeys });

const detectMock = detectDeviceLocation as jest.Mock;
const settingsMock = openLocationSettings as jest.Mock;
const availableMock = fetchAvailableCities as jest.Mock;
const searchMock = searchCities as jest.Mock;

let ctx!: LocationContextValue;
function Probe() {
  ctx = useLocationSelection();
  return null;
}
const mount = () => render(createElement(LocationProvider, null, createElement(Probe), createElement(LocationSelectorHost)));
const open = async () => {
  await act(async () => ctx.openSelector());
  await flush();
};
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  jest.useFakeTimers();
  mockStore.clear();
  mockLanguage = 'EN';
  jest.clearAllMocks();
  availableMock.mockResolvedValue([DELHI, HAJIPUR, PATNA]);
  searchMock.mockResolvedValue(found([]));
});
afterEach(() => {
  jest.useRealTimers();
});

describe('opening the selector', () => {
  it('is closed until the pill asks for it, and opening it never starts GPS', async () => {
    const r = await mount();
    await flush();
    expect(has(r, 'location-search-input')).toBe(false);
    await open();
    expect(has(r, 'location-search-input')).toBe(true);
    expect(has(r, 'use-current-location')).toBe(true);
    expect(detectMock).not.toHaveBeenCalled();
  });

  it('lists available cities from the backend (not hard-coded) and fetches them on open', async () => {
    const r = await mount();
    await open();
    expect(availableMock).toHaveBeenCalled();
    expect([...new Set(byTestIdPrefix(r, 'city-row-').map((n) => n.props.testID))]).toEqual(['city-row-IN:delhi', 'city-row-IN:hajipur', 'city-row-IN:patna']);
  });

  it('shows a loading state, then an error with retry that works', async () => {
    const pending = deferred<never>();
    availableMock.mockReturnValueOnce(pending.promise);
    const r = await mount();
    await open();
    expect(has(r, 'available-loading')).toBe(true);
    await act(async () => {
      pending.reject(new Error('offline'));
    });
    await flush();
    expect(has(r, 'available-error')).toBe(true);
    // The search box and the GPS option stay usable even when the city list failed.
    expect(has(r, 'location-search-input')).toBe(true);
    expect(has(r, 'use-current-location')).toBe(true);
  });

  it('picking a city selects it without any GPS and closes the selector', async () => {
    const r = await mount();
    await open();
    await press(r, 'city-row-IN:hajipur');
    expect(ctx.selection).toMatchObject({ mode: 'city', city: { slug: 'hajipur' } });
    expect(ctx.selectorOpen).toBe(false);
    expect(detectMock).not.toHaveBeenCalled();
    expect(has(r, 'location-search-input')).toBe(false);
  });

  it('shows Currently Selected and Recently Selected, and marks the selected row', async () => {
    const r = await mount();
    await open();
    await press(r, 'city-row-IN:patna');
    await open();
    expect(has(r, 'current-selection')).toBe(true);
    const text = allText(r);
    expect(text).toContain(uiStringsFor('EN').locationCurrentlySelected);
    expect(text).toContain(uiStringsFor('EN').locationRecentlySelected);
    const rows = byTestId(r, 'city-row-IN:patna');
    expect(rows.some((row) => row.props.accessibilityState?.selected === true)).toBe(true);
  });

  it('the close button closes it and keeps the existing selection', async () => {
    const r = await mount();
    await open();
    await press(r, 'city-row-IN:patna');
    await open();
    await press(r, 'location-selector-close');
    expect(ctx.selectorOpen).toBe(false);
    expect(ctx.selection).toMatchObject({ city: { slug: 'patna' } });
  });
});

describe('searching cities', () => {
  it('debounces: nothing is requested while typing, one request after the pause', async () => {
    const r = await mount();
    await open();
    searchMock.mockResolvedValue(found([HAJIPUR]));
    await typeText(r, 'location-search-input', 'h');
    await typeText(r, 'location-search-input', 'ha');
    await typeText(r, 'location-search-input', 'haj');
    await advance(250);
    expect(searchMock).not.toHaveBeenCalled();
    await advance(100);
    await flush();
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith('haj');
  });

  it('a one-letter query does not call the backend', async () => {
    const r = await mount();
    await open();
    await typeText(r, 'location-search-input', 'h');
    await advance(500);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('shows backend results with region and country, case-insensitively', async () => {
    searchMock.mockResolvedValue(found([HAJIPUR]));
    const r = await mount();
    await open();
    await typeText(r, 'location-search-input', 'HAJIPUR');
    await advance(350);
    await flush();
    expect(searchMock).toHaveBeenCalledWith('HAJIPUR');
    expect(has(r, 'city-row-IN:hajipur')).toBe(true);
    expect(allText(r)).toContain('Bihar, India');
  });

  it('distinguishes duplicate city names across countries and selects the right one', async () => {
    searchMock.mockResolvedValue(found([LONDON_GB, LONDON_CA]));
    const r = await mount();
    await open();
    await typeText(r, 'location-search-input', 'london');
    await advance(350);
    await flush();
    expect(has(r, 'city-row-GB:london')).toBe(true);
    expect(has(r, 'city-row-CA:london')).toBe(true);
    const text = allText(r);
    expect(text).toContain('England, United Kingdom');
    expect(text).toContain('Ontario, Canada');
    await press(r, 'city-row-CA:london');
    expect(ctx.selection).toMatchObject({ mode: 'city', city: { id: 'city-london-ca', countryCode: 'CA' } });
  });

  it('a slow response for an old query can never replace the newer results (stale protection)', async () => {
    const slow = deferred<unknown>();
    searchMock.mockImplementation((q: string) => (q === 'haj' ? slow.promise : Promise.resolve(found([PATNA]))));
    const r = await mount();
    await open();
    await typeText(r, 'location-search-input', 'haj');
    await advance(350);
    await typeText(r, 'location-search-input', 'patna');
    await advance(350);
    await flush();
    expect(has(r, 'city-row-IN:patna')).toBe(true);
    await act(async () => {
      slow.resolve(found([HAJIPUR]));
    });
    await flush();
    expect(has(r, 'city-row-IN:hajipur')).toBe(false);
    expect(has(r, 'city-row-IN:patna')).toBe(true);
  });

  it('shows a friendly empty state when nothing matches', async () => {
    searchMock.mockResolvedValue(found([]));
    const r = await mount();
    await open();
    await typeText(r, 'location-search-input', 'zzzzz');
    await advance(350);
    await flush();
    expect(has(r, 'no-cities')).toBe(true);
    expect(allText(r)).toContain(uiStringsFor('EN').locationNoCitiesFound);
    expect(has(r, 'use-current-location')).toBe(true);
  });

  it('a network failure says so (not "no cities found"), keeps local matches and offers Retry that works', async () => {
    searchMock.mockRejectedValueOnce(new CitySearchError('NETWORK_ERROR'));
    const r = await mount();
    await open();
    await typeText(r, 'location-search-input', 'pat');
    await advance(350);
    await flush();
    expect(has(r, 'city-row-IN:patna')).toBe(true);
    expect(has(r, 'search-failed-NETWORK_ERROR')).toBe(true);
    expect(allText(r)).toContain(uiStringsFor('EN').locationSearchNetworkError);
    expect(has(r, 'no-cities')).toBe(false);
    searchMock.mockResolvedValue(found([PATNA]));
    await press(r, 'search-retry');
    await advance(350);
    await flush();
    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(has(r, 'search-failed-NETWORK_ERROR')).toBe(false);
  });

  it('an unsupported backend is reported as such (no Retry), with local matches and never "no cities found"', async () => {
    searchMock.mockRejectedValue(new CitySearchError('BACKEND_UNSUPPORTED'));
    const r = await mount();
    await open();
    await typeText(r, 'location-search-input', 'pat');
    await advance(350);
    await flush();
    expect(has(r, 'search-failed-BACKEND_UNSUPPORTED')).toBe(true);
    expect(allText(r)).toContain(uiStringsFor('EN').locationSearchUnsupported);
    expect(has(r, 'search-retry')).toBe(false);
    expect(has(r, 'no-cities')).toBe(false);
    expect(has(r, 'city-row-IN:patna')).toBe(true);
  });

  it('against an older backend a real city with no active shop is shown and tagged, and can still be chosen', async () => {
    searchMock.mockResolvedValue(found([HAJIPUR, PATNA], new Set(['IN:hajipur'])));
    const r = await mount();
    await open();
    await typeText(r, 'location-search-input', 'pa');
    await advance(350);
    await flush();
    expect(has(r, 'no-shops-IN:patna')).toBe(true);
    expect(has(r, 'no-shops-IN:hajipur')).toBe(false);
    expect(allText(r)).toContain(uiStringsFor('EN').locationCityNoShops);
    await press(r, 'city-row-IN:patna');
    expect(ctx.selection).toMatchObject({ mode: 'city', city: { slug: 'patna' } });
  });

  it('clearing the box returns to the full list', async () => {
    searchMock.mockResolvedValue(found([HAJIPUR]));
    const r = await mount();
    await open();
    await typeText(r, 'location-search-input', 'haj');
    await advance(350);
    await flush();
    await press(r, 'location-search-clear');
    expect(has(r, 'city-row-IN:delhi')).toBe(true);
    expect(has(r, 'location-search-clear')).toBe(false);
  });
});

describe('Use My Current Location', () => {
  it('is the only thing that starts GPS, and success selects a device location', async () => {
    detectMock.mockResolvedValue({ ok: true, coords: { lat: 25.5941, lng: 85.1376 }, label: 'Patna' });
    const r = await mount();
    await open();
    expect(detectMock).not.toHaveBeenCalled();
    await press(r, 'use-current-location');
    await flush();
    expect(detectMock).toHaveBeenCalledTimes(1);
    expect(ctx.selection).toMatchObject({ mode: 'device', label: 'Patna' });
    expect(ctx.selectorOpen).toBe(false);
  });

  it('shows detecting state with a cancel, and cancelling restores the selector with the selection untouched', async () => {
    detectMock.mockReturnValue(new Promise(() => {}));
    const r = await mount();
    await open();
    await press(r, 'city-row-IN:hajipur');
    await open();
    await press(r, 'use-current-location');
    expect(allText(r)).toContain(uiStringsFor('EN').locationDetectingGps);
    expect(has(r, 'cancel-gps')).toBe(true);
    await press(r, 'cancel-gps');
    expect(has(r, 'cancel-gps')).toBe(false);
    expect(ctx.selection).toMatchObject({ mode: 'city', city: { slug: 'hajipur' } });
  });

  it('permission denied: clear message with Retry, selection kept, manual search still works', async () => {
    detectMock.mockResolvedValue({ ok: false, reason: 'denied' });
    const r = await mount();
    await open();
    await press(r, 'city-row-IN:hajipur');
    await open();
    await press(r, 'use-current-location');
    await flush();
    expect(has(r, 'gps-error')).toBe(true);
    expect(allText(r)).toContain(uiStringsFor('EN').gpsPermissionDenied);
    expect(has(r, 'gps-retry')).toBe(true);
    expect(ctx.selection).toMatchObject({ mode: 'city', city: { slug: 'hajipur' } });
    searchMock.mockResolvedValue(found([PATNA]));
    await typeText(r, 'location-search-input', 'patna');
    await advance(350);
    await flush();
    await press(r, 'city-row-IN:patna');
    expect(ctx.selection).toMatchObject({ mode: 'city', city: { slug: 'patna' } });
  });

  it('permanently denied: offers Open Settings', async () => {
    detectMock.mockResolvedValue({ ok: false, reason: 'blocked' });
    const r = await mount();
    await open();
    await press(r, 'use-current-location');
    await flush();
    expect(allText(r)).toContain(uiStringsFor('EN').gpsPermissionBlocked);
    await press(r, 'gps-open-settings');
    expect(settingsMock).toHaveBeenCalledWith('blocked');
  });

  it('GPS switched off: explains and offers the location settings', async () => {
    detectMock.mockResolvedValue({ ok: false, reason: 'services_off' });
    const r = await mount();
    await open();
    await press(r, 'use-current-location');
    await flush();
    expect(allText(r)).toContain(uiStringsFor('EN').gpsServicesOff);
    await press(r, 'gps-open-settings');
    expect(settingsMock).toHaveBeenCalledWith('services_off');
  });

  it('timeout: the screen is not stuck on "Detecting…" and Retry works', async () => {
    detectMock.mockResolvedValueOnce({ ok: false, reason: 'timeout' });
    const r = await mount();
    await open();
    await press(r, 'use-current-location');
    await flush();
    expect(allText(r)).toContain(uiStringsFor('EN').gpsTimedOut);
    expect(allText(r)).not.toContain(uiStringsFor('EN').locationDetectingGps);
    detectMock.mockResolvedValueOnce({ ok: true, coords: { lat: 25.5, lng: 85.1 }, label: null });
    await press(r, 'gps-retry');
    await flush();
    expect(ctx.selection?.mode).toBe('device');
  });
});

describe('Hindi and English', () => {
  it('renders the selector in Hindi', async () => {
    mockLanguage = 'HI';
    const r = await mount();
    await open();
    const hi = uiStringsFor('HI');
    const text = allText(r);
    expect(text).toContain(hi.locationSelectorTitle);
    expect(text).toContain(hi.useMyCurrentLocation);
    expect(hi.useMyCurrentLocation).not.toBe(uiStringsFor('EN').useMyCurrentLocation);
    expect(byTestId(r, 'location-search-input')[0].props.placeholder).toBe(hi.locationSearchPlaceholder);
  });

  it('renders the selector in English', async () => {
    const r = await mount();
    await open();
    expect(allText(r)).toContain(uiStringsFor('EN').useMyCurrentLocation);
  });
});
