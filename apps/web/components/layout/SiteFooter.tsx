import Link from "next/link";
import { BrandLockup } from "../ui/BrandLockup";
import { AppAccessQr } from "./AppAccessQr";
import styles from "../landing/landing.module.css";

// Only render live social links when the owner has provided an exact official profile URL.
// Never invent a profile or link to a generic Instagram/Facebook search page.
function validatedSocialUrl(raw: string | undefined, platform: "instagram" | "facebook"): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const hosts = platform === "instagram"
      ? ["instagram.com", "www.instagram.com"]
      : ["facebook.com", "www.facebook.com", "m.facebook.com", "fb.com"];
    if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.pathname === "/") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Canonical FastQue website footer.
 * Uses the same structure and visual treatment as the Home page so customer, auth,
 * public and dashboard surfaces do not drift into separate footer designs.
 */
export function SiteFooter() {
  const instagram = validatedSocialUrl(process.env.NEXT_PUBLIC_FASTQUE_INSTAGRAM_URL, "instagram");
  const facebook = validatedSocialUrl(process.env.NEXT_PUBLIC_FASTQUE_FACEBOOK_URL, "facebook");

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
            <Link href="/app">Android app & QR</Link>
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
            <Link href="/careers">Careers</Link>
            <Link href="/faq">FAQ</Link>
            <Link href="/hr-policy">HR Policy</Link>
            <Link href="/login">Customer login</Link>
            <Link href="/privacy-policy">Privacy policy</Link>
            <Link href="/account-deletion">Account deletion</Link>
          </div>
        </nav>

        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 22,
          width: "100%",
          padding: "18px 22px",
          border: "1px solid rgba(255,255,255,.17)",
          borderRadius: 18,
          background: "rgba(255,255,255,.05)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <Link href="/app" aria-label="FastQue Android app information and QR" style={{ display: "block", background: "#fff", padding: 8, borderRadius: 11 }}>
              <AppAccessQr size={98} />
            </Link>
            <div style={{ maxWidth: 360 }}>
              <strong style={{ display: "block", marginBottom: 6 }}>FastQue for Android</strong>
              <p style={{ margin: "0 0 6px", lineHeight: 1.5, fontSize: 13, opacity: .78 }}>
                Scan for our permanent app page. Public Android release is coming after testing.
              </p>
              <Link href="/app" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>App link &amp; QR →</Link>
            </div>
          </div>
          {(instagram || facebook) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <strong>Follow FastQue</strong>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                {instagram && <a href={instagram} target="_blank" rel="noopener noreferrer" aria-label="FastQue official Instagram profile">Instagram ↗</a>}
                {facebook && <a href={facebook} target="_blank" rel="noopener noreferrer" aria-label="FastQue official Facebook page">Facebook ↗</a>}
              </div>
            </div>
          )}
        </div>

        <p className={styles.footerNote}>
          <span>© 2026 Fastque Digital Technology Private Limited. All Rights Reserved.</span>
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
