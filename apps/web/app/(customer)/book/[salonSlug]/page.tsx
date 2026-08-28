import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { SalonProfileDto } from "@barbercue/shared";
import { fetchDiscoveryOrNull } from "../../../../lib/discovery-api";
import { BookingFlow } from "../../../../components/booking/BookingFlow";

interface BookPageParams {
  salonSlug: string;
}

// Authenticated, customer-specific flow — never indexable. See robots.ts.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<BookPageParams>;
  searchParams: Promise<{ city?: string; country?: string; style?: string; serviceId?: string; staffId?: string }>;
}) {
  const { salonSlug } = await params;
  const { city, country, style, serviceId, staffId } = await searchParams;
  // Salon.slug is unique only per city, and City.slug is unique only per country (B9), so the
  // salon profile page's "Book an appointment" link always passes both alongside the slug.
  if (!city || !country) notFound();

  // revalidate: 0 (no caching) — unlike the public salon profile page's 5-minute ISR window, a
  // customer one click from booking needs live services/operating-hours data, not a stale cache.
  const salon = await fetchDiscoveryOrNull<SalonProfileDto>(
    `${DISCOVERY_PATHS.salons}/${country}/${city}/${salonSlug}`,
    0,
  );
  if (!salon) notFound();

  return (
    <main style={{ padding: "2.5rem 1.5rem 3rem", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.8rem", letterSpacing: "-0.01em", marginBottom: 4 }}>
        Book at {salon.name}
      </h1>
      <p style={{ color: "var(--bc-muted)" }}>{salon.addressLine}</p>
      <BookingFlow
        salonId={salon.id}
        services={salon.services}
        operatingHours={salon.operatingHours}
        currency={salon.currency}
        countryCode={salon.countryCode}
        selectedStyleName={style}
        initialServiceId={serviceId}
        // A prefilled service (rebook or style hand-off) always came with an explicit staff choice
        // already made on the original booking — default to "Any Staff" (null) rather than leaving
        // the picker unset, unless a specific staffId was actually carried over.
        initialStaffId={serviceId ? (staffId ?? null) : undefined}
      />
    </main>
  );
}
