import { Linking, Share } from 'react-native';
import type { BookingDetailDto } from '@barbercue/shared';

// The web app is a separate Railway service from the backend API (see .env.example) — its origin
// can't be derived from EXPO_PUBLIC_API_BASE_URL the way apps/web derives the realtime socket
// origin from its own API base URL. Falls back to localhost so dev builds still produce a
// clickable (if wrong-for-device) link rather than crashing; production sets this via the EAS
// "preview"/"production" environment, same as EXPO_PUBLIC_API_BASE_URL.
const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN ?? 'http://localhost:3001';

// Same Google Maps plain web deep-link format as apps/web/lib/booking-actions.ts — no Maps SDK/API
// key needed, and Linking.openURL hands it to the native Google Maps app when installed.
export function directionsUrl(
  booking: Pick<BookingDetailDto, 'salonLat' | 'salonLng' | 'salonAddress' | 'salonName'>,
): string {
  if (booking.salonLat !== null && booking.salonLng !== null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${booking.salonLat},${booking.salonLng}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    `${booking.salonName}, ${booking.salonAddress}`,
  )}`;
}

export function openDirections(
  booking: Pick<BookingDetailDto, 'salonLat' | 'salonLng' | 'salonAddress' | 'salonName'>,
): Promise<void> {
  return Linking.openURL(directionsUrl(booking));
}

export function salonPageUrl(
  booking: Pick<BookingDetailDto, 'salonCountryCode' | 'citySlug' | 'salonSlug'>,
): string {
  return `${WEB_ORIGIN}/${booking.salonCountryCode.toLowerCase()}/${booking.citySlug}/${booking.salonSlug}`;
}

// React Native's built-in Share sheet — a real OS share dialog, not a fake "sent" confirmation.
// Resolves even when the user dismisses it without picking a target (action.action ===
// 'dismissedAction'), which callers should treat as "nothing to report," not an error.
export async function shareSalon(
  booking: Pick<BookingDetailDto, 'salonCountryCode' | 'citySlug' | 'salonSlug' | 'salonName'>,
): Promise<'shared' | 'dismissed'> {
  const url = salonPageUrl(booking);
  const result = await Share.share({
    message: `Book at ${booking.salonName} on BarberCue: ${url}`,
    url, // iOS uses this as the shared URL; Android folds it into `message` above.
  });
  return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
}

export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function openWhatsappShare(text: string): Promise<void> {
  return Linking.openURL(whatsappShareUrl(text));
}
