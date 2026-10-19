// Owner Offers rules (Codex PR #260 contract FASTQUE_OFFERS_PROMOTIONS_DAILY_DEALS_V1): timezone handling, the form-to-request
// rules (the shared schema's own) and the plain-language wording.
import * as O from "../offers";

const KOLKATA = "Asia/Kolkata";
const NEW_YORK = "America/New_York";

const valid = (extra = {}) => ({
  ...O.EMPTY_OFFER_FORM,
  title: "Festival 20%",
  discountValue: "20",
  validFrom: "2026-10-20T09:00",
  validTo: "2026-10-27T21:00",
  ...extra,
});

describe("shop timezone conversion", () => {
  it("reads a wall-clock time in the shop's timezone as the right UTC instant", () => {
    expect(O.localToUtcIso("2026-10-20T10:00", KOLKATA)).toBe("2026-10-20T04:30:00.000Z");
    expect(O.localToUtcIso("2026-11-01T12:00", NEW_YORK)).toBe("2026-11-01T17:00:00.000Z"); // after daylight saving ended
    expect(O.localToUtcIso("2026-10-01T12:00", NEW_YORK)).toBe("2026-10-01T16:00:00.000Z"); // during daylight saving
  });
  it("shows a UTC instant as the shop's wall-clock time and round-trips", () => {
    expect(O.utcToLocalInput("2026-10-20T04:30:00.000Z", KOLKATA)).toBe("2026-10-20T10:00");
    expect(O.utcToLocalInput(O.localToUtcIso("2026-12-31T23:30", KOLKATA), KOLKATA)).toBe("2026-12-31T23:30");
  });
  it("rejects anything that is not a real date and time", () => {
    for (const bad of ["", "2026-13-01T10:00", "2026-02-30T10:00", "2026-10-20", "2026-10-20T25:00", "x"]) expect(O.localToUtcIso(bad, KOLKATA)).toBeNull();
    expect(O.utcToLocalInput("not a date", KOLKATA)).toBe("");
  });
  it("prints a range in the shop's timezone", () => {
    const text = O.validityText({ validFrom: "2026-10-20T04:30:00.000Z", validTo: "2026-10-27T15:30:00.000Z" }, KOLKATA);
    expect(text).toContain("20 Oct 2026");
    expect(text).toContain("27 Oct 2026");
    expect(text).toContain(" to ");
  });
});

describe("buildOfferBody", () => {
  it("builds the request the server accepts", () => {
    const { body, errors } = O.buildOfferBody(valid({ description: " Diwali ", maxRedemptions: "50", perCustomerLimit: "2" }), KOLKATA);
    expect(errors).toEqual({});
    expect(body).toMatchObject({
      kind: "OFFER", title: "Festival 20%", description: "Diwali", discountType: "PERCENT", discountValue: 20, audience: "ALL",
      validFrom: "2026-10-20T03:30:00.000Z", validTo: "2026-10-27T15:30:00.000Z", maxRedemptions: 50, perCustomerLimit: 2, serviceIds: [],
    });
    expect(body.inactiveDays).toBeUndefined();
  });
  it("sends no limit as null and drops duplicate services", () => {
    const { body } = O.buildOfferBody(valid({ serviceIds: ["a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000001"] }), KOLKATA);
    expect(body.maxRedemptions).toBeNull();
    expect(body.serviceIds).toHaveLength(1);
  });
  it("needs a name, a discount and real dates, and says where", () => {
    const { body, errors } = O.buildOfferBody(O.EMPTY_OFFER_FORM, KOLKATA);
    expect(body).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(["discountValue", "title", "validFrom", "validTo"]);
  });
  it("keeps a percentage a whole number from 1 to 100 and a flat amount to two decimals", () => {
    expect(O.buildOfferBody(valid({ discountValue: "12.5" }), KOLKATA).errors.discountValue).toContain("whole percentage");
    expect(O.buildOfferBody(valid({ discountValue: "101" }), KOLKATA).errors.discountValue).toContain("whole percentage");
    expect(O.buildOfferBody(valid({ discountValue: "0" }), KOLKATA).errors.discountValue).toBeDefined();
    expect(O.buildOfferBody(valid({ discountType: "FLAT", discountValue: "99.5" }), KOLKATA).body.discountValue).toBe(99.5);
    expect(O.buildOfferBody(valid({ discountType: "FLAT", discountValue: "99.555" }), KOLKATA).errors.discountValue).toContain("2 decimals");
  });
  it("needs the end after the start", () => {
    expect(O.buildOfferBody(valid({ validTo: "2026-10-20T09:00" }), KOLKATA).errors.validTo).toContain("after the start");
    expect(O.buildOfferBody(valid({ validTo: "2026-10-19T09:00" }), KOLKATA).errors.validTo).toContain("after the start");
  });
  it("asks for the days only for customers who have not visited for a while", () => {
    expect(O.buildOfferBody(valid({ audience: "INACTIVE" }), KOLKATA).errors.inactiveDays).toBeDefined();
    expect(O.buildOfferBody(valid({ audience: "INACTIVE", inactiveDays: "400" }), KOLKATA).errors.inactiveDays).toBeDefined();
    expect(O.buildOfferBody(valid({ audience: "INACTIVE", inactiveDays: "45" }), KOLKATA).body.inactiveDays).toBe(45);
    expect(O.buildOfferBody(valid({ audience: "NEW", inactiveDays: "45" }), KOLKATA).body.inactiveDays).toBeUndefined();
  });
  it("limits redemptions and the per-customer limit", () => {
    expect(O.buildOfferBody(valid({ maxRedemptions: "0" }), KOLKATA).errors.maxRedemptions).toBeDefined();
    expect(O.buildOfferBody(valid({ perCustomerLimit: "101" }), KOLKATA).errors.perCustomerLimit).toBeDefined();
    expect(O.buildOfferBody(valid({ perCustomerLimit: "" }), KOLKATA).errors.perCustomerLimit).toBeDefined();
  });
});

