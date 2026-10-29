import {
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
