import type { Metadata } from "next";
import Link from "next/link";
import { DISCOVERY_PATHS, HAIRSTYLE_CATALOG } from "@barbercue/shared";
import type { CityDto, LiveStatsDto, PaginatedResult, SalonListItemDto } from "@barbercue/shared";
import { fetchDiscoveryOrNull } from "../../lib/discovery-api";
import { absoluteUrl, DISCOVERY_REVALIDATE_SECONDS, SITE_URL } from "../../lib/seo";
import { SERVICE_CATEGORIES } from "../../lib/editorial/manifest";
import { JsonLd } from "../../components/discovery/JsonLd";
import { SalonCard } from "../../components/discovery/SalonCard";
import { HeroVisual } from "../../components/landing/HeroVisual";
import { LandingHeaderActions } from "../../components/landing/LandingHeaderActions";
import { EditorialImage } from "../../components/editorial/EditorialImage";
import styles from "../../components/landing/landing.module.css";

const TITLE = "Find a barbershop, salon or spa near you";
const DESCRIPTION =
  "Discover barbers, hair salons, nail bars, spas and more. Book ahead or join a live queue and follow your position in real time.";

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
    name: "FastQue",
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

const BOOK_STEPS = ["Choose a service", "Choose your barber", "Pick a date and time", "Confirm your chair"];
const QUEUE_STEPS = ["Join the live queue", "See your position", "Follow the line as it moves", "Arrive closer to your turn"];

const OWNER_POINTS = [
  "Run the live queue from one floor dashboard",
  "Manage services, barbers, chairs and hours",
  "Get a permanent, shareable FastQue Shop ID",
];

