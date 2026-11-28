import Link from "next/link";
import type { PaginatedResult, SalonListItemDto } from "@barbercue/shared";
import { SalonCard } from "../components/discovery/SalonCard";
import { relatedSeoServices, type SeoService } from "./seo-services";
import styles from "../app/(public)/[countryCode]/[citySlug]/city.module.css";

/** FAQ answers shared by the national and city service pages (also emitted as FAQPage JSON-LD). */
export function serviceFaq(service: SeoService, place: string | null) {
  const where = place ? ` in ${place}` : " near you";
  return [
    {
      q: `Where can I get a ${service.name.toLowerCase()}${where}?`,
      a: `FastQue lists salons, barbershops, beauty parlours and spas${where} that offer ${service.name.toLowerCase()}. Compare prices and timings, then book a slot or join the live queue from your phone.`,
    },
    {
      q: `How much does a ${service.name.toLowerCase()} cost${where}?`,
      a: `Prices are set by each salon and shown on its FastQue page before you book, so you can compare salons${where} and pick one that fits your budget.`,
    },
    {
      q: `Can I skip the waiting line for ${service.name.toLowerCase()}?`,
      a: "Yes. Join the salon's live queue on FastQue and see your place in line, or book a time in advance — no more waiting at the shop.",
    },
  ];
}

export function faqJsonLd(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.q,
      acceptedAnswer: { "@type": "Answer", text: i.a },
    })),
  };
}

export function salonItemListJsonLd(salons: SalonListItemDto[], pageUrl: string, siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    url: pageUrl,
    itemListElement: salons.map((s, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: s.name,
      url: `${siteUrl}/${s.countryCode.toLowerCase()}/${s.citySlug}/${s.slug}`,
    })),
  };
}

export function SalonResults({
  salons,
  service,
  place,
}: {
  salons: PaginatedResult<SalonListItemDto> | null;
  service: SeoService;
  place: string;
}) {
  return (
    <section className={styles.shops}>
      <div className={styles.sectionHeading}>
        <p className={styles.eyebrow}>Book or walk in</p>
        <h2>
          {service.name} {place === "near you" ? "near you" : `in ${place}`}
        </h2>
      </div>
      {salons && salons.items.length > 0 ? (
        <div className={styles.grid}>
          {salons.items.map((s) => (
            <SalonCard key={s.id} salon={s} />
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <span aria-hidden="true">⌖</span>
          <h2>More salons for {service.name.toLowerCase()} are joining soon</h2>
          <p>Search all shops or invite your favourite salon to FastQue.</p>
          <div>
            <Link href="/search">Search shops</Link>
            <Link href="/register/salon">List your salon</Link>
          </div>
        </div>
      )}
    </section>
  );
}

export function ServiceFaqAndRelated({ service, place, cityPath }: { service: SeoService; place: string | null; cityPath: string | null }) {
  const faq = serviceFaq(service, place);
  const related = relatedSeoServices(service);
  return (
    <>
      <section className={styles.areas}>
        <div className={styles.sectionHeading}>
          <h2>Questions about {service.name.toLowerCase()}</h2>
        </div>
        {faq.map((f) => (
          <div key={f.q}>
            <h3>{f.q}</h3>
            <p className={styles.location}>{f.a}</p>
          </div>
        ))}
        <p className={styles.location}>Also searched as: {service.aka.join(", ")}.</p>
      </section>
      {related.length > 0 && (
        <section className={styles.areas}>
          <div className={styles.sectionHeading}>
            <h2>Related services</h2>
          </div>
          <nav className={styles.areaLinks} aria-label="Related services">
            {related.map((r) => (
              <Link key={r.slug} href={cityPath ? `${cityPath}/services/${r.slug}` : `/services/${r.slug}`}>
                {r.name}
              </Link>
            ))}
            <Link href="/services">All services</Link>
          </nav>
        </section>
      )}
    </>
  );
}
