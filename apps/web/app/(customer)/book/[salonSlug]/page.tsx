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
  searchParams: Promise<{ city?: string }>;
}) {
  const { salonSlug } = await params;
  const { city } = await searchParams;
  // Salon.slug is only unique per city (DATABASE.md: @@unique([cityId, slug])), so the salon
  // profile page's "Book an appointment" link always passes ?city= alongside the slug.
  if (!city) notFound();

  // revalidate: 0 (no caching) — unlike the public salon profile page's 5-minute ISR window, a
  // customer one click from booking needs live services/operating-hours data, not a stale cache.
  const salon = await fetchDiscoveryOrNull<SalonProfileDto>(`${DISCOVERY_PATHS.salons}/${city}/${salonSlug}`, 0);
  if (!salon) notFound();

  return (
    <main style={{ padding: "2rem 1.5rem", maxWidth: 800, margin: "0 auto" }}>
      <h1>Book at {salon.name}</h1>
      <p style={{ color: "#6B6357" }}>{salon.addressLine}</p>
      <BookingFlow salonId={salon.id} services={salon.services} operatingHours={salon.operatingHours} />
    </main>
  );
}
