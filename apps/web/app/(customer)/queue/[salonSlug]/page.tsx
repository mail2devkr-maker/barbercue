import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { SalonProfileDto } from "@barbercue/shared";
import { fetchDiscoveryOrNull } from "../../../../lib/discovery-api";
import { WalkInJoinFlow } from "../../../../components/queue/WalkInJoinFlow";

interface QueuePageParams {
  salonSlug: string;
}

// Authenticated, customer-specific flow — never indexable. See robots.ts.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function QueuePage({
  params,
  searchParams,
}: {
  params: Promise<QueuePageParams>;
  searchParams: Promise<{ city?: string; country?: string }>;
}) {
  const { salonSlug } = await params;
  const { city, country } = await searchParams;
  // Salon.slug is unique only per city, and City.slug only per country (B9) — same reason
  // book/[salonSlug]/page.tsx requires both.
  if (!city || !country) notFound();

  const salon = await fetchDiscoveryOrNull<SalonProfileDto>(
    `${DISCOVERY_PATHS.salons}/${country}/${city}/${salonSlug}`,
    0,
  );
  if (!salon) notFound();

  return (
    <main style={{ padding: "2rem 1.5rem", maxWidth: 600, margin: "0 auto" }}>
      <h1>Join the queue at {salon.name}</h1>
      <p style={{ color: "#6B6357" }}>{salon.addressLine}</p>
      <WalkInJoinFlow salonId={salon.id} services={salon.services} />
    </main>
  );
}
