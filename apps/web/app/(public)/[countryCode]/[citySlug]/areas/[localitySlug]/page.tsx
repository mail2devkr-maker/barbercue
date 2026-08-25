import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { CityDto, LocalityDto, PaginatedResult, SalonListItemDto } from "@barbercue/shared";
import { fetchDiscoveryOrNull } from "../../../../../../lib/discovery-api";
import { absoluteUrl, DISCOVERY_REVALIDATE_SECONDS, SITE_URL } from "../../../../../../lib/seo";
import { SalonCard } from "../../../../../../components/discovery/SalonCard";
import { Breadcrumbs, breadcrumbJsonLd } from "../../../../../../components/discovery/Breadcrumbs";
import { JsonLd } from "../../../../../../components/discovery/JsonLd";

interface LocalityPageParams {
  countryCode: string;
  citySlug: string;
  localitySlug: string;
}

async function loadLocality(countryCode: string, citySlug: string, localitySlug: string) {
  return fetchDiscoveryOrNull<LocalityDto>(
    `${DISCOVERY_PATHS.cities}/${countryCode}/${citySlug}/localities/${localitySlug}`,
    DISCOVERY_REVALIDATE_SECONDS,
  );
}

export async function generateMetadata({ params }: { params: Promise<LocalityPageParams> }): Promise<Metadata> {
  const { countryCode, citySlug, localitySlug } = await params;
  const locality = await loadLocality(countryCode, citySlug, localitySlug);
  if (!locality) return {};

  const title = `Barbershops in ${locality.name}`;
  const description = `Find and book nearby barbershops in ${locality.name}. See wait times, services, and prices before you go.`;
  const url = absoluteUrl(`/${countryCode.toLowerCase()}/${citySlug}/areas/${localitySlug}`);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
  };
}

export default async function LocalityPage({ params }: { params: Promise<LocalityPageParams> }) {
  const { countryCode, citySlug, localitySlug } = await params;
  const locality = await loadLocality(countryCode, citySlug, localitySlug);
  if (!locality) notFound();

  const cityPath = `/${countryCode.toLowerCase()}/${citySlug}`;

  const [city, salons] = await Promise.all([
    fetchDiscoveryOrNull<CityDto>(
      `${DISCOVERY_PATHS.cities}/${countryCode}/${citySlug}`,
      DISCOVERY_REVALIDATE_SECONDS,
    ),
    fetchDiscoveryOrNull<PaginatedResult<SalonListItemDto>>(
      `${DISCOVERY_PATHS.salons}?city=${citySlug}&locality=${localitySlug}&countryCode=${countryCode}`,
      DISCOVERY_REVALIDATE_SECONDS,
    ),
  ]);

  const breadcrumbItems = [
    { label: "Home", href: "/" },
    { label: city?.name ?? citySlug, href: cityPath },
    { label: locality.name, href: `${cityPath}/areas/${locality.slug}` },
  ];

  return (
    <main style={{ padding: "2rem 1.5rem", maxWidth: 800, margin: "0 auto" }}>
      <JsonLd data={breadcrumbJsonLd(breadcrumbItems, SITE_URL)} />
      <Breadcrumbs items={breadcrumbItems} />
      <h1>Barbershops in {locality.name}</h1>

      <section style={{ marginTop: 24 }}>
        {salons && salons.items.length > 0 ? (
          salons.items.map((s) => <SalonCard key={s.id} salon={s} />)
        ) : (
          <p style={{ color: "#6B6357" }}>No salons listed in {locality.name} yet.</p>
        )}
      </section>
    </main>
  );
}
