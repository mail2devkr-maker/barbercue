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
export function proxy(request: NextRequest) {
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