const offer = (extra = {}) => ({
  id: "o1", salonId: "s1", kind: "OFFER", status: "DRAFT", title: "Festival 20%", description: null, discountType: "PERCENT", discountValue: 20, currency: "INR",
  audience: "ALL", inactiveDays: null, validFrom: "2026-10-20T03:30:00.000Z", validTo: "2026-10-27T15:30:00.000Z", maxRedemptions: null, perCustomerLimit: 1,
  serviceIds: [], redemptionCount: 0, createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", ...extra,
});

describe("buildOfferPatch", () => {
  it("fills the form from an offer and sends nothing when nothing changed", () => {
    const o = offer();
    const form = O.formFromOffer(o, KOLKATA);
    expect(form.validFrom).toBe("2026-10-20T09:00");
    expect(O.buildOfferPatch(o, form, KOLKATA)).toEqual({ body: null, errors: {} });
  });
  it("sends only what changed", () => {
    const o = offer();
    const form = { ...O.formFromOffer(o, KOLKATA), title: "Festival 25%", discountValue: "25", maxRedemptions: "10" };
    expect(O.buildOfferPatch(o, form, KOLKATA).body).toEqual({ title: "Festival 25%", discountValue: 25, maxRedemptions: 10 });
  });
  it("treats the same services in another order as unchanged", () => {
    const ids = ["a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000002"];
    const o = offer({ serviceIds: ids });
    const form = { ...O.formFromOffer(o, KOLKATA), serviceIds: [...ids].reverse() };
    expect(O.buildOfferPatch(o, form, KOLKATA).body).toBeNull();
  });
  it("can clear a limit and the description", () => {
    const o = offer({ maxRedemptions: 10, description: "x" });
    const form = { ...O.formFromOffer(o, KOLKATA), maxRedemptions: "", description: "" };
    expect(O.buildOfferPatch(o, form, KOLKATA).body).toEqual({ maxRedemptions: null, description: null });
  });
  it("refuses an invalid edit with field messages", () => {
    const o = offer();
    const form = { ...O.formFromOffer(o, KOLKATA), discountValue: "500" };
    const r = O.buildOfferPatch(o, form, KOLKATA);
    expect(r.body).toBeNull();
    expect(r.errors.discountValue).toBeDefined();
  });
});

describe("words and rules", () => {
  it("describes the discount, audience and services", () => {
    expect(O.discountText(offer())).toBe("20% off");
    expect(O.discountText(offer({ discountType: "FLAT", discountValue: 100 }))).toContain("100");
    expect(O.audienceText(offer({ audience: "INACTIVE", inactiveDays: 45 }))).toContain("45 days");
    expect(O.audienceText(offer({ audience: "NEW" }))).toBe("New customers");
    expect(O.servicesText(offer())).toBe("All active services");
    expect(O.servicesText(offer({ serviceIds: ["a"] }))).toBe("1 service");
  });
  it("counts uses, with the limit when there is one", () => {
    expect(O.redemptionText({ redemptionCount: 1, maxRedemptions: null })).toBe("1 booking used it");
    expect(O.redemptionText({ redemptionCount: 3, maxRedemptions: 10 })).toBe("3 bookings used it of 10 allowed");
  });
  it("allows edit and publish only for a draft or paused offer, and pause only for an active one", () => {
    expect([O.canEdit("DRAFT"), O.canEdit("PAUSED"), O.canEdit("ACTIVE"), O.canEdit("EXPIRED")]).toEqual([true, true, false, false]);
    expect([O.canPublish("DRAFT"), O.canPublish("PAUSED"), O.canPublish("ACTIVE"), O.canPublish("EXPIRED")]).toEqual([true, true, false, false]);
    expect([O.canPause("ACTIVE"), O.canPause("DRAFT")]).toEqual([true, false]);
  });
  it("explains the server's offer error codes", () => {
    expect(O.offerErrorText("OFFER_MUST_PAUSE_TO_EDIT", "m")).toContain("Pause");
    expect(O.offerErrorText("OFFER_NOT_PUBLISHABLE", "m")).toContain("cannot be published");
    expect(O.offerErrorText("OFFER_CHANGED_RETRY", "m")).toContain("Reload");
    expect(O.offerErrorText("OTHER", "as sent")).toBe("as sent");
  });
  it("knows its statuses and kinds", () => {
    expect(O.statusLabel("PAUSED")).toBe("Paused");
    expect(O.kindLabel("DAILY_DEAL")).toBe("Daily deal");
    expect(O.statusTone("ACTIVE")).toBe("ok");
  });
});
