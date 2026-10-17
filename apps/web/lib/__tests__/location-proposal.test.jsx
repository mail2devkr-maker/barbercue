// Pure logic only (PR #241 contract). An owner proposes; only a different reviewer can make a location public.
import * as L from "../location-proposal";

const current = (over = {}) => ({ latitude: 28.6139, longitude: 77.209, verification: "VERIFIED", verifiedAt: "2026-10-01T00:00:00.000Z", ...over });
const proposal = (over = {}) => ({ id: "p1", status: "PENDING", latitude: 28.61, longitude: 77.2, source: "GPS", submittedAt: "2026-10-16T10:00:00.000Z", reviewedAt: null, reviewNote: null, ...over });

describe("parseLocation", () => {
  it("reads the current location and a pending proposal", () => {
    const v = L.parseLocation({ salonId: "s1", current: current(), pendingProposal: proposal() });
    expect(v.current).toEqual({ latitude: 28.6139, longitude: 77.209, verified: true, verifiedAt: "2026-10-01T00:00:00.000Z" });
    expect(v.pending.status).toBe("PENDING");
  });
  it("reads a shop with no location and no proposal", () => {
    const v = L.parseLocation({ salonId: "s1", current: { latitude: null, longitude: null, verification: "UNVERIFIED", verifiedAt: null }, pendingProposal: null });
    expect(v.current.latitude).toBeNull();
    expect(v.current.verified).toBe(false);
    expect(v.pending).toBeNull();
  });
  it("never calls a missing location verified, whatever the server says", () => {
    const v = L.parseLocation({ current: { latitude: null, longitude: null, verification: "VERIFIED", verifiedAt: null }, pendingProposal: null });
    expect(v.current.verified).toBe(false);
  });
  it("returns no answer for anything that is not the documented shape", () => {
    for (const bad of [null, undefined, "x", [], {}, { current: null }, { current: { latitude: "28", longitude: 77, verification: "VERIFIED" } }, { current: { latitude: 1, longitude: 2, verification: "MAYBE" } }]) {
      expect(L.parseLocation(bad)).toBeNull();
    }
  });
  it("drops a malformed proposal instead of showing a wrong one", () => {
    const v = L.parseLocation({ current: current(), pendingProposal: { id: "p", status: "PENDING", latitude: "x", longitude: 2, source: "GPS", submittedAt: "t" } });
    expect(v.pending).toBeNull();
  });
});

describe("parseCoordinate", () => {
  it("accepts plain decimals, with a comma or a sign", () => {
    expect(L.parseCoordinate("28.6139")).toBe(28.6139);
    expect(L.parseCoordinate(" -33.8688 ")).toBe(-33.8688);
    expect(L.parseCoordinate("77,209")).toBe(77.209);
    expect(L.parseCoordinate("+5")).toBe(5);
    expect(L.parseCoordinate(".5")).toBe(0.5);
  });
  it("rejects anything that is not a plain number", () => {
    for (const bad of ["", " ", "abc", "28.6139N", "1e3", "NaN", "Infinity", "28..5", "1.2.3", "0x10"]) expect(L.parseCoordinate(bad)).toBeNull();
  });
});

describe("validateCoordinates", () => {
  it("accepts a valid pair and rounds to six decimals", () => {
    expect(L.validateCoordinates("28.61393456789", "77.2090123456").value).toEqual({ latitude: 28.613935, longitude: 77.209012 });
  });
  it("explains each problem on its own box", () => {
    const r = L.validateCoordinates("91", "181");
    expect(r.value).toBeNull();
    expect(r.errors.latitude).toContain("-90 and 90");
    expect(r.errors.longitude).toContain("-180 and 180");
    expect(L.validateCoordinates("abc", "77").errors.latitude).toContain("number");
    expect(L.validateCoordinates("28", "").errors.longitude).toContain("number");
  });
  it("allows the exact limits", () => {
    expect(L.validateCoordinates("90", "180").value).toEqual({ latitude: 90, longitude: 180 });
    expect(L.validateCoordinates("-90", "-180").value).toEqual({ latitude: -90, longitude: -180 });
  });
});

describe("labels and links", () => {
  it("links out to an external map without loading anything into the page", () => {
    expect(L.mapLinkOut(28.6139, 77.209)).toBe("https://www.openstreetmap.org/?mlat=28.613900&mlon=77.209000#map=18/28.613900/77.209000");
  });
  it("uses plain words for sources and review states, and shows an unknown value as sent", () => {
    expect(L.sourceLabel("GPS")).toBe("Device location");
    expect(L.sourceLabel("MANUAL")).toBe("Typed in");
    expect(L.sourceLabel("WEIRD")).toBe("WEIRD");
    expect(L.proposalStatusLabel("PENDING")).toBe("Waiting for review");
    expect(L.proposalStatusLabel("REJECTED")).toBe("Not approved");
    expect(L.proposalStatusLabel("SUPERSEDED")).toContain("Replaced");
  });
  it("explains each device location failure and offers typing instead", () => {
    for (const code of [1, 2, 3, undefined]) expect(L.geolocationMessage(code)).toContain("coordinates");
    expect(L.geolocationMessage(1)).toContain("blocked");
  });
  it("formats coordinates with six decimals", () => {
    expect(L.formatCoordinates(28.6139, 77.209)).toBe("28.613900, 77.209000");
  });
});
