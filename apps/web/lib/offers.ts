import {
  OFFER_AUDIENCES,
  OFFER_DISCOUNT_TYPES,
  OFFER_KINDS,
  OfferErrorCode,
  createOfferSchema,
  formatMoney,
} from "@barbercue/shared";
import type { CreateOfferInput, OfferDto, UpdateOfferInput } from "@barbercue/shared";

// Owner Offers, Promotions and Daily Deals (requirements #11, #16, #24) on Codex's
// docs/contracts/FASTQUE_OFFERS_PROMOTIONS_DAILY_DEALS_V1.md (PR #260, in the #265 integration):
//   GET/POST dashboard/salons/:id/offers, GET/PATCH .../:offerId, POST .../preview, POST .../:offerId/preview,
//   POST .../:offerId/publish, POST .../:offerId/pause, GET .../:offerId/stats
//
// An offer is a price rule, never a payment: nothing here collects money, sends a message or records a redemption. Times are
// UTC instants on the server; this screen shows and takes them in the shop's own timezone. The server decides who is eligible
// when a customer books; the previews here are a check of the arithmetic only.

export type OfferKind = (typeof OFFER_KINDS)[number];
export type OfferAudience = (typeof OFFER_AUDIENCES)[number];
export type OfferDiscountType = (typeof OFFER_DISCOUNT_TYPES)[number];
export type OfferStatus = OfferDto["status"];

export const KIND_OPTIONS: ReadonlyArray<{ value: OfferKind; label: string; help: string }> = [
  { value: "OFFER", label: "Offer", help: "A standing price reduction for a period" },
  { value: "PROMOTION", label: "Promotion", help: "A campaign for a season, event or festival" },
  { value: "DAILY_DEAL", label: "Daily deal", help: "A short, time-boxed deal" },
];

export const STATUS_OPTIONS: ReadonlyArray<{ value: OfferStatus; label: string }> = [
  { value: "DRAFT", label: "Draft" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
  { value: "EXPIRED", label: "Expired" },
];

export const AUDIENCE_OPTIONS: ReadonlyArray<{ value: OfferAudience; label: string; help: string }> = [
  { value: "ALL", label: "Every customer with an account", help: "Anyone signed in who books online" },
  { value: "NEW", label: "New customers", help: "Accounts with no completed visit at your shop" },
  { value: "REPEAT", label: "Returning customers", help: "Accounts with at least one completed visit at your shop" },
  { value: "INACTIVE", label: "Customers who have not visited for a while", help: "Last completed visit at least this many days ago" },
];

export function kindLabel(kind: string): string {
  return KIND_OPTIONS.find((k) => k.value === kind)?.label ?? kind;
}

export function statusLabel(status: string): string {
  return STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status;
}

export function statusTone(status: string): "ok" | "warn" | "bad" | "info" | "neutral" {
  switch (status) {
    case "ACTIVE":
      return "ok";
    case "PAUSED":
      return "warn";
    case "EXPIRED":
      return "neutral";
    default:
      return "info";
  }
}

export function canEdit(status: OfferStatus): boolean {
  return status === "DRAFT" || status === "PAUSED";
}
export function canPublish(status: OfferStatus): boolean {
  return status === "DRAFT" || status === "PAUSED";
}
export function canPause(status: OfferStatus): boolean {
  return status === "ACTIVE";
}

// ---------- the shop's timezone ----------

function zonedParts(ms: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(ms));
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: pick("year"), mo: pick("month"), d: pick("day"), h: pick("hour") % 24, mi: pick("minute") };
}

/** How far `timeZone` is ahead of UTC at this instant, in milliseconds. */
function offsetMs(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / 60_000) * 60_000;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** A "YYYY-MM-DDTHH:mm" wall-clock time in the shop's timezone as a UTC ISO instant, or null if it is not a real time. */
export function localToUtcIso(local: string, timeZone: string): string | null {
  const m = LOCAL_RE.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const probe = new Date(wall);
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || probe.getUTCHours() !== h || probe.getUTCMinutes() !== mi) return null;
  try {
    let guess = wall - offsetMs(wall, timeZone);
    guess = wall - offsetMs(guess, timeZone);
    return new Date(guess).toISOString();
  } catch {
    return null;
  }
}

/** A UTC ISO instant as the "YYYY-MM-DDTHH:mm" wall-clock time the shop's timezone shows. */
export function utcToLocalInput(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  try {
    const p = zonedParts(ms, timeZone);
    const two = (n: number) => String(n).padStart(2, "0");
    return `${p.y}-${two(p.mo)}-${two(p.d)}T${two(p.h)}:${two(p.mi)}`;
  } catch {
    return "";
  }
}