export default async function HomePage() {
  const [cities, featured, liveStats] = await Promise.all([
    fetchDiscoveryOrNull<CityDto[]>(DISCOVERY_PATHS.cities, DISCOVERY_REVALIDATE_SECONDS).catch(() => null),
    fetchDiscoveryOrNull<PaginatedResult<SalonListItemDto>>(
      `${DISCOVERY_PATHS.salons}?limit=3`,
      DISCOVERY_REVALIDATE_SECONDS,
    ).catch(() => null),
    fetchDiscoveryOrNull<LiveStatsDto>(
      `${DISCOVERY_PATHS.salons}/${DISCOVERY_PATHS.liveStats}`,
      DISCOVERY_REVALIDATE_SECONDS,
    ).catch(() => null),
  ]);

  return (
    <div className={styles.page}>
      <JsonLd data={organizationJsonLd()} />

      <header className={styles.landingHeader}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.wordmark} aria-label="FastQue home">
            <span className={styles.wordmarkMark} aria-hidden="true">FQ</span>
            <span>FastQue</span>
          </Link>
          <nav className={styles.headerNav} aria-label="Primary">
            <Link href="/search">Find a barber</Link>
            <Link href="#services">Services</Link>
            <Link href="#book-or-queue">How it works</Link>
            <Link href="#for-shops">For shops</Link>
          </nav>
          <LandingHeaderActions />
        </div>
      </header>

      <main>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <p className={styles.heroEyebrow}>Book ahead · Walk in smarter</p>
            <h1 className={styles.heroHeadline}>Your barber.<br /><em>Your time.</em></h1>
            <p className={styles.heroSub}>
              Discover barbers, hair salons, nail bars, spas and more — built around your day.
              Reserve a chair for later, or join a live queue now and follow your place before
              you leave.
            </p>

            <div className={styles.heroCtaRow}>
              <Link href="/search" className={styles.primaryLink}>
                Book an appointment <span aria-hidden="true">→</span>
              </Link>
              <Link href="/search" className={styles.outlineLink}>
                Join a live queue <span aria-hidden="true">→</span>
              </Link>
            </div>

            <form className={styles.heroSearch} action="/search" method="get" aria-label="Find a barbershop">
              <label className={styles.heroField}>
                <span>Shop or service</span>
                <input name="q" type="search" placeholder="Haircut, fade, FastQue…" />
              </label>
              <label className={styles.heroField}>
                <span>City</span>
                <input name="city" type="search" placeholder="Bengaluru" />
              </label>
              <button type="submit" className={styles.heroSearchButton}>
                Find a barber <span aria-hidden="true">→</span>
              </button>
            </form>

            <div className={styles.heroMeta} aria-label="FastQue benefits">
              <span>No app required</span>
              <span>Book or join live</span>
              <span>Real-time queue position</span>
            </div>
            {liveStats && (liveStats.activeShopCount > 0 || liveStats.liveWaitingCount > 0) && (
              <p className={styles.liveStats} role="status">
                {liveStats.activeShopCount > 0 && (
                  <span>
                    {liveStats.activeShopCount} {liveStats.activeShopCount === 1 ? "shop" : "shops"} on
                    FastQue right now
                  </span>
                )}
                {liveStats.liveWaitingCount > 0 && (
                  <span>
                    {liveStats.liveWaitingCount} {liveStats.liveWaitingCount === 1 ? "person" : "people"}{" "}
                    in live queues right now
                  </span>
                )}
              </p>
            )}
            <p className={styles.ownerPrompt}>
              Run a barbershop? <Link href="/dashboard/register-shop">Register your shop</Link>
            </p>
          </div>
          <HeroVisual />
        </div>
      </section>

      <section id="book-or-queue" className={styles.choiceSection}>
        <div className={styles.inner}>
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>Two ways to the chair</p>
            <h2 className={styles.sectionTitle}>Plan the cut—or skip the waiting room.</h2>
            <p className={styles.sectionLead}>
              FastQue is designed around how barbershops actually work: scheduled appointments
              when you want certainty, and a live queue when today works better.
            </p>
          </div>

          <div className={styles.choiceGrid}>
            <article className={styles.choiceCard}>
              <div className={styles.choiceHead}>
                <span className={styles.choiceIcon} aria-hidden="true">01</span>
                <span className={styles.choiceKicker}>Book ahead</span>
              </div>
              <h3>Keep a time that is yours.</h3>
              <p>Choose the service, barber and slot before you go.</p>
              <ol className={styles.flowList}>
                {BOOK_STEPS.map((step) => <li key={step}>{step}</li>)}
              </ol>
              <Link href="/search" className={styles.textLink}>Find a shop to book <span aria-hidden="true">→</span></Link>
            </article>

            <article className={`${styles.choiceCard} ${styles.queueChoiceCard}`}>
              <div className={styles.choiceHead}>
                <span className={styles.choiceIcon} aria-hidden="true">02</span>
                <span className={styles.choiceKicker}>Join live</span>
              </div>
              <h3>Stand in line from anywhere.</h3>
              <p>Keep moving while your position updates in real time.</p>
              <ol className={styles.flowList}>
                {QUEUE_STEPS.map((step) => <li key={step}>{step}</li>)}
              </ol>
              <Link href="/search" className={styles.textLink}>Find a live queue <span aria-hidden="true">→</span></Link>
            </article>
          </div>
        </div>
      </section>

      <section id="services" className={styles.categorySection}>
        <div className={styles.inner}>
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>Every kind of chair</p>
            <h2 className={styles.sectionTitle}>Beyond the barber&apos;s chair.</h2>
            <p className={styles.sectionLead}>
              FastQue covers the full grooming and beauty floor. Browse by category to search
              real shops offering that service near you.
            </p>
          </div>

          <div className={styles.categoryGrid}>
            {SERVICE_CATEGORIES.map((category) => (
              <Link
                key={category.id}
                href={`/search?service=${encodeURIComponent(category.query)}`}
                className={styles.categoryCard}
              >
                <span className={styles.categoryArt}>
                  <EditorialImage id={category.assetId} sizes="(max-width: 720px) 45vw, 220px" />
                </span>
                <span className={styles.categoryLabel}>{category.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="shops" className={styles.discoverySection}>
        <div className={styles.inner}>
          <div className={styles.discoveryHeader}>
            <div>
              <p className={styles.eyebrow}>Find your next barber</p>
              <h2 className={styles.sectionTitle}>Shops worth knowing.</h2>
            </div>
            <Link href="/search" className={styles.outlineLink}>Explore all shops <span aria-hidden="true">→</span></Link>
          </div>

          {featured && featured.items.length > 0 ? (
            <div className={styles.shopGrid}>
              {featured.items.map((salon) => <SalonCard key={salon.id} salon={salon} />)}
            </div>
          ) : (
            <div className={styles.marketplaceEmpty}>
              <div>
                <strong>FastQue is opening up shop by shop.</strong>
                <p>Use search to see what is available near you, or bring your own barber onto FastQue.</p>
              </div>
              <Link href="/search" className={styles.textLink}>Search FastQue <span aria-hidden="true">→</span></Link>
            </div>
          )}

          <div className={styles.cityBar}>
            <span className={styles.cityBarLabel}>Browse by city</span>
            {cities && cities.length > 0 ? (
              <nav className={styles.chipRow} aria-label="Browse cities">
                {cities.map((city) => (
                  <Link
                    key={`${city.countryCode}:${city.slug}`}
                    href={`/${city.countryCode.toLowerCase()}/${city.slug}`}
                    className={styles.chip}
                  >
                    {city.name}
                  </Link>
                ))}
              </nav>
            ) : (
              <p className={styles.cityEmpty}>City guides appear as shops open their FastQue profiles.</p>
            )}
          </div>
        </div>
      </section>

      <section className={styles.advisorSection}>
        <div className={styles.inner}>
          <div className={styles.advisorGrid}>
            <div className={styles.advisorArt} aria-hidden="true">
              <span className={styles.advisorHalo} />
              <span className={styles.advisorProfile} />
              <span className={styles.advisorBadge}>
                <EditorialImage id="hair-flagship" width={56} height={42} />
              </span>
              <span className={`${styles.advisorSpark} ${styles.advisorSparkOne}`}>✦</span>
              <span className={`${styles.advisorSpark} ${styles.advisorSparkTwo}`}>✦</span>
              <span className={styles.advisorLabel}>AI Style Advisor</span>
            </div>
            <div className={styles.advisorCopy}>
              <p className={styles.eyebrow}>Know the look before the cut</p>
              <h2 className={styles.sectionTitle}>Walk in with a clearer idea.</h2>
              <p className={styles.sectionLead}>
                Preview supported hairstyles on your own photo, compare looks, and carry your
                choice into booking. Style matches are guidance—not a guarantee.
              </p>
              <div className={styles.styleRow} aria-label="Styles available in the Style Advisor">
                {HAIRSTYLE_CATALOG.slice(0, 6).map((style) => <span key={style.id}>{style.name}</span>)}
              </div>
              <Link href="/style-advisor" className={styles.primaryLink}>Try the Style Advisor <span aria-hidden="true">→</span></Link>
            </div>
          </div>
        </div>
      </section>

      <section id="for-shops" className={styles.ownerSection}>
        <div className={styles.ownerInner}>
          <div>
            <p className={styles.ownerEyebrow}>For modern barbershops</p>
            <h2>Run the floor.<br /><em>Not the paperwork.</em></h2>
            <div className={styles.ownerArt}>
              <EditorialImage id="owner-workstation" sizes="(max-width: 980px) 90vw, 480px" />
            </div>
          </div>
          <div className={styles.ownerPanel}>
            <p>
              Give customers one place to book ahead or join today&apos;s line while your team runs
              chairs, services and the live queue from one focused dashboard.
            </p>
            <ul>
              {OWNER_POINTS.map((point) => <li key={point}>{point}</li>)}
            </ul>
            <Link href="/dashboard/register-shop" className={styles.ownerCta}>Register your shop <span aria-hidden="true">→</span></Link>
          </div>
        </div>
      </section>

      <section className={styles.finalCta}>
        <div className={styles.finalCtaInner}>
          <p className={styles.eyebrow}>Your next chair is closer than you think</p>
          <h2>Book the time. Or join the line.</h2>
          <p>Find a barbershop and choose the way you want to walk in.</p>
          <div className={styles.finalActions}>
            <Link href="/search" className={styles.finalPrimary}>Find a barber</Link>
            <Link href="/login" className={styles.finalSecondary}>Sign in</Link>
          </div>
        </div>
      </section>

      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <strong>FastQue</strong>
            <p>Purpose-built for modern barbershops.</p>
          </div>
          <nav className={styles.footerLinks} aria-label="Footer">
            <div><span>Customers</span><Link href="/search">Find a barber</Link><Link href="/account/bookings">My bookings</Link><Link href="/style-advisor">Style Advisor</Link></div>
            <div><span>Shops</span><Link href="/dashboard/register-shop">Register your shop</Link><Link href="/owner/login">Owner login</Link><Link href="/staff/login">Staff login</Link></div>
            <div><span>FastQue</span><Link href="/login">Customer login</Link></div>
          </nav>
          <p className={styles.footerNote}>© {new Date().getFullYear()} FastQue.</p>
        </div>
      </footer>
    </div>
  );
}
