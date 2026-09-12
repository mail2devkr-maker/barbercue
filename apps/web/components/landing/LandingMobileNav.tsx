"use client";

import { useState } from "react";
import Link from "next/link";
import { MenuIcon, CloseIcon } from "./icons";
import styles from "./landing.module.css";

const LINKS = [
  { href: "/search", label: "Find a barber" },
  { href: "#services", label: "Services" },
  { href: "#book-or-queue", label: "How it works" },
  { href: "#for-shops", label: "For shops" },
  { href: "#site-footer", label: "About" },
];

/**
 * Small client island for the public landing header's mobile menu. The page around it stays a
 * Server Component (SEO/data fetching), so only the open/close state lives here.
 */
export function LandingMobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.mobileNavHost}>
      <button
        type="button"
        className={styles.menuToggle}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </button>

      {open && (
        <nav className={styles.mobileNav} aria-label="Mobile">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={styles.mobileNavLink} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
          <div className={styles.mobileNavDivider} aria-hidden="true" />
          <Link href="/login" className={styles.mobileNavLink} onClick={() => setOpen(false)}>
            Sign in
          </Link>
          <Link href="/dashboard/register-shop" className={styles.mobileNavCta} onClick={() => setOpen(false)}>
            List your shop
          </Link>
        </nav>
      )}
    </div>
  );
}
