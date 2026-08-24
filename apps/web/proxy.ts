import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { REFRESH_TOKEN_COOKIE_NAME } from "@barbercue/shared";

/**
 * Coarse, cookie-presence-only gate — NOT the security boundary (ARCHITECTURE.md: "No
 * frontend-only authorization"). The access token lives only in browser memory (see lib/api.ts),
 * never in a cookie, so Proxy has no way to read it or the caller's role here; it can only see
 * whether the httpOnly refresh cookie exists at all. Real role enforcement happens twice, both
 * server-side: the backend's JwtAuthGuard/RolesGuard on every API call (authoritative), and
 * client-side in <RequireRole> once the page has hydrated and fetched /auth/me (redirects a
 * wrong-role user before they see a page full of failed requests). This layer exists purely so a
 * fully logged-out visitor is bounced to a login page instead of a blank/loading dashboard shell.
 */
// Hostname the browser actually talks to for the API. The refresh cookie is set by the BACKEND
// on the backend's own host, so this middleware — which only ever sees cookies belonging to the
// WEB host — can read it exclusively when the two share a hostname.
const API_HOSTNAME = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1").hostname;
  } catch {
    return null;
  }
})();

export function proxy(request: NextRequest) {
  // In dev both apps are on `localhost` (cookies ignore port), so the cookie set by the backend
  // is visible here and the gate below works. In a split-domain deployment (Railway gives each
  // service its own *.up.railway.app host) the cookie belongs to the backend's host and is never
  // sent to this one — so this check could only ever conclude "logged out" and would bounce a
  // just-authenticated user straight back to /login, which is exactly the production Google
  // Sign-In failure this guard caused. Skip the gate when we know we cannot see the cookie and
  // let <RequireRole> (client-side, authoritative via /auth/me) handle the redirect instead. The
  // real security boundary is unchanged either way: the backend's JwtAuthGuard/RolesGuard.
  if (API_HOSTNAME !== request.nextUrl.hostname) return NextResponse.next();

  const hasSession = request.cookies.has(REFRESH_TOKEN_COOKIE_NAME);
  if (hasSession) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const loginPath = pathname.startsWith("/dashboard/admin")
    ? "/admin/login"
    : pathname.startsWith("/dashboard/salons")
      ? "/staff/login"
      : "/login";

  const redirectUrl = new URL(loginPath, request.url);
  redirectUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/account/:path*", "/dashboard/:path*"],
};
