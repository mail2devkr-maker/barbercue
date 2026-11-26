import type { Metadata } from "next";
import Link from "next/link";
import { CustomerShell } from "../../../../components/layout/CustomerShell";
import { CookiePreferencesLink } from "../../../../components/privacy/ConsentBanner";
import { absoluteUrl } from "../../../../lib/seo";
import styles from "../../privacy-policy/privacy-policy.module.css";

const TITLE = "How FastQue measures visits";
const DESCRIPTION = "What FastQue's first-party analytics records, what it never records, and how to change your choice.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/privacy/analytics") },
};

export default function AnalyticsNoticePage() {
  return (
    <CustomerShell>
      <main className={styles.page}>
        <article className={styles.article}>
          <header className={styles.hero}>
            <p className={styles.eyebrow}>FastQue privacy notice</p>
            <h1>{TITLE}</h1>
            <p className={styles.updated}>Policy version 2026-11</p>
            <p className={styles.lead}>
              FastQue measures how people use fastque.com so we can bring salons and services to the places that need
              them. This notice supplements our <Link href="/privacy-policy">Privacy Policy</Link>.
            </p>
          </header>

          <section>
            <h2>Only with your permission</h2>
            <p>
              Nothing beyond essential storage (login, security and your cookie choice) is collected until you choose.
              You can accept, reject or customise, and change your mind at any time: <CookiePreferencesLink />.
            </p>
          </section>

          <section>
            <h2>What we record with analytics consent</h2>
            <ul>
              <li>A random, pseudonymous browser id (we store only a one-way hash of it on our servers).</li>
              <li>Pages viewed, time spent, and FastQue features used (searches, salon and product views, bookings started and confirmed).</li>
              <li>The search words you type into FastQue&apos;s own search box, after removing anything that looks like a phone number, email, card, UPI id, PAN or password.</li>
              <li>How you arrived (for example a Google search, an Instagram link or a salon&apos;s QR code), from the link&apos;s campaign tags and the referring website.</li>
              <li>Device type, browser and operating system (not the full browser string).</li>
              <li>
                An approximate location (country, state, city) from network data or the city you choose. Your IP
                address is used only for that moment and is never stored. Precise location is used only if you tap
                &ldquo;Near me&rdquo; and allow it; even then we keep only the nearest city, never coordinates.
              </li>
              <li>If you are signed in, your visits are linked to your FastQue account so your bookings can be counted.</li>
            </ul>
          </section>

          <section>
            <h2>What we never record</h2>
            <ul>
              <li>Keystrokes, form contents, passwords, OTPs, card or bank details.</li>
              <li>Screen recordings or hidden device fingerprints.</li>
              <li>Your search history on Google or any other site. (Google Search Console only gives us totals per search phrase.)</li>
            </ul>
          </section>

          <section>
            <h2>Marketing cookies</h2>
            <p>
              Only if you allow marketing cookies, FastQue may measure ads with Google and Meta. We never send them
              your name, phone number or email from this site; Meta receives only a hashed pseudonymous id.
            </p>
          </section>

          <section>
            <h2>Retention and your rights</h2>
            <p>
              Detailed events are deleted after 180 days and visit summaries after about 13 months by default; only
              anonymous daily totals are kept longer. Under India&apos;s Digital Personal Data Protection Act you can ask
              to access or erase this data: <Link href="/contact-us">contact us</Link>.
            </p>
          </section>
        </article>
      </main>
    </CustomerShell>
  );
}
