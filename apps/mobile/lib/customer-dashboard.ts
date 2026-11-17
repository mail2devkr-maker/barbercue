import {
  BOOKING_PATHS,
  Language,
  isCustomerBookingUpcoming,
  presetRange,
  type BookingDetailDto,
  type SalonSummary,
} from '@barbercue/shared';

/**
 * Pure helpers for the mobile customer dashboard (web parity with apps/web /account, built by Nitesh
 * and shipped 14 Nov). No React and no network here, so every rule is unit-tested.
 */

/**
 * The query for "my next appointment". Same as the website: yesterday (local) as the lower bound
 * covers every salon time zone, then upcoming-ness is checked exactly by the shared rule.
 */
export function nextBookingPath(now: Date = new Date()): string {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const query = new URLSearchParams({ status: 'CONFIRMED,PENDING_PAYMENT', sort: 'oldest', from: presetRange('today', yesterday).from });
  return `${BOOKING_PATHS.bookings}/${BOOKING_PATHS.mine}?${query.toString()}`;
}

/** The first booking in the list that is really still ahead of the customer, or null. */
export function pickNextBooking(items: BookingDetailDto[], now: Date = new Date()): BookingDetailDto | null {
  return items.find((b) => isCustomerBookingUpcoming(b, now)) ?? null;
}

/** Params for the SalonProfile screen from any salon list entry. */
export function salonProfileParams(salon: Pick<SalonSummary, 'countryCode' | 'citySlug' | 'slug'>) {
  return { countryCode: salon.countryCode, citySlug: salon.citySlug, salonSlug: salon.slug };
}

/** "Just now", "2 hours ago", "Yesterday", "3 days ago", or a date (web's lastViewedLabel, EN + HI). */
export function lastViewedLabel(iso: string, language: Language | null | undefined, now: Date = new Date()): string {
  const hi = language === Language.HI;
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return hi ? 'अभी' : 'Just now';
  if (minutes < 1) return hi ? 'अभी' : 'Just now';
  if (minutes < 60) return hi ? `${minutes} मिनट पहले` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hi ? `${hours} घंटे पहले` : `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return hi ? 'कल' : 'Yesterday';
  if (days < 7) return hi ? `${days} दिन पहले` : `${days} days ago`;
  return then.toLocaleDateString(hi ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' });
}

/** Whole stars (0-5) for a rating row. */
export function starsText(rating: number): string {
  const whole = Math.max(0, Math.min(5, Math.round(rating)));
  return '★'.repeat(whole) + '☆'.repeat(5 - whole);
}

/** Time-of-day greeting in English or Hindi. */
export function greetingText(hour: number, language: Language | null | undefined): string {
  const hi = language === Language.HI;
  if (hour >= 5 && hour < 12) return hi ? 'सुप्रभात' : 'Good morning';
  if (hour >= 12 && hour < 17) return hi ? 'नमस्ते' : 'Good afternoon';
  return hi ? 'शुभ संध्या' : 'Good evening';
}
