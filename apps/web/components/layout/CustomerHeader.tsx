"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import styles from "./customer-shell.module.css";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/search", label: "Find a Barber" },
  { href: "/account/bookings", label: "My Bookings" },
  { href: "/style-advisor", label: "AI Style Advisor" },
];

// Renders on both public discovery pages (search/city/locality/salon-profile — reachable by
// anonymous visitors) and authenticated customer pages, so it has to work correctly in both
// states: nav links are always visible (clicking one while signed out hits the existing
// RequireRole redirect on the destination page, same as today), only the account area on the
// right swaps between "Sign in" and the Account menu.
export function CustomerHeader() {
  const { user, status, logout } = useAuth();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (accountAreaRef.current && !accountAreaRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setAccountMenuOpen(false);
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  async function handleLogout() {
    setAccountMenuOpen(false);
    setMobileMenuOpen(false);
    await logout();
  }

  const isAuthenticated = status === "authenticated" && user !== null;

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.wordmark} aria-label="BarberCue home">
          BarberCue
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`${styles.navLink} ${pathname === link.href ? styles.navLinkActive : ""}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className={styles.accountArea} ref={accountAreaRef}>
          {isAuthenticated ? (
            <>
              <button
                type="button"
                className={styles.accountButton}
                onClick={() => setAccountMenuOpen((v) => !v)}
                aria-expanded={accountMenuOpen}
                aria-haspopup="true"
              >
                Account ▾
              </button>
              {accountMenuOpen && (
                <div className={styles.accountDropdown} role="menu">
                  <Link
                    href="/account/profile"
                    role="menuitem"
                    className={styles.accountDropdownItem}
                    onClick={() => setAccountMenuOpen(false)}
                  >
                    Profile
                  </Link>
                  <Link
                    href="/account/premium"
                    role="menuitem"
                    className={styles.accountDropdownItem}
                    onClick={() => setAccountMenuOpen(false)}
                  >
                    Premium
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.accountDropdownItem}
                    onClick={() => void handleLogout()}
                  >
                    Logout
                  </button>
                </div>
              )}
            </>
          ) : (
            <Link href="/login" className={styles.signInLink}>
              Sign in
            </Link>
          )}
        </div>

        <button
          type="button"
          className={styles.menuToggle}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((v) => !v)}
        >
          {mobileMenuOpen ? "✕" : "☰"}
        </button>
      </div>

      {mobileMenuOpen && (
        <nav className={styles.mobileNav} aria-label="Mobile">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={styles.mobileNavLink}
              onClick={() => setMobileMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          {isAuthenticated ? (
            <>
              <Link href="/account/profile" className={styles.mobileNavLink} onClick={() => setMobileMenuOpen(false)}>
                Profile
              </Link>
              <Link href="/account/premium" className={styles.mobileNavLink} onClick={() => setMobileMenuOpen(false)}>
                Premium
              </Link>
              <button type="button" className={styles.mobileNavLink} onClick={() => void handleLogout()}>
                Logout
              </button>
            </>
          ) : (
            <Link href="/login" className={styles.mobileNavLink} onClick={() => setMobileMenuOpen(false)}>
              Sign in
            </Link>
          )}
        </nav>
      )}
    </header>
  );
}
