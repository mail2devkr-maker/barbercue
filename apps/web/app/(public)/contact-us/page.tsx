import type { Metadata } from "next";
import Link from "next/link";
import { CustomerShell } from "../../../components/layout/CustomerShell";
import { absoluteUrl } from "../../../lib/seo";
import styles from "../../../components/landing/info-page.module.css";

const TITLE = "Contact Us";
const DESCRIPTION =
  "Contact FastQue for customer support, shop onboarding and partnership enquiries, or privacy and account requests.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/contact-us") },
  openGraph: {
    title: `${TITLE} | FastQue`,
    description: DESCRIPTION,
    url: absoluteUrl("/contact-us"),
    type: "website",
  },
};

export default function ContactUsPage() {
  return (
    <CustomerShell>
      <main className={styles.page}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Contact FastQue</p>
          <h1>Tell us how we can help.</h1>
          <p className={styles.lead}>
            Whether you are a customer, a shop owner, or exploring a partnership with FastQue,
            email is the published support channel for reaching the team.
          </p>
          <div className={styles.heroActions}>
            <a href="mailto:support@fastque.com" className={styles.primary}>support@fastque.com</a>
            <Link href="/about-us" className={styles.secondary}>About FastQue</Link>
          </div>
        </section>

        <section className={styles.contactGrid} aria-label="FastQue contact options">
          <article className={styles.contactCard}>
            <p className={styles.eyebrow}>Customers</p>
            <h2>Account, booking or app support</h2>
            <p>
              For sign-in, account, booking, queue or general product questions, email{" "}
              <a href="mailto:support@fastque.com?subject=FastQue%20Customer%20Support">support@fastque.com</a>.
            </p>
          </article>

          <article className={styles.contactCard}>
            <p className={styles.eyebrow}>Shops & partnerships</p>
            <h2>Bring your business to FastQue</h2>
            <p>
              For salon onboarding, business partnerships or shop-related questions, contact{" "}
              <a href="mailto:support@fastque.com?subject=FastQue%20Shop%20or%20Partnership%20Enquiry">support@fastque.com</a>.
            </p>
          </article>

          <article className={styles.contactCard}>
            <p className={styles.eyebrow}>Privacy & account requests</p>
            <h2>Data and account assistance</h2>
            <p>
              For privacy, personal-data or account-deletion assistance, email{" "}
              <a href="mailto:support@fastque.com?subject=FastQue%20Privacy%20or%20Account%20Request">support@fastque.com</a>{" "}
              or review the dedicated account-deletion page.
            </p>
            <div className={styles.cardActions}>
              <Link href="/account-deletion" className={styles.inlineLink}>Account deletion →</Link>
            </div>
          </article>
        </section>

        <section className={styles.section}>
          <div className={styles.story}>
            <div>
              <p className={styles.eyebrow}>Contact details</p>
              <h2>FastQue</h2>
            </div>
            <div>
              <dl className={styles.details}>
                <div className={styles.detailRow}>
                  <dt>Website</dt>
                  <dd>fastque.com</dd>
                </div>
                <div className={styles.detailRow}>
                  <dt>Email</dt>
                  <dd><a className={styles.inlineLink} href="mailto:support@fastque.com">support@fastque.com</a></dd>
                </div>
                <div className={styles.detailRow}>
                  <dt>Product</dt>
                  <dd>Booking and live-queue platform for grooming and beauty businesses</dd>
                </div>
              </dl>
              <p className={styles.notice}>
                A public business phone number or office address is not listed here because FastQue
                has not published those details yet. They can be added as soon as the official
                contact details are confirmed.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.finalCta}>
          <p className={styles.eyebrow}>Helpful links</p>
          <h2>Looking for something specific?</h2>
          <div className={styles.cardActions}>
            <Link href="/privacy-policy" className={styles.secondary}>Privacy Policy</Link>
            <Link href="/account-deletion" className={styles.secondary}>Account Deletion</Link>
            <Link href="/dashboard/register-shop" className={styles.primary}>Register a Shop</Link>
          </div>
        </section>
      </main>
    </CustomerShell>
  );
}
