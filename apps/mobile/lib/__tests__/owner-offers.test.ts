import {
  buildOwnerOfferBody,
  canPreviewOwnerOffer,
  effectiveOwnerOfferStatus,
  ownerOfferFormFromDto,
  ownerOfferIsoToLocal,
  ownerOfferLocalToIso,
  ownerOffersListPath,
} from '../owner-offers';
import type { OfferDto } from '@barbercue/shared';

describe('owner offer helpers', () => {
  it('only previews bounded service sets supported by the backend', () => {
    expect(canPreviewOwnerOffer([], 0)).toBe(false);
    expect(canPreviewOwnerOffer([], 101)).toBe(false);
    expect(canPreviewOwnerOffer(['service-1'], 101)).toBe(true);
    expect(canPreviewOwnerOffer([], 100)).toBe(true);
  });

  it('builds salon-scoped, bounded cursor requests with active filters', () => {
    expect(ownerOffersListPath('salon/one', { kind: 'DAILY_DEAL', status: 'PAUSED', cursor: 'cursor/value' }))
      .toBe('dashboard/salons/salon%2Fone/offers?limit=25&kind=DAILY_DEAL&status=PAUSED&cursor=cursor%2Fvalue');
  });

  it('round-trips shop-local times using the shop timezone rather than the device timezone', () => {
    const iso = ownerOfferLocalToIso('2026-10-28T09:30', 'Asia/Kolkata');
    expect(iso).toBe('2026-10-28T04:00:00.000Z');
    expect(ownerOfferIsoToLocal(iso!, 'Asia/Kolkata')).toBe('2026-10-28T09:30');
  });

  it('rejects impossible calendar times and nonexistent timezone wall times', () => {
    expect(ownerOfferLocalToIso('2026-02-30T09:00', 'Asia/Kolkata')).toBeNull();
    expect(ownerOfferLocalToIso('2026-03-08T02:30', 'America/New_York')).toBeNull();
  });

  it('uses the shared validation rules and requires inactive days only for inactive customers', () => {
    const base = {
      kind: 'OFFER' as const,
      title: 'Weekday offer',
      description: '',
      discountType: 'PERCENT' as const,
      discountValue: '20',
      audience: 'INACTIVE' as const,
      inactiveDays: '',
      validFrom: '2026-10-28T09:00',
      validTo: '2026-10-29T09:00',
      maxRedemptions: '',
      perCustomerLimit: '1',
      serviceIds: [],
    };
    expect(buildOwnerOfferBody(base, 'Asia/Kolkata')).toMatchObject({ body: null, error: expect.any(String) });
    expect(buildOwnerOfferBody({ ...base, inactiveDays: '30' }, 'Asia/Kolkata').body).toMatchObject({
      audience: 'INACTIVE', inactiveDays: 30, maxRedemptions: null, serviceIds: [],
    });
  });

  it('keeps expired active records from offering publish/pause actions', () => {
    const offer = {
      id: 'offer-1', salonId: 'salon-1', kind: 'OFFER', status: 'ACTIVE', title: 'Past offer', description: null,
      discountType: 'PERCENT', discountValue: 10, currency: 'INR', audience: 'ALL', inactiveDays: null,
      validFrom: '2026-10-01T00:00:00.000Z', validTo: '2026-10-02T00:00:00.000Z', maxRedemptions: null,
      perCustomerLimit: 1, serviceIds: [], redemptionCount: 0, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    } as OfferDto;
    expect(effectiveOwnerOfferStatus(offer, Date.parse('2026-10-03T00:00:00.000Z'))).toBe('EXPIRED');
    expect(ownerOfferFormFromDto(offer, 'Asia/Kolkata').serviceIds).toEqual([]);
  });
});
