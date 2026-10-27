import {
  computePercentageDiscountPaise,
  decimalStringToPaise,
  describeOfferSchedule,
  offerHasSchedule,
  type SalonOfferSummaryDto,
} from '@barbercue/shared';

// Booking page 3.0: which of a salon's published offers to show on its search card, and what it
// is worth. Display only — the booking flow recalculates and revalidates every offer on the
// server (OffersService.lockAndValidateForBooking) against the real services and appointment time.

export interface OfferRow {
  id: string;
  title: string;
  description: string | null;
  discountType: 'PERCENT' | 'FLAT';
  discountValue: { toString(): string } | number;
  validTo: Date;
  audience: 'ALL' | 'NEW' | 'REPEAT' | 'INACTIVE';
  applicableDays: number[];
  dailyStartTime: string | null;
  dailyEndTime: string | null;
  minimumBookingAmount: { toString(): string } | number | null;
  maximumDiscountAmount: { toString(): string } | number | null;
  /** Linked services; empty = every active service at the salon. */
  serviceIds: string[];
}

export interface PricedService {
  id: string;
  name: string;
  price: number;
}

const paise = (value: { toString(): string } | number) =>
  decimalStringToPaise(Number(value.toString()).toFixed(2));

/** The discount (in paise) one offer gives on one service on its own. */
export function offerSavingPaise(offer: OfferRow, price: number): number {
  const basePaise = paise(price);
  const raw =
    offer.discountType === 'PERCENT'
      ? computePercentageDiscountPaise(basePaise, Number(offer.discountValue))
      : Math.min(basePaise, paise(offer.discountValue));
  return offer.maximumDiscountAmount !== null
    ? Math.min(raw, paise(offer.maximumDiscountAmount))
    : raw;
}

function shortList(names: string[]): string {
  return names.length <= 2
    ? names.join(', ')
    : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
}

/**
 * A salon's current offers, best first. With a selected service (`selected` not undefined), only
 * offers covering that service count — `null` means the salon doesn't offer it, so none do.
 * Order: certain offers before conditional ones (customer-specific, day/time-limited, or with an
 * unmet minimum spend), then the largest saving, then the soonest ending.
 */
export function summarizeOffers(
  offers: OfferRow[],
  salonServices: PricedService[],
  selected: PricedService | null | undefined,
): SalonOfferSummaryDto[] {
  const summaries: SalonOfferSummaryDto[] = [];
  for (const offer of offers) {
    const eligible = offer.serviceIds.length
      ? salonServices.filter((service) => offer.serviceIds.includes(service.id))
      : salonServices;
    let targets: PricedService[];
    if (selected !== undefined) {
      if (!selected || !eligible.some((service) => service.id === selected.id))
        continue;
      targets = [selected];
    } else {
      targets = eligible;
    }
    let best: PricedService | null = null;
    let bestSaving = 0;
    for (const service of targets) {
      const saving = offerSavingPaise(offer, service.price);
      if (saving > bestSaving) {
        best = service;
        bestSaving = saving;
      }
    }
    if (!best) continue;
    const minimumBookingAmount =
      offer.minimumBookingAmount === null
        ? null
        : Number(offer.minimumBookingAmount.toString());
    const conditional =
      offer.audience !== 'ALL' ||
      offerHasSchedule(offer) ||
      (minimumBookingAmount !== null && best.price < minimumBookingAmount);
    summaries.push({
      id: offer.id,
      title: offer.title,
      description: offer.description,
      discountType: offer.discountType,
      discountValue: Number(offer.discountValue.toString()),
      validTo: offer.validTo.toISOString(),
      audience: offer.audience,
      schedule: describeOfferSchedule(offer),
      minimumBookingAmount,
      maximumDiscountAmount:
        offer.maximumDiscountAmount === null
          ? null
          : Number(offer.maximumDiscountAmount.toString()),
      appliesTo: selected
        ? selected.name
        : offer.serviceIds.length
          ? shortList(eligible.map((service) => service.name))
          : null,
      conditional,
      saving: bestSaving / 100,
      price: conditional
        ? null
        : {
            serviceId: best.id,
            serviceName: best.name,
            originalPrice: best.price,
            offerPrice: (paise(best.price) - bestSaving) / 100,
          },
    });
  }
  return summaries.sort(
    (a, b) =>
      Number(a.conditional) - Number(b.conditional) ||
      b.saving - a.saving ||
      a.validTo.localeCompare(b.validTo),
  );
}

/**
 * The best discount every customer is sure to get on one service: the largest saving among the
 * offers covering it that are certain (all customers, no day/time window, minimum spend met by
 * this service alone). Null when no certain offer covers it.
 */
export function bestCertainOfferFor(
  offers: OfferRow[],
  service: PricedService,
): { offerId: string; offerPrice: number; saving: number } | null {
  let best: { offerId: string; offerPrice: number; saving: number } | null =
    null;
  for (const offer of offers) {
    if (offer.serviceIds.length && !offer.serviceIds.includes(service.id))
      continue;
    if (offer.audience !== 'ALL' || offerHasSchedule(offer)) continue;
    const minimum =
      offer.minimumBookingAmount === null
        ? null
        : Number(offer.minimumBookingAmount.toString());
    if (minimum !== null && service.price < minimum) continue;
    const savingPaise = offerSavingPaise(offer, service.price);
    if (savingPaise <= 0 || (best && savingPaise / 100 <= best.saving))
      continue;
    best = {
      offerId: offer.id,
      offerPrice: (paise(service.price) - savingPaise) / 100,
      saving: savingPaise / 100,
    };
  }
  return best;
}

/**
 * The card headline for all of a salon's current offers together: how many there are, the
 * largest percentage on offer, and the largest rupee saving on any single service.
 */
export function offerHeadline(
  summaries: {
    discountType: 'PERCENT' | 'FLAT';
    discountValue: number;
    saving: number;
  }[],
): { count: number; maxPercent: number | null; maxSaving: number } | null {
  if (summaries.length === 0) return null;
  const percents = summaries
    .filter((s) => s.discountType === 'PERCENT')
    .map((s) => s.discountValue);
  return {
    count: summaries.length,
    maxPercent: percents.length ? Math.max(...percents) : null,
    maxSaving: Math.max(...summaries.map((s) => s.saving)),
  };
}
