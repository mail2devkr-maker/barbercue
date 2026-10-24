import { Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import {
  LOCATION_FIX_TIMEOUT_MS,
  LOCATION_GEOCODE_TIMEOUT_MS,
  LOCATION_LAST_KNOWN_TIMEOUT_MS,
  settleWithin,
} from '../home-location';

/**
 * The ONE place GPS is touched on purpose. It runs only when the customer taps "Use my current
 * location" in the selector — never because a location pill was tapped, never from a passive focus
 * effect. Every outcome is a typed result (it never throws and never hangs), so the UI can always
 * return to a usable state and keep manual city search available.
 *
 * It reuses PR #165's bounded-wait primitives: a fresh fix gets LOCATION_FIX_TIMEOUT_MS, then the
 * last-known position gets LOCATION_LAST_KNOWN_TIMEOUT_MS, then the attempt ends with 'timeout'.
 */

export type DeviceLocationFailure =
  /** Android location services (GPS) are switched off. */
  | 'services_off'
  /** Permission refused this time; the OS will still allow asking again later. */
  | 'denied'
  /** Permission permanently refused ("Don't ask again"): only the system Settings can grant it. */
  | 'blocked'
  /** No fix and no last-known position within the bounded wait. */
  | 'timeout'
  | 'unavailable';

export type DeviceLocationResult =
  | { ok: true; coords: { lat: number; lng: number }; label: string | null }
  | { ok: false; reason: DeviceLocationFailure };

const SERVICES_CHECK_TIMEOUT_MS = 4_000;

export async function detectDeviceLocation(): Promise<DeviceLocationResult> {
  try {
    // A hung services probe is treated as "enabled" so the attempt still proceeds to the bounded
    // position calls below, which then report the real problem.
    const servicesEnabled = await settleWithin(Location.hasServicesEnabledAsync(), SERVICES_CHECK_TIMEOUT_MS, true);
    if (!servicesEnabled) return { ok: false, reason: 'services_off' };

    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      if (permission.status === 'denied' && permission.canAskAgain === false) return { ok: false, reason: 'blocked' };
      permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        return { ok: false, reason: permission.canAskAgain === false ? 'blocked' : 'denied' };
      }
    }

    const fix =
      (await settleWithin(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        LOCATION_FIX_TIMEOUT_MS,
        null,
      )) ?? (await settleWithin(Location.getLastKnownPositionAsync(), LOCATION_LAST_KNOWN_TIMEOUT_MS, null));
    if (!fix) return { ok: false, reason: 'timeout' };

    const lat = fix.coords.latitude;
    const lng = fix.coords.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, reason: 'unavailable' };

    const places = await settleWithin(
      Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }),
      LOCATION_GEOCODE_TIMEOUT_MS,
      [] as Location.LocationGeocodedAddress[],
    );
    const label = places[0]?.city || places[0]?.subregion || places[0]?.region || null;
    return { ok: true, coords: { lat, lng }, label };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Silent, prompt-free refresh of an ALREADY-chosen device location: only reads a permission the
 * customer has already granted and only reads the last-known position. It can never show a
 * permission dialog, never starts GPS hardware, and the caller only ever applies it while the
 * selection is in device mode — so it cannot replace a manually chosen city.
 */
export async function readLastKnownDeviceCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') return null;
    const position = await settleWithin(Location.getLastKnownPositionAsync(), LOCATION_LAST_KNOWN_TIMEOUT_MS, null);
    if (!position) return null;
    const { latitude: lat, longitude: lng } = position.coords;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

/** Opens the screen that can actually fix the failure: GPS switch for services_off, app settings otherwise. */
export async function openLocationSettings(reason: DeviceLocationFailure): Promise<void> {
  try {
    if (reason === 'services_off' && Platform.OS === 'android') {
      await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
      return;
    }
  } catch {
    // fall through to the generic app settings
  }
  try {
    await Linking.openSettings();
  } catch {
    // nothing more the app can do; the inline message already explains the fix
  }
}
