"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Role } from "@barbercue/shared";
import { useAuth } from "../../lib/auth-context";
import { withNextParam } from "../../lib/safe-next-path";
import styles from "./require-role.module.css";

/**
 * Client-side route guard. This is UX only, not the security boundary — the backend's
 * JwtAuthGuard/RolesGuard are what actually enforce access (ARCHITECTURE.md: "No frontend-only
 * authorization"). Even if this component were removed entirely, every protected API call would
 * still correctly reject an unauthenticated or wrong-role request; all this does is redirect the
 * user to the right login page before they see a page full of failed requests.
 */
export function RequireRole({
  roles,
  redirectTo,
  children,
}: {
  roles?: Role[];
  redirectTo: string;
  children: React.ReactNode;
}) {
  const { user, status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const authorized = status === "authenticated" && (!roles || (user && roles.some((r) => user.roles.includes(r))));

  useEffect(() => {
    if (status === "loading") return;
    if (authorized) return;
    // Carry the page the visitor was actually trying to reach through to the login screen, which
    // already honours ?next=. Without this a logged-out visitor who taps "Register your shop" is
    // sent to /login and then dumped on the default customer landing page, with no route back —
    // in production `proxy.ts` short-circuits (web and API are on different hosts), so this
    // component is the only thing that can preserve the destination.
    //
    // The query string is read from `window` rather than useSearchParams(): that hook opts every
    // page wrapping this guard out of static prerendering ("useSearchParams() should be wrapped
    // in a suspense boundary"), which fails the production build. This runs in an effect, so it
    // is always client-side and `window` is always defined.
    const search = typeof window === "undefined" ? "" : window.location.search;
    router.replace(withNextParam(redirectTo, `${pathname}${search}`));
  }, [status, authorized, redirectTo, router, pathname]);

  if (status === "loading") {
    return (
      <main className={styles.loadingPage}>
        <div className={styles.loadingCard} role="status">
          <span className={styles.loadingMark} aria-hidden="true">BC</span>
          <div>
            <strong>Preparing your BarberCue</strong>
            <p>Restoring your secure session…</p>
          </div>
        </div>
      </main>
    );
  }
  if (!authorized) return null;

  return <>{children}</>;
}
