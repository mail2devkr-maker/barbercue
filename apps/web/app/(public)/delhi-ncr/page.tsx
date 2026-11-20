import type { Metadata } from "next";
import Link from "next/link";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { CityDto, PaginatedResult, SalonListItemDto } from "@barbercue/shared";
import { fetchDiscoveryOrNull } from "../../../lib/discovery-api";
import { absoluteUrl, DISCOVERY_REVALIDATE_SECONDS, SITE_URL } from "../../../lib/seo";
import { SalonCard } from "../../../components/discovery/SalonCard";
import { Breadcrumbs, breadcrumbJsonLd } from "../../../components/discovery/Breadcrumbs";
import { JsonLd } from "../../../components/discovery/JsonLd";
import { SEO_SERVICES } from "../../../lib/seo-services";
import { faqJsonLd } from "../../../lib/seo-service-page";
import { delhiNcrFaq, delhiNcrIntro, isDelhiNcrCity } from "../../../lib/seo-region";
import styles from "../[countryCode]/[citySlug]/city.module.css";

const PATH = "/delhi-ncr";
/** Shops shown per city here; the city page lists them all. */
const SHOPS_PER_CITY = 8;

interface RegionCity {
  city: CityDto;
  salons: SalonListItemDto[];
  hasMore: boolean;
}

/** NCR cities with at least one live shop, most shops first. Same requests (and cache keys) as the city pages. */
async function loadRegion(): Promise<RegionCity[]> {
  const cities = (await fetchDiscoveryOrNull<CityDto[]>(DISCOVERY_PATHS.cities, DISCOVERY_REVALIDATE_SECONDS)) ?? [];
  const ncr = cities.filter(isDelhiNcrCity);
  const loaded = await Promise.all(
    ncr.map(async (city) => {
      const res = await fetchDiscoveryOrNull<PaginatedResult<SalonListItemDto>>(
        `${DISCOVERY_PATHS.salons}?city=${city.slug}&countryCode=${city.countryCode}`,
        DISCOVERY_REVALIDATE_SECONDS,
      );
      return { city, salons: res?.items ?? [], hasMore: Boolean(res?.nextCursor) };
    }),
  );
  return loaded.filter((c) => c.salons.length > 0).sort((a, b) => b.salons.length - a.salons.length);
}

const facts = (region: RegionCity[]) =>
  region.map((c) => ({ name: c.city.name, shopCount: c.salons.length, hasMore: c.hasMore }));

export async function generateMetadata(): Promise<Metadata> {
  const region = await loadRegion();
  const title = "Salons, barbershops & beauty parlours in Delhi NCR";
  const description =
    "Book salons, barbershops and beauty parlours in Noida, Greater Noida, Ghaziabad and Delhi on FastQue. See real prices and opening hours, book ahead or join the live queue.";
  const url = absoluteUrl(PATH);
  return {
    title,
    description,
    robots: region.length > 0 ? undefined : { index: false, follow: true },
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
  };
}

export default async function DelhiNcrPage() {
  const region = await loadRegion();
  const f = facts(region);
  const faq = delhiNcrFaq(f);
  const crumbs = [
    { label: "Home", href: "/" },
    { label: "Delhi NCR", href: PATH },
  ];
  const cityList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Delhi NCR cities on FastQue",
    url: absoluteUrl(PATH),
    itemListElement: region.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: `Salons in ${c.city.name}`,
      url: `${SITE_URL}/${c.city.countryCode.toLowerCase()}/${c.city.slug}`,
    })),
  };

  return (
    <main className={styles.page}>
      <JsonLd data={breadcrumbJsonLd(crumbs, SITE_URL)} />
      <JsonLd data={faqJsonLd(faq)} />
      {region.length > 0 && <JsonLd data={cityList} />}
      <div className={styles.breadcrumbs}>
        <Breadcrumbs items={crumbs} />
      </div>

      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Salons · Barbershops · Beauty parlours · Spas</p>
          <h1>Salons &amp; barbershops in Delhi NCR</h1>
          <p className={styles.location}>{delhiNcrIntro(f)}</p>
        </div>
      </header>

      {region.length > 0 && (
        <section className={styles.areas}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Choose your city</p>
            <h2>Cities in Delhi NCR</h2>
          </div>
          <nav className={styles.areaLinks} aria-label="Delhi NCR cities">
            {region.map((c) => (
              <Link key={c.city.slug} href={`/${c.city.countryCode.toLowerCase()}/${c.city.slug}`}>
                {c.city.name} ({c.salons.length}
                {c.hasMore ? "+" : ""})
              </Link>
            ))}
          </nav>
        </section>
      )}

      {region.map((c) => {
        const cityPath = `/${c.city.countryCode.toLowerCase()}/${c.city.slug}`;
        const shown = c.salons.slice(0, SHOPS_PER_CITY);
        const more = c.salons.length > shown.length || c.hasMore;
        return (
          <section key={c.city.slug} className={styles.shops}>
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>{c.city.state}</p>
              <h2>Salons &amp; barbershops in {c.city.name}</h2>
            </div>
            <div className={styles.grid}>
              {shown.map((s) => (
                <SalonCard key={s.id} salon={s} />
              ))}
            </div>
            <nav className={styles.areaLinks} aria-label={`More in ${c.city.name}`}>
              <Link href={cityPath}>{more ? `See all shops in ${c.city.name}` : `More about salons in ${c.city.name}`}</Link>
              {SEO_SERVICES.slice(0, 4).map((svc) => (
                <Link key={svc.slug} href={`${cityPath}/services/${svc.slug}`}>
                  {svc.name} in {c.city.name}
                </Link>
              ))}
            </nav>
          </section>
        );
      })}

      {region.length === 0 && (
        <section className={styles.shops}>
          <div className={styles.empty}>
            <span aria-hidden="true">⌖</span>
            <h2>No shops are listed in Delhi NCR yet</h2>
            <div>
              <Link href="/search">Search all cities</Link>
            </div>
          </div>
        </section>
      )}

      <section className={styles.areas}>
        <div className={styles.sectionHeading}>
          <h2>Salon booking in Delhi NCR: common questions</h2>
        </div>
        {faq.map((item) => (
          <div key={item.q}>
            <h3>{item.q}</h3>
            <p className={styles.location}>{item.a}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
