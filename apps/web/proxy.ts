import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { REFRESH_TOKEN_COOKIE_NAME } from "@barbercue/shared";
import { canonicalHostRedirectUrl } from "./lib/canonical-host";

// Coarse cookie-presence gate only; backend guards remain the security boundary.
const API_HOSTNAME = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1").hostname;
  } catch {
    return null;
  }
})();

export function proxy(request: NextRequest) {
  const canonicalRedirect = canonicalHostRedirectUrl(request.url, request.headers.get("host"));
  if (canonicalRedirect) return NextResponse.redirect(canonicalRedirect, 308);

  const { pathname } = request.nextUrl;
  const requiresSession = pathname === "/account" || pathname.startsWith("/account/")
    || pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  if (!requiresSession) return NextResponse.next();

  // In split-domain production, the backend refresh cookie is not sent to the web host. Leave
  // authentication decisions to the existing /auth/me role check and backend guards there.
  if (API_HOSTNAME !== request.nextUrl.hostname) return NextResponse.next();
  if (request.cookies.has(REFRESH_TOKEN_COOKIE_NAME)) return NextResponse.next();

  const loginPath = pathname === "/dashboard/register-shop"
    ? "/owner/register"
    : pathname.startsWith("/dashboard/admin")
      ? "/admin/login"
      : pathname.startsWith("/dashboard/salons")
        ? "/staff/login"
        : "/login";

  const redirectUrl = new URL(loginPath, request.url);
  redirectUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(redirectUrl);
}

export const config = { matcher: ["/:path*"] };
