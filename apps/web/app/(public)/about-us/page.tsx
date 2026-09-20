import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CustomerShell } from "../../../components/layout/CustomerShell";
import { absoluteUrl } from "../../../lib/seo";
import styles from "../../../components/landing/info-page.module.css";

const TITLE = "About Us";
const DESCRIPTION =
  "Discover how FastQue helps customers discover, book, queue and review salon services while giving salon owners one place to run bookings, staff, chairs, queues and customer operations.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/about-us") },
  openGraph: {
    title: TITLE + " | FastQue",
    description: DESCRIPTION,
    url: absoluteUrl("/about-us"),
    type: "website",
  },
};

const CUSTOMER_FEATURES = [
  {
    title: "Discover nearby beauty & grooming businesses",
    body: "Search FastQue shops by location, service and business profile, then compare the services, prices, team and shop information available on the profile.",
  },
  {
    title: "Book ahead",
    body: "Choose services, a preferred staff member when available, a date and a bookable time slot, then keep the appointment in one booking history.",
  },
  {
    title: "Use the live queue",
    body: "Join supported walk-in queues, follow queue progress and use check-in guidance instead of waiting at the shop without visibility.",
  },
  {
    title: "Manage your booking",
    body: "Review appointment details, get directions, share the shop, cancel or reschedule when eligible, and quickly book the same service again.",
  },
  {
    title: "Ratings & reviews",
    body: "After a completed booking, leave a verified 1–5 star review with an optional comment, edit it later, and see a public response from the shop.",
  },
  {
    title: "Stay informed",
    body: "FastQue includes an in-app notification centre for booking, queue and reminder updates, with notification preferences designed to default to enabled.",
  },
  {
    title: "Explore styles",
    body: "Use the FastQue Style Advisor experience to explore grooming and beauty ideas before choosing a service.",
  },
];

const OWNER_FEATURES = [
  {
    title: "Fast self-service onboarding",
    body: "Register a shop, start with service packs, prefilled opening hours and ten default chairs, then add only the staff and details you actually need.",
  },
  {
    title: "Services & availability",
    body: "Manage services, prices, durations, operating hours, staff working hours and the resources that determine real booking capacity.",
  },
  {
    title: "Bookings + walk-ins in one operation",
    body: "Run scheduled appointments and the live walk-in queue together instead of maintaining separate systems for two kinds of demand.",
  },
  {
    title: "Staff & chair operations",
    body: "Manage staff status, profiles, working hours, chair capacity and live assignments from the shop dashboard.",
  },
  {
    title: "Customer operations",
    body: "See booking and customer context, manage queue activity, handle no-show workflows and keep day-to-day service operations connected.",
  },
  {
    title: "Direct payment setup",
    body: "Configure the shop payment QR used for eligible online booking payment flows while walk-ins can continue paying the business directly.",
  },
  {
    title: "Reviews & reputation",
    body: "See verified booking reviews in the owner dashboard and post a public shop response that appears with the customer review.",
  },
  {
    title: "Photos, profile & discovery",
    body: "Build a public shop profile with services, photos, team information, business details and live operating information customers can use before booking.",
  },
  {
    title: "Dashboard visibility",
    body: "Use shop dashboards for bookings, queue activity, customers, reviews and operational setup instead of piecing together the day from multiple tools.",
  },
  {
    title: "Account & profile safeguards",
    body: "FastQue includes role-based owner/staff access, staff invitations, account controls and profile-evidence review tools for supported verification workflows.",
  },
];

const PILLARS = [
  {
    number: "01",
    title: "Less waiting for customers",
    body: "Move from discovery to booking or a live queue with clearer timing and fewer unnecessary trips to the shop.",
  },
  {
    number: "02",
    title: "One operating view for shops",
    body: "Bookings, walk-ins, services, staff, chairs, customers and reviews stay connected to the same operating system.",
  },
  {
    number: "03",
    title: "Designed for real salon workflows",
    body: "FastQue supports scheduled appointments and real-time walk-in demand because beauty and grooming businesses regularly need both.",
  },
];

