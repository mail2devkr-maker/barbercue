import { OfferErrorCode, formatMoney } from "@barbercue/shared";
import type { OfferPriceLineDto, PublicOfferDto } from "@barbercue/shared";

// Customer side of Offers, Promotions and Daily Deals (requirements #11, #16, #24) on Codex's
// docs/contracts/FASTQUE_OFFERS_PROMOTIONS_DAILY_DEALS_V1.md (PR #260):
//   GET  offers?city=<city-slug>&service=<uuid>&limit&cursor   (public; { items, nextCursor }; per-service price estimates)
//   POST bookings { ..., offerId }                              (the server re-checks eligibility, dates, limits and prices)
//
// What a customer sees here is an estimate. The server decides at booking time, and an offer needs a signed-in account.
// The offer list names the city by its display name and has no country or city slug, so a link to a shop is built only from the
// city slug the visitor searched with (an offer is never linked from a guess).

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

/** Looks an offer up by id in the public list of a city, a few pages at most (the server has no lookup by id). */
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
