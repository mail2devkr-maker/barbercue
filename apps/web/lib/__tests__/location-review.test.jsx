// Pure logic only (PR #241 contract). The server decides who may decide; this helps a reviewer see the facts.
import * as R from "../location-review";

const salon = (over = {}) => ({ id: "s1", publicId: "BC-SHOP-000001", name: "Fade House", addressLine: "14 Station Road", localityText: "Civil Lines", postalCode: "768201", cityName: "Jharsuguda", currentLatitude: 21.855, currentLongitude: 84.006, ...over });

describe("validateNote", () => {
  it("needs 3 to 500 characters after trimming", () => {
    expect(R.validateNote("")).toContain("at least 3");
    expect(R.validateNote("  ab  ")).toContain("at least 3");
    expect(R.validateNote("abc")).toBeNull();
    expect(R.validateNote("x".repeat(500))).toBeNull();
    expect(R.validateNote("x".repeat(501))).toContain("at most 500");
  });
});

describe("distanceKm", () => {
  it("is zero for the same point and symmetric", () => {
    const a = { latitude: 21.855, longitude: 84.006 };
    const b = { latitude: 21.9, longitude: 84.1 };
    expect(R.distanceKm(a, a)).toBe(0);
    expect(R.distanceKm(a, b)).toBeCloseTo(R.distanceKm(b, a), 9);
  });
  it("matches a known distance (one degree of latitude is about 111.2 km)", () => {
    expect(R.distanceKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(111.19, 1);
  });
  it("copes with the antimeridian and the poles", () => {
    expect(R.distanceKm({ latitude: 0, longitude: 179.5 }, { latitude: 0, longitude: -179.5 })).toBeCloseTo(111.19, 1);
    expect(Number.isFinite(R.distanceKm({ latitude: 90, longitude: 0 }, { latitude: -90, longitude: 0 }))).toBe(true);
  });
});

describe("describeShift", () => {
  it("says when the shop has no public location yet", () => {
    expect(R.describeShift({ latitude: 1, longitude: 2, salon: salon({ currentLatitude: null, currentLongitude: null }) })).toContain("no public location");
  });
  it("describes small, medium and large moves", () => {
    expect(R.describeShift({ latitude: 21.855, longitude: 84.006, salon: salon() })).toContain("under 50 m");
    expect(R.describeShift({ latitude: 21.8595, longitude: 84.006, salon: salon() })).toMatch(/About \d+ m from the current/);
    expect(R.describeShift({ latitude: 22.855, longitude: 84.006, salon: salon() })).toMatch(/About 111\.\d km from the current/);
  });
});

describe("addressLine and decision helpers", () => {
  it("joins the non-empty parts of the address", () => {
    expect(R.addressLine(salon())).toBe("14 Station Road, Civil Lines, Jharsuguda, 768201");
    expect(R.addressLine(salon({ localityText: null, postalCode: " " }))).toBe("14 Station Road, Jharsuguda");
  });
  it("builds the decision body with a trimmed note", () => {
    expect(R.decisionBody("APPROVED", "  Matches the shop front  ")).toEqual({ decision: "APPROVED", note: "Matches the shop front" });
    expect(R.decisionVerb("REJECTED")).toBe("Reject");
    expect(R.decisionVerb("APPROVED")).toBe("Approve");
  });
});
