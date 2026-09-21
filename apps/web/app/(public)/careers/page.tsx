import type { Metadata } from "next";
import Link from "next/link";
import { CustomerShell } from "../../../components/layout/CustomerShell";
import { absoluteUrl } from "../../../lib/seo";
import styles from "../../../components/landing/info-page.module.css";

const TITLE = "Careers — Field Sales & Shop Onboarding";
const DESCRIPTION =
  "FastQue is hiring Field Sales and Shop Onboarding Executives. No prior experience required. Target-linked monthly salary ₹10,000–₹12,000 for 150 verified shop onboardings.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/careers") },
  openGraph: {
    title: `${TITLE} | FastQue`,
    description: DESCRIPTION,
    url: absoluteUrl("/careers"),
    type: "website",
  },
};

const APPLY_EMAIL =
  "mailto:support@fastque.com?subject=Application%20%E2%80%94%20FastQue%20Field%20Sales%20%26%20Shop%20Onboarding%20Executive";

export default function CareersPage() {
  return (
    <CustomerShell>
      <main className={styles.page}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>We&apos;re hiring</p>
          <h1>Help local shops get discovered, booked and better organised.</h1>
          <p className={styles.lead}>
            FastQue is looking for Field Sales &amp; Shop Onboarding Executives who can meet
            barbershops, salons, beauty parlours and spas, explain FastQue clearly, and help genuine
            businesses complete their onboarding.
          </p>
          <div className={styles.heroActions}>
            <a href={APPLY_EMAIL} className={styles.primary}>Apply by email</a>
            <Link href="/about-us" className={styles.secondary}>About FastQue</Link>
          </div>
        </section>

        <section className={styles.contactGrid} aria-label="FastQue hiring highlights">
          <article className={styles.contactCard}>
            <p className={styles.eyebrow}>Experience</p>
            <h2>No prior experience required</h2>
            <p>
              Prior sales experience is not mandatory. Clear communication, consistency, honesty
              and comfort speaking with local business owners matter more.
            </p>
          </article>

          <article className={styles.contactCard}>
            <p className={styles.eyebrow}>Monthly compensation</p>
            <h2>₹10,000–₹12,000</h2>
            <p>
              This is target-linked monthly salary. To qualify for this salary range, the monthly
              target is at least 150 verified shop onboardings.
            </p>
          </article>

          <article className={styles.contactCard}>
            <p className={styles.eyebrow}>Role</p>
            <h2>Field Sales &amp; Shop Onboarding</h2>
            <p>
              Meet grooming and beauty businesses in your assigned area, introduce FastQue, help
              interested shops start onboarding, and keep your onboarding status accurate.
            </p>
          </article>
        </section>

        <section className={styles.section}>
          <div className={styles.story}>
            <div>
              <p className={styles.eyebrow}>Your target</p>
              <h2>150 verified shops in a month.</h2>
            </div>
            <div>
              <p>
                A shop counts toward the monthly target only when FastQue verifies the onboarding as
                genuine and complete. Duplicate, fake or incomplete registrations do not count.
              </p>
              <p>
                The role is about quality onboarding, not just collecting leads. You should be able
                to explain what FastQue does, help the owner understand the platform, and accurately
                capture the progress of each shop you approach.
              </p>
              <p>
                Exact joining terms, assigned area and compensation terms will be confirmed in
                writing before a candidate starts work.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>What you&apos;ll do</p>
            <h2>Simple field work with a clear outcome.</h2>
            <p>
              The focus is to bring real local grooming and beauty businesses onto FastQue and help
              them understand the basics of using the platform.
            </p>
          </div>

          <div className={styles.grid}>
            <article className={styles.card}>
              <span className={styles.cardNumber}>01</span>
              <h3>Visit local shops</h3>
              <p>
                Meet barbershops, salons, beauty parlours and spas in your assigned area and
                introduce FastQue in a simple, professional way.
              </p>
            </article>
            <article className={styles.card}>
              <span className={styles.cardNumber}>02</span>
              <h3>Explain &amp; onboard</h3>
              <p>
                Show interested owners how FastQue helps with discovery, bookings and live-queue
                management, then help them begin the onboarding process.
              </p>
            </article>
            <article className={styles.card}>
              <span className={styles.cardNumber}>03</span>
              <h3>Follow through</h3>
              <p>
                Keep track of shops you approach, follow up where needed, and make sure completed
                onboardings are genuine and ready for FastQue verification.
              </p>
            </article>
          </div>
        </section>

        <section className={styles.finalCta}>
          <p className={styles.eyebrow}>Interested?</p>
          <h2>Start with a short introduction.</h2>
          <p>
            Email your name, city, mobile number and a brief introduction. Prior experience is not
            required, so first-time applicants are welcome to apply.
          </p>
          <div className={styles.cardActions}>
            <a href={APPLY_EMAIL} className={styles.primary}>Apply to FastQue</a>
            <a href="mailto:support@fastque.com" className={styles.secondary}>support@fastque.com</a>
          </div>
        </section>
      </main>
    </CustomerShell>
  );
}
