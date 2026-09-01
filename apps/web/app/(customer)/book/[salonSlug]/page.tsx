import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { PublicSalonStatusDto, SalonProfileDto } from "@barbercue/shared";
import { fetchDiscoveryOrNull } from "../../../../lib/discovery-api";
import { BookingFlow } from "../../../../components/booking/BookingFlow";
import { EditorialImage } from "../../../../components/editorial/EditorialImage";
import { PublicSalonStatus } from "../../../../components/discovery/PublicSalonStatus";
import styles from "./book.module.css";

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
  const publicStatus = await fetchDiscoveryOrNull<PublicSalonStatusDto>(
    `${DISCOVERY_PATHS.salons}/${country}/${city}/${salonSlug}/${DISCOVERY_PATHS.status}`,
    0,
  ).catch(() => null);

  return (
    <main className={styles.page}>
      <div className={styles.banner} aria-hidden="true">
        <EditorialImage id="process-haircut" fill priority sizes="(max-width: 760px) 100vw, 760px" />
        <div className={styles.bannerScrim} />
        <p className={styles.bannerCaption}>Precision, comfort, and a chair that&apos;s ready when you are.</p>
      </div>

      <div className={styles.header}>
        <p className={styles.eyebrow}>Booking</p>
        <h1>Book at {salon.name}</h1>
        <p className={styles.address}>{salon.addressLine}</p>
      </div>

      {publicStatus && <PublicSalonStatus status={publicStatus} compact />}

      <BookingFlow
        salonId={salon.id}
        services={salon.services}
        operatingHours={salon.operatingHours}
        currency={salon.currency}
        countryCode={salon.countryCode}
        salonTimeZone={salon.salonTimeZone}
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
