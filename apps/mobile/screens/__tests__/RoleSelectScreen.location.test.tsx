/// <reference types="jest" />

// The first test in a file pays for loading React Native and the screen cold; under a loaded CI/parallel
// run that can exceed jest's 5s default, so give these render tests a realistic ceiling.
jest.setTimeout(30_000);
import { createElement } from 'react';
import { uiStringsFor } from '@barbercue/shared';
import { HAJIPUR } from '../../lib/location/__fixtures__/cities';
import { allText, flush, press, render } from '../../lib/location/__fixtures__/render';

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
  return { useLanguage: () => ({ language: 'EN', setLanguage: jest.fn(), t: strings('EN') }) };
});
jest.mock('../../lib/api', () => ({ apiFetch: jest.fn().mockResolvedValue([]), ApiError: class extends Error {} }));

import * as Location from 'expo-location';
import { LocationProvider, useLocationSelection, LOCATION_SELECTION_STORAGE_KEY, type LocationContextValue } from '../../lib/location/location-context';
import { serializeSelection } from '../../lib/location/selection';
import RoleSelectScreen from '../RoleSelectScreen';

const t = uiStringsFor('EN');
let ctx!: LocationContextValue;
function Probe() {
  ctx = useLocationSelection();
  return null;
}
const navigation = { navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) };
const mount = () =>
  render(createElement(LocationProvider, null, createElement(Probe), createElement(RoleSelectScreen as never, { navigation, route: { key: 'k', name: 'RoleSelect' } } as never)));
const anyGpsCall = () =>
  Object.values(Location as unknown as Record<string, unknown>).some((fn) => jest.isMockFunction(fn) && (fn as jest.Mock).mock.calls.length > 0);

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('Signed-out Home (RoleSelectScreen)', () => {
  it('the pill opens the selector and never starts GPS', async () => {
    const r = await mount();
    await flush(4);
    await press(r, 'signedout-location-pill');
    expect(ctx.selectorOpen).toBe(true);
    expect(anyGpsCall()).toBe(false);
  });

  it('the City / Location field opens the same selector with no GPS', async () => {
    const r = await mount();
    await flush(4);
    await press(r, 'signedout-city-field');
    expect(ctx.selectorOpen).toBe(true);
    expect(anyGpsCall()).toBe(false);
  });

  it('"View all" opens the dedicated All Services catalogue (not the generic shop search)', async () => {
    const r = await mount();
    await flush(4);
    await press(r, 'signedout-all-services');
    expect(navigation.navigate).toHaveBeenCalledWith('AllServices');
    expect(navigation.navigate).not.toHaveBeenCalledWith('GuestBrowse', expect.anything());
  });

  it('prompts to choose a location, then shows the restored city after restart — with no GPS', async () => {
    const first = await mount();
    await flush(4);
    expect(allText(first)).toContain(t.chooseLocationAction);
    mockStore.set(LOCATION_SELECTION_STORAGE_KEY, serializeSelection({ mode: 'city', city: HAJIPUR, selectedAt: 1 }));
    const second = await mount();
    await flush(6);
    expect(allText(second)).toContain('Hajipur');
    expect(anyGpsCall()).toBe(false);
  });
});
