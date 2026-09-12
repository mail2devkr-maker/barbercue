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
 *
 * Two label/route sets share one auth-aware component instead of duplicating the branching logic:
 * "wide" is the single-row desktop header (Sign In + List Your Shop, routed at the real shop
 * registration flow), "utility" is the two-row header's top bar (Login + Sign Up). Both sign-in
 * actions land on the same real OTP flow at /login — there's no separate registration screen to
 * point "Sign Up" at, so it intentionally shares the route rather than linking to a page that
 * doesn't exist.
 */
export function LandingHeaderActions({ variant }: { variant: "wide" | "utility" }) {
  const { user, status } = useAuth();
  const authenticatedUser = status === "authenticated" ? user : null;

  const signInLabel = variant === "wide" ? "Sign In" : "Login";
  const linkClassName = variant === "wide" ? styles.headerSignIn : styles.utilityLink;
  const ctaClassName = variant === "wide" ? styles.headerCta : styles.utilityCta;
  const ctaLabel = variant === "wide" ? "List Your Shop" : "Sign Up";
  const ctaHref = variant === "wide" ? "/dashboard/register-shop" : "/login";
  const rootClassName = variant === "wide" ? styles.headerWideActions : styles.utilityAuth;

  return (
    <div className={rootClassName}>
      {authenticatedUser ? (
        <Link href={workspaceLandingPath(authenticatedUser)} className={linkClassName}>
          {workspaceNavigationLabel(authenticatedUser)}
        </Link>
      ) : status === "unauthenticated" ? (
        <Link href="/login" className={linkClassName}>
          {signInLabel}
        </Link>
      ) : (
        <span className={linkClassName} aria-hidden="true" style={{ visibility: "hidden" }}>
          {signInLabel}
        </span>
      )}
      {!authenticatedUser && (
        <Link href={ctaHref} className={ctaClassName}>
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