export function timeText(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  try {
    return new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
  } catch {
    return iso;
  }
}

export function validityText(offer: Pick<OfferDto, "validFrom" | "validTo">, timeZone: string): string {
  return `${timeText(offer.validFrom, timeZone)} to ${timeText(offer.validTo, timeZone)}`;
}

// ---------- the form ----------

export interface OfferForm {
  kind: OfferKind;
  title: string;
  description: string;
  discountType: OfferDiscountType;
  discountValue: string;
  audience: OfferAudience;
  inactiveDays: string;
  validFrom: string;
  validTo: string;
  maxRedemptions: string;
  perCustomerLimit: string;
  /** Empty means every service the shop currently has active. */
  serviceIds: string[];
}

export const EMPTY_OFFER_FORM: OfferForm = {
  kind: "OFFER",
  title: "",
  description: "",
  discountType: "PERCENT",
  discountValue: "",
  audience: "ALL",
  inactiveDays: "",
  validFrom: "",
  validTo: "",
  maxRedemptions: "",
  perCustomerLimit: "1",
  serviceIds: [],
};

export function formFromOffer(offer: OfferDto, timeZone: string): OfferForm {
  return {
    kind: offer.kind,
    title: offer.title,
    description: offer.description ?? "",
    discountType: offer.discountType,
    discountValue: String(offer.discountValue),
    audience: offer.audience,
    inactiveDays: offer.inactiveDays === null ? "" : String(offer.inactiveDays),
    validFrom: utcToLocalInput(offer.validFrom, timeZone),
    validTo: utcToLocalInput(offer.validTo, timeZone),
    maxRedemptions: offer.maxRedemptions === null ? "" : String(offer.maxRedemptions),
    perCustomerLimit: String(offer.perCustomerLimit),
    serviceIds: [...offer.serviceIds],
  };
}

export type OfferErrors = Partial<Record<keyof OfferForm, string>>;

function wholeNumber(text: string): number | null {
  return /^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : null;
}

function money(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

/**
 * Turns the form into the request body the server accepts, or says what is wrong next to the field. The rules are the shared
 * schema's own, so the screen can never accept what the server would reject for a reason it could have checked.
 */
export function buildOfferBody(form: OfferForm, timeZone: string): { body: CreateOfferInput | null; errors: OfferErrors } {
  const errors: OfferErrors = {};
  const title = form.title.trim();
  if (title.length < 2) errors.title = "Give the offer a name of at least 2 characters.";
  if (title.length > 120) errors.title = "Use at most 120 characters.";
  if (form.description.trim().length > 500) errors.description = "Use at most 500 characters.";

  const value = money(form.discountValue);
  if (value === null || value <= 0) errors.discountValue = form.discountType === "PERCENT" ? "Enter a whole percentage from 1 to 100." : "Enter an amount above 0 with at most 2 decimals.";
  else if (form.discountType === "PERCENT" && (!Number.isInteger(value) || value > 100)) errors.discountValue = "Enter a whole percentage from 1 to 100.";

  const from = localToUtcIso(form.validFrom, timeZone);
  const to = localToUtcIso(form.validTo, timeZone);
  if (!from) errors.validFrom = "Choose when the offer starts.";
  if (!to) errors.validTo = "Choose when the offer ends.";
  if (from && to && Date.parse(to) <= Date.parse(from)) errors.validTo = "The end must be after the start.";

  let inactiveDays: number | undefined;
  if (form.audience === "INACTIVE") {
    const n = wholeNumber(form.inactiveDays);
    if (n === null || n < 1 || n > 365) errors.inactiveDays = "Enter a whole number of days from 1 to 365.";
    else inactiveDays = n;
  }

  let maxRedemptions: number | null = null;
  if (form.maxRedemptions.trim() !== "") {
    const n = wholeNumber(form.maxRedemptions);
    if (n === null || n < 1 || n > 1_000_000) errors.maxRedemptions = "Leave empty for no limit, or enter a whole number from 1 to 1,000,000.";
    else maxRedemptions = n;
  }
  const per = wholeNumber(form.perCustomerLimit);
  if (per === null || per < 1 || per > 100) errors.perCustomerLimit = "Enter a whole number from 1 to 100.";

  if (Object.keys(errors).length > 0 || value === null || !from || !to || per === null) return { body: null, errors };

  const candidate: Record<string, unknown> = {
    kind: form.kind,
    title,
    description: form.description.trim() === "" ? null : form.description.trim(),
    discountType: form.discountType,
    discountValue: value,
    audience: form.audience,
    validFrom: from,
    validTo: to,
    maxRedemptions,
    perCustomerLimit: per,
    serviceIds: [...new Set(form.serviceIds)],
  };
  if (inactiveDays !== undefined) candidate.inactiveDays = inactiveDays;
  const parsed = createOfferSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && key in EMPTY_OFFER_FORM && !errors[key as keyof OfferForm]) errors[key as keyof OfferForm] = issue.message;
    }
    return { body: null, errors: Object.keys(errors).length > 0 ? errors : { title: "Check the offer details." } };
  }
  return { body: parsed.data, errors };
}

