import { campaignLabelFor, offerDays, promoState, promoText } from "../offer-promo";
import { INVITE_TEXT_MAX } from "../shop-share";

const TZ = "Asia/Kolkata";
const base = {
  title: "Monsoon Special", description: null, discountType: "PERCENT", discountValue: 20, currency: "INR", audience: "ALL", inactiveDays: null,
  validFrom: "2026-10-01T04:30:00.000Z", validTo: "2026-10-31T18:30:00.000Z", serviceIds: [], status: "ACTIVE", maxRedemptions: null, redemptionCount: 0,
};
const inWindow = new Date("2026-10-15T08:00:00.000Z");

describe("promoState (owner issue #17): only a usable offer produces a post", () => {
  it("allows an active offer inside its dates", () => {
    expect(promoState(base, TZ, inWindow)).toEqual({ ok: true });
  });

  it("refuses a draft, a paused offer and an ended offer, each with its own plain reason", () => {
    expect(promoState({ ...base, status: "DRAFT" }, TZ, inWindow)).toMatchObject({ ok: false, reason: expect.stringContaining("still a draft") });
    expect(promoState({ ...base, status: "PAUSED" }, TZ, inWindow)).toMatchObject({ ok: false, reason: expect.stringContaining("paused") });
    expect(promoState({ ...base, status: "EXPIRED" }, TZ, inWindow)).toMatchObject({ ok: false, reason: "This offer has ended." });
  });

  it("refuses before the start and from the end instant on, naming the date", () => {
    const early = promoState(base, TZ, new Date("2026-09-30T10:00:00.000Z"));
    expect(early.ok).toBe(false);
    expect(early.reason).toContain("has not started yet");
    expect(early.reason).toMatch(/Oct/);
    const late = promoState(base, TZ, new Date(base.validTo));
    expect(late.ok).toBe(false);
    expect(late.reason).toContain("dates have passed");
    expect(promoState(base, TZ, new Date(Date.parse(base.validTo) - 1)).ok).toBe(true);
  });

  it("refuses an offer whose allowed bookings are all used, but not one with room left", () => {
    expect(promoState({ ...base, maxRedemptions: 10, redemptionCount: 10 }, TZ, inWindow)).toMatchObject({ ok: false, reason: expect.stringContaining("All 10 allowed bookings") });
    expect(promoState({ ...base, maxRedemptions: 10, redemptionCount: 9 }, TZ, inWindow)).toEqual({ ok: true });
  });

  it("refuses an offer with unreadable dates instead of guessing", () => {
    expect(promoState({ ...base, validFrom: "garbage" }, TZ, inWindow).ok).toBe(false);
  });
});

describe("promoText: built only from the offer's own fields", () => {
  it("states the discount, the shop, the validity and that booking needs a FastQue account", () => {
    const t = promoText(base, "Fade House", null, TZ);
    expect(t).toContain("Monsoon Special at Fade House: 20% off on all services.");
    expect(t).toContain("Valid ");
    expect(t).toContain("Oct 2026");
    expect(t).toContain("Book online on FastQue with your account to use it.");
  });

  it("names the services, and abbreviates long lists honestly", () => {
    expect(promoText({ ...base, serviceIds: ["a"] }, "S", ["Haircut"], TZ)).toContain("20% off on Haircut.");
    expect(promoText({ ...base, serviceIds: ["a", "b"] }, "S", ["Haircut", "Beard"], TZ)).toContain("on Haircut and Beard.");
    expect(promoText({ ...base, serviceIds: ["a", "b", "c", "d", "e"] }, "S", ["A", "B", "C", "D", "E"], TZ)).toContain("on A, B and C and 2 more.");
    // ids known but names not loaded: say so rather than invent them
    expect(promoText({ ...base, serviceIds: ["a", "b"] }, "S", null, TZ)).toContain("on selected services.");
  });

  it("shows a flat discount in money", () => {
    expect(promoText({ ...base, discountType: "FLAT", discountValue: 100 }, "S", null, TZ)).toMatch(/₹\s?100 off/);
  });

  it("says who the offer is for, so it is never advertised to everyone by mistake", () => {
    expect(promoText({ ...base, audience: "NEW" }, "S", null, TZ)).toContain("For new customers only.");
    expect(promoText({ ...base, audience: "REPEAT" }, "S", null, TZ)).toContain("For returning customers only.");
    expect(promoText({ ...base, audience: "INACTIVE", inactiveDays: 45 }, "S", null, TZ)).toContain("have not visited in the last 45 days");
    expect(promoText(base, "S", null, TZ)).not.toMatch(/only\./);
  });

  it("includes the owner's description, trimmed and capped, and nothing the offer does not say", () => {
    const t = promoText({ ...base, description: "  Free head massage with every cut.  " }, "S", null, TZ);
    expect(t).toContain("Free head massage with every cut.");
    const long = promoText({ ...base, description: "x".repeat(900) }, "S", null, TZ);
    expect(long.length).toBeLessThanOrEqual(INVITE_TEXT_MAX);
    expect(promoText(base, "S", null, TZ)).not.toMatch(/limited|hurry|best|guarantee|free/i);
  });
});

describe("tracking-link window and label", () => {
  it("covers exactly the shop-local days the offer is valid, ending the day before an exact-midnight end", () => {
    expect(offerDays(base, TZ)).toEqual({ firstDay: "2026-10-01", lastDay: "2026-10-31" });
    expect(offerDays({ validFrom: "2026-10-01T04:30:00.000Z", validTo: "2026-10-01T18:30:00.000Z" }, TZ)).toEqual({ firstDay: "2026-10-01", lastDay: "2026-10-01" });
  });

  it("labels the campaign after the offer and keeps it within the limit", () => {
    expect(campaignLabelFor({ title: "  Monsoon Special " })).toBe("Offer: Monsoon Special");
    expect(campaignLabelFor({ title: "y".repeat(300) }).length).toBeLessThanOrEqual(120);
  });
});
