import type { Metadata } from "next";
import Link from "next/link";
import { DISCOVERY_PATHS, HAIRSTYLE_CATALOG } from "@barbercue/shared";
import type { CityDto, PaginatedResult, SalonListItemDto } from "@barbercue/shared";
import { fetchDiscoveryOrNull } from "../../lib/discovery-api";
import { absoluteUrl, DISCOVERY_REVALIDATE_SECONDS, SITE_URL } from "../../lib/seo";
import { JsonLd } from "../../components/discovery/JsonLd";
import { SalonCard } from "../../components/discovery/SalonCard";
import { HeroSlideshow } from "../../components/landing/HeroSlideshow";
import styles from "../../components/landing/landing.module.css";

// No "BarberCue" here: the root layout's title template ("%s | BarberCue") already appends the
// brand name — including it here duplicated it in the browser tab and every social share card.
const TITLE = "Find a barbershop near you";
const DESCRIPTION =
  "Discover nearby barbershops, see the current wait, and book your chair online. No app required.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/") },
  openGraph: { title: TITLE, description: DESCRIPTION, url: absoluteUrl("/"), type: "website" },
};

function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "BarberCue",
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

const HOW_IT_WORKS = [
  {
    title: "Find a shop",
    text: "Browse barbershops by city, or search by name and service.",
  },
  {
    title: "Book or join the queue",
    text: "Reserve a time slot ahead, or check in remotely and join the live queue from wherever you are.",
  },
  {
    title: "Get notified",
    text: "Watch your position update in real time and get called when your chair is ready.",
  },
  {
    title: "Walk in and go",
    text: "Show up right on time — no waiting room, no wasted afternoon.",
  },
];

const CUSTOMER_BENEFITS = [
  "See real-time wait times before you leave home",
  "Book a specific time, or join the queue remotely",
  "Track your position live — no more guessing",
  "Sign in with Google or your phone number, no password to remember",
];

const OWNER_BENEFITS = [
  "A live queue dashboard your staff can run the floor from",
  "Online bookings that fill your chairs automatically",
  "A unique, permanent Shop ID for your listing",
  "Free to register — no setup fees to get started",
];

