import {
  describeOfferSchedule,
  offerScheduleApplies,
  createOfferSchema,
  offerListQuerySchema,
  offerPreviewSchema,
  publicOfferQuerySchema,
} from "../offers";

const serviceA = "550e8400-e29b-41d4-a716-446655440000";
const serviceB = "550e8400-e29b-41d4-a716-446655440001";

const validOffer = {
  kind: "DAILY_DEAL",
  title: "Weekday cut",
  discountType: "PERCENT",
  discountValue: 10,
  audience: "ALL",
  validFrom: "2026-10-19T00:00:00.000Z",
  validTo: "2026-10-20T00:00:00.000Z",
  serviceIds: [serviceA],
};

describe("offer booking rules", () => {
  it("accepts minimum spend, a percentage cap and Happy Hours", () => {
    expect(
      createOfferSchema.parse({
        ...validOffer,
        minimumBookingAmount: 500,
        maximumDiscountAmount: 150,
        applicableDays: [1, 2, 3, 4, 5],
        dailyStartTime: "14:00",
        dailyEndTime: "17:00",
      }),
    ).toMatchObject({ applicableDays: [1, 2, 3, 4, 5], dailyStartTime: "14:00" });
    expect(createOfferSchema.parse(validOffer).applicableDays).toEqual([]);
  });

  it("rejects half a time window, a backwards window, a cap on a flat offer and duplicate days", () => {
    expect(createOfferSchema.safeParse({ ...validOffer, dailyStartTime: "14:00" }).success).toBe(false);
    expect(createOfferSchema.safeParse({ ...validOffer, dailyStartTime: "17:00", dailyEndTime: "14:00" }).success).toBe(false);
    expect(createOfferSchema.safeParse({ ...validOffer, dailyStartTime: "25:00", dailyEndTime: "26:00" }).success).toBe(false);
    expect(createOfferSchema.safeParse({ ...validOffer, discountType: "FLAT", discountValue: 50, maximumDiscountAmount: 40 }).success).toBe(false);
    expect(createOfferSchema.safeParse({ ...validOffer, applicableDays: [1, 1] }).success).toBe(false);
  });

  it("applies the schedule start-inclusive, end-exclusive, on the chosen days", () => {
    const schedule = { applicableDays: [1, 2, 3, 4, 5], dailyStartTime: "14:00", dailyEndTime: "17:00" };
    expect(offerScheduleApplies(schedule, 2, 14 * 60)).toBe(true);
    expect(offerScheduleApplies(schedule, 2, 17 * 60)).toBe(false);
    expect(offerScheduleApplies(schedule, 6, 15 * 60)).toBe(false);
    expect(offerScheduleApplies({ applicableDays: [], dailyStartTime: null, dailyEndTime: null }, 0, 0)).toBe(true);
    expect(describeOfferSchedule(schedule)).toBe("Mon–Fri, 14:00–17:00");
    expect(describeOfferSchedule({ applicableDays: [0, 6], dailyStartTime: null, dailyEndTime: null })).toBe("Sun, Sat");
  });
});

describe("offers shared contracts", () => {
  it("accepts a valid provider-free draft and defaults the per-customer cap", () => {
    expect(createOfferSchema.parse(validOffer)).toMatchObject({
      kind: "DAILY_DEAL",
      perCustomerLimit: 1,
      serviceIds: [serviceA],
    });
  });

  it("rejects invalid percentage, reversed dates, duplicate services and missing inactive days", () => {
    expect(
      createOfferSchema.safeParse({ ...validOffer, discountValue: 101 })
        .success,
    ).toBe(false);
    expect(
      createOfferSchema.safeParse({
        ...validOffer,
        validTo: validOffer.validFrom,
      }).success,
    ).toBe(false);
    expect(
      createOfferSchema.safeParse({
        ...validOffer,
        serviceIds: [serviceA, serviceA],
      }).success,
    ).toBe(false);
    expect(
      createOfferSchema.safeParse({ ...validOffer, audience: "INACTIVE" })
        .success,
    ).toBe(false);
  });

  it("requires unique non-empty service ids for preview", () => {
    expect(
      offerPreviewSchema.safeParse({ serviceIds: [serviceA] }).success,
    ).toBe(true);
    expect(offerPreviewSchema.safeParse({ serviceIds: [] }).success).toBe(
      false,
    );
    expect(
      offerPreviewSchema.safeParse({ serviceIds: [serviceA, serviceA] })
        .success,
    ).toBe(false);
  });

  it("accepts computed expired status for owner history and validates public filters", () => {
    expect(
      offerListQuerySchema.parse({ status: "EXPIRED", limit: "10" }),
    ).toMatchObject({ status: "EXPIRED", limit: 10 });
    expect(
      publicOfferQuerySchema.safeParse({ service: serviceB, limit: "50" })
        .success,
    ).toBe(true);
    expect(
      publicOfferQuerySchema.parse({ countryCode: "in", citySlug: "jharsuguda" }),
    ).toMatchObject({ countryCode: "IN", citySlug: "jharsuguda" });
    expect(
      createOfferSchema.safeParse({ ...validOffer, serviceIds: [] }).success,
    ).toBe(true);
  });
});
