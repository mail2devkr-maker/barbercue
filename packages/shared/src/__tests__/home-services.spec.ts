import { computeHomeEta, computeHomePrice, conservativeTravelMinutes, homeProviderLabel, homeTransitionAllowed, parseHomeRequest } from "../home-services";

const item = (name: string, servicePaise: number, quantity = 1) => ({ name, servicePaise, productPaise: 0, disposablePaise: 0, equipmentPaise: 0, quantity });
const base = { travelPaise: 0, areaSurchargePaise: 0, upliftPct: 0, weekend: false, weekendPct: 0, peak: false, peakPct: 0, groupDiscountPct: 0, groupDiscountMin: 3 };

describe("FastQue Home rules", () => {
  it("spec 21 price example: 299 + 99 + 49 - 50 = 397", () => {
    const p = computeHomePrice({ ...base, items: [item("Haircut", 29900), item("Beard", 9900)], travelPaise: 4900, promo: { code: "X", percentOff: null, amountOffPaise: 5000 } });
    expect(p.totalPaise).toBe(39700);
    expect(p.lines.reduce((s, l) => s + l.paise, 0)).toBe(p.totalPaise);
  });

  it("a discount can never make the service negative, and every charge is its own line", () => {
    const p = computeHomePrice({ ...base, items: [item("Cut", 10000, 3)], weekend: true, weekendPct: 10, groupDiscountPct: 20, promo: { code: "B", percentOff: null, amountOffPaise: 999_999 } });
    expect(p.totalPaise).toBe(0);
    expect(p.lines.map((l) => l.code)).toEqual(["SERVICE", "WEEKEND", "GROUP", "PROMO"]);
  });

  it("spec 13 ETA example: 15 + 5 + 12 + 5 = 37 min arrival, 67 min completion, as a window", () => {
    const now = new Date("2026-11-25T06:00:00Z");
    const e = computeHomeEta({ now, availableFrom: new Date(now.getTime() + 15 * 60_000), prepMinutes: 5, travelMinutes: 12, travelSource: "ROAD", accessBufferMinutes: 5, serviceMinutes: 30, cleanupMinutes: 0 });
    expect((e.arrival.getTime() - now.getTime()) / 60_000).toBe(37);
    expect((e.completion.getTime() - now.getTime()) / 60_000).toBe(67);
    expect(e.windowTo.getTime()).toBeGreaterThan(e.windowFrom.getTime());
  });

  it("does not add preparation twice and lowers confidence without routing or with stale location", () => {
    const now = new Date();
    const mk = (over: object) => computeHomeEta({ now, availableFrom: now, prepMinutes: 10, travelMinutes: 10, travelSource: "ROAD", accessBufferMinutes: 0, serviceMinutes: 10, cleanupMinutes: 0, ...over });
    expect((mk({ alreadyPreparing: true }).arrival.getTime() - now.getTime()) / 60_000).toBe(10);
    expect(mk({ historySamples: 20 }).confidence).toBe("HIGH");
    expect(mk({ locationAgeMinutes: 30, historySamples: 20 }).confidence).toBe("LOW");
    expect(mk({ travelSource: "ESTIMATE" })).toMatchObject({ confidence: "LOW", approximate: true });
  });

  it("fallback travel is conservative and says when coordinates are unknown", () => {
    const a = { lat: 28.5, lng: 77.4 };
    expect(conservativeTravelMinutes(a, { lat: 28.59, lng: 77.4 }, "TWO_WHEELER").minutes).toBeGreaterThan(45);
    expect(conservativeTravelMinutes({ lat: null, lng: null }, a, "CAR")).toEqual({ minutes: 60, source: "UNKNOWN" });
  });

  it("state machine: no shortcuts and completion is not payment", () => {
    expect(homeTransitionAllowed("INVITED", "CONFIRMED", "PROFESSIONAL")).toBe(false);
    expect(homeTransitionAllowed("CONFIRMED", "IN_PROGRESS", "PROFESSIONAL")).toBe(false);
    expect(homeTransitionAllowed("IN_PROGRESS", "PAYMENT_CONFIRMED", "PROFESSIONAL")).toBe(false);
    expect(homeTransitionAllowed("PAYMENT_PENDING", "PAYMENT_CONFIRMED", "CUSTOMER")).toBe(false);
    expect(homeTransitionAllowed("IN_PROGRESS", "INTERRUPTED", "CUSTOMER")).toBe(true);
  });

  it("labels and typed requests (English and Hindi)", () => {
    expect(homeProviderLabel("SALON_MANAGED", "Royal")).toBe("Salon Professional – Associated with Royal");
    const defs = [{ code: "mens-haircut", name: "Men's haircut", nameHi: "पुरुष हेयरकट", synonyms: ["haircut"] }, { code: "waxing", name: "Waxing", nameHi: "वैक्सिंग", synonyms: ["wax"] }];
    expect(parseHomeRequest("Find a female beautician for waxing under ₹1,500", defs)).toMatchObject({ serviceCodes: ["waxing"], maxPricePaise: 150000, comfortPreference: "FEMALE", withinMinutes: null });
    expect(parseHomeRequest("Find me a barber who can come to my home within 30 minutes", defs)).toMatchObject({ mode: "INSTANT", withinMinutes: 30, maxPricePaise: null });
    expect(parseHomeRequest("Book my regular haircut for Sunday morning", defs)).toMatchObject({ mode: "SCHEDULED", weekday: 0, partOfDay: "MORNING", wantsRegular: true });
    expect(parseHomeRequest("कल सुबह पुरुष हेयरकट", defs)).toMatchObject({ serviceCodes: ["mens-haircut"], dayOffset: 1, partOfDay: "MORNING" });
  });
});
