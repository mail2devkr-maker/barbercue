import Link from "next/link";
import { BrandLockup } from "../ui/BrandLockup";
import styles from "../landing/landing.module.css";

/**
 * Canonical FastQue website footer.
 * Uses the same structure and visual treatment as the Home page so customer, auth,
 * public and dashboard surfaces do not drift into separate footer designs.
 */
export function SiteFooter() {
  return (
    <footer id="site-footer" className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <span className={styles.footerLogoFrame}>
            <BrandLockup compact canonicalArtwork />
          </span>
          <p>Purpose-built for modern barbershops.</p>
        </div>

        <nav className={styles.footerLinks} aria-label="Footer">
          <div>
            <span>Customers</span>
            <Link href="/search">Find a barber</Link>
            <Link href="/account/bookings">My bookings</Link>
            <Link href="/style-advisor">Style Advisor</Link>
          </div>
          <div>
            <span>Shops</span>
            <Link href="/dashboard/register-shop">Register your shop</Link>
            <Link href="/owner/login">Owner login</Link>
            <Link href="/staff/login">Staff login</Link>
          </div>
          <div>
            <span>FastQue</span>
            <Link href="/employee/login">Employee Login</Link>
            <Link href="/about-us">About Us</Link>
            <Link href="/contact-us">Contact Us</Link>
            <Link href="/login">Customer login</Link>
            <Link href="/privacy-policy">Privacy policy</Link>
            <Link href="/account-deletion">Account deletion</Link>
          </div>
        </nav>

        <p className={styles.footerNote}>
          <span>© 2026 FastQue Private Limited. All Rights Reserved.</span>
          <a
            className={styles.sitePoweredBy}
            href="https://dcw.co.in/what-is-dcw"
            aria-label="Powered By DCW — learn what DCW is"
          >
            <span className={styles.sitePoweredByText}>Powered By</span>
            <span className={styles.sitePoweredByDcw}>DCW</span>
          </a>
        </p>
      </div>
    </footer>
  );
}