function FeatureList({ items }: { items: typeof CUSTOMER_FEATURES }) {
  return (
    <div className={styles.featureList}>
      {items.map((feature) => (
        <article key={feature.title} className={styles.featureItem}>
          <span className={styles.featureTick} aria-hidden="true">✓</span>
          <div>
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

export default function AboutUsPage() {
  return (
    <CustomerShell>
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.aboutHeroGrid}>
            <div>
              <p className={styles.eyebrow}>About FastQue</p>
              <h1>Good looks.<br />Less waiting.</h1>
              <p className={styles.lead}>
                FastQue connects customers and grooming & beauty businesses through discovery,
                appointments, live queues and the operational tools that keep a busy shop moving.
              </p>
              <div className={styles.heroActions}>
                <Link href="/search" className={styles.primary}>Find a shop</Link>
                <Link href="/dashboard/register-shop" className={styles.secondary}>Partner with FastQue</Link>
              </div>
            </div>
            <div className={styles.aboutHeroImage}>
              <Image
                src="/editorial/hero/barbercue-hero.webp"
                alt="A modern grooming experience represented on FastQue"
                width={900}
                height={650}
                priority
              />
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Why FastQue exists</p>
            <h2>Make every step around the chair easier.</h2>
            <p>
              Customers need clarity about where to go, what to book and when they will be served.
              Owners need the same clarity across appointments, walk-ins, people and capacity.
            </p>
          </div>
          <div className={styles.grid}>
            {PILLARS.map((pillar) => (
              <article key={pillar.number} className={styles.card}>
                <span className={styles.cardNumber}>{pillar.number}</span>
                <h3>{pillar.title}</h3>
                <p>{pillar.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.featureSplit}>
            <div className={styles.featureVisual}>
              <Image
                src="/editorial/processes/haircut.webp"
                alt="Customer receiving a salon service"
                width={760}
                height={900}
              />
            </div>
            <div>
              <p className={styles.eyebrow}>For customers</p>
              <h2 className={styles.featureHeading}>From “where should I go?” to “my chair is ready.”</h2>
              <p className={styles.featureLead}>
                FastQue keeps discovery, booking, queue visibility and post-visit feedback in one
                customer journey.
              </p>
              <FeatureList items={CUSTOMER_FEATURES} />
              <div className={styles.cardActions}>
                <Link href="/search" className={styles.primary}>Explore FastQue shops</Link>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={[styles.featureSplit, styles.featureSplitReverse].join(" ")}>
            <div>
              <p className={styles.eyebrow}>For salon owners</p>
              <h2 className={styles.featureHeading}>One place to run the floor and grow a digital presence.</h2>
              <p className={styles.featureLead}>
                FastQue is built around the practical work of getting customers booked, seated,
                served and kept informed.
              </p>
              <FeatureList items={OWNER_FEATURES} />
              <div className={styles.cardActions}>
                <Link href="/dashboard/register-shop" className={styles.primary}>Register your shop</Link>
              </div>
            </div>
            <div className={styles.featureVisual}>
              <Image
                src="/editorial/owner/salon-owner-operations.webp"
                alt="Salon owner managing daily operations"
                width={760}
                height={900}
              />
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.imageStrip}>
            <Image src="/editorial/processes/facial.webp" alt="Facial and skincare service" width={520} height={360} />
            <Image src="/editorial/processes/manicure.webp" alt="Manicure and nail service" width={520} height={360} />
            <Image src="/editorial/services/hair/hair-salon-flagship.webp" alt="Hair salon service" width={520} height={360} />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.story}>
            <div>
              <p className={styles.eyebrow}>Our approach</p>
              <h2>Useful technology without unnecessary friction.</h2>
            </div>
            <div>
              <p>
                FastQue keeps the customer journey direct: discover a business, choose a service,
                book ahead or join the live queue, stay informed and share feedback after the visit.
              </p>
              <p>
                For owners, the same platform connects shop setup, services, opening hours, staff,
                chairs, bookings, queues, customers, reviews and operational controls.
              </p>
              <p>
                <strong>FastQue was created by Devdutta Kumar Pandey</strong> and is being developed
                as a practical operating and discovery platform for modern grooming and beauty
                businesses.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.finalCta}>
          <p className={styles.eyebrow}>Two sides. One smoother visit.</p>
          <h2>Spend less time coordinating the queue and more time on the service.</h2>
          <p>
            Customers can discover and plan their visit while shop teams get one operational view
            of the work that needs to happen next.
          </p>
          <div className={styles.cardActions}>
            <Link href="/search" className={styles.primary}>I&apos;m a customer</Link>
            <Link href="/dashboard/register-shop" className={styles.secondary}>I run a salon</Link>
            <Link href="/contact-us" className={styles.secondary}>Contact Us</Link>
          </div>
        </section>
      </main>
    </CustomerShell>
  );
}
