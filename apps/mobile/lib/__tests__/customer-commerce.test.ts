import { customerInvoicesRequestPath, includeOfferInBooking, offerProfileParams, publicOffersRequestPath } from '../customer-commerce';
import type { PublicOfferDto } from '@barbercue/shared';

describe('customer commerce mobile contracts', () => {
  it('uses bounded cursor pages for public offer discovery', () => {
    expect(publicOffersRequestPath()).toBe('offers?limit=20');
    expect(publicOffersRequestPath('cursor/value')).toBe('offers?limit=20&cursor=cursor%2Fvalue');
  });

  it('uses the authenticated customer-only invoice endpoint with bounded pages', () => {
    expect(customerInvoicesRequestPath()).toBe('invoices/mine?limit=20');
    expect(customerInvoicesRequestPath('invoice-cursor')).toBe('invoices/mine?limit=20&cursor=invoice-cursor');
  });

  it('carries only the selected public offer identity and canonical shop location into booking', () => {
    const offer = {
      id: 'offer-id',
      salon: { id: 'salon-id', name: 'Example', slug: 'example', city: 'Pune', countryCode: 'IN', citySlug: 'pune' },
      title: 'Weekday offer',
    } as PublicOfferDto;
    expect(offerProfileParams(offer)).toEqual({
      countryCode: 'IN', citySlug: 'pune', salonSlug: 'example', offerId: 'offer-id', offerTitle: 'Weekday offer',
    });
  });

  it('sends an offer ID for server-side booking validation without changing ordinary bookings', () => {
    const body = { salonId: 'salon', serviceIds: ['service'], slotStart: '2026-10-28T10:00:00.000Z' };
    expect(includeOfferInBooking(body, 'offer')).toEqual({ ...body, offerId: 'offer' });
    expect(includeOfferInBooking(body)).toEqual(body);
  });
});
