import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, breadcrumbJsonLd } from "../../../components/discovery/Breadcrumbs";
import { JsonLd } from "../../../components/discovery/JsonLd";
import styles from "../../../components/discovery/seo-guides.module.css";
import { absoluteUrl, SITE_URL } from "../../../lib/seo";

const title = "How a salon live queue works | FastQue";
const description = "Learn how to join a participating salon's live queue, follow your position and manage your queue visit in FastQue.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl("/how-live-queue-works") },
  openGraph: { title, description, url: absoluteUrl("/how-live-queue-works"), type: "article" },
};

export default function HowLiveQueueWorksPage() {
  const crumbs = [{ label: "Home", href: "/" }, { label: "How the live queue works", href: "/how-live-queue-works" }];
  return (
    <main className={styles.page}>
      <JsonLd data={breadcrumbJsonLd(crumbs, SITE_URL)} />
      <Breadcrumbs items={crumbs} />
      <header>
        <p className={styles.eyebrow}>For customers</p>
        <h1>Join a salon live queue with FastQue</h1>
        <p className={styles.lead}>A live queue is for a participating shop that has its queue open. Join from the shop&apos;s FastQue page, then check the queue status in your account while the business serves customers.</p>
      </header>
      <section className={styles.section}>
        <h2>Before you join</h2>
        <p>Check that the salon offers the live queue option and review its current service information. Queue availability and pace depend on the shop&apos;s real-time operations; FastQue does not promise a fixed wait time.</p>
      </section>
      <section className={styles.section}>
        <h2>Join and follow your place</h2>
        <ol className={styles.steps}>
          <li>Open the participating salon profile and choose its live queue option when available.</li>
          <li>Review the queue details and confirm the action in FastQue.</li>
          <li>Return to your queue view to see the latest position or status the shop has recorded.</li>
          <li>If your plans change, use the available cancellation action and check that FastQue confirms the updated status.</li>
        </ol>
        <p>Queue position and estimated timing can change as the shop serves customers. Follow the latest status and any instructions from the business.</p>
        <nav className={styles.links} aria-label="Continue exploring FastQue">
          <Link href="/search">Find a salon</Link>
          <Link href="/how-to-book">How online booking works</Link>
        </nav>
      </section>
    </main>
  );
}
