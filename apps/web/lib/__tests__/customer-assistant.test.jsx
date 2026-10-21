import { DEFAULT_RADIUS_KM, bookHref, buildSearchRequest, describeFailure, formatSlot, localToday, parseSearch } from "../customer-assistant";

const TODAY = "2026-10-21";
const form = (over = {}) => ({ serviceQuery: "haircut", date: "2026-10-22", city: "Jharsuguda", coords: null, maxPrice: "", limit: 3, ...over });

describe("localToday", () => {
  it("uses the caller's calendar, zero-padded", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localToday(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });
});

describe("buildSearchRequest", () => {
  it("builds a city search with a slugified city and the chosen limit", () => {
    const built = buildSearchRequest(form({ city: "  New Delhi " }), TODAY);
    expect(built.ok).toBe(true);
    expect(built.body).toEqual({ serviceQuery: "haircut", date: "2026-10-22", city: "new-delhi", limit: 3 });
  });

  it("builds a location search with a default radius and no city", () => {
    const built = buildSearchRequest(form({ city: "ignored", coords: { lat: 25.692, lng: 85.212 } }), TODAY);
    expect(built.ok).toBe(true);
    expect(built.body).toMatchObject({ lat: 25.692, lng: 85.212, radiusKm: DEFAULT_RADIUS_KM });
    expect(built.body.city).toBeUndefined();
  });

  it("includes a price ceiling only when one was typed", () => {
    expect(buildSearchRequest(form({ maxPrice: "500" }), TODAY).body.maxPrice).toBe(500);
    expect(buildSearchRequest(form({ maxPrice: "0" }), TODAY).body.maxPrice).toBe(0);
    expect(buildSearchRequest(form({ maxPrice: "  " }), TODAY).body.maxPrice).toBeUndefined();
  });

  it("says exactly what to fix", () => {
    expect(buildSearchRequest(form({ serviceQuery: " a " }), TODAY)).toEqual({ ok: false, errors: { serviceQuery: expect.stringMatching(/Type the service/) } });
    expect(buildSearchRequest(form({ serviceQuery: "x".repeat(81) }), TODAY).errors.serviceQuery).toMatch(/at most 80/);
    expect(buildSearchRequest(form({ date: "" }), TODAY).errors.date).toMatch(/Pick a day/);
    expect(buildSearchRequest(form({ date: "2026-10-20" }), TODAY).errors.date).toMatch(/today or a later day/);
    expect(buildSearchRequest(form({ city: "" }), TODAY).errors.city).toMatch(/Enter your city/);
    expect(buildSearchRequest(form({ city: "!!!" }), TODAY).errors.city).toMatch(/does not look like a city/);
    expect(buildSearchRequest(form({ maxPrice: "abc" }), TODAY).errors.maxPrice).toMatch(/number/);
    expect(buildSearchRequest(form({ maxPrice: "-5" }), TODAY).errors.maxPrice).toMatch(/number/);
  });

  it("reports every problem at once and sends nothing", () => {
    const built = buildSearchRequest(form({ serviceQuery: "", date: "", city: "" }), TODAY);
    expect(built.ok).toBe(false);
    expect(Object.keys(built.errors).sort()).toEqual(["city", "date", "serviceQuery"]);
  });

  it("accepts today", () => {
    expect(buildSearchRequest(form({ date: TODAY }), TODAY).ok).toBe(true);
  });

  it("refuses a day that is not a real calendar date, as the server would", () => {
    expect(buildSearchRequest(form({ date: "2026-02-31" }), "2026-01-01").ok).toBe(false);
  });
});

const candidate = (over = {}) => ({
  salon: { id: "s1", publicId: "BC-SHOP-000001", name: "Example Salon", slug: "example-salon", citySlug: "hajipur", countryCode: "IN", distanceKm: 2.4 },
  service: { id: "svc-1", name: "Haircut", category: "Hair", price: 250, durationMinutes: 30 },
  currency: "INR", timeZone: "Asia/Kolkata", availableSlots: [{ slotStart: "2026-10-22T03:30:00.000Z", slotEnd: "2026-10-22T04:00:00.000Z" }], ...over,
});
const result = (cands = [candidate()]) => ({ mode: "DETERMINISTIC_CATALOG_AVAILABILITY", generated: false, bookingConfirmationRequired: true, date: "2026-10-22", candidates: cands });

describe("parseSearch", () => {
  it("accepts the documented shape, including no candidates and no distance", () => {
    expect(parseSearch(result())).toEqual(result());
    expect(parseSearch(result([]))).toEqual(result([]));
    expect(parseSearch(result([candidate({ salon: { ...candidate().salon, distanceKm: null } })]))).not.toBeNull();
  });

  it("refuses a reply that is generated, not confirmation-required, or malformed", () => {
    for (const bad of [null, "x", {}, { ...result(), mode: "GENERATIVE" }, { ...result(), generated: true }, { ...result(), bookingConfirmationRequired: false }, { ...result(), candidates: "x" },
      result([candidate({ service: { ...candidate().service, price: Number.NaN } })]), result([candidate({ availableSlots: [{ slotStart: "x" }] })]), result([candidate({ timeZone: 5 })]),
      result([candidate({ salon: { ...candidate().salon, slug: undefined } })])]) {
      expect(parseSearch(bad)).toBeNull();
    }
  });
});

describe("formatSlot", () => {
  it("shows the clock time in the SHOP's time zone", () => {
    expect(formatSlot("2026-10-22T03:30:00.000Z", "Asia/Kolkata")).toMatch(/^9:00\s?am$/i);
    expect(formatSlot("2026-10-22T03:30:00.000Z", "America/New_York")).toMatch(/^11:30\s?pm$/i);
  });

  it("never hides a time for an unknown time zone, and ignores a bad instant", () => {
    expect(formatSlot("2026-10-22T03:30:00.000Z", "Not/AZone")).toMatch(/3:30\s?am UTC$/i);
    expect(formatSlot("not a date", "Asia/Kolkata")).toBe("");
  });
});

describe("bookHref", () => {
  it("opens the shop's booking page with only the service chosen (never a stale time)", () => {
    expect(bookHref(candidate())).toBe("/book/example-salon?country=in&city=hajipur&serviceId=svc-1");
    expect(bookHref(candidate())).not.toMatch(/slot|time|date/);
  });

  it("encodes a slug safely", () => {
    expect(bookHref(candidate({ salon: { ...candidate().salon, slug: "a b/c" } }))).toMatch(/^\/book\/a%20b%2Fc\?/);
  });
});

describe("describeFailure", () => {
  it("explains the rate limit, bad input, offline and everything else without implying a booking", () => {
    expect(describeFailure(429).kind).toBe("TOO_FAST");
    expect(describeFailure(429).message).toMatch(/5 a minute/);
    expect(describeFailure(400).kind).toBe("FIX_FORM");
    expect(describeFailure(undefined, "VALIDATION_ERROR").kind).toBe("FIX_FORM");
    expect(describeFailure(0).message).toMatch(/offline/);
    expect(describeFailure(500).kind).toBe("TRY_LATER");
    expect(describeFailure(500).message).toMatch(/Nothing was booked/);
  });
});
