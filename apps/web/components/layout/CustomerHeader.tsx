"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { isWorkspaceUser, workspaceLandingPath, workspaceNavigationLabel } from "../../lib/workspace-route";
import { BrandLockup } from "../ui/BrandLockup";
import { NotificationBell } from "./NotificationBell";
import styles from "./customer-shell.module.css";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/search", label: "Find a Barber" },
  { href: "/account/bookings", label: "My Bookings" },
  { href: "/style-advisor", label: "AI Style Advisor" },
];

// Renders on both public discovery pages (search/city/locality/salon-profile — reachable by
// anonymous visitors) and authenticated customer pages, so it has to work correctly in both
// states. Public browsing is role-aware: customer sessions retain the customer account menu,
// while owner/staff and platform-admin sessions get a direct link back to their own protected
// workspace instead of being sent through customer-only /account routes.
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
  const workspaceUser = user && isWorkspaceUser(user) ? user : null;
  const visibleNavLinks = workspaceUser
    ? NAV_LINKS.filter((link) => link.href === "/" || link.href === "/search")
    : NAV_LINKS;

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.wordmark} aria-label="FastQue home">
          <BrandLockup showTagline canonicalArtwork />
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          {visibleNavLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`${styles.navLink} ${pathname === link.href ? styles.navLinkActive : ""}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className={styles.accountArea} ref={accountAreaRef} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isAuthenticated && <NotificationBell />}
          {isAuthenticated ? workspaceUser ? (
            <Link
              href={workspaceLandingPath(workspaceUser)}
              className={styles.accountButton}
              aria-label={workspaceNavigationLabel(workspaceUser)}
            >
              {workspaceNavigationLabel(workspaceUser)}
            </Link>
          ) : (
            <>
              <button
                type="button"
                className={styles.accountButton}
                onClick={() => setAccountMenuOpen((v) => !v)}
                aria-expanded={accountMenuOpen}
                aria-haspopup="true"
              >
                <BrandLockup compact markOnly />
                My account <span aria-hidden="true">⌄</span>
              </button>
              {accountMenuOpen && (
                <div className={styles.accountDropdown} role="menu">
                  <Link
                    href="/account/bookings"
                    role="menuitem"
                    className={styles.accountDropdownItem}
                    onClick={() => setAccountMenuOpen(false)}
                  >
                    My bookings
                  </Link>
                  <Link
                    href="/account/credits"
                    role="menuitem"
                    className={styles.accountDropdownItem}
                    onClick={() => setAccountMenuOpen(false)}
                  >
                    FastQue Credits
                  </Link>
                  <Link
                    href="/account/profile"
                    role="menuitem"
                    className={styles.accountDropdownItem}
                    onClick={() => setAccountMenuOpen(false)}
                  >
                    Profile & security
                  </Link>
                  <Link
                    href="/account/premium"
                    role="menuitem"
                    className={styles.accountDropdownItem}
                    onClick={() => setAccountMenuOpen(false)}
                  >
                    Premium
                  </Link>
                  <Link
                    href="/style-advisor"
                    role="menuitem"
                    className={styles.accountDropdownItem}
                    onClick={() => setAccountMenuOpen(false)}
                  >
                    AI Style Advisor
                  </Link>
                  {/* Own-shop management is a different login/session surface entirely (see
                      /owner/login) — shown unconditionally, same reasoning as account/layout.tsx's
                      own Owner Dashboard link: a CUSTOMER-audience session can never tell whether
                      this account also owns a shop. */}
                  <Link
                    href="/owner/login"
                    role="menuitem"
                    className={styles.accountDropdownItem}
                    onClick={() => setAccountMenuOpen(false)}
                  >
                    Owner Dashboard
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    className={`${styles.accountDropdownItem} ${styles.logoutItem}`}
                    onClick={() => void handleLogout()}
                  >
                    Log out
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
          {visibleNavLinks.map((link) => (
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
              {workspaceUser ? (
                <Link
                  href={workspaceLandingPath(workspaceUser)}
                  className={styles.mobileNavLink}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {workspaceNavigationLabel(workspaceUser)}
                </Link>
              ) : (
                <>
                  <Link href="/account/credits" className={styles.mobileNavLink} onClick={() => setMobileMenuOpen(false)}>
                    FastQue Credits
                  </Link>
                  <Link href="/account/profile" className={styles.mobileNavLink} onClick={() => setMobileMenuOpen(false)}>
                    Profile &amp; security
                  </Link>
                  <Link href="/account/premium" className={styles.mobileNavLink} onClick={() => setMobileMenuOpen(false)}>
                    Premium
                  </Link>
                  <Link href="/owner/login" className={styles.mobileNavLink} onClick={() => setMobileMenuOpen(false)}>
                    Owner Dashboard
                  </Link>
                </>
              )}
              <button type="button" className={styles.mobileNavLink} onClick={() => void handleLogout()}>
                Log out
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
