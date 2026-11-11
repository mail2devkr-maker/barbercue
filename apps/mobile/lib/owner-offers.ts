import { createOfferSchema, DASHBOARD_PATHS, type CreateOfferInput, type OfferDto } from '@barbercue/shared';

export type OwnerOfferForm = {
  kind: CreateOfferInput['kind'];
  title: string;
  description: string;
  discountType: CreateOfferInput['discountType'];
  discountValue: string;
  audience: CreateOfferInput['audience'];
  inactiveDays: string;
  validFrom: string;
  validTo: string;
  maxRedemptions: string;
  perCustomerLimit: string;
  /** Empty means every active shop service. */
  serviceIds: string[];
};

export type OwnerOfferPage = { items: OfferDto[]; nextCursor: string | null };

export function canPreviewOwnerOffer(serviceIds: readonly string[], activeServiceCount: number): boolean {
  return activeServiceCount > 0 && (serviceIds.length > 0 || activeServiceCount <= 100);
}

export const EMPTY_OWNER_OFFER_FORM: OwnerOfferForm = {
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

export function ownerOffersRootPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/offers`;
}

export function ownerOffersListPath(
  salonId: string,
  filters: { kind?: string; status?: string; cursor?: string } = {},
): string {
  const query = new URLSearchParams({ limit: '25' });
  if (filters.kind) query.set('kind', filters.kind);
  if (filters.status) query.set('status', filters.status);
  if (filters.cursor) query.set('cursor', filters.cursor);
  return `${ownerOffersRootPath(salonId)}?${query.toString()}`;
}

function zonedParts(ms: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') };
}

function offsetAt(ms: number, timeZone: string): number {
  const parts = zonedParts(ms, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(ms / 60_000) * 60_000;
}

/** Converts a shop-local datetime input into an ISO instant, rejecting invalid/nonexistent wall times. */
export function ownerOfferLocalToIso(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute) return null;
  try {
    let guess = wall - offsetAt(wall, timeZone);
    guess = wall - offsetAt(guess, timeZone);
    const iso = new Date(guess).toISOString();
    const roundTrip = zonedParts(Date.parse(iso), timeZone);
    if (roundTrip.year !== year || roundTrip.month !== month || roundTrip.day !== day || roundTrip.hour !== hour || roundTrip.minute !== minute) return null;
    return iso;
  } catch {
    return null;
  }
}

export function ownerOfferIsoToLocal(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  try {
    const parts = zonedParts(ms, timeZone);
    const two = (n: number) => String(n).padStart(2, '0');
    return `${parts.year}-${two(parts.month)}-${two(parts.day)}T${two(parts.hour)}:${two(parts.minute)}`;
  } catch {
    return '';
  }
}

export function ownerOfferFormFromDto(offer: OfferDto, timeZone: string): OwnerOfferForm {
  return {
    kind: offer.kind,
    title: offer.title,
    description: offer.description ?? '',
    discountType: offer.discountType,
    discountValue: String(offer.discountValue),
    audience: offer.audience,
    inactiveDays: offer.inactiveDays === null ? '' : String(offer.inactiveDays),
    validFrom: ownerOfferIsoToLocal(offer.validFrom, timeZone),
    validTo: ownerOfferIsoToLocal(offer.validTo, timeZone),
    maxRedemptions: offer.maxRedemptions === null ? '' : String(offer.maxRedemptions),
    perCustomerLimit: String(offer.perCustomerLimit),
    serviceIds: [...offer.serviceIds],
  };
}

export function buildOwnerOfferBody(
  form: OwnerOfferForm,
  timeZone: string,
): { body: CreateOfferInput | null; error: string | null } {
  const validFrom = ownerOfferLocalToIso(form.validFrom, timeZone);
  const validTo = ownerOfferLocalToIso(form.validTo, timeZone);
  if (!validFrom || !validTo) return { body: null, error: 'Enter real start and end times in the shop timezone.' };

  const value = form.discountValue.trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value)) return { body: null, error: 'Enter a positive discount value with up to two decimal places.' };
  const redemptions = form.maxRedemptions.trim();
  const perCustomer = form.perCustomerLimit.trim();
  const inactive = form.inactiveDays.trim();
  const input = {
    kind: form.kind,
    title: form.title,
    description: form.description.trim() ? form.description.trim() : null,
    discountType: form.discountType,
    discountValue: Number(value),
    audience: form.audience,
    ...(form.audience === 'INACTIVE' ? { inactiveDays: Number(inactive) } : {}),
    validFrom,
    validTo,
    maxRedemptions: redemptions ? Number(redemptions) : null,
    perCustomerLimit: Number(perCustomer),
    serviceIds: [...new Set(form.serviceIds)],
  };
  const parsed = createOfferSchema.safeParse(input);
  return parsed.success
    ? { body: parsed.data, error: null }
    : { body: null, error: parsed.error.issues[0]?.message ?? 'Check the offer details.' };
}

export function effectiveOwnerOfferStatus(offer: OfferDto, now = Date.now()): OfferDto['status'] {
  return offer.status === 'ACTIVE' && Date.parse(offer.validTo) <= now ? 'EXPIRED' : offer.status;
}

export function ownerOfferTimeText(iso: string, timeZone: string, language: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  try {
    return new Intl.DateTimeFormat(language === 'HI' ? 'hi-IN' : 'en-IN', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ms));
  } catch {
    return iso;
  }
}
