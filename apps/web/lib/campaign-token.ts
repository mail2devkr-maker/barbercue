// Campaign link propagation (requirement #3, decision on issue #221). A shop owner shares the canonical public shop URL
// with `?fq_campaign=<token>`. The customer web app carries that value, for the SAME shop only, through the booking
// flow and sends it as the optional `attributionToken` on the final POST /bookings. The server alone checks it (hash,
// shop, active window, revocation) and silently ignores one that is invalid, expired, revoked or for another shop, so a
// bad value can never block or change a booking.
//
// The token is an attribution marker, not a credential and not proof of where a customer came from. It is kept only in
// this tab's session storage, keyed by the shop, for a short time; it is never logged, sent anywhere but the booking
// request, or kept in the account. A client-side `source` is never accepted as attribution.

export const CAMPAIGN_QUERY_KEY = "fq_campaign";

/** How long a captured token is remembered. After this the visit no longer counts as coming from the link. */
export const CAMPAIGN_TTL_MS = 2 * 60 * 60 * 1000;

/** The server issues 43-character base64url tokens and accepts 40 to 128 characters. */
const TOKEN_RE = /^[A-Za-z0-9_-]{40,128}$/;

const STORAGE_PREFIX = "fq:campaign:";

export interface TokenStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function isValidCampaignToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

/** The campaign value from a URL query string, only when it has the bounded token shape. */
export function parseCampaignParam(search: string): string | null {
  const value = new URLSearchParams(search).get(CAMPAIGN_QUERY_KEY);
  return value !== null && isValidCampaignToken(value) ? value : null;
}

/** The query string without the campaign parameter ("" when nothing else is left, otherwise starting with "?"). */
export function withoutCampaignParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(CAMPAIGN_QUERY_KEY);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

function keyPart(value: string): string {
  return value.trim().toLowerCase();
}

/** Identifies one shop the way its public URL does (`country/city/slug`), so a token never crosses shops. */
export function salonKey(countryCode: string, citySlug: string, salonSlug: string): string {
  return `${keyPart(countryCode)}/${keyPart(citySlug)}/${keyPart(salonSlug)}`;
}

/**
 * The shop key for a public shop page path (`/in/patna/fade-house`). Other paths (the home page, `/book/...`, account
 * pages, anything with more or fewer segments, a country code that is not two letters) give null.
 */
export function salonKeyFromPublicPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || !/^[a-zA-Z]{2}$/.test(parts[0])) return null;
  try {
    return salonKey(parts[0], decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
  } catch {
    return null;
  }
}

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

/** Remembers a token for one shop. Storage that is unavailable or full is ignored: the booking simply is not attributed. */
export function rememberCampaign(store: TokenStore | null, key: string, token: string, now: number = Date.now()): void {
  if (!store || !isValidCampaignToken(token)) return;
  try {
    store.setItem(storageKey(key), JSON.stringify({ token, at: now }));
  } catch {
    /* not attributed; the booking itself is unaffected */
  }
}

/** The remembered token for this shop, or null when there is none, it expired, or the stored value is not a token. */
export function recallCampaign(store: TokenStore | null, key: string, now: number = Date.now()): string | null {
  if (!store) return null;
  try {
    const raw = store.getItem(storageKey(key));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { token, at } = parsed as { token?: unknown; at?: unknown };
    if (typeof token !== "string" || typeof at !== "number" || !isValidCampaignToken(token)) return null;
    if (now - at > CAMPAIGN_TTL_MS || at > now + 60_000) {
      store.removeItem(storageKey(key));
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

export function forgetCampaign(store: TokenStore | null, key: string): void {
  if (!store) return;
  try {
    store.removeItem(storageKey(key));
  } catch {
    /* nothing to do */
  }
}

/** This tab's session storage, or null where the browser blocks it (private mode, blocked site data, server render). */
export function sessionTokenStore(): TokenStore | null {
  try {
    return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
