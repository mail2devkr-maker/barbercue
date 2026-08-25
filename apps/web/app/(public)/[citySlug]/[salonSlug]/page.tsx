import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DISCOVERY_PATHS, formatMoney } from "@barbercue/shared";
import type { CityDto, LocalityDto, SalonProfileDto } from "@barbercue/shared";
import { fetchDiscoveryOrNull } from "../../../../lib/discovery-api";
import { absoluteUrl, DISCOVERY_REVALIDATE_SECONDS, SITE_URL } from "../../../../lib/seo";
import { ServiceList } from "../../../../components/discovery/ServiceList";
import { OperatingHoursTable } from "../../../../components/discovery/OperatingHoursTable";
import { PhotoGallery } from "../../../../components/discovery/PhotoGallery";
import { ReviewList } from "../../../../components/discovery/ReviewList";
import { Breadcrumbs, breadcrumbJsonLd } from "../../../../components/discovery/Breadcrumbs";
import { JsonLd } from "../../../../components/discovery/JsonLd";

interface SalonPageParams {
  citySlug: string;
  salonSlug: string;
}

async function loadSalon(citySlug: string, salonSlug: string) {
  return fetchDiscoveryOrNull<SalonProfileDto>(
    `${DISCOVERY_PATHS.salons}/${citySlug}/${salonSlug}`,
    DISCOVERY_REVALIDATE_SECONDS,
  );
}

export async function generateMetadata({ params }: { params: Promise<SalonPageParams> }): Promise<Metadata> {
  const { citySlug, salonSlug } = await params;
  const salon = await loadSalon(citySlug, salonSlug);
  if (!salon) return {};

  const title = salon.name;
  const description =
    salon.description ?? `${salon.name} — services, prices, hours, and reviews. Book your chair online.`;
  const url = absoluteUrl(`/${salon.citySlug}/${salon.slug}`);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: salon.coverPhotoUrl ? [{ url: salon.coverPhotoUrl }] : undefined,
    },
  };
}

// HairSalon (schema.org LocalBusiness subtype) — see PROJECT_STRUCTURE.md "SEO details".
// aggregateRating is omitted entirely when there are zero reviews (Schema.org discourages a
// fabricated 0/5), matching the API's own null-when-empty convention.
function buildHairSalonJsonLd(salon: SalonProfileDto) {
  return {
    "@context": "https://schema.org",
    "@type": "HairSalon",
    name: salon.name,
    url: absoluteUrl(`/${salon.citySlug}/${salon.slug}`),
    telephone: salon.phone ?? undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: salon.addressLine,
      addressLocality: salon.localitySlug ?? salon.citySlug,
      postalCode: salon.postalCode ?? undefined,
      // From the salon's own city, never a hardcoded country: emitting "IN" for a business
      // outside India is false structured data that search engines act on.
      addressCountry: salon.countryCode,
    },
    // Omitted entirely when the owner registered without GPS — same rule as aggregateRating
    // above. A GeoCoordinates with null lat/lng is invalid structured data, and emitting one
    // is worse for search engines than emitting no geo block at all.
    geo:
      salon.lat !== null && salon.lng !== null
        ? {
            "@type": "GeoCoordinates",
            latitude: salon.lat,
            longitude: salon.lng,
          }
        : undefined,
    openingHoursSpecification: salon.operatingHours
      .filter((h) => !h.isClosed)
      .map((h) => ({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ][h.dayOfWeek],
        opens: h.openTime,
        closes: h.closeTime,
      })),
    ...(salon.priceMin !== null && salon.priceMax !== null
      ? {
          priceRange:
            salon.priceMin === salon.priceMax
              ? formatMoney(salon.priceMin, salon.currency, salon.countryCode)
              : `${formatMoney(salon.priceMin, salon.currency, salon.countryCode)}–${formatMoney(salon.priceMax, salon.currency, salon.countryCode)}`,
        }
      : {}),
    ...(salon.ratingCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: salon.ratingAverage,
            reviewCount: salon.ratingCount,
          },
        }
      : {}),
  };
}

export default async function SalonPage({
  params,
  searchParams,
}: {
  params: Promise<SalonPageParams>;
  searchParams: Promise<{ style?: string }>;
}) {
  const { citySlug, salonSlug } = await params;
  const { style } = await searchParams;
  const salon = await loadSalon(citySlug, salonSlug);
  if (!salon) notFound();

  // AI Style Advisor hand-off (major-upgrade phase): "Try This Look" carries the chosen style
  // name through search -> this profile page -> the booking form via this one query param, so the
  // final POST /bookings body can include it (Booking.selectedStyleName).
  const bookHref = `/book/${salon.slug}?city=${citySlug}${style ? `&style=${encodeURIComponent(style)}` : ""}`;

  const [city, locality] = await Promise.all([
    fetchDiscoveryOrNull<CityDto>(`${DISCOVERY_PATHS.cities}/${citySlug}`, DISCOVERY_REVALIDATE_SECONDS),
    salon.localitySlug
      ? fetchDiscoveryOrNull<LocalityDto>(
          `${DISCOVERY_PATHS.cities}/${citySlug}/localities/${salon.localitySlug}`,
          DISCOVERY_REVALIDATE_SECONDS,
        )
      : Promise.resolve(null),
  ]);

  const breadcrumbItems = [
    { label: "Home", href: "/" },
    { label: city?.name ?? citySlug, href: `/${citySlug}` },
    ...(salon.localitySlug
      ? [{ label: locality?.name ?? salon.localitySlug, href: `/${citySlug}/areas/${salon.localitySlug}` }]
      : []),
    { label: salon.name, href: `/${citySlug}/${salon.slug}` },
  ];

  return (
    <main style={{ padding: "2rem 1.5rem", maxWidth: 800, margin: "0 auto" }}>
      <JsonLd data={breadcrumbJsonLd(breadcrumbItems, SITE_URL)} />
      <JsonLd data={buildHairSalonJsonLd(salon)} />
      <Breadcrumbs items={breadcrumbItems} />

      <h1>{salon.name}</h1>
      <p style={{ color: "#6B6357" }}>{salon.addressLine}</p>
      {salon.phone && <p style={{ color: "#6B6357" }}>{salon.phone}</p>}
      {salon.ratingCount > 0 && (
        <p style={{ color: "#6B6357" }}>
          ★ {salon.ratingAverage?.toFixed(1)} ({salon.ratingCount} review{salon.ratingCount === 1 ? "" : "s"})
        </p>
      )}
      {salon.description && <p>{salon.description}</p>}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link
          href={bookHref}
          style={{
            display: "inline-block",
            marginTop: 8,
            padding: "10px 20px",
            background: "#B0413E",
            color: "#fff",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Book an appointment
        </Link>
        <Link
          href={`/queue/${salon.slug}?city=${citySlug}`}
          style={{
            display: "inline-block",
            marginTop: 8,
            padding: "10px 20px",
            background: "#fff",
            color: "#B0413E",
            border: "1px solid #B0413E",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Join queue now
        </Link>
      </div>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: "1.1rem" }}>Photos</h2>
        <PhotoGallery photos={salon.photos} salonName={salon.name} />
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: "1.1rem" }}>Services</h2>
        <ServiceList
          services={salon.services}
          currency={salon.currency}
          countryCode={salon.countryCode}
        />
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: "1.1rem" }}>Opening hours</h2>
        <OperatingHoursTable hours={salon.operatingHours} />
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: "1.1rem" }}>Reviews</h2>
        <ReviewList reviews={salon.reviews} />
      </section>
    </main>
  );
}
