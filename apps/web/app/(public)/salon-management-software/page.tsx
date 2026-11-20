import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, breadcrumbJsonLd } from "../../../components/discovery/Breadcrumbs";
import { JsonLd } from "../../../components/discovery/JsonLd";
import styles from "../../../components/discovery/seo-guides.module.css";
import { absoluteUrl, SITE_URL } from "../../../lib/seo";

const title = "Salon management software for bookings and live queues | FastQue";
const description = "FastQue gives participating salons tools for online appointments, live queues, services, staff, chairs, schedules and customer discovery.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl("/salon-management-software") },
  openGraph: { title, description, url: absoluteUrl("/salon-management-software"), type: "article" },
};

export default function SalonManagementSoftwarePage() {
  const crumbs = [{ label: "Home", href: "/" }, { label: "Salon management software", href: "/salon-management-software" }];
  return (
    <main className={styles.page}>
      <JsonLd data={breadcrumbJsonLd(crumbs, SITE_URL)} />
      <Breadcrumbs items={crumbs} />
      <header>
        <p className={styles.eyebrow}>For salon and barbershop owners</p>
        <h1>Salon management software for appointments and live queues</h1>
        <p className={styles.lead}>FastQue helps participating salons bring customer discovery and day-to-day shop operations into one workspace. Businesses manage the services, staff, chairs, hours and availability they choose to publish.</p>
      </header>
      <section className={styles.section}>
        <h2>Tools for the way your shop works</h2>
        <ul className={styles.steps}>
          <li><strong>Appointments:</strong> manage online bookings and the visit information associated with your shop.</li>
          <li><strong>Live queue:</strong> operate an in-person queue and keep its current status visible to customers when the shop enables it.</li>
          <li><strong>Services and schedules:</strong> maintain the service menu, prices, working hours and appointment availability shown on your public profile.</li>
          <li><strong>Team and chairs:</strong> manage staff and chair assignments in the owner workspace according to each account&apos;s permissions.</li>
          <li><strong>Customer discovery:</strong> publish accurate shop details so customers can compare the information your business provides before visiting.</li>
        </ul>
        <p>FastQue does not guarantee new customers, revenue or a particular queue time. Results depend on each business&apos;s listing, operating choices and real-world demand.</p>
        <nav className={styles.links} aria-label="Salon owner actions">
          <Link href="/owner/register">Register a shop</Link>
          <Link href="/owner/login">Owner login</Link>
          <Link href="/faq">Read customer and shop FAQs</Link>
        </nav>
      </section>
    </main>
  );
}
