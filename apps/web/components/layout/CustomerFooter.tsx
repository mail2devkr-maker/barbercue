import Link from "next/link";
import { BrandLockup } from "../ui/BrandLockup";
import styles from "./customer-shell.module.css";

// Keep the public legal notice reachable from customer and discovery surfaces.
export function CustomerFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span className={styles.footerLogoFrame}>
          <BrandLockup compact canonicalArtwork />
        </span>
        <nav className={styles.footerLinks} aria-label="Footer">
          <Link href="/search">Find a Barber</Link>
          <Link href="/account/bookings">My Bookings</Link>
          <Link href="/style-advisor">Style Advisor</Link>
          <Link href="/account/profile">Account</Link>
          <Link href="/privacy-policy">Privacy Policy</Link>
          <Link href="/account-deletion">Account Deletion</Link>
        </nav>
        <p className={styles.footerNote}>© {new Date().getFullYear()} FastQue. · Created by Devdutta Kumar Pandey</p>
      </div>
    </footer>
  );
}
