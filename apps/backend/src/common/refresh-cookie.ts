import type { Response } from 'express';
import { REFRESH_TOKEN_COOKIE_NAME } from '@barbercue/shared';

const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches TokenService

// Previously assumed production always put web and backend on separate registrable domains
// (forcing SameSite=None). That was never actually true: apps/web/next.config.ts reverse-proxies
// /api/v1/* to the backend's private *.railway.internal address, and NEXT_PUBLIC_API_BASE_URL is
// the relative path "/api/v1" — every browser->API call is same-origin to fastque.com. `None`
// cookies carry restrictions `Lax` doesn't need and don't get the same reliability guarantees
// browsers give same-site cookies across a top-level navigation, which is the proven root cause of
// a live bug where this cookie failed to survive an owner clicking Home after logging in (confirmed
// via production HTTP logs: a successful /auth/refresh immediately followed by one arriving with no
// cookie at all). Only the web client relies on this cookie — mobile sends its refresh token in the
// request body instead — so this cannot affect mobile auth.
const CROSS_SITE_COOKIES = false;

/**
 * Extracted from AuthController so SalonsController's registerSalon (which also mints a fresh
 * token pair — the customer-to-owner audience transition) can set the exact same web session
 * cookie every login endpoint already does, with zero risk of the two ever drifting apart.
 */
export function setRefreshCookie(response: Response, refreshToken: string): void {
  response.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    // "site" (for SameSite purposes) ignores port, so `lax` works across localhost:3000/3001 in
    // dev — both are the same site (`localhost`). In production web and backend are separate
    // registrable domains: Railway gives each service its own `*.up.railway.app` host, and
    // `up.railway.app` is itself on the Public Suffix List, so the two hosts are cross-site.
    // A `lax` cookie is never sent on a cross-site XHR, which silently breaks /auth/refresh
    // (the session dies on the next reload). `none` is therefore required in production, and
    // is only legal alongside `secure` — hence both flags derive from the same condition
    // rather than being set independently.
    sameSite: CROSS_SITE_COOKIES ? 'none' : 'lax',
    secure: CROSS_SITE_COOKIES,
    // Path is deliberately "/", not "/api/v1/auth": cookies are scoped by (domain, path), never
    // by port, so this same cookie jar is shared between the backend (localhost:3000) and
    // apps/web's proxy.ts (localhost:3001) in dev. proxy.ts's coarse "is there a session at
    // all" gate on /account/* and /dashboard/* reads this cookie on requests to the WEB app —
    // a path that never starts with "/api/v1/auth", so a narrower path silently hid the cookie
    // from that check. Only /auth/refresh and /auth/logout ever read this cookie server-side
    // regardless of path.
    path: '/',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

export function clearRefreshCookie(response: Response): void {
  // Attributes must mirror setRefreshCookie's: a browser only removes a cookie when the
  // clearing Set-Cookie matches the stored one, so logout would silently leave a
  // SameSite=None/Secure cookie in place if these were omitted.
  response.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: CROSS_SITE_COOKIES ? 'none' : 'lax',
    secure: CROSS_SITE_COOKIES,
    path: '/',
  });
}
