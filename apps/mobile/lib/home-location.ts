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
export async function resolveHomeLocation(promptIfNeeded: boolean): Promise<HomeLocation | null> {
  if (cachedCityLabel && cachedCoords) {
    return { label: cachedCityLabel, coords: cachedCoords };
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const permission = promptIfNeeded
        ? await Location.requestForegroundPermissionsAsync()
        : await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') return null;

      const position =
        (await Location.getLastKnownPositionAsync().catch(() => null)) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null));
      if (!position) return null;

      const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
      const places = await Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lng }).catch(() => []);
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
