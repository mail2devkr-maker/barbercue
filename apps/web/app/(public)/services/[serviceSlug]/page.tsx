import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { CityDto, PaginatedResult, SalonListItemDto } from "@barbercue/shared";
import { fetchDiscoveryOrNull } from "../../../../lib/discovery-api";
import { absoluteUrl, DISCOVERY_REVALIDATE_SECONDS, SITE_URL } from "../../../../lib/seo";
import { seoServiceBySlug } from "../../../../lib/seo-services";
import {
  faqJsonLd,
  SalonResults,
  salonItemListJsonLd,
  serviceFaq,
  ServiceFaqAndRelated,
} from "../../../../lib/seo-service-page";
import { Breadcrumbs, breadcrumbJsonLd } from "../../../../components/discovery/Breadcrumbs";
import { JsonLd } from "../../../../components/discovery/JsonLd";
import styles from "../../[countryCode]/[citySlug]/city.module.css";

export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ serviceSlug: string }> }): Promise<Metadata> {
  const { serviceSlug } = await params;
  const service = seoServiceBySlug(serviceSlug);
  // Unknown entity: a real 404 (crawlers wait for metadata, so this beats the streamed 200).
  if (!service) notFound();
  const title = `${service.name} near you — best salons, barbers & parlours`;
  const description = `${service.blurb} Compare prices, book ahead or join the live queue on FastQue. Also known as ${service.aka.slice(0, 3).join(", ")}.`;
  const url = absoluteUrl(`/services/${service.slug}`);
  return {
    title,
    description,
    keywords: [service.name, ...service.aka],
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
  };
}

export default async function ServicePage({ params }: { params: Promise<{ serviceSlug: string }> }) {
  const { serviceSlug } = await params;
  const service = seoServiceBySlug(serviceSlug);
  if (!service) notFound();

  const [cities, salons] = await Promise.all([
    fetchDiscoveryOrNull<CityDto[]>(DISCOVERY_PATHS.cities, DISCOVERY_REVALIDATE_SECONDS),
    fetchDiscoveryOrNull<PaginatedResult<SalonListItemDto>>(
      `${DISCOVERY_PATHS.salons}?service=${encodeURIComponent(service.query)}&limit=24`,
      DISCOVERY_REVALIDATE_SECONDS,
    ),
  ]);
  const pageUrl = absoluteUrl(`/services/${service.slug}`);
  const crumbs = [
    { label: "Home", href: "/" },
    { label: "Services", href: "/services" },
    { label: service.name, href: `/services/${service.slug}` },
  ];

  return (
    <main className={styles.page}>
      <JsonLd data={breadcrumbJsonLd(crumbs, SITE_URL)} />
      <JsonLd data={faqJsonLd(serviceFaq(service, null))} />
      {salons && salons.items.length > 0 && <JsonLd data={salonItemListJsonLd(salons.items, pageUrl, SITE_URL)} />}
      <div className={styles.breadcrumbs}>
        <Breadcrumbs items={crumbs} />
      </div>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{service.category}</p>
          <h1>{service.name} near you</h1>
          <p className={styles.location}>{service.blurb} Book ahead or join the live queue — no waiting at the shop.</p>
        </div>
      </header>

      {cities && cities.length > 0 && (
        <section className={styles.areas}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Choose your city</p>
            <h2>{service.name} by city</h2>
          </div>
          <nav className={styles.areaLinks} aria-label={`${service.name} by city`}>
            {cities.map((c) => (
              <Link
                key={`${c.countryCode}-${c.slug}`}
                href={`/${c.countryCode.toLowerCase()}/${c.slug}/services/${service.slug}`}
              >
                {service.name} in {c.name}
              </Link>
            ))}
          </nav>
        </section>
      )}

      <SalonResults salons={salons} service={service} place="near you" />
      <ServiceFaqAndRelated service={service} place={null} cityPath={null} />
    </main>
  );
}
