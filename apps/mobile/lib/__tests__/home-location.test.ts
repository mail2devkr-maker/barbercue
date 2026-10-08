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

  it('forceRefresh bypasses a cached city and resolves a fresh current position', async () => {
    getPermMock.mockResolvedValue({ status: 'granted' });
    requestPermMock.mockResolvedValue({ status: 'granted' });
    lastKnownMock.mockResolvedValue(SAMPLE_POSITION);
    reverseGeocodeMock
      .mockResolvedValueOnce([{ city: 'Hajipur', subregion: null, region: null }])
      .mockResolvedValueOnce([{ city: 'Patna', subregion: null, region: null }]);

    const first = await resolveHomeLocation(false);
    currentPosMock.mockResolvedValue({
      coords: { latitude: 25.5941, longitude: 85.1376 },
    });
    const refreshed = await resolveHomeLocation(true, true);

    expect(first?.label).toBe('Hajipur');
    expect(requestPermMock).toHaveBeenCalledTimes(1);
    expect(currentPosMock).toHaveBeenCalledTimes(1);
    expect(refreshed).toEqual({
      label: 'Patna',
      coords: { lat: 25.5941, lng: 85.1376 },
    });
  });

  it('forceRefresh prefers current position over a stale last-known position', async () => {
    requestPermMock.mockResolvedValue({ status: 'granted' });
    currentPosMock.mockResolvedValue({
      coords: { latitude: 25.5941, longitude: 85.1376 },
    });
    lastKnownMock.mockResolvedValue(SAMPLE_POSITION);
    reverseGeocodeMock.mockResolvedValue([{ city: 'Patna', subregion: null, region: null }]);

    const result = await resolveHomeLocation(true, true);

    expect(currentPosMock).toHaveBeenCalledTimes(1);
    expect(lastKnownMock).not.toHaveBeenCalled();
    expect(result?.label).toBe('Patna');
  });

  describe('a location lookup that never settles must not freeze the Home selector', () => {
    // Home disables both location controls while a lookup is pending (`disabled={locating}`), so a
    // getCurrentPositionAsync that never resolves (no GPS fix indoors, location services toggled
    // off mid-request) used to leave the pill and the City / Location field stuck on
    // "Detecting location". The lookup must always settle within a bounded time.
    const NEVER = () => new Promise<never>(() => {});
    const WELL_BEYOND_ANY_REASONABLE_GPS_WAIT_MS = 30_000;

    async function settleWithin(promise: Promise<unknown>, ms: number): Promise<'settled' | 'pending'> {
      let state: 'settled' | 'pending' = 'pending';
      promise.then(
        () => { state = 'settled'; },
        () => { state = 'settled'; },
      );
      await jest.advanceTimersByTimeAsync(ms);
      return state;
    }

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('an explicit refresh falls back to the last-known position when the fresh fix never arrives', async () => {
      requestPermMock.mockResolvedValue({ status: 'granted' });
      currentPosMock.mockImplementation(NEVER);
      lastKnownMock.mockResolvedValue(SAMPLE_POSITION);
      reverseGeocodeMock.mockResolvedValue([{ city: 'Bengaluru', subregion: null, region: null }]);

      const pending = resolveHomeLocation(true, true);
      expect(await settleWithin(pending, WELL_BEYOND_ANY_REASONABLE_GPS_WAIT_MS)).toBe('settled');
      await expect(pending).resolves.toEqual({ label: 'Bengaluru', coords: { lat: 12.9716, lng: 77.5946 } });
    });

    it('with no fix and no last-known position it resolves null so Home can show feedback instead of spinning', async () => {
      requestPermMock.mockResolvedValue({ status: 'granted' });
      currentPosMock.mockImplementation(NEVER);
      lastKnownMock.mockResolvedValue(null);

      const pending = resolveHomeLocation(true, true);
      expect(await settleWithin(pending, WELL_BEYOND_ANY_REASONABLE_GPS_WAIT_MS)).toBe('settled');
      await expect(pending).resolves.toBeNull();
    });

    it('a stuck passive lookup cannot block a later explicit tap forever', async () => {
      getPermMock.mockResolvedValue({ status: 'granted' });
      requestPermMock.mockResolvedValue({ status: 'granted' });
      lastKnownMock.mockResolvedValue(null);
      currentPosMock.mockImplementation(NEVER);

      const passive = resolveHomeLocation(false);
      const explicit = resolveHomeLocation(true, true);
      expect(await settleWithin(Promise.all([passive, explicit]), 2 * WELL_BEYOND_ANY_REASONABLE_GPS_WAIT_MS)).toBe('settled');
    });

    it('a geocoder that never answers also resolves instead of hanging', async () => {
      requestPermMock.mockResolvedValue({ status: 'granted' });
      currentPosMock.mockResolvedValue(SAMPLE_POSITION);
      reverseGeocodeMock.mockImplementation(NEVER);

      const pending = resolveHomeLocation(true, true);
      expect(await settleWithin(pending, WELL_BEYOND_ANY_REASONABLE_GPS_WAIT_MS)).toBe('settled');
      await expect(pending).resolves.toBeNull();
    });
  });

  it('refreshing twice in one session returns the second fresh fix, not the first', async () => {
    requestPermMock.mockResolvedValue({ status: 'granted' });
    currentPosMock
      .mockResolvedValueOnce({ coords: { latitude: 25.6, longitude: 85.2 } })
      .mockResolvedValueOnce({ coords: { latitude: 25.5941, longitude: 85.1376 } });
    reverseGeocodeMock
      .mockResolvedValueOnce([{ city: 'Hajipur', subregion: null, region: null }])
      .mockResolvedValueOnce([{ city: 'Patna', subregion: null, region: null }]);

    const first = await resolveHomeLocation(true, true);
    const second = await resolveHomeLocation(true, true);

    expect(first?.label).toBe('Hajipur');
    expect(second).toEqual({ label: 'Patna', coords: { lat: 25.5941, lng: 85.1376 } });
    expect(currentPosMock).toHaveBeenCalledTimes(2);
  });

  it('an explicit tap with permission denied resolves null and never touches the position APIs', async () => {
    requestPermMock.mockResolvedValue({ status: 'denied' });

    const result = await resolveHomeLocation(true, true);

    expect(result).toBeNull();
    expect(requestPermMock).toHaveBeenCalledTimes(1);
    expect(currentPosMock).not.toHaveBeenCalled();
    expect(lastKnownMock).not.toHaveBeenCalled();
  });
});
