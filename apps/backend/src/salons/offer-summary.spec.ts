import {
  bestCertainOfferFor,
  offerHeadline,
  summarizeOffers,
  type OfferRow,
} from './offer-summary';

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

describe('combined offers on a card', () => {
  it('each service gets its own best certain discount: the biggest % or the biggest ₹ saving', () => {
    const offers = [
      offer({ id: 'pct10', discountValue: 10 }), // all services
      offer({
        id: 'flat100',
        discountType: 'FLAT',
        discountValue: 100,
        serviceIds: ['facial'],
      }),
      offer({ id: 'pct30-beard', discountValue: 30, serviceIds: ['beard'] }),
      offer({ id: 'new-only', discountValue: 50, audience: 'NEW' }), // conditional: never used
    ];
    // Haircut ₹300: only 10% applies → ₹270.
    expect(bestCertainOfferFor(offers, services[0])).toEqual({
      offerId: 'pct10',
      offerPrice: 270,
      saving: 30,
    });
    // Beard ₹250: 30% (₹75) beats 10% (₹25).
    expect(bestCertainOfferFor(offers, services[1])).toMatchObject({
      offerId: 'pct30-beard',
      offerPrice: 175,
    });
    // Facial ₹600: flat ₹100 beats 10% (₹60).
    expect(bestCertainOfferFor(offers, services[2])).toMatchObject({
      offerId: 'flat100',
      offerPrice: 500,
    });
    expect(bestCertainOfferFor([offers[3]], services[0])).toBeNull();
  });

  it('the headline shows how many offers, the largest % and the largest ₹ saving', () => {
    const summaries = summarizeOffers(
      [
        offer({ id: 'a', discountValue: 10 }),
        offer({ id: 'b', discountValue: 30, serviceIds: ['beard'] }),
        offer({
          id: 'c',
          discountType: 'FLAT',
          discountValue: 100,
          serviceIds: ['facial'],
        }),
      ],
      services,
      undefined,
    );
    expect(offerHeadline(summaries)).toEqual({
      count: 3,
      maxPercent: 30,
      maxSaving: 100,
    });
    expect(offerHeadline([])).toBeNull();
    expect(
      offerHeadline([{ discountType: 'FLAT', discountValue: 50, saving: 50 }]),
    ).toEqual({ count: 1, maxPercent: null, maxSaving: 50 });
  });
});
