import type { BookingDetailDto } from "@barbercue/shared";

// Google Maps' plain web deep-link format (no Maps SDK/API key needed) — works in any browser and
// hands off to the native Google Maps app on mobile when installed. Coordinates are preferred when
// the salon has them (Salon.lat/lng are nullable — see BookingDetailDto's own doc comment); a
// text-address search is the honest fallback rather than guessing a location.
export function directionsUrl(
  booking: Pick<BookingDetailDto, "salonLat" | "salonLng" | "salonAddress" | "salonName">,
): string {
  if (booking.salonLat !== null && booking.salonLng !== null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${booking.salonLat},${booking.salonLng}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    `${booking.salonName}, ${booking.salonAddress}`,
  )}`;
}

export function salonPageUrl(
  booking: Pick<BookingDetailDto, "salonCountryCode" | "citySlug" | "salonSlug">,
): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/${booking.salonCountryCode.toLowerCase()}/${booking.citySlug}/${booking.salonSlug}`;
}

export function rebookUrl(booking: BookingDetailDto): string {
  const params = new URLSearchParams({
    city: booking.citySlug,
    country: booking.salonCountryCode.toLowerCase(),
    serviceId: booking.serviceId,
  });
  if (booking.preferredStaffId) params.set("staffId", booking.preferredStaffId);
  return `/book/${booking.salonSlug}?${params}`;
}

export type ShareResult = "shared" | "copied" | "cancelled" | "unsupported";

// Real device/browser share only — never a fake "sent" confirmation. navigator.share (mobile
// Chrome/Safari, most Android browsers) opens the OS share sheet; where it's unavailable, falls
// back to copying "text\nurl" to the clipboard so the caller can still tell the customer something
// useful happened. AbortError (the user closed the native share sheet without picking anything) is
// reported as "cancelled", not surfaced as an error.
export async function shareOrCopy(data: { title: string; text: string; url: string }): Promise<ShareResult> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(data);
      return "shared";
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return "cancelled";
      // fall through to the clipboard fallback below
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(`${data.text}\n${data.url}`);
      return "copied";
    } catch {
      /* fall through to unsupported */
    }
  }
  return "unsupported";
}

// wa.me is a plain deep link WhatsApp itself documents for "share to WhatsApp" buttons — not the
// WhatsApp Business API, and never claims proactive/automatic delivery (see ARCHITECTURE.md's
// communication-channel notes): it just opens WhatsApp with the message pre-filled for the user to
// send themselves.
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
