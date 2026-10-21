import { customerAssistantSearchSchema } from "../schemas";

const valid = {
  serviceQuery: "  haircut  ",
  date: "2026-10-22",
  city: "hajipur",
};

describe("customerAssistantSearchSchema", () => {
  it("trims text, defaults to three results, and accepts a valid salon-local date", () => {
    expect(customerAssistantSearchSchema.parse(valid)).toMatchObject({
      serviceQuery: "haircut",
      date: "2026-10-22",
      limit: 3,
    });
  });

  it.each(["2026-02-29", "2026-10-32", "2026-1-01", "not-a-date"])(
    "rejects invalid calendar dates: %s",
    (date) => {
      expect(
        customerAssistantSearchSchema.safeParse({ ...valid, date }).success,
      ).toBe(false);
    },
  );

  it("requires a coordinate pair and requires it for a radius", () => {
    expect(
      customerAssistantSearchSchema.safeParse({ ...valid, lat: 25.7 }).success,
    ).toBe(false);
    expect(
      customerAssistantSearchSchema.safeParse({ ...valid, radiusKm: 10 })
        .success,
    ).toBe(false);
    expect(
      customerAssistantSearchSchema.safeParse({
        ...valid,
        lat: 25.7,
        lng: 85.2,
        radiusKm: 10,
      }).success,
    ).toBe(true);
  });

  it("requires a city or coordinate location scope", () => {
    const { city: _city, ...unlocated } = valid;
    expect(customerAssistantSearchSchema.safeParse(unlocated).success).toBe(
      false,
    );
    expect(
      customerAssistantSearchSchema.safeParse({
        ...unlocated,
        lat: 25.7,
        lng: 85.2,
      }).success,
    ).toBe(true);
  });

  it("bounds result count, query length, and price", () => {
    expect(
      customerAssistantSearchSchema.safeParse({ ...valid, limit: 6 }).success,
    ).toBe(false);
    expect(
      customerAssistantSearchSchema.safeParse({ ...valid, serviceQuery: "x" })
        .success,
    ).toBe(false);
    expect(
      customerAssistantSearchSchema.safeParse({ ...valid, maxPrice: -1 })
        .success,
    ).toBe(false);
    expect(
      customerAssistantSearchSchema.safeParse({ ...valid, maxPrice: 1_000_001 })
        .success,
    ).toBe(false);
  });

  it("requires a city when a country code is supplied and normalizes it", () => {
    const { city: _city, ...unlocated } = valid;
    expect(
      customerAssistantSearchSchema.safeParse({
        ...unlocated,
        countryCode: "IN",
      }).success,
    ).toBe(false);
    expect(
      customerAssistantSearchSchema.parse({
        ...valid,
        city: "hajipur",
        countryCode: "in",
      }).countryCode,
    ).toBe("IN");
  });
});
