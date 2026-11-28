import { formatMoney } from "@barbercue/shared";
import type { CityDto, SalonProfileDto } from "@barbercue/shared";

/**
 * Public-salon SEO helpers (issue #429 / super SEO pass). Everything here describes only data the
 * shop has actually published; nothing is guessed or invented.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

type SalonKind = Pick<SalonProfileDto, "salonType" | "salonTypeConfirmed">;

/**
 * schema.org type for the shop. schema.org has no "barbershop" type; HairSalon is the correct one
 * for men's and unisex grooming, BeautySalon for a ladies' beauty parlour.
 */
export function salonSchemaType(salon: SalonKind): "HairSalon" | "BeautySalon" {
  return salon.salonTypeConfirmed && salon.salonType === "LADIES" ? "BeautySalon" : "HairSalon";
}

/** Human label for headings: never call a ladies' parlour a "barbershop". */
export function salonKindLabel(salon: SalonKind): string {
  if (!salon.salonTypeConfirmed) return "Salon";
  if (salon.salonType === "GENTS") return "Barbershop";
  if (salon.salonType === "LADIES") return "Beauty parlour";
  return "Unisex salon";
}

function priceRange(salon: SalonProfileDto): string | undefined {
  if (salon.priceMin === null || salon.priceMax === null) return undefined;
  const min = formatMoney(salon.priceMin, salon.currency, salon.countryCode);
  if (salon.priceMin === salon.priceMax) return min;
  return `${min}–${formatMoney(salon.priceMax, salon.currency, salon.countryCode)}`;
}

/**
 * LocalBusiness JSON-LD for a public shop page.
 *
 * Deliberately NO aggregateRating: the reviews are collected on FastQue itself, and Google treats
 * a business page that controls its own reviews as ineligible for review stars (self-serving
 * reviews). Ratings stay visible on the page for people.
 */
export function buildSalonJsonLd(
  salon: SalonProfileDto,
  pageUrl: string,
  city: Pick<CityDto, "name" | "state"> | null,
  localityName: string | null,
) {
  const openHours = salon.operatingHours
    .filter((h) => !h.isClosed && h.openTime && h.closeTime)
    .map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: DAY_NAMES[h.dayOfWeek],
      opens: h.openTime,
      closes: h.closeTime,
    }));
  const images = salon.photos.map((p) => p.url).filter(Boolean);
  const range = priceRange(salon);
  return {
    "@context": "https://schema.org",
    "@type": salonSchemaType(salon),
    "@id": `${pageUrl}#business`,
    name: salon.name,
    url: pageUrl,
    ...(salon.description ? { description: salon.description } : {}),
    ...(salon.phone ? { telephone: salon.phone } : {}),
    ...(images.length > 0 ? { image: images.slice(0, 6) } : salon.coverPhotoUrl ? { image: [salon.coverPhotoUrl] } : {}),
    address: {
      "@type": "PostalAddress",
      streetAddress: salon.addressLine,
      ...(localityName ? { addressLocality: `${localityName}, ${city?.name ?? ""}`.replace(/, $/, "") } : city ? { addressLocality: city.name } : {}),
      ...(city?.state ? { addressRegion: city.state } : {}),
      ...(salon.postalCode ? { postalCode: salon.postalCode } : {}),
      addressCountry: salon.countryCode,
    },
    ...(salon.lat !== null && salon.lng !== null
      ? { geo: { "@type": "GeoCoordinates", latitude: salon.lat, longitude: salon.lng } }
      : {}),
    ...(openHours.length > 0 ? { openingHoursSpecification: openHours } : {}),
    ...(range ? { priceRange: range } : {}),
    ...(salon.services.length > 0
      ? {
          hasOfferCatalog: {
            "@type": "OfferCatalog",
            name: `Services at ${salon.name}`,
            itemListElement: salon.services.slice(0, 50).map((svc) => ({
              "@type": "Offer",
              itemOffered: { "@type": "Service", name: svc.name },
              ...(typeof svc.price === "number"
                ? { price: svc.price, priceCurrency: salon.currency ?? "INR" }
                : {}),
            })),
          },
        }
      : {}),
  };
}
