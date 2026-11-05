import {
  OFFER_AUDIENCES,
  OFFER_DISCOUNT_TYPES,
  OFFER_KINDS,
  createOfferSchema,
} from '@barbercue/shared';
import type { CreateOfferInput, OfferDto, UpdateOfferInput } from '@barbercue/shared';

export type OfferKind = (typeof OFFER_KINDS)[number];
export type OfferAudience = (typeof OFFER_AUDIENCES)[number];
export type OfferDiscountType = (typeof OFFER_DISCOUNT_TYPES)[number];

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
  serviceIds: string[];
}

export type OfferErrors = Partial<Record<keyof OfferForm, string>>;

export const EMPTY_OFFER_FORM: OfferForm = {
  kind: 'OFFER',
  title: '',
  description: '',
  discountType: 'PERCENT',
  discountValue: '',
  audience: 'ALL',
  inactiveDays: '',
  validFrom: '',
  validTo: '',
  maxRedemptions: '',
  perCustomerLimit: '1',
  serviceIds: [],
};

function zonedParts(ms: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(ms));
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return { y: pick('year'), mo: pick('month'), d: pick('day'), h: pick('hour') % 24, mi: pick('minute') };
}

function offsetMs(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / 60_000) * 60_000;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function localToUtcIso(local: string, timeZone: string): string | null {
  const match = LOCAL_RE.exec(local.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const probe = new Date(wall);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    probe.getUTCHours() !== hour ||
    probe.getUTCMinutes() !== minute
  ) return null;
  try {
    let guess = wall - offsetMs(wall, timeZone);
    guess = wall - offsetMs(guess, timeZone);
    const result = new Date(guess);
    const roundTrip = zonedParts(guess, timeZone);
    if (roundTrip.y !== year || roundTrip.mo !== month || roundTrip.d !== day || roundTrip.h !== hour || roundTrip.mi !== minute) return null;
    return result.toISOString();
  } catch {
    return null;
  }
}

export function utcToLocalInput(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  try {
    const p = zonedParts(ms, timeZone);
    const two = (value: number) => String(value).padStart(2, '0');
    return String(p.y) + '-' + two(p.mo) + '-' + two(p.d) + 'T' + two(p.h) + ':' + two(p.mi);
  } catch {
    return '';
  }
}

export function emptyOfferForm(timeZone: string, now = new Date()): OfferForm {
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    ...EMPTY_OFFER_FORM,
    validFrom: utcToLocalInput(start.toISOString(), timeZone),
    validTo: utcToLocalInput(end.toISOString(), timeZone),
  };
}

export function formFromOffer(offer: OfferDto, timeZone: string): OfferForm {
  return {
    kind: offer.kind,
    title: offer.title,
    description: offer.description ?? '',
    discountType: offer.discountType,
    discountValue: String(offer.discountValue),
    audience: offer.audience,
    inactiveDays: offer.inactiveDays === null ? '' : String(offer.inactiveDays),
    validFrom: utcToLocalInput(offer.validFrom, timeZone),
    validTo: utcToLocalInput(offer.validTo, timeZone),
    maxRedemptions: offer.maxRedemptions === null ? '' : String(offer.maxRedemptions),
    perCustomerLimit: String(offer.perCustomerLimit),
    serviceIds: [...offer.serviceIds],
  };
}

function wholeNumber(text: string): number | null {
  return /^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : null;
}

function money(text: string): number | null {
  const value = text.trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value)) return null;
  return Number(value);
}

