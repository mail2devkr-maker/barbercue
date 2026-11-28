import { OfferErrorCode, formatMoney } from "@barbercue/shared";
import type { OfferPriceLineDto, PublicOfferDto } from "@barbercue/shared";

// Customer side of Offers, Promotions and Daily Deals (requirements #11, #16, #24) on Codex's
// docs/contracts/FASTQUE_OFFERS_PROMOTIONS_DAILY_DEALS_V1.md (PR #260, with the PR #268 additions):
//   GET  offers?countryCode=&citySlug=&service=&limit&cursor   (public; { items, nextCursor }; per-service price estimates;
//                                                              the older `city=<slug>` filter still works)
//   GET  offers/:offerId                                        (one active, in-date offer; 404 OFFER_NOT_FOUND otherwise)
//   POST bookings { ..., offerId }                              (the server re-checks eligibility, dates, limits and prices)
//
// What a customer sees here is an estimate. The server decides at booking time, and an offer needs a signed-in account.
// Every offer names its shop's `countryCode` and `citySlug`, so a link to the shop is built from the offer itself. Only a server
// older than PR #268 sends neither; for that case a link falls back to the city the visitor searched with, and is left out
// when there is none (an offer is never linked from a guess).

export const DEFAULT_COUNTRY = "in";
const CITY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The city slug as the server matches it (lower-case, hyphenated), or null when what was typed cannot be one. */
export function cityToSlug(input: string): string | null {
  const slug = input.trim().toLowerCase().replace(/\s+/g, "-");
  return slug.length > 0 && slug.length <= 120 && CITY_SLUG.test(slug) ? slug : null;
}

export function isOfferId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function bookOfferHref(args: { salonSlug: string; country: string; citySlug: string; offerId: string }): string {
  const q = new URLSearchParams({ country: args.country, city: args.citySlug, offer: args.offerId });
  return `/book/${encodeURIComponent(args.salonSlug)}?${q.toString()}`;
}

/** The shop's canonical country and city slug as the offer states them, or null for a server that does not send them. */
export function canonicalLocation(offer: { salon: { countryCode?: unknown; citySlug?: unknown } }): { country: string; citySlug: string } | null {
  const country = typeof offer.salon.countryCode === "string" ? offer.salon.countryCode.trim().toLowerCase() : "";
  const citySlug = typeof offer.salon.citySlug === "string" ? offer.salon.citySlug.trim().toLowerCase() : "";
  return /^[a-z]{2}$/.test(country) && CITY_SLUG.test(citySlug) ? { country, citySlug } : null;
}

/**
 * The link that opens booking for this offer. It uses the offer's own country and city slug; only when the server sends none (older
 * than PR #268) does it use the searched city and country, and with neither it returns null rather than guess.
 */
export function offerBookHref(offer: PublicOfferDto, searched?: { country?: string | null; citySlug?: string | null }): string | null {
  const canonical = canonicalLocation(offer);
  const country = canonical?.country ?? (searched?.citySlug ? (searched.country ?? DEFAULT_COUNTRY).toLowerCase() : null);
  const citySlug = canonical?.citySlug ?? searched?.citySlug ?? null;
  if (!country || !citySlug) return null;
  return bookOfferHref({ salonSlug: offer.salon.slug, country, citySlug, offerId: offer.id });
}

/** Query for the public list. The legacy `city` filter is sent with the canonical ones so an older server still filters by city. */
export function publicOfferParams(citySlug: string, country?: string | null): Record<string, string> {
  const params: Record<string, string> = { city: citySlug, citySlug };
  if (country && /^[A-Za-z]{2}$/.test(country)) params.countryCode = country.toUpperCase();
  return params;
}

export function offerDiscountText(offer: Pick<PublicOfferDto, "discountType" | "discountValue" | "currency">): string {
  return offer.discountType === "PERCENT" ? `${offer.discountValue}% off` : `${formatMoney(offer.discountValue, offer.currency)} off`;
}

export function offerKindLabel(kind: PublicOfferDto["kind"]): string {
  return kind === "DAILY_DEAL" ? "Daily deal" : kind === "PROMOTION" ? "Promotion" : "Offer";
}

/** Who can use it, in words, from the audience the server reports. An account is always needed. */
export function eligibilityText(offer: Pick<PublicOfferDto, "eligibility" | "inactiveDays">): string {
  const base = (() => {
    switch (offer.eligibility.audience) {
      case "NEW":
        return "For customers with no completed visit at this shop";
      case "REPEAT":
        return "For customers who have visited this shop before";
      case "INACTIVE":
        return `For customers whose last visit here was at least ${offer.inactiveDays ?? "?"} days ago`;
      default:
        return "For every customer with an account";
    }
  })();
  return offer.eligibility.accountRequired ? `${base}. Sign in to book with it.` : base;
}

