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
import { SEO_SERVICES } from "../../../../lib/seo-services";
import styles from "./city.module.css";

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

  const title = `Salons, barbershops, beauty parlours & spas in ${city.name}`;
  const description = `Find the best salons, barbershops, beauty parlours, spas and nail studios in ${city.name}, ${city.state}. Haircut, facial, waxing, hair spa, bridal makeup and more — see prices and wait times, book ahead or join the live queue.`;
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
    <main className={styles.page}>
      <JsonLd data={breadcrumbJsonLd(breadcrumbItems, SITE_URL)} />
      <div className={styles.breadcrumbs}>
        <Breadcrumbs items={breadcrumbItems} />
      </div>

      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Salons · Barbershops · Beauty parlours · Spas</p>
          <h1>Salons &amp; barbershops in {city.name}</h1>
          <p className={styles.location}>{city.state}, {city.country}</p>
        </div>
      </header>

      {localities && localities.length > 0 && (
        <section className={styles.areas}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Narrow your search</p>
            <h2>Browse by area</h2>
          </div>
          <nav className={styles.areaLinks} aria-label={`Areas in ${city.name}`}>
            {localities.map((l) => (
              <Link
                key={l.slug}
                href={`${cityPath}/areas/${l.slug}`}
              >
                {l.name}
              </Link>
            ))}
          </nav>
        </section>
      )}

      <section className={styles.areas}>
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Popular in {city.name}</p>
          <h2>Beauty services in {city.name}</h2>
        </div>
        <nav className={styles.areaLinks} aria-label={`Services in ${city.name}`}>
          {SEO_SERVICES.map((svc) => (
            <Link key={svc.slug} href={`${cityPath}/services/${svc.slug}`}>
              {svc.name}
            </Link>
          ))}
        </nav>
      </section>

      <section className={styles.shops}>
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Book or walk in</p>
          <h2>Shops in {city.name}</h2>
        </div>
        {salons && salons.items.length > 0 ? (
          <div className={styles.grid}>
            {salons.items.map((s) => <SalonCard key={s.id} salon={s} />)}
          </div>
        ) : (
          <div className={styles.empty}>
            <span aria-hidden="true">⌖</span>
            <h2>No shops are listed in {city.name} yet</h2>
            <p>Try another nearby city or invite your local barbershop to FastQue.</p>
            <div>
              <Link href="/search">Search another city</Link>
              <Link href="/register/salon">List a barbershop</Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
