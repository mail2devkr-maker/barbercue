import type { Metadata } from "next";
import Link from "next/link";
import { CustomerShell } from "../../../components/layout/CustomerShell";
import { absoluteUrl } from "../../../lib/seo";
import styles from "../../../components/landing/info-page.module.css";

const TITLE = "About Us";
const DESCRIPTION =
  "Learn how FastQue helps customers book ahead or join live queues, while helping barbershops, salons and beauty businesses run their day.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/about-us") },
  openGraph: {
    title: `${TITLE} | FastQue`,
    description: DESCRIPTION,
    url: absoluteUrl("/about-us"),
    type: "website",
  },
};

const PILLARS = [
  {
    number: "01",
    title: "Less waiting for customers",
    body: "Find participating shops, book a time in advance, or join a live queue and follow your position before heading in.",
  },
  {
    number: "02",
    title: "One operating view for shops",
    body: "FastQue brings bookings, live queues, services, staff, chairs and working hours into one focused workflow for the shop team.",
  },
  {
    number: "03",
    title: "Built around the real shop floor",
    body: "The product supports both scheduled appointments and walk-in demand, so shops do not have to choose one way of working.",
  },
];

export default function AboutUsPage() {
  return (
    <CustomerShell>
      <main className={styles.page}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>About FastQue</p>
          <h1>Good looks.<br />Less waiting.</h1>
          <p className={styles.lead}>
            FastQue is a booking and live-queue platform for barbershops, salons, nail bars, spas and
            other grooming and beauty businesses. It is designed to make the time around a service
            easier for customers and more manageable for the teams running the floor.
          </p>
          <div className={styles.heroActions}>
            <Link href="/search" className={styles.primary}>Find a shop</Link>
            <Link href="/dashboard/register-shop" className={styles.secondary}>Partner with FastQue</Link>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Why FastQue exists</p>
            <h2>Give people a clearer way to reach the chair.</h2>
            <p>
              Customers should not have to guess how long the wait will be, and shop teams should
              not need separate tools for appointments and today&apos;s queue.
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
          <div className={styles.story}>
            <div>
              <p className={styles.eyebrow}>Our approach</p>
              <h2>Useful technology without unnecessary friction.</h2>
            </div>
            <div>
              <p>
                FastQue keeps the customer journey simple: discover a shop, choose a service, book
                ahead or join the live queue, then stay informed as the visit approaches.
              </p>
              <p>
                For shop teams, the same platform supports day-to-day operations such as queue
                handling, bookings, staff, chairs, services and shop setup.
              </p>
              <p>
                <strong>FastQue was created by Devdutta Kumar Pandey</strong> and is being developed
                as a practical platform for modern grooming and beauty businesses.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.finalCta}>
          <p className={styles.eyebrow}>Connect with FastQue</p>
          <h2>Have a question, partnership idea or support request?</h2>
          <p>Our published support channel is available on the Contact Us page.</p>
          <div className={styles.cardActions}>
            <Link href="/contact-us" className={styles.primary}>Contact Us</Link>
            <Link href="/privacy-policy" className={styles.secondary}>Privacy Policy</Link>
          </div>
        </section>
      </main>
    </CustomerShell>
  );
}
