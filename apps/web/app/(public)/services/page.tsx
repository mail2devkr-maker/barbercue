import type { Metadata } from "next";
import Link from "next/link";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { CityDto } from "@barbercue/shared";
import { fetchDiscoveryOrNull } from "../../../lib/discovery-api";
import { absoluteUrl, DISCOVERY_REVALIDATE_SECONDS, SITE_URL } from "../../../lib/seo";
import { SEO_CATEGORIES, SEO_SHOP_TYPES, seoServicesInCategory } from "../../../lib/seo-services";
import { Breadcrumbs, breadcrumbJsonLd } from "../../../components/discovery/Breadcrumbs";
import { JsonLd } from "../../../components/discovery/JsonLd";
import styles from "../[countryCode]/[citySlug]/city.module.css";

// Rendered per request (data fetches stay cached) so the build never needs a live backend.
export const dynamic = "force-dynamic";

const TITLE = "All beauty & grooming services — salons, barbers, parlours and spas near you";
const DESCRIPTION =
  "Haircut, beard trim, facial, waxing, threading, hair spa, keratin, manicure, pedicure, bridal makeup, massage and more. Compare salons, barbershops, beauty parlours and spas near you on FastQue — book ahead or join the live queue.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/services") },
  openGraph: { title: TITLE, description: DESCRIPTION, url: absoluteUrl("/services"), type: "website" },
};

export default async function ServicesIndexPage() {
  const cities = (await fetchDiscoveryOrNull<CityDto[]>(DISCOVERY_PATHS.cities, DISCOVERY_REVALIDATE_SECONDS)) ?? [];
  const crumbs = [
    { label: "Home", href: "/" },
    { label: "Services", href: "/services" },
  ];
  return (
    <main className={styles.page}>
      <JsonLd data={breadcrumbJsonLd(crumbs, SITE_URL)} />
      <div className={styles.breadcrumbs}>
        <Breadcrumbs items={crumbs} />
      </div>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Every beauty service, one place</p>
          <h1>Beauty &amp; grooming services near you</h1>
          <p className={styles.location}>
            Salons, barbershops, beauty parlours, spas, nail and makeup studios — compare prices, book ahead or join the live queue.
          </p>
        </div>
      </header>

      {SEO_CATEGORIES.map((category) => (
        <section key={category} className={styles.areas}>
          <div className={styles.sectionHeading}>
            <h2>{category}</h2>
          </div>
          <nav className={styles.areaLinks} aria-label={category}>
            {seoServicesInCategory(category).map((svc) => (
              <Link key={svc.slug} href={`/services/${svc.slug}`}>
                {svc.name}
              </Link>
            ))}
          </nav>
        </section>
      ))}

      {cities.length > 0 && (
        <section className={styles.areas}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Find a shop</p>
            <h2>Salons, barbershops &amp; parlours by city</h2>
          </div>
          <nav className={styles.areaLinks} aria-label="Cities">
            {cities.map((c) => (
              <Link key={`${c.countryCode}-${c.slug}`} href={`/${c.countryCode.toLowerCase()}/${c.slug}`}>
                {c.name}
              </Link>
            ))}
          </nav>
          <p className={styles.location}>
            Shop types: {SEO_SHOP_TYPES.map((t) => t.plural).join(" · ")}
          </p>
        </section>
      )}
    </main>
  );
}
