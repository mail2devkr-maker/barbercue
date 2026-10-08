jest.mock('expo-location', () => ({
  hasServicesEnabledAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

import { Linking } from 'react-native';
import * as Location from 'expo-location';
import { LOCATION_FIX_TIMEOUT_MS, LOCATION_LAST_KNOWN_TIMEOUT_MS } from '../../home-location';
import { detectDeviceLocation, openLocationSettings, readLastKnownDeviceCoords } from '../device-location';

const servicesMock = Location.hasServicesEnabledAsync as jest.Mock;
const getPermMock = Location.getForegroundPermissionsAsync as jest.Mock;
const requestPermMock = Location.requestForegroundPermissionsAsync as jest.Mock;
const lastKnownMock = Location.getLastKnownPositionAsync as jest.Mock;
const currentPosMock = Location.getCurrentPositionAsync as jest.Mock;
const geocodeMock = Location.reverseGeocodeAsync as jest.Mock;

const PATNA_FIX = { coords: { latitude: 25.5941, longitude: 85.1376 } };
const never = () => new Promise(() => {});

beforeEach(() => {
  jest.resetAllMocks();
  servicesMock.mockResolvedValue(true);
  getPermMock.mockResolvedValue({ status: 'granted', canAskAgain: true });
  geocodeMock.mockResolvedValue([{ city: 'Patna', subregion: null, region: 'Bihar' }]);
});

describe('detectDeviceLocation', () => {
  it('success: real coordinates plus a city label', async () => {
    currentPosMock.mockResolvedValue(PATNA_FIX);
    await expect(detectDeviceLocation()).resolves.toEqual({ ok: true, coords: { lat: 25.5941, lng: 85.1376 }, label: 'Patna' });
  });

  it('success even if reverse geocoding yields nothing — label is null, coordinates are kept', async () => {
    currentPosMock.mockResolvedValue(PATNA_FIX);
    geocodeMock.mockRejectedValue(new Error('no geocoder'));
    await expect(detectDeviceLocation()).resolves.toEqual({ ok: true, coords: { lat: 25.5941, lng: 85.1376 }, label: null });
  });

  it('reports services_off without asking for permission', async () => {
    servicesMock.mockResolvedValue(false);
    await expect(detectDeviceLocation()).resolves.toEqual({ ok: false, reason: 'services_off' });
    expect(requestPermMock).not.toHaveBeenCalled();
    expect(currentPosMock).not.toHaveBeenCalled();
  });

  it('requests permission when undetermined and proceeds once granted', async () => {
    getPermMock.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    requestPermMock.mockResolvedValue({ status: 'granted', canAskAgain: true });
    currentPosMock.mockResolvedValue(PATNA_FIX);
    const result = await detectDeviceLocation();
    expect(requestPermMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it('reports denied (can ask again) when the customer refuses this time', async () => {
    getPermMock.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    requestPermMock.mockResolvedValue({ status: 'denied', canAskAgain: true });
    await expect(detectDeviceLocation()).resolves.toEqual({ ok: false, reason: 'denied' });
    expect(currentPosMock).not.toHaveBeenCalled();
  });

  it('reports blocked when the customer chose "don\'t ask again" in the system dialog', async () => {
    getPermMock.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    requestPermMock.mockResolvedValue({ status: 'denied', canAskAgain: false });
    await expect(detectDeviceLocation()).resolves.toEqual({ ok: false, reason: 'blocked' });
  });

  it('reports blocked without re-prompting when permission was already permanently denied', async () => {
    getPermMock.mockResolvedValue({ status: 'denied', canAskAgain: false });
    await expect(detectDeviceLocation()).resolves.toEqual({ ok: false, reason: 'blocked' });
    expect(requestPermMock).not.toHaveBeenCalled();
  });

  it('falls back to the last-known position when a fresh fix is slow', async () => {
    jest.useFakeTimers();
    try {
      currentPosMock.mockImplementation(never);
      lastKnownMock.mockResolvedValue(PATNA_FIX);
      const pending = detectDeviceLocation();
      await jest.advanceTimersByTimeAsync(LOCATION_FIX_TIMEOUT_MS + 10);
      await expect(pending).resolves.toMatchObject({ ok: true, coords: { lat: 25.5941, lng: 85.1376 } });
    } finally {
      jest.useRealTimers();
    }
  });

  it('times out with a typed result — never hangs — when there is no fix and no last-known position', async () => {
    jest.useFakeTimers();
    try {
      currentPosMock.mockImplementation(never);
      lastKnownMock.mockImplementation(never);
      const pending = detectDeviceLocation();
      await jest.advanceTimersByTimeAsync(LOCATION_FIX_TIMEOUT_MS + LOCATION_LAST_KNOWN_TIMEOUT_MS + 50);
      await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('a hung reverse geocode does not block: the fix still succeeds with a null label', async () => {
    jest.useFakeTimers();
    try {
      currentPosMock.mockResolvedValue(PATNA_FIX);
      geocodeMock.mockImplementation(never);
      const pending = detectDeviceLocation();
      await jest.advanceTimersByTimeAsync(20_000);
      await expect(pending).resolves.toEqual({ ok: true, coords: { lat: 25.5941, lng: 85.1376 }, label: null });
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects non-finite coordinates as unavailable rather than propagating NaN', async () => {
    currentPosMock.mockResolvedValue({ coords: { latitude: NaN, longitude: 1 } });
    await expect(detectDeviceLocation()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('never throws on an unexpected native error', async () => {
    getPermMock.mockRejectedValue(new Error('native boom'));
    await expect(detectDeviceLocation()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('readLastKnownDeviceCoords (the only passive refresh)', () => {
  it('never prompts and returns null when permission is not already granted', async () => {
    getPermMock.mockResolvedValue({ status: 'undetermined' });
    await expect(readLastKnownDeviceCoords()).resolves.toBeNull();
    expect(requestPermMock).not.toHaveBeenCalled();
    expect(currentPosMock).not.toHaveBeenCalled();
  });

  it('reads only the last-known position, never starting fresh GPS', async () => {
    lastKnownMock.mockResolvedValue(PATNA_FIX);
    await expect(readLastKnownDeviceCoords()).resolves.toEqual({ lat: 25.5941, lng: 85.1376 });
    expect(currentPosMock).not.toHaveBeenCalled();
  });
});

describe('openLocationSettings', () => {
  it('opens the app settings for permission problems', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await openLocationSettings('blocked');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('never throws when the OS refuses to open settings', async () => {
    jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('nope'));
    await expect(openLocationSettings('blocked')).resolves.toBeUndefined();
  });
});
