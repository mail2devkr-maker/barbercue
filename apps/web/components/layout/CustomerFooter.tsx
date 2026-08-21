import Link from "next/link";
import styles from "./customer-shell.module.css";

// Only routes that actually exist in the app — no invented Terms/Privacy links.
export function CustomerFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span className={styles.footerWordmark}>BarberCue</span>
        <nav className={styles.footerLinks} aria-label="Footer">
          <Link href="/search">Find a Barber</Link>
          <Link href="/account/bookings">My Bookings</Link>
          <Link href="/style-advisor">Style Advisor</Link>
          <Link href="/account/profile">Account</Link>
        </nav>
        <p className={styles.footerNote}>© {new Date().getFullYear()} BarberCue.</p>
      </div>
    </footer>
  );
}
