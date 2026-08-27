import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DISCOVERY_PATHS, formatMoney } from "@barbercue/shared";
import type { CityDto, LocalityDto, SalonProfileDto } from "@barbercue/shared";
import { fetchDiscoveryOrNull } from "../../../../../lib/discovery-api";
import { absoluteUrl, DISCOVERY_REVALIDATE_SECONDS, SITE_URL } from "../../../../../lib/seo";
import { ServiceList } from "../../../../../components/discovery/ServiceList";
import { OperatingHoursTable } from "../../../../../components/discovery/OperatingHoursTable";
import { PhotoGallery } from "../../../../../components/discovery/PhotoGallery";
import { ReviewList } from "../../../../../components/discovery/ReviewList";
import { Breadcrumbs, breadcrumbJsonLd } from "../../../../../components/discovery/Breadcrumbs";
import { JsonLd } from "../../../../../components/discovery/JsonLd";
import { SalonImage } from "../../../../../components/ui/SalonImage";
import { LinkButton } from "../../../../../components/ui/Button";
import { Card } from "../../../../../components/ui/Card";

interface SalonPageParams {
  // ISO-3166-1 alpha-2, lowercase in the URL — the backend uppercases it before the (countryCode,
  // slug) city lookup, so either case resolves identically.
  countryCode: string;
  citySlug: string;
  salonSlug: string;
}

async function loadSalon(countryCode: string, citySlug: string, salonSlug: string) {
  return fetchDiscoveryOrNull<SalonProfileDto>(
    `${DISCOVERY_PATHS.salons}/${countryCode}/${citySlug}/${salonSlug}`,
    DISCOVERY_REVALIDATE_SECONDS,
  );
}

/** `/{countryCode}/{citySlug}/{salonSlug}` — B9's canonical public salon URL. */
function salonPath(salon: SalonProfileDto): string {
  return `/${salon.countryCode.toLowerCase()}/${salon.citySlug}/${salon.slug}`;
}

export async function generateMetadata({ params }: { params: Promise<SalonPageParams> }): Promise<Metadata> {
  const { countryCode, citySlug, salonSlug } = await params;
  const salon = await loadSalon(countryCode, citySlug, salonSlug);
  if (!salon) return {};

  const title = salon.name;
  const description =
    salon.description ?? `${salon.name} — services, prices, hours, and reviews. Book your chair online.`;
  const url = absoluteUrl(salonPath(salon));

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
    url: absoluteUrl(salonPath(salon)),
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
  const { countryCode, citySlug, salonSlug } = await params;
  const { style } = await searchParams;
  const salon = await loadSalon(countryCode, citySlug, salonSlug);
  if (!salon) notFound();

  // Query params carried into the (unindexed, ?robots: noindex?) booking/queue flows so those
  // pages can re-resolve the exact same salon: Salon.slug is unique only within one city, and
  // City.slug is unique only within one country, so both are needed to disambiguate.
  const cityQuery = `city=${citySlug}&country=${salon.countryCode}`;

  // AI Style Advisor hand-off (major-upgrade phase): "Try This Look" carries the chosen style
  // name through search -> this profile page -> the booking form via this one query param, so the
  // final POST /bookings body can include it (Booking.selectedStyleName).
  const bookHref = `/book/${salon.slug}?${cityQuery}${style ? `&style=${encodeURIComponent(style)}` : ""}`;

  const cityPath = `/${salon.countryCode.toLowerCase()}/${citySlug}`;

  const [city, locality] = await Promise.all([
    fetchDiscoveryOrNull<CityDto>(
      `${DISCOVERY_PATHS.cities}/${countryCode}/${citySlug}`,
      DISCOVERY_REVALIDATE_SECONDS,
    ),
    salon.localitySlug
      ? fetchDiscoveryOrNull<LocalityDto>(
          `${DISCOVERY_PATHS.cities}/${countryCode}/${citySlug}/localities/${salon.localitySlug}`,
          DISCOVERY_REVALIDATE_SECONDS,
        )
      : Promise.resolve(null),
  ]);

  const breadcrumbItems = [
    { label: "Home", href: "/" },
    { label: city?.name ?? citySlug, href: cityPath },
    ...(salon.localitySlug
      ? [{ label: locality?.name ?? salon.localitySlug, href: `${cityPath}/areas/${salon.localitySlug}` }]
      : []),
    { label: salon.name, href: salonPath(salon) },
  ];

  const sectionHeadingStyle: React.CSSProperties = {
    fontFamily: "var(--font-display)",
    fontWeight: 600,
    fontSize: "1.3rem",
    marginBottom: 16,
  };

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "0 0 3rem" }}>
      <JsonLd data={breadcrumbJsonLd(breadcrumbItems, SITE_URL)} />
      <JsonLd data={buildHairSalonJsonLd(salon)} />

      <div style={{ padding: "1.25rem 1.5rem 0" }}>
        <Breadcrumbs items={breadcrumbItems} />
      </div>

      {/* The cover photo is the first thing a visitor sees on Fresha/Booksy-style profile
          pages — SalonImage's own honest empty state covers a shop with none, so this never
          shows a placeholder photo that isn't really theirs. */}
      <div style={{ padding: "0 1.5rem", marginBottom: 20 }}>
        <SalonImage url={salon.coverPhotoUrl} alt={`${salon.name}'s cover photo`} aspectRatio="16 / 9" rounded={20} priority />
      </div>

      <div style={{ padding: "0 1.5rem" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "2rem", letterSpacing: "-0.01em", marginBottom: 6 }}>
          {salon.name}
        </h1>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", marginBottom: 10 }}>
          {salon.ratingCount > 0 && (
            <span style={{ color: "var(--bc-gold)", fontWeight: 600, fontSize: "0.95rem" }}>
              ★ {salon.ratingAverage?.toFixed(1)}{" "}
              <span style={{ color: "var(--bc-muted)", fontWeight: 400 }}>
                ({salon.ratingCount} review{salon.ratingCount === 1 ? "" : "s"})
              </span>
            </span>
          )}
          <span style={{ color: "var(--bc-muted)" }}>{salon.addressLine}</span>
          {salon.phone && <span style={{ color: "var(--bc-muted)" }}>{salon.phone}</span>}
        </div>
        {salon.description && (
          <p style={{ color: "var(--bc-ink)", lineHeight: 1.6, marginBottom: 20, maxWidth: 640 }}>{salon.description}</p>
        )}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 32 }}>
          <LinkButton href={bookHref} variant="primary">
            Book an appointment
          </LinkButton>
          <LinkButton href={`/queue/${salon.slug}?${cityQuery}`} variant="outline">
            Join queue now
          </LinkButton>
        </div>

        <section style={{ marginBottom: 24 }}>
          <h2 style={sectionHeadingStyle}>Photos</h2>
          <PhotoGallery photos={salon.photos} salonName={salon.name} />
        </section>

        <Card style={{ marginBottom: 24 }}>
          <h2 style={sectionHeadingStyle}>Services</h2>
          <ServiceList services={salon.services} currency={salon.currency} countryCode={salon.countryCode} />
        </Card>

        <Card style={{ marginBottom: 24 }}>
          <h2 style={sectionHeadingStyle}>Opening hours</h2>
          <OperatingHoursTable hours={salon.operatingHours} />
        </Card>

        <Card>
          <h2 style={sectionHeadingStyle}>Reviews</h2>
          <ReviewList reviews={salon.reviews} />
        </Card>
      </div>
    </main>
  );
}
