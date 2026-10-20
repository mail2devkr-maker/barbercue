// Canonical offer locations and the lookup by id (Codex PR #268): links come from the offer itself, a server older than #268 falls back
// to the searched city, and the lookup by id replaces the multi-page search except for that older server.
import * as P from "../public-offers";

const OFFER_ID = "11111111-1111-4111-8111-111111111111";
const offer = (salon = {}) => ({
  id: OFFER_ID, discountType: "PERCENT", discountValue: 10, currency: "INR", inactiveDays: null, serviceIds: [],
  eligibility: { audience: "ALL", accountRequired: true }, prices: [],
  salon: { id: "s1", name: "Studio", slug: "studio-360", city: "New Delhi", countryCode: "IN", citySlug: "new-delhi", ...salon },
});

describe("canonicalLocation", () => {
  it("reads the offer's own country and city slug, lower-cased", () => {
    expect(P.canonicalLocation(offer())).toEqual({ country: "in", citySlug: "new-delhi" });
    expect(P.canonicalLocation(offer({ countryCode: " in ", citySlug: "New-Delhi" }))).toEqual({ country: "in", citySlug: "new-delhi" });
  });
  it("is null for a server that sends neither, or something that cannot be a slug", () => {
    expect(P.canonicalLocation({ salon: {} })).toBeNull();
    expect(P.canonicalLocation(offer({ countryCode: undefined }))).toBeNull();
    expect(P.canonicalLocation(offer({ citySlug: undefined }))).toBeNull();
    for (const bad of ["../x", "a b", "", "-x", "x?y=1"]) expect(P.canonicalLocation(offer({ citySlug: bad }))).toBeNull();
    for (const bad of ["IND", "I", "1N", ""]) expect(P.canonicalLocation(offer({ countryCode: bad }))).toBeNull();
  });
});

describe("offerBookHref", () => {
  it("uses the offer's canonical location, not what the visitor searched", () => {
    expect(P.offerBookHref(offer(), { country: "us", citySlug: "somewhere-else" })).toBe(`/book/studio-360?country=in&city=new-delhi&offer=${OFFER_ID}`);
  });
  it("works with no search at all when the offer carries its location", () => {
    expect(P.offerBookHref(offer())).toBe(`/book/studio-360?country=in&city=new-delhi&offer=${OFFER_ID}`);
  });
  it("falls back to the searched city for an older server, with the default country", () => {
    const old = offer({ countryCode: undefined, citySlug: undefined });
    expect(P.offerBookHref(old, { citySlug: "jharsuguda" })).toBe(`/book/studio-360?country=in&city=jharsuguda&offer=${OFFER_ID}`);
    expect(P.offerBookHref(old, { country: "AE", citySlug: "dubai" })).toBe(`/book/studio-360?country=ae&city=dubai&offer=${OFFER_ID}`);
  });
  it("returns null rather than guess when there is no location at all", () => {
    const old = offer({ countryCode: undefined, citySlug: undefined });
    expect(P.offerBookHref(old)).toBeNull();
    expect(P.offerBookHref(old, {})).toBeNull();
    expect(P.offerBookHref(old, { country: "in", citySlug: null })).toBeNull();
  });
  it("encodes the shop slug", () => {
    expect(P.offerBookHref(offer({ slug: "a b/c" }))).toContain("/book/a%20b%2Fc?");
  });
});

describe("publicOfferParams", () => {
  it("sends the legacy and the canonical city filter together, so an older server still filters by city", () => {
    expect(P.publicOfferParams("jharsuguda")).toEqual({ city: "jharsuguda", citySlug: "jharsuguda" });
  });
  it("adds the country only when it is a two-letter code, upper-cased", () => {
    expect(P.publicOfferParams("jharsuguda", "in")).toEqual({ city: "jharsuguda", citySlug: "jharsuguda", countryCode: "IN" });
    for (const bad of ["", "ind", "1n", null, undefined]) expect(P.publicOfferParams("x", bad).countryCode).toBeUndefined();
  });
});

describe("lookupPublicOffer", () => {
  const err = (status, code) => Object.assign(new Error("e"), { status, code });
  const page = () => ({ items: [{ id: OFFER_ID, title: "from list" }], nextCursor: null });

  it("returns the offer from the lookup by id and never touches the list", async () => {
    const fetchPage = jest.fn(async () => page());
    const found = await P.lookupPublicOffer(async () => ({ id: OFFER_ID, title: "by id" }), fetchPage, OFFER_ID);
    expect(found.title).toBe("by id");
    expect(fetchPage).not.toHaveBeenCalled();
  });
  it("treats OFFER_NOT_FOUND as final", async () => {
    const fetchPage = jest.fn(async () => page());
    expect(await P.lookupPublicOffer(async () => { throw err(404, "OFFER_NOT_FOUND"); }, fetchPage, OFFER_ID)).toBeNull();
    expect(fetchPage).not.toHaveBeenCalled();
  });
  it("falls back to the bounded list search only for a 404 that is not OFFER_NOT_FOUND (a server without the route)", async () => {
    const fetchPage = jest.fn(async () => page());
    const found = await P.lookupPublicOffer(async () => { throw err(404, "NOT_FOUND"); }, fetchPage, OFFER_ID);
    expect(found.title).toBe("from list");
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
  it("does not fall back without a list to search, or after any other failure", async () => {
    expect(await P.lookupPublicOffer(async () => { throw err(404, "NOT_FOUND"); }, null, OFFER_ID)).toBeNull();
    const fetchPage = jest.fn(async () => page());
    for (const failure of [err(500, "INTERNAL"), err(400, "OFFER_INVALID"), err(429, "RATE"), new Error("offline"), "text", null]) {
      expect(await P.lookupPublicOffer(async () => { throw failure; }, fetchPage, OFFER_ID)).toBeNull();
    }
    expect(fetchPage).not.toHaveBeenCalled();
  });
  it("returns null when the fallback search itself fails", async () => {
    expect(await P.lookupPublicOffer(async () => { throw err(404, "NOT_FOUND"); }, async () => { throw new Error("offline"); }, OFFER_ID)).toBeNull();
  });
});
