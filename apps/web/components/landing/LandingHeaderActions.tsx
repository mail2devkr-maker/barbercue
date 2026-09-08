"use client";

import Link from "next/link";
import { useAuth } from "../../lib/auth-context";
import { workspaceLandingPath, workspaceNavigationLabel } from "../../lib/workspace-route";
import styles from "./landing.module.css";

/**
 * Auth-aware actions for the public landing header.
 *
 * The landing page is a Server Component for SEO/data fetching, so only this small island needs
 * to be client-side. Keeping it inside the root AuthProvider means Home reflects the exact same
 * authenticated state as the account/dashboard surfaces instead of always rendering a hard-coded
 * "Sign in" link.
 */
export function LandingHeaderActions() {
  const { user, status } = useAuth();
  const authenticatedUser = status === "authenticated" ? user : null;

  return (
    <div className={styles.headerActions}>
      {authenticatedUser ? (
        <Link href={workspaceLandingPath(authenticatedUser)} className={styles.headerSignIn}>
          {workspaceNavigationLabel(authenticatedUser)}
        </Link>
      ) : status === "unauthenticated" ? (
        <Link href="/login" className={styles.headerSignIn}>
          Sign in
        </Link>
      ) : (
        <span className={styles.headerSignIn} aria-hidden="true" style={{ visibility: "hidden" }}>
          Sign in
        </span>
      )}
      <Link href="/search" className={styles.headerPrimary}>
        Find a barber
      </Link>
    </div>
  );
}
