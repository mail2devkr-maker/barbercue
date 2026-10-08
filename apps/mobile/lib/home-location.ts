import * as Location from 'expo-location';

// FastQue Home redesign — the header's location pill needs a real city label, never a hard-coded
// "Bengaluru". Reverse geocoding is done via expo-location's on-device geocoder (Location.
// reverseGeocodeAsync), the same free, no-API-key mechanism SalonSearchScreen's existing "Near Me"
// button already relies on for coordinates — no paid geocoding service involved.
//
// Cached at module scope for the app session, same pattern as lib/voice-announce.ts's voice cache:
// a device's city doesn't change moment-to-moment, so Home shouldn't re-request permission or
// re-resolve on every focus once it has an answer.
let cachedCityLabel: string | null = null;
let cachedCoords: { lat: number; lng: number } | null = null;
let inFlight: Promise<HomeLocation | null> | null = null;

// Home disables both location controls while a lookup is pending, so every native call below must
// settle in bounded time: a getCurrentPositionAsync that never resolves (no GPS fix indoors,
// location services switched off mid-request) would otherwise leave the header pill and the
// City / Location field stuck on "Detecting location" for the rest of the session. On timeout the
// call resolves to its fallback (null / no places) and the lookup moves on to the next source.
export const LOCATION_FIX_TIMEOUT_MS = 10_000;
export const LOCATION_LAST_KNOWN_TIMEOUT_MS = 3_000;
export const LOCATION_GEOCODE_TIMEOUT_MS = 8_000;

function settleWithin<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export interface HomeLocation {
  label: string;
  coords: { lat: number; lng: number };
}

export function __resetHomeLocationCacheForTests(): void {
  cachedCityLabel = null;
  cachedCoords = null;
  inFlight = null;
}

/**
 * `promptIfNeeded: false` (Home's own mount/focus) only ever checks a permission that's already
 * granted — it never shows the OS permission dialog unprompted. `promptIfNeeded: true` (the
 * customer tapping the location pill directly) may request it, mirroring the existing "Near Me"
 * button's on-demand request in SalonSearchScreen. Denial/failure resolves to null rather than
 * throwing — the header's honest fallback is the neutral "Choose location" label, never a guess.
 */
export async function resolveHomeLocation(
  promptIfNeeded: boolean,
  forceRefresh = false,
): Promise<HomeLocation | null> {
  // Passive Home focus reads may reuse the session cache. An explicit user tap must never be
  // trapped behind that cache: "Choose location" / the header pill are change-location actions,
  // so forceRefresh bypasses the cached city and resolves the device's current position again.
  if (!forceRefresh && cachedCityLabel && cachedCoords) {
    return { label: cachedCityLabel, coords: cachedCoords };
  }

  // Avoid two native location requests racing each other. If an explicit refresh arrives while a
  // passive read is still running, let that read finish first and then continue with a fresh fix.
  if (inFlight) {
    const pending = await inFlight;
    if (!forceRefresh) return pending;
  }

  inFlight = (async () => {
    try {
      const permission = promptIfNeeded
        ? await Location.requestForegroundPermissionsAsync()
        : await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') return null;

      // Explicit refreshes prefer a real current fix so moving/changing location cannot get stuck
      // on an old last-known coordinate. Passive focus reads keep the faster last-known-first path.
      const current = () =>
        settleWithin(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          LOCATION_FIX_TIMEOUT_MS,
          null,
        );
      const lastKnown = () => settleWithin(Location.getLastKnownPositionAsync(), LOCATION_LAST_KNOWN_TIMEOUT_MS, null);
      const position = forceRefresh
        ? (await current()) ?? (await lastKnown())
        : (await lastKnown()) ?? (await current());
      if (!position) return null;

      const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
      const places = await settleWithin(
        Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lng }),
        LOCATION_GEOCODE_TIMEOUT_MS,
        [] as Location.LocationGeocodedAddress[],
      );
      const label = places[0]?.city || places[0]?.subregion || places[0]?.region || null;
      if (!label) return null;

      cachedCityLabel = label;
      cachedCoords = coords;
      return { label, coords };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
