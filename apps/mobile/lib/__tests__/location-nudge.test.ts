// @ts-nocheck -- fixture objects only carry the fields locationNudge reads.
import { locationNudge } from '../location-proposal';

const view = (lat, pending = null, lastDecision = null) => ({
  current: { latitude: lat, longitude: lat === null ? null : 85.2, verified: lat !== null, verifiedAt: null },
  pending,
  lastDecision,
});

describe("locationNudge", () => {
  it("is quiet when the shop already has a map pin or nothing could be read", () => {
    expect(locationNudge(view(25.7))).toBeNull();
    expect(locationNudge(null)).toBeNull();
  });
  it("asks to set a location when there is no pin and nothing pending", () => {
    expect(locationNudge(view(null))).toBe("missing");
    expect(locationNudge(view(null, null, { status: "APPROVED", reviewNote: null, reviewedAt: null }))).toBe("missing");
  });
  it("reports a pending proposal before an older rejection", () => {
    const rejected = { status: "REJECTED", reviewNote: null, reviewedAt: null };
    expect(locationNudge(view(null, { id: "p" }, rejected))).toBe("pending");
    expect(locationNudge(view(null, null, rejected))).toBe("rejected");
  });
});
