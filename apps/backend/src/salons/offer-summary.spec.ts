import { summarizeOffers, type OfferRow } from './offer-summary';

const services = [
  { id: 'cut', name: 'Haircut', price: 300 },
  { id: 'beard', name: 'Beard Styling', price: 250 },
  { id: 'facial', name: 'Facial', price: 600 },
];

function offer(over: Partial<OfferRow>): OfferRow {
  return {
    id: 'o',
    title: 'Offer',
    description: null,
    discountType: 'PERCENT',
    discountValue: 20,
    validTo: new Date('2026-11-30T00:00:00Z'),
    audience: 'ALL',
    applicableDays: [],
    dailyStartTime: null,
    dailyEndTime: null,
    minimumBookingAmount: null,
    maximumDiscountAmount: null,
    serviceIds: [],
    ...over,
  };
}

describe('summarizeOffers', () => {
  it('with a selected service, only offers covering it count, priced on that service', () => {
    const [best, ...rest] = summarizeOffers(
      [
        offer({ id: 'facial-only', serviceIds: ['facial'], discountValue: 50 }),
        offer({ id: 'beard-20', serviceIds: ['beard'] }),
      ],
      services,
      services[1],
    );
    expect(rest).toHaveLength(0);
    expect(best).toMatchObject({
      id: 'beard-20',
      appliesTo: 'Beard Styling',
      conditional: false,
      saving: 50,
      price: {
        serviceName: 'Beard Styling',
        originalPrice: 250,
        offerPrice: 200,
      },
    });
    expect(summarizeOffers([offer({})], services, null)).toEqual([]);
  });

  it('puts certain offers before conditional ones, then the biggest saving', () => {
    const result = summarizeOffers(
      [
        offer({ id: 'first-visit', audience: 'NEW', discountValue: 50 }),
        offer({
          id: 'happy-hours',
          discountValue: 40,
          applicableDays: [1, 2, 3, 4, 5],
          dailyStartTime: '14:00',
          dailyEndTime: '17:00',
        }),
        offer({ id: 'flat-50', discountType: 'FLAT', discountValue: 50 }),
        offer({ id: 'pct-10', discountValue: 10 }),
      ],
      services,
      undefined,
    );
    expect(result.map((o) => o.id)).toEqual([
      'pct-10', // ₹60 on the ₹600 facial
      'flat-50',
      'first-visit',
      'happy-hours',
    ]);
    // Conditional offers never carry a guaranteed price.
    expect(result[2].price).toBeNull();
    expect(result[3]).toMatchObject({
      schedule: 'Mon–Fri, 14:00–17:00',
      price: null,
    });
  });

  it('an unmet minimum spend makes the offer conditional; the cap limits the saving', () => {
    const [minSpend] = summarizeOffers(
      [
        offer({
          discountType: 'FLAT',
          discountValue: 100,
          minimumBookingAmount: 500,
        }),
      ],
      services,
      services[0],
    );
    expect(minSpend).toMatchObject({
      conditional: true,
      price: null,
      saving: 100,
    });

    const [capped] = summarizeOffers(
      [offer({ discountValue: 50, maximumDiscountAmount: 75 })],
      services,
      services[2],
    );
    expect(capped).toMatchObject({
      saving: 75,
      price: { originalPrice: 600, offerPrice: 525 },
    });
  });

  it('names the covered services when none is selected', () => {
    const [linked] = summarizeOffers(
      [offer({ serviceIds: ['cut', 'beard', 'facial'] })],
      services,
      undefined,
    );
    expect(linked.appliesTo).toBe('Haircut, Beard Styling +1 more');
    expect(
      summarizeOffers([offer({})], services, undefined)[0].appliesTo,
    ).toBeNull();
  });
});
