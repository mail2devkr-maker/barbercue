import { EMPTY_OFFER_FORM, buildOfferBody, buildOfferPatch, formFromOffer, rulesText } from '../../../../lib/offers';

// Owner form for the offer booking rules: minimum spend, a cap on percentage discounts and Happy
// Hours (days + daily window). The server re-checks all of it when a customer books.
const TZ = 'Asia/Kolkata';
const base = {
  ...EMPTY_OFFER_FORM,
  title: 'Weekday happy hours',
  discountValue: '20',
  validFrom: '2026-11-01T00:00',
  validTo: '2026-11-30T23:00',
};

describe('offer booking rules in the owner form', () => {
  it('sends minimum spend, cap and Happy Hours', () => {
    const { body, errors } = buildOfferBody(
      { ...base, minimumBookingAmount: '500', maximumDiscountAmount: '150', applicableDays: [5, 1, 3], dailyStartTime: '14:00', dailyEndTime: '17:00' },
      TZ,
    );
    expect(errors).toEqual({});
    expect(body).toMatchObject({
      minimumBookingAmount: 500,
      maximumDiscountAmount: 150,
      applicableDays: [1, 3, 5],
      dailyStartTime: '14:00',
      dailyEndTime: '17:00',
    });
  });

  it('explains half a window, a backwards window and a bad amount next to the field', () => {
    expect(buildOfferBody({ ...base, dailyStartTime: '14:00' }, TZ).errors.dailyEndTime).toBe('Set both a start and an end time, or neither.');
    expect(buildOfferBody({ ...base, dailyStartTime: '17:00', dailyEndTime: '14:00' }, TZ).errors.dailyEndTime).toBe('The end time must be after the start time.');
    expect(buildOfferBody({ ...base, minimumBookingAmount: 'abc' }, TZ).errors.minimumBookingAmount).toMatch(/amount above 0/);
  });

  it('a flat offer never sends a cap, and an edit sends only the changed rule', () => {
    expect(buildOfferBody({ ...base, discountType: 'FLAT', discountValue: '50', maximumDiscountAmount: '40' }, TZ).body.maximumDiscountAmount).toBeNull();
    const saved = {
      ...buildOfferBody(base, TZ).body,
      id: 'o1', salonId: 's1', status: 'DRAFT', currency: 'INR', inactiveDays: null, redemptionCount: 0,
      createdAt: '', updatedAt: '', maxRedemptions: null, description: null,
    };
    const form = formFromOffer(saved, TZ);
    expect(buildOfferPatch(saved, form, TZ).body).toBeNull();
    expect(buildOfferPatch(saved, { ...form, applicableDays: [6, 0] }, TZ).body).toEqual({ applicableDays: [0, 6] });
  });

  it('summarises the rules for the offer list', () => {
    expect(rulesText({ currency: 'INR', minimumBookingAmount: 500, maximumDiscountAmount: 150, applicableDays: [1, 2, 3, 4, 5], dailyStartTime: '14:00', dailyEndTime: '17:00' }))
      .toBe('Min. spend ₹500 · Up to ₹150 off · Mon–Fri, 14:00–17:00');
    expect(rulesText({ currency: 'INR', minimumBookingAmount: null, maximumDiscountAmount: null, applicableDays: [], dailyStartTime: null, dailyEndTime: null })).toBe('');
  });
});
