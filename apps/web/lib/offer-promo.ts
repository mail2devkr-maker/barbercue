import type { OfferDto } from "@barbercue/shared";
import { INVITE_TEXT_MAX, cleanInviteText } from "./shop-share";
import { discountText, timeText, utcToLocalInput, validityText } from "./offers";

// Offer -> shareable post (owner issue #17). The owner shares a post for a real offer; FastQue publishes nothing anywhere and
// reports no engagement it cannot see. The text is built ONLY from the offer's own fields, so a post can never promise more than
// the offer gives: its discount, its services, who it is for and the dates it is valid. An offer that customers cannot use right
// now (a draft, paused, ended, not started, or fully used) produces no post at all, with the reason in plain words.

export type PromoState = { ok: true } | { ok: false; reason: string };

export function promoState(offer: Pick<OfferDto, "status" | "validFrom" | "validTo" | "maxRedemptions" | "redemptionCount">, timeZone: string, now: Date = new Date()): PromoState {
  if (offer.status === "DRAFT") return { ok: false, reason: "This offer is still a draft. Publish it first, so a post only advertises something customers can use." };
  if (offer.status === "PAUSED") return { ok: false, reason: "This offer is paused, so customers cannot use it right now. Resume it before sharing." };
  if (offer.status === "EXPIRED") return { ok: false, reason: "This offer has ended." };
  const from = Date.parse(offer.validFrom);
  const to = Date.parse(offer.validTo);
  if (Number.isNaN(from) || Number.isNaN(to)) return { ok: false, reason: "This offer has no readable dates, so it cannot be shared." };
  if (now.getTime() < from) return { ok: false, reason: `This offer has not started yet. It starts on ${timeText(offer.validFrom, timeZone)}.` };
  if (now.getTime() >= to) return { ok: false, reason: `This offer's dates have passed. It ended on ${timeText(offer.validTo, timeZone)}.` };
  if (offer.maxRedemptions !== null && offer.redemptionCount >= offer.maxRedemptions) {
    return { ok: false, reason: `All ${offer.maxRedemptions} allowed bookings have been used, so there is nothing left to share.` };
  }
  return { ok: true };
}

const MAX_DESCRIPTION = 200;
const MAX_SERVICES_LISTED = 3;

function servicesClause(serviceNames: ReadonlyArray<string> | null, serviceCount: number): string {
  if (serviceCount === 0) return "on all services";
  if (!serviceNames || serviceNames.length === 0) return "on selected services";
  const shown = serviceNames.slice(0, MAX_SERVICES_LISTED);
  const rest = serviceNames.length - shown.length;
  const list = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return `on ${list}${rest > 0 ? ` and ${rest} more` : ""}`;
}

function audienceClause(offer: Pick<OfferDto, "audience" | "inactiveDays">): string {
  switch (offer.audience) {
    case "NEW": return "For new customers only.";
    case "REPEAT": return "For returning customers only.";
    case "INACTIVE": return offer.inactiveDays ? `For customers who have not visited in the last ${offer.inactiveDays} days.` : "For customers who have not visited for a while.";
    default: return "";
  }
}

/** The editable starting text for a post. Never longer than a share link can carry. */
export function promoText(
  offer: Pick<OfferDto, "title" | "description" | "discountType" | "discountValue" | "currency" | "audience" | "inactiveDays" | "validFrom" | "validTo" | "serviceIds">,
  shopName: string,
  serviceNames: ReadonlyArray<string> | null,
  timeZone: string,
): string {
  const lines = [
    `${offer.title.trim()} at ${shopName}: ${discountText(offer)} ${servicesClause(serviceNames, offer.serviceIds.length)}.`,
    audienceClause(offer),
    `Valid ${validityText(offer, timeZone)}.`,
    (offer.description ?? "").trim().slice(0, MAX_DESCRIPTION),
    "Book online on FastQue with your account to use it.",
  ].filter((l) => l !== "");
  return cleanInviteText(lines.join("\n"));
}

/** Shop-local calendar days an offer is valid, so a tracking link can end when the offer does. */
export function offerDays(offer: Pick<OfferDto, "validFrom" | "validTo">, timeZone: string): { firstDay: string; lastDay: string } {
  const first = utcToLocalInput(offer.validFrom, timeZone).slice(0, 10);
  // validTo is the first instant the offer is no longer valid; the last day it IS valid is the day before when it ends at midnight.
  const lastInstant = new Date(Date.parse(offer.validTo) - 1).toISOString();
  const last = utcToLocalInput(lastInstant, timeZone).slice(0, 10);
  return { firstDay: first, lastDay: last };
}

export function campaignLabelFor(offer: Pick<OfferDto, "title">): string {
  return `Offer: ${offer.title.trim()}`.slice(0, 80);
}

export const PROMO_TEXT_MAX = INVITE_TEXT_MAX;
