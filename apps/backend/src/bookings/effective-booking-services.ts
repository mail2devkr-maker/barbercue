import type { Prisma } from '@prisma/client';

/**
 * Production-safety hardening (P0 #2) — rolling deploys (see DEPLOYMENT.md: migrations run before
 * the new backend starts, but old and new backend instances may briefly overlap while traffic
 * drains) mean an OLD backend binary can still be serving `POST /bookings` after the
 * booking_services migration has already run and its one-time backfill has already completed.
 * That old binary only ever wrote `Booking.serviceId` (and the live `Service` FK it points at) —
 * it has no idea `BookingService` exists — so a booking it creates has ZERO rows in `services`.
 * The migration's backfill only ever covers bookings that existed BEFORE it ran; it cannot
 * retroactively cover one an old instance creates AFTER it.
 *
 * Every read path that derives duration/price/service-selection from a booking MUST go through
 * this helper instead of reading `booking.services` directly, or a booking like that would
 * silently produce 0 duration, 0 price, or an empty service list/summary instead of the correct
 * single-service values a customer/owner actually booked.
 */
export interface EffectiveBookingServiceItem {
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  price: Prisma.Decimal;
}

// The minimal shape every consumer's own Prisma `include` already selects (bookingDetailInclude in
// bookings.service.ts, ownerBookingInclude in dashboard-bookings.service.ts) — both select the
// live `service` join specifically so this fallback is always possible without an extra query.
export interface BookingWithServiceSnapshot {
  serviceId: string;
  service: { name: string; durationMinutes: number; price: Prisma.Decimal };
  services: readonly {
    serviceId: string;
    serviceName: string;
    durationMinutes: number;
    price: Prisma.Decimal;
  }[];
}

export function resolveEffectiveBookingServices(
  booking: BookingWithServiceSnapshot,
): EffectiveBookingServiceItem[] {
  if (booking.services.length > 0) {
    return booking.services.map((s) => ({
      serviceId: s.serviceId,
      serviceName: s.serviceName,
      durationMinutes: s.durationMinutes,
      price: s.price,
    }));
  }
  // Synthesize exactly one legacy item from the live joined Service — the same values this
  // booking's own read paths would have shown before the multi-service mission ever existed.
  return [
    {
      serviceId: booking.serviceId,
      serviceName: booking.service.name,
      durationMinutes: booking.service.durationMinutes,
      price: booking.service.price,
    },
  ];
}
