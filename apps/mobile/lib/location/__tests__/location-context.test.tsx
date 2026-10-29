/// <reference types="jest" />
import { act } from 'react';
import { createElement } from 'react';
import { HAJIPUR, LONDON_GB, PATNA } from '../__fixtures__/cities';
import { flush, render } from '../__fixtures__/render';

const mockStore = new Map<string, string>();
jest.mock('../../secure-storage', () => ({
  getItem: jest.fn(async (key: string) => (mockStore.has(key) ? mockStore.get(key)! : null)),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

jest.mock('../device-location', () => ({
  detectDeviceLocation: jest.fn(),
  readLastKnownDeviceCoords: jest.fn(),
  openLocationSettings: jest.fn(),
}));

import { detectDeviceLocation, readLastKnownDeviceCoords } from '../device-location';
import { LocationProvider, useLocationSelection, LOCATION_SELECTION_STORAGE_KEY, type LocationContextValue } from '../location-context';

const detectMock = detectDeviceLocation as jest.Mock;
const lastKnownMock = readLastKnownDeviceCoords as jest.Mock;

let latest!: LocationContextValue;
function Probe() {
  latest = useLocationSelection();
  return null;
}
const mount = () => render(createElement(LocationProvider, null, createElement(Probe)));

const PATNA_GPS = { ok: true, coords: { lat: 25.5941, lng: 85.1376 }, label: 'Patna' };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('LocationProvider', () => {
  it('starts with no selection, hydrated, and never touches GPS on its own', async () => {
    await mount();
    await flush();
    expect(latest.hydrated).toBe(true);
    expect(latest.selection).toBeNull();
    expect(detectMock).not.toHaveBeenCalled();
    expect(lastKnownMock).not.toHaveBeenCalled();
  });

  it('opening the selector (what the pill does) opens UI state only — no GPS', async () => {
    await mount();
    await flush();
    await act(async () => latest.openSelector());
    expect(latest.selectorOpen).toBe(true);
    expect(detectMock).not.toHaveBeenCalled();
    expect(lastKnownMock).not.toHaveBeenCalled();
  });

  it('manual city selection works with no GPS at all, closes the selector and records a recent', async () => {
    await mount();
    await flush();
    await act(async () => latest.openSelector());
    await act(async () => latest.selectCity(HAJIPUR));
    expect(latest.selection).toMatchObject({ mode: 'city', city: { slug: 'hajipur' } });
    expect(latest.selectorOpen).toBe(false);
    expect(latest.recents.map((c) => c.slug)).toEqual(['hajipur']);
    expect(detectMock).not.toHaveBeenCalled();
  });

  it('persists across a remount (app restart) — city and recents are restored', async () => {
    const first = await mount();
    await flush();
    await act(async () => latest.selectCity(HAJIPUR));
    await act(async () => latest.selectCity(PATNA));
    await act(async () => first.unmount());

    await mount();
    await flush();
    expect(latest.hydrated).toBe(true);
    expect(latest.selection).toMatchObject({ mode: 'city', city: { slug: 'patna' } });
    expect(latest.recents.map((c) => c.slug)).toEqual(['patna', 'hajipur']);
  });

  it('persists a device selection with its coordinates and provenance', async () => {
    const first = await mount();
    await flush();
    detectMock.mockResolvedValue(PATNA_GPS);
    await act(async () => {
      await latest.selectCurrentLocation();
    });
    expect(latest.selection).toMatchObject({ mode: 'device', label: 'Patna', coords: { lat: 25.5941, lng: 85.1376 } });
    await act(async () => first.unmount());
    await mount();
    await flush();
    expect(latest.selection).toMatchObject({ mode: 'device', coords: { lat: 25.5941, lng: 85.1376 } });
  });

  it('ignores corrupt stored data instead of crashing', async () => {
    mockStore.set(LOCATION_SELECTION_STORAGE_KEY, '{{{not json');
    await mount();
    await flush();
    expect(latest.hydrated).toBe(true);
    expect(latest.selection).toBeNull();
  });

  it('GPS success replaces the selection and closes the selector', async () => {
    await mount();
    await flush();
    await act(async () => latest.selectCity(HAJIPUR));
    await act(async () => latest.openSelector());
    detectMock.mockResolvedValue(PATNA_GPS);
    await act(async () => {
      await latest.selectCurrentLocation();
    });
    expect(latest.selection?.mode).toBe('device');
    expect(latest.selectorOpen).toBe(false);
    expect(latest.gps).toEqual({ status: 'idle' });
  });

  it.each(['services_off', 'denied', 'blocked', 'timeout', 'unavailable'] as const)(
    'GPS failure (%s) leaves the manual city untouched, keeps the selector open and never sticks on "detecting"',
    async (reason) => {
      await mount();
      await flush();
      await act(async () => latest.selectCity(HAJIPUR));
      await act(async () => latest.openSelector());
      detectMock.mockResolvedValue({ ok: false, reason });
      await act(async () => {
        await latest.selectCurrentLocation();
      });
      expect(latest.selection).toMatchObject({ mode: 'city', city: { slug: 'hajipur' } });
      expect(latest.gps).toEqual({ status: 'error', reason });
      expect(latest.selectorOpen).toBe(true);
    },
  );

  it('can retry GPS after a failure', async () => {
    await mount();
    await flush();
    detectMock.mockResolvedValueOnce({ ok: false, reason: 'timeout' }).mockResolvedValueOnce(PATNA_GPS);
    await act(async () => {
      await latest.selectCurrentLocation();
    });
    expect(latest.gps.status).toBe('error');
    await act(async () => {
      await latest.selectCurrentLocation();
    });
    expect(latest.selection?.mode).toBe('device');
  });

  it('a manual pick made while GPS is still running wins; the late fix is discarded', async () => {
    await mount();
    await flush();
    const gps = deferred<unknown>();
    detectMock.mockReturnValue(gps.promise);
    let pending!: Promise<void>;
    await act(async () => {
      pending = latest.selectCurrentLocation();
    });
    expect(latest.gps.status).toBe('detecting');
    await act(async () => latest.selectCity(HAJIPUR));
    expect(latest.gps).toEqual({ status: 'idle' });
    await act(async () => {
      gps.resolve(PATNA_GPS);
      await pending;
    });
    expect(latest.selection).toMatchObject({ mode: 'city', city: { slug: 'hajipur' } });
  });

  it('closing the selector abandons an in-flight GPS attempt — a late fix does not change the location', async () => {
    await mount();
    await flush();
    await act(async () => latest.selectCity(HAJIPUR));
    const gps = deferred<unknown>();
    detectMock.mockReturnValue(gps.promise);
    let pending!: Promise<void>;
    await act(async () => {
      latest.openSelector();
      pending = latest.selectCurrentLocation();
    });
    await act(async () => latest.closeSelector());
    await act(async () => {
      gps.resolve(PATNA_GPS);
      await pending;
    });
    expect(latest.selection).toMatchObject({ mode: 'city', city: { slug: 'hajipur' } });
    expect(latest.gps).toEqual({ status: 'idle' });
  });

  it('cancelGpsDetection returns to idle without changing the selection', async () => {
    await mount();
    await flush();
    detectMock.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      void latest.selectCurrentLocation();
    });
    expect(latest.gps.status).toBe('detecting');
    await act(async () => latest.cancelGpsDetection());
    expect(latest.gps).toEqual({ status: 'idle' });
    expect(latest.selection).toBeNull();
  });

  it('ignores a second GPS tap while one is running (no duplicate permission prompts)', async () => {
    await mount();
    await flush();
    detectMock.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      void latest.selectCurrentLocation();
      void latest.selectCurrentLocation();
    });
    expect(detectMock).toHaveBeenCalledTimes(1);
  });

  describe('passive refresh never overrides a manual choice', () => {
    it('refreshDeviceCoords is a complete no-op for a manual city', async () => {
      await mount();
      await flush();
      await act(async () => latest.selectCity(HAJIPUR));
      await act(async () => {
        await latest.refreshDeviceCoords();
      });
      expect(lastKnownMock).not.toHaveBeenCalled();
      expect(latest.selection).toMatchObject({ mode: 'city', city: { slug: 'hajipur' } });
    });

    it('is a no-op with no selection (never invents one)', async () => {
      await mount();
      await flush();
      await act(async () => {
        await latest.refreshDeviceCoords();
      });
      expect(lastKnownMock).not.toHaveBeenCalled();
      expect(latest.selection).toBeNull();
    });

    it('updates the coordinates of an explicit device selection', async () => {
      await mount();
      await flush();
      detectMock.mockResolvedValue(PATNA_GPS);
      await act(async () => {
        await latest.selectCurrentLocation();
      });
      lastKnownMock.mockResolvedValue({ lat: 25.6, lng: 85.2 });
      await act(async () => {
        await latest.refreshDeviceCoords();
      });
      expect(latest.selection).toMatchObject({ mode: 'device', coords: { lat: 25.6, lng: 85.2 }, label: 'Patna' });
    });

    it('does not apply a refresh that lands after the customer picked a city meanwhile', async () => {
      await mount();
      await flush();
      detectMock.mockResolvedValue(PATNA_GPS);
      await act(async () => {
        await latest.selectCurrentLocation();
      });
      const slow = deferred<{ lat: number; lng: number } | null>();
      lastKnownMock.mockReturnValue(slow.promise);
      let pending!: Promise<void>;
      await act(async () => {
        pending = latest.refreshDeviceCoords();
      });
      await act(async () => latest.selectCity(LONDON_GB));
      await act(async () => {
        slow.resolve({ lat: 1, lng: 1 });
        await pending;
      });
      expect(latest.selection).toMatchObject({ mode: 'city', city: { slug: 'london' } });
    });
  });

  it('clearSelection removes the selection and its stored copy', async () => {
    await mount();
    await flush();
    await act(async () => latest.selectCity(HAJIPUR));
    await act(async () => latest.clearSelection());
    expect(latest.selection).toBeNull();
    expect(mockStore.has(LOCATION_SELECTION_STORAGE_KEY)).toBe(false);
  });
});