/** Only the fields that changed, as the server's partial update takes them; null when nothing changed. */
export function buildOfferPatch(original: OfferDto, form: OfferForm, timeZone: string): { body: UpdateOfferInput | null; errors: OfferErrors } {
  const built = buildOfferBody(form, timeZone);
  if (!built.body) return { body: null, errors: built.errors };
  const next = built.body;
  const patch: Record<string, unknown> = {};
  if (next.kind !== original.kind) patch.kind = next.kind;
  if (next.title !== original.title) patch.title = next.title;
  if ((next.description ?? null) !== (original.description ?? null)) patch.description = next.description ?? null;
  if (next.discountType !== original.discountType) patch.discountType = next.discountType;
  if (next.discountValue !== original.discountValue) patch.discountValue = next.discountValue;
  if (next.audience !== original.audience) patch.audience = next.audience;
  if ((next.inactiveDays ?? null) !== original.inactiveDays) patch.inactiveDays = next.inactiveDays;
  if (Date.parse(next.validFrom) !== Date.parse(original.validFrom)) patch.validFrom = next.validFrom;
  if (Date.parse(next.validTo) !== Date.parse(original.validTo)) patch.validTo = next.validTo;
  if ((next.maxRedemptions ?? null) !== original.maxRedemptions) patch.maxRedemptions = next.maxRedemptions ?? null;
  if (next.perCustomerLimit !== original.perCustomerLimit) patch.perCustomerLimit = next.perCustomerLimit;
  const a = [...next.serviceIds].sort().join(",");
  const b = [...original.serviceIds].sort().join(",");
  if (a !== b) patch.serviceIds = next.serviceIds;
  return Object.keys(patch).length === 0 ? { body: null, errors: {} } : { body: patch as UpdateOfferInput, errors: {} };
}

// ---------- words ----------

export function discountText(offer: Pick<OfferDto, "discountType" | "discountValue" | "currency">): string {
  return offer.discountType === "PERCENT" ? `${offer.discountValue}% off` : `${formatMoney(offer.discountValue, offer.currency)} off`;
}

export function audienceText(offer: Pick<OfferDto, "audience" | "inactiveDays">): string {
  if (offer.audience === "INACTIVE") return `Customers whose last completed visit was at least ${offer.inactiveDays ?? "?"} days ago`;
  return AUDIENCE_OPTIONS.find((a) => a.value === offer.audience)?.label ?? offer.audience;
}

export function servicesText(offer: Pick<OfferDto, "serviceIds">): string {
  const n = offer.serviceIds.length;
  return n === 0 ? "All active services" : `${n} service${n === 1 ? "" : "s"}`;
}

export function redemptionText(offer: Pick<OfferDto, "redemptionCount" | "maxRedemptions">): string {
  const used = `${offer.redemptionCount} booking${offer.redemptionCount === 1 ? "" : "s"} used it`;
  return offer.maxRedemptions === null ? used : `${used} of ${offer.maxRedemptions} allowed`;
}

export function offerErrorText(code: string | undefined, message: string): string {
  switch (code) {
    case OfferErrorCode.NOT_FOUND:
      return "That offer no longer exists. Reload the page.";
    case OfferErrorCode.MUST_PAUSE_TO_EDIT:
      return "Pause this offer before changing it. Customers cannot use it while it is paused.";
    case OfferErrorCode.NOT_PUBLISHABLE:
      return "This offer cannot be published yet. Check its dates and that its services are still active.";
    case OfferErrorCode.INVALID:
      return `The offer details were not accepted. ${message}`;
    case OfferErrorCode.CHANGED_RETRY:
      return "The offer changed while you were saving. Reload and try again.";
    case "INVALID_FILTER":
    case "CURSOR_FILTER_MISMATCH":
      return "The list changed while you were paging, so it was reloaded from the start.";
    default:
      return message;
  }
}

/** Which of the money fields is the discount, in the shop's currency, for a preview line. */
export function previewMoney(amount: number, currency: string): string {
  return formatMoney(amount, currency);
}
