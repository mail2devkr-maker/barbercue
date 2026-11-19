import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { CityDto, PaginatedResult, SalonListItemDto } from "@barbercue/shared";
import { fetchDiscoveryOrNull } from "../../../../../../lib/discovery-api";
import { absoluteUrl, DISCOVERY_REVALIDATE_SECONDS, SITE_URL } from "../../../../../../lib/seo";
import { citySalonsWithServicePath, seoServiceBySlug } from "../../../../../../lib/seo-services";
import {
  faqJsonLd,
  SalonResults,
  salonItemListJsonLd,
  serviceFaq,
  ServiceFaqAndRelated,
} from "../../../../../../lib/seo-service-page";
import { Breadcrumbs, breadcrumbJsonLd } from "../../../../../../components/discovery/Breadcrumbs";
import { JsonLd } from "../../../../../../components/discovery/JsonLd";
import styles from "../../city.module.css";

export const revalidate = 3600;

interface Params {
  countryCode: string;
  citySlug: string;
  serviceSlug: string;
}

function loadSalons(city: CityDto, query: string) {
  return fetchDiscoveryOrNull<PaginatedResult<SalonListItemDto>>(
    citySalonsWithServicePath(city, query),
    DISCOVERY_REVALIDATE_SECONDS,
  );
}

async function loadCity(countryCode: string, citySlug: string) {
  return fetchDiscoveryOrNull<CityDto>(`${DISCOVERY_PATHS.cities}/${countryCode}/${citySlug}`, DISCOVERY_REVALIDATE_SECONDS);
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { countryCode, citySlug, serviceSlug } = await params;
  const service = seoServiceBySlug(serviceSlug);
  const city = service ? await loadCity(countryCode, citySlug) : null;
  // Unknown entity: a real 404 (crawlers wait for metadata, so this beats the streamed 200).
  if (!service || !city) notFound();
  const title = `${service.name} in ${city.name} — salons, barbers & parlours near you`;
  const description = `Best ${service.name.toLowerCase()} in ${city.name}, ${city.state}. ${service.blurb} Compare prices, book ahead or join the live queue on FastQue.`;
  const url = absoluteUrl(`/${city.countryCode.toLowerCase()}/${city.slug}/services/${service.slug}`);
  // A city with no salon offering this service yet is a thin page: keep it out of Google's index
  // (still followable) until a salon for it joins.
  const salons = await loadSalons(city, service.query).catch(() => null);
  const hasSalons = Boolean(salons && salons.items.length > 0);
  return {
    title,
    description,
    robots: hasSalons ? undefined : { index: false, follow: true },
    keywords: [`${service.name} in ${city.name}`, ...service.aka.map((a) => `${a} ${city.name}`)],
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
  };
}

export default async function CityServicePage({ params }: { params: Promise<Params> }) {
  const { countryCode, citySlug, serviceSlug } = await params;
  const service = seoServiceBySlug(serviceSlug);
  if (!service) notFound();
  const city = await loadCity(countryCode, citySlug);
  if (!city) notFound();

  const cityPath = `/${city.countryCode.toLowerCase()}/${city.slug}`;
  const pageUrl = absoluteUrl(`${cityPath}/services/${service.slug}`);
  const salons = await loadSalons(city, service.query);
  const crumbs = [
    { label: "Home", href: "/" },
    { label: city.name, href: cityPath },
    { label: service.name, href: `${cityPath}/services/${service.slug}` },
  ];

  return (
    <main className={styles.page}>
      <JsonLd data={breadcrumbJsonLd(crumbs, SITE_URL)} />
      <JsonLd data={faqJsonLd(serviceFaq(service, city.name))} />
      {salons && salons.items.length > 0 && <JsonLd data={salonItemListJsonLd(salons.items, pageUrl, SITE_URL)} />}
      <div className={styles.breadcrumbs}>
        <Breadcrumbs items={crumbs} />
      </div>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{service.category}</p>
          <h1>
            {service.name} in {city.name}
          </h1>
          <p className={styles.location}>
            {service.blurb.replace(/ near you\.?$/, "")} in {city.name}, {city.state}. Book ahead or join the live queue on FastQue.
          </p>
        </div>
      </header>

      <SalonResults salons={salons} service={service} place={city.name} />
      <ServiceFaqAndRelated service={service} place={city.name} cityPath={cityPath} />
      <section className={styles.areas}>
        <nav className={styles.areaLinks} aria-label="More">
          <Link href={cityPath}>All salons in {city.name}</Link>
          <Link href={`/services/${service.slug}`}>{service.name} in other cities</Link>
        </nav>
      </section>
    </main>
  );
}
