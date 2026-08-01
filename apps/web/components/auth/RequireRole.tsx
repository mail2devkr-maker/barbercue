"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@barbercue/shared";
import { useAuth } from "../../lib/auth-context";

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
  const authorized = status === "authenticated" && (!roles || (user && roles.some((r) => user.roles.includes(r))));

  useEffect(() => {
    if (status === "loading") return;
    if (!authorized) router.replace(redirectTo);
  }, [status, authorized, redirectTo, router]);

  if (status === "loading") return <p style={{ padding: "2rem" }}>Loading…</p>;
  if (!authorized) return null;

  return <>{children}</>;
}
