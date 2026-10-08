/// <reference types="jest" />
import { act, createElement } from 'react';
import { uiStringsFor } from '@barbercue/shared';
import { HAJIPUR } from '../../lib/location/__fixtures__/cities';
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

jest.mock('@react-navigation/native', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) };
});

jest.mock('../../lib/language-context', () => {
  const { uiStringsFor: strings } = require('@barbercue/shared');
  return { useLanguage: () => ({ language: 'EN', setLanguage: jest.fn(), t: strings('EN') }) };
});
jest.mock('../../lib/auth-context', () => ({ useAuth: () => ({ status: 'unauthenticated', user: null }) }));
jest.mock('../../lib/notifications', () => ({ useUnreadNotificationCount: () => 0 }));
jest.mock('../../lib/api', () => ({
  apiFetch: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  ApiError: class extends Error {},
}));

import * as Location from 'expo-location';
import { LocationProvider, useLocationSelection, LOCATION_SELECTION_STORAGE_KEY, type LocationContextValue } from '../../lib/location/location-context';
import { serializeSelection } from '../../lib/location/selection';
import HomeScreen from '../HomeScreen';

const t = uiStringsFor('EN');
let ctx!: LocationContextValue;
function Probe() {
  ctx = useLocationSelection();
  return null;
}
const navigation = { navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) };

const mount = () =>
  render(createElement(LocationProvider, null, createElement(Probe), createElement(HomeScreen as never, { navigation, route: { key: 'k', name: 'Home' } } as never)));

const anyGpsCall = () =>
  [
    Location.hasServicesEnabledAsync,
    Location.getForegroundPermissionsAsync,
    Location.requestForegroundPermissionsAsync,
    Location.getCurrentPositionAsync,
    Location.getLastKnownPositionAsync,
    Location.reverseGeocodeAsync,
  ].some((fn) => (fn as jest.Mock).mock.calls.length > 0);

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('Home location pill (the bug in the physical-device video)', () => {
  it('tapping the pill opens the location selector — it does NOT start GPS', async () => {
    const r = await mount();
    await flush(4);
    const pillId = has(r, 'home-location-pill') ? 'home-location-pill' : 'home-location-pill-wide';
    expect(ctx.selectorOpen).toBe(false);
    await press(r, pillId);
    expect(ctx.selectorOpen).toBe(true);
    expect(anyGpsCall()).toBe(false);
  });

  it('tapping the City / Location field opens the same selector with no GPS', async () => {
    const r = await mount();
    await flush(4);
    await press(r, 'home-city-field');
    expect(ctx.selectorOpen).toBe(true);
    expect(anyGpsCall()).toBe(false);
  });

  it('mounting Home never touches GPS or permissions on its own', async () => {
    await mount();
    await flush(6);
    expect(anyGpsCall()).toBe(false);
    expect(ctx.selection).toBeNull();
  });

  it('shows "Choose location" until something is picked, then the selected city name', async () => {
    const r = await mount();
    await flush(4);
    expect(allText(r)).toContain(t.chooseLocationAction);
    await act(async () => ctx.selectCity(HAJIPUR));
    await flush(2);
    expect(allText(r)).toContain('Hajipur');
    expect(anyGpsCall()).toBe(false);
  });

  it('restores a saved city after restart and keeps it — focus never replaces it with a GPS guess', async () => {
    mockStore.set(LOCATION_SELECTION_STORAGE_KEY, serializeSelection({ mode: 'city', city: HAJIPUR, selectedAt: 1 }));
    const r = await mount();
    await flush(6);
    expect(allText(r)).toContain('Hajipur');
    expect(ctx.selection).toMatchObject({ mode: 'city', city: { slug: 'hajipur' } });
    expect(anyGpsCall()).toBe(false);
    expect(byTestId(r, 'home-city-field').length).toBeGreaterThan(0);
  });
});