export function validUntilText(validTo: string): string {
  const ms = Date.parse(validTo);
  if (Number.isNaN(ms)) return validTo;
  return `until ${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms))}`;
}

export function appliesToServices(offer: Pick<PublicOfferDto, "serviceIds">, serviceIds: ReadonlyArray<string>): boolean {
  return offer.serviceIds.length === 0 || serviceIds.every((id) => offer.serviceIds.includes(id));
}

/** The offer's own price lines for the chosen services (only those the offer prices). */
export function priceLinesFor(offer: Pick<PublicOfferDto, "prices">, serviceIds: ReadonlyArray<string>): OfferPriceLineDto[] {
  return offer.prices.filter((line) => serviceIds.includes(line.serviceId));
}

/** An estimate for the chosen services: the listed total and what the offer would make it. null when the offer prices none of them. */
export function estimateFor(offer: Pick<PublicOfferDto, "prices">, serviceIds: ReadonlyArray<string>): { subtotal: number; discount: number; total: number } | null {
  const lines = priceLinesFor(offer, serviceIds);
  if (lines.length === 0) return null;
  const cents = (n: number) => Math.round(n * 100);
  const subtotal = lines.reduce((s, l) => s + cents(l.basePrice), 0);
  const discount = lines.reduce((s, l) => s + cents(l.discount), 0);
  return { subtotal: subtotal / 100, discount: discount / 100, total: (subtotal - discount) / 100 };
}

export function isOfferError(code: string | undefined): boolean {
  return typeof code === "string" && code.startsWith("OFFER_");
}

/** Plain words for the offer errors a booking can fail with. */
export function customerOfferErrorText(code: string | undefined, message: string): string {
  switch (code) {
    case OfferErrorCode.EXPIRED:
      return "This offer has ended.";
    case OfferErrorCode.NOT_ELIGIBLE:
      return "This offer is not available for your account.";
    case OfferErrorCode.REDEMPTION_LIMIT:
      return "This offer has been used as many times as it allows.";
    case OfferErrorCode.SERVICE_MISMATCH:
      return "This offer does not apply to the services you chose.";
    case OfferErrorCode.CHANGED_RETRY:
      return "This offer changed while you were booking. Please check it and try again.";
    case OfferErrorCode.NOT_FOUND:
    case OfferErrorCode.INVALID:
      return "This offer is no longer available.";
    default:
      return message;
  }
}

/** The HTTP status and code of a failed request, read from the error without depending on its class. */
function errorParts(err: unknown): { status: number | null; code: string | null } {
  if (typeof err !== "object" || err === null) return { status: null, code: null };
  const e = err as { status?: unknown; code?: unknown };
  return { status: typeof e.status === "number" ? e.status : null, code: typeof e.code === "string" ? e.code : null };
}

/**
 * Finds the offer a booking link names. The server's lookup by id (`GET offers/:offerId`) is used first. `OFFER_NOT_FOUND` is a
 * final answer: the offer is not active, in date or visible. Only a server without that route (a 404 that is not OFFER_NOT_FOUND,
 * a backend older than PR #268) falls back, and only when the link also names a city, to the bounded search of that city's list.
 * Any other failure means "no offer applied"; the booking itself is never blocked.
 */
export async function lookupPublicOffer(
  fetchOne: (offerId: string) => Promise<PublicOfferDto>,
  fetchPage: ((cursor: string | null) => Promise<{ items: PublicOfferDto[]; nextCursor: string | null }>) | null,
  offerId: string,
): Promise<PublicOfferDto | null> {
  try {
    return await fetchOne(offerId);
  } catch (err) {
    const { status, code } = errorParts(err);
    if (code === OfferErrorCode.NOT_FOUND) return null;
    if (status === 404 && fetchPage) {
      try {
        return await findPublicOffer(fetchPage, offerId);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Looks an offer up by id in the public list of a city, a few pages at most. Only for a server that has no lookup by id. */
export async function findPublicOffer(
  fetchPage: (cursor: string | null) => Promise<{ items: PublicOfferDto[]; nextCursor: string | null }>,
  offerId: string,
  maxPages = 4,
): Promise<PublicOfferDto | null> {
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i += 1) {
    const page = await fetchPage(cursor);
    const hit = page.items.find((o) => o.id === offerId);
    if (hit) return hit;
    if (!page.nextCursor) return null;
    cursor = page.nextCursor;
  }
  return null;
}
