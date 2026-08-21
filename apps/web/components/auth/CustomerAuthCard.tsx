import styles from "./customer-auth.module.css";

// Customer-only login presentation. Deliberately separate from AuthCard (still used by
// staff/owner/admin/forgot-password/reset-password) rather than adding branching props to that
// shared component — this is the one auth surface that needs product branding, the other five
// stay generic on purpose.
const WORDMARK = "BarberCue";
// Reuses the landing page's own hero headline verbatim (apps/web/app/(public)/page.tsx) rather
// than inventing new marketing copy.
const HEADLINE = "Skip the wait. Book your chair.";
const SUPPORTING_TEXT = "Find a barber, check the wait, and book your chair — all in one place.";

export function CustomerAuthCard({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.wordmark}>{WORDMARK}</p>
        <h1 className={styles.headline}>{HEADLINE}</h1>
        <p className={styles.supporting}>{SUPPORTING_TEXT}</p>
        {children}
      </div>
    </main>
  );
}
