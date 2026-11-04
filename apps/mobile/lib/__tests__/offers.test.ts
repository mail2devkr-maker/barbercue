import { buildOfferBody, buildOfferPatch, emptyOfferForm, formFromOffer, localToUtcIso } from '../offers';
import type { OfferDto } from '@barbercue/shared';

const offer: OfferDto = {
  id: 'offer-1', salonId: 'salon-1', kind: 'OFFER', status: 'DRAFT', title: 'Weekday special',
  description: null, discountType: 'PERCENT', discountValue: 10, currency: 'INR', audience: 'ALL',
  inactiveDays: null, validFrom: '2026-11-04T03:30:00.000Z', validTo: '2026-12-04T03:30:00.000Z',
  maxRedemptions: null, perCustomerLimit: 1, serviceIds: [], redemptionCount: 0,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
};

describe('mobile offer form contract', () => {
  it('converts shop-local times to UTC and round trips them', () => {
    expect(localToUtcIso('2026-11-04T09:00', 'Asia/Kolkata')).toBe('2026-11-04T03:30:00.000Z');
    const form = formFromOffer(offer, 'Asia/Kolkata');
    expect(form.validFrom).toBe('2026-11-04T09:00');
    expect(form.validTo).toBe('2026-12-04T09:00');
  });

  it('rejects nonexistent local times at daylight-saving transitions', () => {
    expect(localToUtcIso('2026-03-08T02:30', 'America/New_York')).toBeNull();
  });

  it('defaults a new offer to a future interval in the shop timezone', () => {
    const form = emptyOfferForm('Asia/Kolkata', new Date('2026-11-04T03:30:00.000Z'));
    expect(form.validFrom).toBe('2026-11-04T10:00');
    expect(Date.parse(localToUtcIso(form.validTo, 'Asia/Kolkata')!)).toBeGreaterThan(Date.parse(localToUtcIso(form.validFrom, 'Asia/Kolkata')!));
  });

  it('builds a schema-validated offer body and keeps all services represented by an empty selection', () => {
    const form = {
      ...emptyOfferForm('Asia/Kolkata', new Date('2026-11-04T03:30:00.000Z')),
      title: '  Weekday special  ',
      discountValue: '10',
    };
    const result = buildOfferBody(form, 'Asia/Kolkata');
    expect(result.errors).toEqual({});
    expect(result.body).toMatchObject({
      title: 'Weekday special',
      discountType: 'PERCENT',
      discountValue: 10,
      serviceIds: [],
      validFrom: '2026-11-04T04:30:00.000Z',
    });
  });

  it('reports invalid percent, date range, inactive audience and per-customer limits before sending', () => {
    const form = {
      ...emptyOfferForm('UTC', new Date('2026-11-04T00:00:00.000Z')),
      title: 'Bad offer',
      discountValue: '10.5',
      audience: 'INACTIVE' as const,
      inactiveDays: '0',
      perCustomerLimit: '101',
      validTo: '2026-11-04T01:00',
    };
    const result = buildOfferBody(form, 'UTC');
    expect(result.body).toBeNull();
    expect(result.errors.discountValue).toBeTruthy();
    expect(result.errors.validTo).toBeTruthy();
    expect(result.errors.inactiveDays).toBeTruthy();
    expect(result.errors.perCustomerLimit).toBeTruthy();
  });

  it('creates only changed fields in a patch and returns null for no changes', () => {
    const originalForm = formFromOffer(offer, 'Asia/Kolkata');
    expect(buildOfferPatch(offer, originalForm, 'Asia/Kolkata')).toEqual({ body: null, errors: {} });
    const result = buildOfferPatch(offer, { ...originalForm, title: 'Updated offer' }, 'Asia/Kolkata');
    expect(result.errors).toEqual({});
    expect(result.body).toEqual({ title: 'Updated offer' });
  });
});
