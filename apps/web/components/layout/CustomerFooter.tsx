import Link from "next/link";
import { BrandLockup } from "../ui/BrandLockup";
import styles from "./customer-shell.module.css";

// Keep the public legal notice reachable from customer and discovery surfaces.
export function CustomerFooter({ dark }: { dark?: boolean }) {
  return (
    <footer className={dark ? `${styles.footer} ${styles.footerDark}` : styles.footer}>
      <div className={styles.footerInner}>
        <span className={styles.footerLogoFrame}>
          <BrandLockup compact canonicalArtwork />
        </span>
        <nav className={styles.footerLinks} aria-label="Footer">
          <Link href="/search">Find a Barber</Link>
          <Link href="/account/bookings">My Bookings</Link>
          <Link href="/style-advisor">Style Advisor</Link>
          <Link href="/account/profile">Account</Link>
          <Link href="/about-us">About Us</Link>
          <Link href="/contact-us">Contact Us</Link>
          <Link href="/privacy-policy">Privacy Policy</Link>
          <Link href="/account-deletion">Account Deletion</Link>
        </nav>
        <p className={styles.footerNote}>
          <span>© {new Date().getFullYear()} FastQue.</span>
          <span className={styles.poweredByBadge} aria-label="Powered By DCW">
            <span className={styles.poweredByText}>Powered By</span>
            <span className={styles.poweredByDcw}>DCW</span>
          </span>
        </p>
      </div>
    </footer>
  );
}
