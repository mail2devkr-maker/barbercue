// Customer side of Offers (Codex PR #260 contract): city slug, links, estimates, wording and the by-id lookup.
import * as P from "../public-offers";

const offer = (extra = {}) => ({
  id: "o1", discountType: "PERCENT", discountValue: 20, currency: "INR", inactiveDays: null, serviceIds: [],
  eligibility: { audience: "ALL", accountRequired: true },
  prices: [
    { serviceId: "a", serviceName: "Haircut", basePrice: 250, discount: 50, finalPrice: 200, currency: "INR" },
    { serviceId: "b", serviceName: "Shave", basePrice: 100, discount: 20, finalPrice: 80, currency: "INR" },
  ], ...extra,
});

describe("city and links", () => {
  it("turns a typed city into the slug the server matches, or null", () => {
    expect(P.cityToSlug(" Jharsuguda ")).toBe("jharsuguda");
    expect(P.cityToSlug("New Delhi")).toBe("new-delhi");
    for (const bad of ["", "  ", "a/b", "city?x=1", "..", "-x"]) expect(P.cityToSlug(bad)).toBeNull();
  });
  it("builds the booking link from the searched city, with the country and the offer", () => {
    const href = P.bookOfferHref({ salonSlug: "studio 360", country: "in", citySlug: "jharsuguda", offerId: "11111111-1111-4111-8111-111111111111" });
    expect(href).toBe("/book/studio%20360?country=in&city=jharsuguda&offer=11111111-1111-4111-8111-111111111111");
  });
  it("accepts only a uuid as an offer id", () => {
    expect(P.isOfferId("11111111-1111-4111-8111-111111111111")).toBe(true);
    for (const bad of ["", "x", "11111111-1111-4111-8111", undefined, null]) expect(P.isOfferId(bad)).toBe(false);
  });
});

describe("words", () => {
  it("describes the discount, kind and who can use it", () => {
    expect(P.offerDiscountText(offer())).toBe("20% off");
    expect(P.offerDiscountText(offer({ discountType: "FLAT", discountValue: 100 }))).toContain("100");
    expect(P.offerKindLabel("DAILY_DEAL")).toBe("Daily deal");
    expect(P.eligibilityText(offer())).toContain("Sign in to book");
    expect(P.eligibilityText(offer({ eligibility: { audience: "NEW", accountRequired: true } }))).toContain("no completed visit");
    expect(P.eligibilityText(offer({ eligibility: { audience: "INACTIVE", accountRequired: true }, inactiveDays: 45 }))).toContain("45 days");
  });
  it("explains the offer errors a booking can fail with", () => {
    expect(P.customerOfferErrorText("OFFER_EXPIRED", "m")).toBe("This offer has ended.");
    expect(P.customerOfferErrorText("OFFER_NOT_ELIGIBLE", "m")).toContain("not available for your account");
    expect(P.customerOfferErrorText("OFFER_REDEMPTION_LIMIT", "m")).toContain("as many times");
    expect(P.customerOfferErrorText("OFFER_SERVICE_MISMATCH", "m")).toContain("does not apply");
    expect(P.customerOfferErrorText("SLOT_FULL", "full")).toBe("full");
    expect(P.isOfferError("OFFER_EXPIRED")).toBe(true);
    expect(P.isOfferError("SLOT_FULL")).toBe(false);
  });
});

describe("estimates", () => {
  it("adds the offer's own lines for the chosen services only", () => {
    expect(P.estimateFor(offer(), ["a", "b"])).toEqual({ subtotal: 350, discount: 70, total: 280 });
    expect(P.estimateFor(offer(), ["a"])).toEqual({ subtotal: 250, discount: 50, total: 200 });
    expect(P.estimateFor(offer(), ["zzz"])).toBeNull();
  });
  it("knows whether the offer covers the chosen services", () => {
    expect(P.appliesToServices(offer(), ["a", "b"])).toBe(true);
    expect(P.appliesToServices(offer({ serviceIds: ["a"] }), ["a"])).toBe(true);
    expect(P.appliesToServices(offer({ serviceIds: ["a"] }), ["a", "b"])).toBe(false);
  });
});

describe("findPublicOffer", () => {
  it("pages through the list until it finds the offer, and stops at the last page", async () => {
    const pages = { null: { items: [{ id: "x" }], nextCursor: "c1" }, c1: { items: [{ id: "y" }, { id: "target" }], nextCursor: null } };
    const fetchPage = jest.fn(async (cursor) => pages[String(cursor)]);
    expect((await P.findPublicOffer(fetchPage, "target"))?.id).toBe("target");
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(await P.findPublicOffer(async () => ({ items: [{ id: "x" }], nextCursor: null }), "target")).toBeNull();
  });
  it("gives up after the page limit instead of paging forever", async () => {
    const fetchPage = jest.fn(async () => ({ items: [{ id: "x" }], nextCursor: "again" }));
    expect(await P.findPublicOffer(fetchPage, "target", 3)).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});
