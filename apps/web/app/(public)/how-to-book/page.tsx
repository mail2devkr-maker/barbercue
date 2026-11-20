import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, breadcrumbJsonLd } from "../../../components/discovery/Breadcrumbs";
import { JsonLd } from "../../../components/discovery/JsonLd";
import styles from "../../../components/discovery/seo-guides.module.css";
import { absoluteUrl, SITE_URL } from "../../../lib/seo";

const title = "How to book a salon appointment online | FastQue";
const description = "Find a salon, compare its listed services and prices, choose an available appointment and manage your booking with FastQue.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl("/how-to-book") },
  openGraph: { title, description, url: absoluteUrl("/how-to-book"), type: "article" },
};

export default function HowToBookPage() {
  const crumbs = [{ label: "Home", href: "/" }, { label: "How online booking works", href: "/how-to-book" }];
  return (
    <main className={styles.page}>
      <JsonLd data={breadcrumbJsonLd(crumbs, SITE_URL)} />
      <Breadcrumbs items={crumbs} />
      <header>
        <p className={styles.eyebrow}>For customers</p>
        <h1>Book a salon appointment online</h1>
        <p className={styles.lead}>Use FastQue to discover participating salons and barbershops, compare the service information each business publishes, and request an appointment without calling around.</p>
      </header>
      <section className={styles.section}>
        <h2>How it works</h2>
        <ol className={styles.steps}>
          <li><strong>Find a shop.</strong> Search by city or browse the salon profile. The shop controls its own service menu, prices, hours and availability.</li>
          <li><strong>Choose what you need.</strong> Select from the services and appointment times the shop makes available. Staff selection appears when that shop supports it.</li>
          <li><strong>Review and confirm.</strong> Check the selected service, shop and time before confirming. A request is not a guarantee of service outside the booking status shown in your account.</li>
          <li><strong>Manage the visit.</strong> Use your account to view the booking and the actions available for it. Rescheduling or cancellation depends on the booking state and shop rules displayed in FastQue.</li>
        </ol>
      </section>
      <section className={styles.section}>
        <h2>Compare the details that matter</h2>
        <p>Salon profiles can show actual services, prices, business hours, address, photos and customer reviews supplied through FastQue. Information differs by shop; check the profile before you travel. FastQue does not guarantee that a shop is open or that a particular service is available beyond the current information shown.</p>
        <nav className={styles.links} aria-label="Continue exploring FastQue">
          <Link href="/search">Search salons</Link>
          <Link href="/services">Browse services</Link>
          <Link href="/how-live-queue-works">How the live queue works</Link>
        </nav>
      </section>
    </main>
  );
}
