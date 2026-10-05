import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "../../../components/discovery/JsonLd";
import { CustomerShell } from "../../../components/layout/CustomerShell";
import { absoluteUrl } from "../../../lib/seo";
import styles from "../../../components/landing/info-page.module.css";

const TITLE = "Frequently Asked Questions";
const DESCRIPTION =
  "Answers to common questions about FastQue bookings, live queues, shop onboarding, accounts, privacy, careers and employee policies.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/faq") },
  openGraph: {
    title: `${TITLE} | FastQue`,
    description: DESCRIPTION,
    url: absoluteUrl("/faq"),
    type: "website",
  },
};

type FaqItem = {
  question: string;
  answer: string;
};

type FaqGroup = {
  title: string;
  intro: string;
  items: FaqItem[];
};

const FAQ_GROUPS: FaqGroup[] = [
  {
    title: "For customers",
    intro: "Finding a shop, booking ahead and using live queues.",
    items: [
      {
        question: "What is FastQue?",
        answer:
          "FastQue is a discovery, booking and live-queue platform for grooming and beauty businesses such as barbershops, salons, nail bars and spas.",
      },
      {
        question: "How do I find a barber, salon or spa?",
        answer:
          "Use Find a Barber or Search, then search by shop, service or location. Available city and locality pages also help you discover listed businesses.",
      },
      {
        question: "What is the difference between booking and joining a live queue?",
        answer:
          "Booking reserves an available date and time. A live queue lets you join a shop's current line and follow your position as the queue moves.",
      },
      {
        question: "Can I choose a service and barber?",
        answer:
          "Where a shop has configured those options, FastQue lets you choose from its available services and team members during booking.",
      },
      {
        question: "Do I need an account?",
        answer:
          "Some discovery pages can be viewed without signing in. Account features, booking history and other personalised actions may require login.",
      },
      {
        question: "Can I see my live-queue position?",
        answer:
          "Yes, when a participating shop runs a FastQue live queue, the queue experience is designed to show your current position and update it as the line moves.",
      },
      {
        question: "Can I cancel or change a booking?",
        answer:
          "Available change or cancellation options depend on the booking state and the shop's operating setup. Check the booking details in your account and contact the shop or FastQue support if you need help.",
      },
      {
        question: "Who sets service prices and availability?",
        answer:
          "Each listed business controls its own services, prices, staff availability and operating hours. FastQue presents the information configured for that shop.",
      },
      {
        question: "Does FastQue guarantee service quality or waiting time?",
        answer:
          "No. FastQue helps with discovery, booking and queue visibility, but actual service quality, staff availability and real-world waiting time remain dependent on the participating business and conditions at the shop.",
      },
      {
        question: "What is the Style Advisor?",
        answer:
          "The Style Advisor is a guidance feature that can help you preview supported hairstyles on your own photo. It is for visual guidance and does not guarantee an identical real-world result.",
      },
    ],
  },
  {
    title: "For shops",
    intro: "Listing, onboarding and running bookings or queues.",
    items: [
      {
        question: "Who can register a shop on FastQue?",
        answer:
          "Genuine grooming and beauty businesses such as barbershops, salons, beauty parlours, nail bars and spas can start the shop-registration process.",
      },
      {
        question: "How do I list my business?",
        answer:
          "Use the Register your shop or List Your Shop link on FastQue and complete the requested business and onboarding information.",
      },
      {
        question: "What can a shop manage in FastQue?",
        answer:
          "The platform supports shop information, services, team or barber setup, chairs, hours, bookings and live-queue operations through the shop workspace where those features are enabled.",
      },
      {
        question: "What is a FastQue Shop ID?",
        answer:
          "A FastQue Shop ID is a persistent identifier associated with a shop in the platform. It helps FastQue and the business refer to the correct listing and operational records.",
      },
      {
        question: "Can a shop use both appointments and a live queue?",
        answer:
          "FastQue is designed to support both scheduled booking and live-queue workflows. The exact setup available to a business depends on its configured workspace and services.",
      },
      {
        question: "Does listing on FastQue guarantee customers or revenue?",
        answer:
          "No. FastQue provides discovery and operational tools, but it does not guarantee customer volume, bookings, revenue or business performance.",
      },
      {
        question: "How can a shop get onboarding help?",
        answer:
          "Use the Contact Us page or email support@fastque.com for shop onboarding and partnership assistance.",
      },
    ],
  },
  {
    title: "Accounts, privacy and support",
    intro: "Security, personal data and getting help.",
    items: [
      {
        question: "How do I contact FastQue support?",
        answer:
          "Email support@fastque.com. Include the email or phone number you use with FastQue and any relevant booking or shop ID, but never send your password or OTP.",
      },
      {
        question: "Should I ever share my password or OTP with FastQue staff?",
        answer:
          "No. Do not share passwords, OTPs or other sign-in secrets with FastQue support, field staff or any third party.",
      },
      {
        question: "Where can I read the privacy policy?",
        answer:
          "The public Privacy Policy is available from the website footer and explains FastQue's published privacy terms.",
      },
      {
        question: "How do I request account deletion?",
        answer:
          "Use the Account Deletion page linked in the website footer for the published account-deletion process and support route.",
      },
      {
        question: "What should I do if I see suspicious activity?",
        answer:
          "Contact support@fastque.com promptly and do not disclose credentials, OTPs or payment secrets. If the issue concerns a shop, include the relevant shop or booking reference if available.",
      },
    ],
  },
  {
    title: "Careers and employees",
    intro: "Field-sales hiring, employment terms and HR policy.",
    items: [
      {
        question: "Is FastQue hiring Field Sales & Shop Onboarding Executives?",
        answer:
          "FastQue publishes current hiring information on the Careers page. Applications can be sent through the published support email route.",
      },
      {
        question: "Is prior field-sales experience mandatory?",
        answer:
          "For the currently published field-sales role, prior experience is not mandatory. Communication, consistency, honesty and ability to work with local businesses are important.",
      },
      {
        question: "What is the probation period?",
        answer:
          "The current field-sales offer terms provide a three-month probation period. The company may extend probation based on performance and assessment.",
      },
      {
        question: "What notice is required for resignation?",
        answer:
          "The current field-sales offer terms require at least one month or 30 days prior written notice for resignation, unless a reduction or waiver is approved in writing by the company, subject to applicable law.",
      },
      {
        question: "What is the current shop-onboarding performance condition?",
        answer:
          "Under the current field-sales offer structure, eligibility for the committed salary requires at least 85 verified shop onboardings in the applicable performance period.",
      },
      {
        question: "How does the current onboarding incentive work?",
        answer:
          "Under the current offer structure, shops 86 through 100 earn an incentive of INR 60 per shop in that slab, and the 101st shop onward earns INR 100 per additional shop.",
      },
      {
        question: "What counts as a verified shop onboarding?",
        answer:
          "An onboarding must be genuine and complete enough for FastQue verification. Duplicate, fake or materially incomplete registrations do not count toward performance targets.",
      },
      {
        question: "Where can employees and candidates read the HR policy?",
        answer:
          "The public HR Policy page is linked from Careers and the website footer. Employee-specific written offer letters, contracts and applicable law take precedence where they contain more specific terms.",
      },
    ],
  },
];

function faqSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_GROUPS.flatMap((group) =>
      group.items.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    ),
  };
}

export default function FaqPage() {
  return (
    <CustomerShell>
      <main className={styles.page}>
        <JsonLd data={faqSchema()} />

        <section className={styles.hero}>
          <p className={styles.eyebrow}>FastQue help</p>
          <h1>Questions, answered clearly.</h1>
          <p className={styles.lead}>
            Common answers for customers, shop owners, candidates and employees. If your question is
            specific to your account, booking, shop or offer letter, contact FastQue support.
          </p>
          <div className={styles.heroActions}>
            <Link href="/contact-us" className={styles.primary}>Contact support</Link>
            <Link href="/hr-policy" className={styles.secondary}>HR Policy</Link>
          </div>
        </section>

        {FAQ_GROUPS.map((group) => (
          <section className={styles.section} key={group.title}>
            <div className={styles.sectionHeader}>
              <p className={styles.eyebrow}>{group.title}</p>
              <h2>{group.title}</h2>
              <p>{group.intro}</p>
            </div>

            <div className={styles.faqList}>
              {group.items.map((item) => (
                <details className={styles.faqItem} key={item.question}>
                  <summary>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </section>
        ))}

        <section className={styles.finalCta}>
          <p className={styles.eyebrow}>Still need help?</p>
          <h2>Talk to FastQue.</h2>
          <p>
            Email support@fastque.com for account, booking, shop onboarding, careers or employee
            assistance. Never send passwords or OTPs.
          </p>
          <div className={styles.cardActions}>
            <a href="mailto:support@fastque.com" className={styles.primary}>support@fastque.com</a>
            <Link href="/contact-us" className={styles.secondary}>Contact options</Link>
          </div>
        </section>
      </main>
    </CustomerShell>
  );
}
