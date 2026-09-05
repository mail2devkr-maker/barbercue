jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

import * as Location from 'expo-location';
import { resolveHomeLocation, __resetHomeLocationCacheForTests } from '../home-location';

const getPermMock = Location.getForegroundPermissionsAsync as jest.Mock;
const requestPermMock = Location.requestForegroundPermissionsAsync as jest.Mock;
const lastKnownMock = Location.getLastKnownPositionAsync as jest.Mock;
const currentPosMock = Location.getCurrentPositionAsync as jest.Mock;
const reverseGeocodeMock = Location.reverseGeocodeAsync as jest.Mock;

const SAMPLE_POSITION = { coords: { latitude: 12.9716, longitude: 77.5946 } };

describe('resolveHomeLocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetHomeLocationCacheForTests();
  });

  it('never prompts when promptIfNeeded is false — an already-granted permission resolves a real city', async () => {
    getPermMock.mockResolvedValue({ status: 'granted' });
    lastKnownMock.mockResolvedValue(SAMPLE_POSITION);
    reverseGeocodeMock.mockResolvedValue([{ city: 'Bengaluru', subregion: null, region: 'Karnataka' }]);

    const result = await resolveHomeLocation(false);

    expect(requestPermMock).not.toHaveBeenCalled();
    expect(result).toEqual({ label: 'Bengaluru', coords: { lat: 12.9716, lng: 77.5946 } });
  });

  it('never prompts when promptIfNeeded is false and permission was never granted — resolves null, not a guess', async () => {
    getPermMock.mockResolvedValue({ status: 'undetermined' });

    const result = await resolveHomeLocation(false);

    expect(requestPermMock).not.toHaveBeenCalled();
    expect(currentPosMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('promptIfNeeded true requests permission; a denial resolves null rather than a fabricated city', async () => {
    requestPermMock.mockResolvedValue({ status: 'denied' });

    const result = await resolveHomeLocation(true);

    expect(requestPermMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it('falls back to subregion, then region, when reverseGeocodeAsync has no city — never Bengaluru/Dallas hard-coded', async () => {
    getPermMock.mockResolvedValue({ status: 'granted' });
    lastKnownMock.mockResolvedValue(SAMPLE_POSITION);
    reverseGeocodeMock.mockResolvedValue([{ city: null, subregion: 'North County', region: 'Some State' }]);

    const result = await resolveHomeLocation(false);

    expect(result?.label).toBe('North County');
  });

  it('caches the resolved location — a second call makes no further native calls at all', async () => {
    getPermMock.mockResolvedValue({ status: 'granted' });
    lastKnownMock.mockResolvedValue(SAMPLE_POSITION);
    reverseGeocodeMock.mockResolvedValue([{ city: 'Hajipur', subregion: null, region: null }]);

    const first = await resolveHomeLocation(false);
    const second = await resolveHomeLocation(false);

    expect(first).toEqual(second);
    expect(getPermMock).toHaveBeenCalledTimes(1);
    expect(reverseGeocodeMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to getCurrentPositionAsync when there is no last-known position', async () => {
    getPermMock.mockResolvedValue({ status: 'granted' });
    lastKnownMock.mockResolvedValue(null);
    currentPosMock.mockResolvedValue(SAMPLE_POSITION);
    reverseGeocodeMock.mockResolvedValue([{ city: 'Patna', subregion: null, region: null }]);

    const result = await resolveHomeLocation(false);

    expect(currentPosMock).toHaveBeenCalledTimes(1);
    expect(result?.label).toBe('Patna');
  });
});
