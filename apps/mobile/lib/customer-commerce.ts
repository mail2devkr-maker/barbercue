import type { PublicOfferDto } from "@barbercue/shared";
import type { SearchStackParamList } from "../navigation/types";

export function publicOffersRequestPath(cursor?: string): string {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return `offers?${query.toString()}`;
}
export function customerInvoicesRequestPath(cursor?: string): string {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return `invoices/mine?${query.toString()}`;
}

/** A promotion is carried as an identifier only; price and eligibility are recalculated by API. */
export function offerProfileParams(
  offer: PublicOfferDto,
): SearchStackParamList["SalonProfile"] {
  return {
    countryCode: offer.salon.countryCode,
    citySlug: offer.salon.citySlug,
    salonSlug: offer.salon.slug,
    offerId: offer.id,
    offerTitle: offer.title,
  };
}

export function includeOfferInBooking<T extends Record<string, unknown>>(
  body: T,
  offerId?: string,
): T & { offerId?: string } {
  return offerId ? { ...body, offerId } : body;
}
