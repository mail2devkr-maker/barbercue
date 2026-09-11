import type { Metadata } from "next";
import Link from "next/link";
import { CustomerShell } from "../../../components/layout/CustomerShell";
import { absoluteUrl } from "../../../lib/seo";
import styles from "../privacy-policy/privacy-policy.module.css";

const TITLE = "Account Deletion";
const DESCRIPTION = "How to delete a FastQue customer account or request deletion when you no longer have the app.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/account-deletion") },
  openGraph: { title: `${TITLE} | FastQue`, description: DESCRIPTION, url: absoluteUrl("/account-deletion"), type: "website" },
};

export default function AccountDeletionPage() {
  return (
    <CustomerShell>
      <main className={styles.page}>
        <article className={styles.article}>
          <header className={styles.hero}>
            <p className={styles.eyebrow}>FastQue account support</p>
            <h1>Delete your account</h1>
            <p className={styles.lead}>
              FastQue provides a customer account-deletion flow in the mobile app. This page also provides a request
              path if you no longer have access to the app.
            </p>
          </header>

          <section>
            <h2>Delete an active customer account in the app</h2>
            <ol>
              <li>Sign in to the FastQue mobile app with the customer account you want to delete.</li>
              <li>Open Account.</li>
              <li>Select Delete account and confirm the irreversible action.</li>
            </ol>
            <p>The flow is limited to the signed-in customer account and immediately revokes its active sessions.</p>
          </section>

          <section>
            <h2>Request deletion without the app</h2>
            <p>
              Email <a href="mailto:support@fastque.com?subject=FastQue%20account%20deletion%20request">support@fastque.com</a>{" "}
              with the subject “FastQue account deletion request.” Do not include a password, OTP, UPI PIN, payment QR
              image or other sensitive payment information in the email. FastQue may need to verify that a request is
              associated with the account before taking action and does not confirm whether a particular account exists
              through this public page.
            </p>
          </section>

          <section>
            <h2>What deletion removes or retains</h2>
            <p>
              Account deletion removes direct account identifiers, linked sign-in methods, password material, active
              sessions are revoked, and device push registrations, notification preferences and in-app notifications are removed. FastQue keeps a
              de-identified account record only where required to preserve booking, review, promotional-credit,
              subscription, transaction-integrity or security records. FastQue does not publish a single automatic
              retention period for those records.
            </p>
            <p>
              This customer flow does not delete a salon, owner, staff or administrator account. Those account types
              can have business and operational responsibilities and must not be removed through a customer-session
              action.
            </p>
          </section>

          <section>
            <h2>Privacy information</h2>
            <p>Read the full <Link href="/privacy-policy">FastQue Privacy Policy</Link>.</p>
          </section>
        </article>
      </main>
    </CustomerShell>
  );
}