export function buildOfferBody(form: OfferForm, timeZone: string): { body: CreateOfferInput | null; errors: OfferErrors } {
  const errors: OfferErrors = {};
  const title = form.title.trim();
  if (title.length < 2) errors.title = 'Use at least 2 characters.';
  if (title.length > 120) errors.title = 'Use at most 120 characters.';
  if (form.description.trim().length > 500) errors.description = 'Use at most 500 characters.';

  const value = money(form.discountValue);
  if (value === null || value <= 0) errors.discountValue = form.discountType === 'PERCENT' ? 'Enter a whole percentage from 1 to 100.' : 'Enter an amount above 0 with at most 2 decimals.';
  else if (form.discountType === 'PERCENT' && (!Number.isInteger(value) || value > 100)) errors.discountValue = 'Enter a whole percentage from 1 to 100.';

  const validFrom = localToUtcIso(form.validFrom, timeZone);
  const validTo = localToUtcIso(form.validTo, timeZone);
  if (!validFrom) errors.validFrom = 'Choose a valid start date and time in the shop timezone.';
  if (!validTo) errors.validTo = 'Choose a valid end date and time in the shop timezone.';
  if (validFrom && validTo && Date.parse(validTo) <= Date.parse(validFrom)) errors.validTo = 'The end must be after the start.';

  let inactiveDays: number | undefined;
  if (form.audience === 'INACTIVE') {
    const valueDays = wholeNumber(form.inactiveDays);
    if (valueDays === null || valueDays < 1 || valueDays > 365) errors.inactiveDays = 'Enter a whole number from 1 to 365.';
    else inactiveDays = valueDays;
  }

  let maxRedemptions: number | null = null;
  if (form.maxRedemptions.trim() !== '') {
    const limit = wholeNumber(form.maxRedemptions);
    if (limit === null || limit < 1 || limit > 1_000_000) errors.maxRedemptions = 'Leave empty for no limit, or enter a whole number up to 1,000,000.';
    else maxRedemptions = limit;
  }
  if (new Set(form.serviceIds).size !== form.serviceIds.length || form.serviceIds.length > 100) errors.serviceIds = 'Select up to 100 unique services.';
  const perCustomerLimit = wholeNumber(form.perCustomerLimit);
  if (perCustomerLimit === null || perCustomerLimit < 1 || perCustomerLimit > 100) errors.perCustomerLimit = 'Enter a whole number from 1 to 100.';

  if (Object.keys(errors).length || value === null || !validFrom || !validTo || perCustomerLimit === null) return { body: null, errors };

  const candidate: Record<string, unknown> = {
    kind: form.kind,
    title,
    description: form.description.trim() || null,
    discountType: form.discountType,
    discountValue: value,
    audience: form.audience,
    validFrom,
    validTo,
    maxRedemptions,
    perCustomerLimit,
    serviceIds: [...form.serviceIds],
  };
  if (inactiveDays !== undefined) candidate.inactiveDays = inactiveDays;
  const parsed = createOfferSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && key in EMPTY_OFFER_FORM) errors[key as keyof OfferForm] ??= issue.message;
    }
    return { body: null, errors: Object.keys(errors).length ? errors : { title: 'Check the offer details.' } };
  }
  return { body: parsed.data, errors: {} };
}

export function buildOfferPatch(original: OfferDto, form: OfferForm, timeZone: string): { body: UpdateOfferInput | null; errors: OfferErrors } {
  const built = buildOfferBody(form, timeZone);
  if (!built.body) return { body: null, errors: built.errors };
  const next = built.body;
  const patch: Record<string, unknown> = {};
  if (next.kind !== original.kind) patch.kind = next.kind;
  if (next.title !== original.title) patch.title = next.title;
  if ((next.description ?? null) !== original.description) patch.description = next.description ?? null;
  if (next.discountType !== original.discountType) patch.discountType = next.discountType;
  if (next.discountValue !== original.discountValue) patch.discountValue = next.discountValue;
  if (next.audience !== original.audience) patch.audience = next.audience;
  if ((next.inactiveDays ?? null) !== original.inactiveDays) patch.inactiveDays = next.inactiveDays;
  if (Date.parse(next.validFrom) !== Date.parse(original.validFrom)) patch.validFrom = next.validFrom;
  if (Date.parse(next.validTo) !== Date.parse(original.validTo)) patch.validTo = next.validTo;
  if ((next.maxRedemptions ?? null) !== original.maxRedemptions) patch.maxRedemptions = next.maxRedemptions ?? null;
  if (next.perCustomerLimit !== original.perCustomerLimit) patch.perCustomerLimit = next.perCustomerLimit;
  if ([...next.serviceIds].sort().join(',') !== [...original.serviceIds].sort().join(',')) patch.serviceIds = next.serviceIds;
  return Object.keys(patch).length ? { body: patch as UpdateOfferInput, errors: {} } : { body: null, errors: {} };
}

export function canEditOffer(status: OfferDto['status']): boolean {
  return status === 'DRAFT' || status === 'PAUSED';
}
