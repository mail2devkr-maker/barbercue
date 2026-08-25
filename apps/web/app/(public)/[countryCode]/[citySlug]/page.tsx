import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { CityDto, LocalityDto, PaginatedResult, SalonListItemDto } from "@barbercue/shared";
import { fetchDiscoveryOrNull } from "../../../../lib/discovery-api";
import { absoluteUrl, DISCOVERY_REVALIDATE_SECONDS, SITE_URL } from "../../../../lib/seo";
import { SalonCard } from "../../../../components/discovery/SalonCard";
import { Breadcrumbs, breadcrumbJsonLd } from "../../../../components/discovery/Breadcrumbs";
import { JsonLd } from "../../../../components/discovery/JsonLd";

interface CityPageParams {
  // ISO-3166-1 alpha-2, lowercase in the URL by convention (e.g. "in") — the backend uppercases
  // it before the (countryCode, slug) lookup, so either case resolves identically.
  countryCode: string;
  citySlug: string;
}

async function loadCity(countryCode: string, citySlug: string) {
  return fetchDiscoveryOrNull<CityDto>(
    `${DISCOVERY_PATHS.cities}/${countryCode}/${citySlug}`,
    DISCOVERY_REVALIDATE_SECONDS,
  );
}

export async function generateMetadata({ params }: { params: Promise<CityPageParams> }): Promise<Metadata> {
  const { countryCode, citySlug } = await params;
  const city = await loadCity(countryCode, citySlug);
  if (!city) return {};

  const title = `Barbershops in ${city.name}`;
  const description = `Find and book nearby barbershops in ${city.name}, ${city.state}. See wait times, services, and prices before you go.`;
  const url = absoluteUrl(`/${city.countryCode.toLowerCase()}/${city.slug}`);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
  };
}

export default async function CityPage({ params }: { params: Promise<CityPageParams> }) {
  const { countryCode, citySlug } = await params;
  const city = await loadCity(countryCode, citySlug);
  if (!city) notFound();

  const cityPath = `/${city.countryCode.toLowerCase()}/${city.slug}`;

  const [localities, salons] = await Promise.all([
    fetchDiscoveryOrNull<LocalityDto[]>(
      `${DISCOVERY_PATHS.cities}/${countryCode}/${citySlug}/localities`,
      DISCOVERY_REVALIDATE_SECONDS,
    ),
    fetchDiscoveryOrNull<PaginatedResult<SalonListItemDto>>(
      `${DISCOVERY_PATHS.salons}?city=${citySlug}&countryCode=${city.countryCode}`,
      DISCOVERY_REVALIDATE_SECONDS,
    ),
  ]);

  const breadcrumbItems = [
    { label: "Home", href: "/" },
    { label: city.name, href: cityPath },
  ];

  return (
    <main style={{ padding: "2rem 1.5rem", maxWidth: 800, margin: "0 auto" }}>
      <JsonLd data={breadcrumbJsonLd(breadcrumbItems, SITE_URL)} />
      <Breadcrumbs items={breadcrumbItems} />
      <h1>Barbershops in {city.name}</h1>
      <p style={{ color: "#6B6357" }}>
        {city.state}, {city.country}
      </p>

      {localities && localities.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: "1.1rem" }}>Areas</h2>
          <nav style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {localities.map((l) => (
              <Link
                key={l.slug}
                href={`${cityPath}/areas/${l.slug}`}
                style={{
                  fontSize: "0.85rem",
                  padding: "6px 12px",
                  border: "1px solid #E7E0D3",
                  borderRadius: 20,
                  color: "#1C1A17",
                }}
              >
                {l.name}
              </Link>
            ))}
          </nav>
        </section>
      )}

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: "1.1rem" }}>Salons</h2>
        {salons && salons.items.length > 0 ? (
          salons.items.map((s) => <SalonCard key={s.id} salon={s} />)
        ) : (
          <p style={{ color: "#6B6357" }}>No salons listed in {city.name} yet.</p>
        )}
      </section>
    </main>
  );
}
