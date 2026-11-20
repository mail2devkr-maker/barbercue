import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, breadcrumbJsonLd } from "../../../components/discovery/Breadcrumbs";
import { JsonLd } from "../../../components/discovery/JsonLd";
import styles from "../../../components/discovery/seo-guides.module.css";
import { absoluteUrl, SITE_URL } from "../../../lib/seo";

const PATH = "/list-your-salon";
const title = "List your salon or barbershop on FastQue | Gurugram, Faridabad, Delhi NCR";
const description =
  "Salon, barbershop or beauty parlour owner? Put your shop on FastQue: customers see your services, prices and hours, book ahead or join your live queue. Register in a few minutes.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: { title, description, url: absoluteUrl(PATH), type: "article" },
};

export default function ListYourSalonPage() {
  const crumbs = [
    { label: "Home", href: "/" },
    { label: "List your salon", href: PATH },
  ];
  return (
    <main className={styles.page}>
      <JsonLd data={breadcrumbJsonLd(crumbs, SITE_URL)} />
      <Breadcrumbs items={crumbs} />
      <header>
        <p className={styles.eyebrow}>For salon, barbershop &amp; parlour owners</p>
        <h1>Put your shop on FastQue</h1>
        <p className={styles.lead}>
          Customers in Gurugram, Faridabad, Noida, Greater Noida, Ghaziabad and across Delhi NCR use FastQue to find a
          salon, see its services and prices, and book a time or join the live queue from their phone.
        </p>
        <p className={styles.lead} lang="hi">
          अपनी दुकान FastQue पर जोड़िए। ग्राहक आपकी सर्विस, रेट और टाइमिंग देखकर पहले से बुकिंग कर सकते हैं या
          फ़ोन से लाइव लाइन में लग सकते हैं — दुकान पर भीड़ और इंतज़ार कम।
        </p>
        <nav className={styles.links} aria-label="Register">
          <Link href="/owner/register">Register your shop</Link>
          <Link href="/contact-us">Talk to us</Link>
        </nav>
      </header>

      <section className={styles.section}>
        <h2>What you get</h2>
        <ul className={styles.steps}>
          <li><strong>Your own shop page</strong> with services, prices, address and opening hours.</li>
          <li><strong>Online appointments:</strong> customers book a time you have open.</li>
          <li><strong>Live queue:</strong> walk-in customers join from their phone and come closer to their turn.</li>
          <li><strong>Staff and chairs:</strong> manage who works which chair and when, in the FastQue owner app.</li>
          <li><strong>Listed in your city:</strong> your shop appears on your city&apos;s FastQue page, which search engines can show to people nearby.</li>
        </ul>
        <p>FastQue does not promise a fixed number of customers. Results depend on your listing and local demand.</p>
      </section>

      <section className={styles.section}>
        <h2>How to join (about 10 minutes)</h2>
        <ol className={styles.steps}>
          <li>Create an owner account with your phone or email.</li>
          <li>Add your shop name, address and opening hours.</li>
          <li>Add your services with prices, and your staff and chairs.</li>
          <li>Turn on bookings or the live queue, whichever suits your shop.</li>
        </ol>
        <p lang="hi">
          शुरू करने के लिए: owner account बनाइए → दुकान का नाम, पता और टाइमिंग डालिए → सर्विस और रेट जोड़िए → बुकिंग या
          लाइव लाइन चालू कीजिए। मदद चाहिए तो हमसे बात कीजिए।
        </p>
        <nav className={styles.links} aria-label="Next steps">
          <Link href="/owner/register">Register your shop</Link>
          <Link href="/salon-management-software">See the owner tools</Link>
          <Link href="/delhi-ncr">Shops already on FastQue in Delhi NCR</Link>
        </nav>
      </section>
    </main>
  );
}
