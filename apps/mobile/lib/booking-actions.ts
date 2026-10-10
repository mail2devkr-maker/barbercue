import { Linking, Share } from 'react-native';
import type { BookingDetailDto, UiStrings } from '@barbercue/shared';

// The web app is a separate Railway service from the backend API (see .env.example) — its origin
// can't be derived from EXPO_PUBLIC_API_BASE_URL the way apps/web derives the realtime socket
// origin from its own API base URL. EXPO_PUBLIC_WEB_ORIGIN wins when set. Otherwise development
// builds use the local web app, and every release build uses the public site (fastque.com is the
// canonical origin: its shop pages serve this exact path and declare themselves canonical). No
// EAS environment sets EXPO_PUBLIC_WEB_ORIGIN, so without this default shared links pointed at
// http://localhost:3001 on real phones.
export const PRODUCTION_WEB_ORIGIN = 'https://fastque.com';

export function resolveWebOrigin(configured: string | undefined, isDevelopment: boolean): string {
  const trimmed = configured?.trim().replace(/\/+$/, '');
  if (trimmed) return trimmed;
  return isDevelopment ? 'http://localhost:3001' : PRODUCTION_WEB_ORIGIN;
}

const WEB_ORIGIN = resolveWebOrigin(process.env.EXPO_PUBLIC_WEB_ORIGIN, __DEV__);

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
  t: UiStrings,
): Promise<'shared' | 'dismissed'> {
  const url = salonPageUrl(booking);
  const result = await Share.share({
    message: `${t.shareBookingPrefix}${booking.salonName}${t.shareBookingMiddle}${url}`,
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