// Full landing-page redesign (major-upgrade phase) — replaces the Phase 1 foundation-shell
// placeholder. Sections implemented: Hero (+ illustrated slideshow), How It Works, Find a Shop,
// Skip the Queue, AI Style Advisor teaser, Popular Styles, Featured Shops, Customer Benefits,
// Owner Benefits, Final CTA, Footer. "Book appointment" is folded into How It Works rather than
// duplicated as its own section, and Testimonials is deliberately omitted — this is a pre-launch
// product with no real customers yet, and a fabricated quote would be dishonest marketing filler.
export default async function HomePage() {
  const [cities, featured] = await Promise.all([
    fetchDiscoveryOrNull<CityDto[]>(DISCOVERY_PATHS.cities, DISCOVERY_REVALIDATE_SECONDS).catch(() => null),
    fetchDiscoveryOrNull<PaginatedResult<SalonListItemDto>>(
      `${DISCOVERY_PATHS.salons}?limit=3`,
      DISCOVERY_REVALIDATE_SECONDS,
    ).catch(() => null),
  ]);

  return (
    <main className={styles.page}>
      <JsonLd data={organizationJsonLd()} />

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div>
            <h1 className={styles.heroHeadline}>Skip the wait. Book your chair.</h1>
            <p className={styles.heroSub}>
              Find a nearby barbershop, see the current wait before you leave, and book online —
              or join the live queue and walk in right when it&apos;s your turn.
            </p>
            <div className={styles.ctaRow}>
              <Link href="/search" className={styles.ctaPrimary}>
                Find a Barber Shop
              </Link>
              <Link href="/dashboard/register-shop" className={styles.ctaSecondary}>
                Register your Shop
              </Link>
            </div>
          </div>
          <HeroSlideshow />
        </div>
      </section>

      {/* How it works */}
      <section className={styles.section}>
        <div className={styles.inner}>
          <p className={styles.eyebrow}>How it works</p>
          <h2 className={styles.sectionTitle}>From find to chair in four steps</h2>
          <div className={styles.stepGrid} style={{ marginTop: 28 }}>
            {HOW_IT_WORKS.map((step, i) => (
              <div key={step.title} className={styles.stepCard}>
                <span className={styles.stepNumber}>{i + 1}</span>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepText}>{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Find a shop */}
      <section className={styles.sectionAlt}>
        <div className={styles.inner}>
          <p className={styles.eyebrow}>Find a shop</p>
          <h2 className={styles.sectionTitle}>Browse barbershops by city</h2>
          {cities && cities.length > 0 ? (
            <nav className={styles.chipRow} aria-label="Browse cities">
              {cities.map((c) => (
                <Link key={c.slug} href={`/${c.slug}`} className={styles.chip}>
                  {c.name}
                </Link>
              ))}
            </nav>
          ) : (
            <p style={{ color: "#6B6357" }}>No cities listed yet.</p>
          )}
        </div>
      </section>

      {/* Skip the queue */}
      <section className={styles.section}>
        <div className={styles.inner}>
          <p className={styles.eyebrow}>Skip the queue</p>
          <h2 className={styles.sectionTitle}>Join the line without standing in it</h2>
          <p className={styles.sectionLead}>
            Check in remotely and track your position in the live queue in real time. When
            you&apos;re close to the front, head over — your chair will be ready when you arrive.
          </p>
          <Link href="/search" className={styles.ctaSecondary}>
            See shops with a live queue
          </Link>
        </div>
      </section>

      {/* AI Style Advisor */}
      <section className={styles.sectionAlt}>
        <div className={styles.inner}>
          <p className={styles.eyebrow}>New</p>
          <h2 className={styles.sectionTitle}>Not sure what to ask for? Try the AI Style Advisor</h2>
          <p className={styles.sectionLead}>
            Upload a selfie and preview a handful of hairstyles on your own face before you book —
            each shown with an AI Style Match percentage, not a guarantee. Pick a look you like,
            then book the shop to get it.
          </p>
          <Link href="/style-advisor" className={styles.ctaPrimary}>
            Try the AI Style Advisor
          </Link>
        </div>
      </section>

      {/* Popular styles */}
      <section className={styles.section}>
        <div className={styles.inner}>
          <p className={styles.eyebrow}>Popular styles</p>
          <h2 className={styles.sectionTitle}>Styles customers are trying</h2>
          <div className={styles.styleGrid} style={{ marginTop: 24 }}>
            {HAIRSTYLE_CATALOG.map((style) => (
              <Link key={style.id} href="/style-advisor" className={styles.styleChip}>
                {style.name}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured shops */}
      {featured && featured.items.length > 0 && (
        <section className={styles.sectionAlt}>
          <div className={styles.inner}>
            <p className={styles.eyebrow}>On BarberCue</p>
            <h2 className={styles.sectionTitle}>Featured shops</h2>
            <div className={styles.shopGrid} style={{ marginTop: 24 }}>
              {featured.items.map((salon) => (
                <SalonCard key={salon.id} salon={salon} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Customer benefits */}
      <section className={styles.section}>
        <div className={styles.inner}>
          <p className={styles.eyebrow}>For customers</p>
          <h2 className={styles.sectionTitle}>Why customers use BarberCue</h2>
          <div className={styles.benefitGrid} style={{ marginTop: 24 }}>
            {CUSTOMER_BENEFITS.map((b) => (
              <div key={b} className={styles.benefitItem}>
                <span className={styles.benefitMark}>✓</span>
                <p className={styles.benefitText}>{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Owner benefits */}
      <section className={styles.sectionAlt}>
        <div className={styles.inner}>
          <p className={styles.eyebrow}>For shop owners</p>
          <h2 className={styles.sectionTitle}>Run your shop&apos;s floor from one dashboard</h2>
          <div className={styles.benefitGrid} style={{ marginTop: 24, marginBottom: 28 }}>
            {OWNER_BENEFITS.map((b) => (
              <div key={b} className={styles.benefitItem}>
                <span className={styles.benefitMark}>✓</span>
                <p className={styles.benefitText}>{b}</p>
              </div>
            ))}
          </div>
          <Link href="/dashboard/register-shop" className={styles.ctaPrimary}>
            Register your Shop
          </Link>
        </div>
      </section>

      {/* Final CTA */}
      <section className={styles.finalCta}>
        <div className={styles.finalCtaInner}>
          <h2 className={styles.sectionTitle}>Ready to skip the wait?</h2>
          <p style={{ opacity: 0.8, marginBottom: 24 }}>
            Find a shop near you and book your next cut in under a minute.
          </p>
          <div className={styles.ctaRow}>
            <Link href="/search" className={styles.ctaPrimary}>
              Find a Barber Shop
            </Link>
            <Link href="/login" className={styles.ctaSecondary}>
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div>
            <strong className={styles.footerWordmark}>BarberCue</strong>
            <p className={styles.footerNote} style={{ marginTop: 4 }}>
              © {new Date().getFullYear()} BarberCue. Skip the wait, book your chair.
            </p>
          </div>
          <nav className={styles.footerLinks} aria-label="Footer">
            <Link href="/search">Find a shop</Link>
            <Link href="/dashboard/register-shop">Register your shop</Link>
            <Link href="/login">Customer login</Link>
            <Link href="/owner/login">Owner login</Link>
            <Link href="/staff/login">Staff login</Link>
            <Link href="/admin/login">Admin login</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
