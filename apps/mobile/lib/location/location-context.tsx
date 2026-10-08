import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { deleteItem, getItem, setItem } from '../secure-storage';
import { detectDeviceLocation, readLastKnownDeviceCoords, type DeviceLocationFailure } from './device-location';
import {
  parseRecents,
  parseSelection,
  pushRecentCity,
  serializeRecents,
  serializeSelection,
  type SelectableCity,
  type SelectedLocation,
} from './selection';

/**
 * One location model for the whole app (Home header, City / Location field, Search results).
 *
 * Rules enforced here, in one place:
 *  - Opening the selector never touches GPS. Only `selectCurrentLocation()` does, and only from the
 *    selector's explicit "Use my current location" action.
 *  - A manually chosen city is never replaced by anything passive. The only background refresh,
 *    `refreshDeviceCoords()`, is a no-op unless the selection is already in device mode.
 *  - A newer user action always wins over an older asynchronous GPS attempt (sequence guard).
 *  - Failures leave the existing selection untouched and never leave the UI "detecting".
 *  - The selection and recents survive restarts (SecureStore). GPS coordinates are stored only as
 *    part of an explicitly chosen device selection, never logged, and replaced on the next choice.
 */

export const LOCATION_SELECTION_STORAGE_KEY = 'fastque_location_selection_v1';
export const LOCATION_RECENTS_STORAGE_KEY = 'fastque_location_recents_v1';

export type GpsState = { status: 'idle' } | { status: 'detecting' } | { status: 'error'; reason: DeviceLocationFailure };

export interface LocationContextValue {
  /** False until the stored selection has been read, so screens don't flash "Choose location". */
  hydrated: boolean;
  selection: SelectedLocation | null;
  recents: SelectableCity[];
  selectorOpen: boolean;
  gps: GpsState;
  openSelector: () => void;
  closeSelector: () => void;
  selectCity: (city: SelectableCity) => void;
  selectCurrentLocation: () => Promise<void>;
  dismissGpsError: () => void;
  /** Abandons an in-flight GPS attempt; the existing selection is untouched. */
  cancelGpsDetection: () => void;
  clearSelection: () => void;
  refreshDeviceCoords: () => Promise<void>;
}

const noop = () => {};
const INERT: LocationContextValue = {
  hydrated: true,
  selection: null,
  recents: [],
  selectorOpen: false,
  gps: { status: 'idle' },
  openSelector: noop,
  closeSelector: noop,
  selectCity: noop,
  selectCurrentLocation: async () => {},
  dismissGpsError: noop,
  cancelGpsDetection: noop,
  clearSelection: noop,
  refreshDeviceCoords: async () => {},
};

const LocationContext = createContext<LocationContextValue>(INERT);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [selection, setSelection] = useState<SelectedLocation | null>(null);
  const [recents, setRecents] = useState<SelectableCity[]>([]);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [gps, setGps] = useState<GpsState>({ status: 'idle' });

  const selectionRef = useRef<SelectedLocation | null>(null);
  const recentsRef = useRef<SelectableCity[]>([]);
  // Bumped by every user action that supersedes an in-flight GPS attempt.
  const gpsSequence = useRef(0);
  const detecting = useRef(false);

  const commitSelection = useCallback((next: SelectedLocation | null) => {
    selectionRef.current = next;
    setSelection(next);
    const write = next ? setItem(LOCATION_SELECTION_STORAGE_KEY, serializeSelection(next)) : deleteItem(LOCATION_SELECTION_STORAGE_KEY);
    void write.catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getItem(LOCATION_SELECTION_STORAGE_KEY).catch(() => null),
      getItem(LOCATION_RECENTS_STORAGE_KEY).catch(() => null),
    ]).then(([rawSelection, rawRecents]) => {
      if (cancelled) return;
      // A choice made before storage answered (a very fast tap) already won; never overwrite it.
      if (selectionRef.current === null) {
        const stored = parseSelection(rawSelection);
        selectionRef.current = stored;
        setSelection(stored);
      }
      const storedRecents = parseRecents(rawRecents);
      if (recentsRef.current.length === 0) {
        recentsRef.current = storedRecents;
        setRecents(storedRecents);
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openSelector = useCallback(() => setSelectorOpen(true), []);

  const cancelPendingGps = useCallback(() => {
    gpsSequence.current += 1;
    detecting.current = false;
    setGps({ status: 'idle' });
  }, []);

  const closeSelector = useCallback(() => {
    // Closing abandons an unfinished GPS attempt: a fix that lands after the customer walked away
    // must not silently change their location.
    cancelPendingGps();
    setSelectorOpen(false);
  }, [cancelPendingGps]);

  const selectCity = useCallback(
    (city: SelectableCity) => {
      cancelPendingGps();
      commitSelection({ mode: 'city', city, selectedAt: Date.now() });
      const nextRecents = pushRecentCity(recentsRef.current, city);
      recentsRef.current = nextRecents;
      setRecents(nextRecents);
      void setItem(LOCATION_RECENTS_STORAGE_KEY, serializeRecents(nextRecents)).catch(() => {});
      setSelectorOpen(false);
    },
    [cancelPendingGps, commitSelection],
  );

  const selectCurrentLocation = useCallback(async () => {
    if (detecting.current) return;
    detecting.current = true;
    const sequence = ++gpsSequence.current;
    setGps({ status: 'detecting' });
    const result = await detectDeviceLocation();
    // Superseded by a manual city pick, by closing the selector, or by a newer attempt.
    if (sequence !== gpsSequence.current) return;
    detecting.current = false;
    if (!result.ok) {
      setGps({ status: 'error', reason: result.reason });
      return; // the existing selection is deliberately left exactly as it was
    }
    commitSelection({ mode: 'device', coords: result.coords, label: result.label, capturedAt: Date.now() });
    setGps({ status: 'idle' });
    setSelectorOpen(false);
  }, [commitSelection]);

  const dismissGpsError = useCallback(() => setGps((current) => (current.status === 'error' ? { status: 'idle' } : current)), []);

  const clearSelection = useCallback(() => {
    cancelPendingGps();
    commitSelection(null);
  }, [cancelPendingGps, commitSelection]);

  const refreshDeviceCoords = useCallback(async () => {
    const before = selectionRef.current;
    if (before?.mode !== 'device') return; // never touches a manually chosen city
    const coords = await readLastKnownDeviceCoords();
    const current = selectionRef.current;
    if (!coords || current?.mode !== 'device' || current.capturedAt !== before.capturedAt) return;
    commitSelection({ ...current, coords, capturedAt: Date.now() });
  }, [commitSelection]);

  const value = useMemo<LocationContextValue>(
    () => ({
      hydrated,
      selection,
      recents,
      selectorOpen,
      gps,
      openSelector,
      closeSelector,
      selectCity,
      selectCurrentLocation,
      dismissGpsError,
      cancelGpsDetection: cancelPendingGps,
      clearSelection,
      refreshDeviceCoords,
    }),
    [hydrated, selection, recents, selectorOpen, gps, openSelector, closeSelector, selectCity, selectCurrentLocation, dismissGpsError, cancelPendingGps, clearSelection, refreshDeviceCoords],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocationSelection(): LocationContextValue {
  return useContext(LocationContext);
}
