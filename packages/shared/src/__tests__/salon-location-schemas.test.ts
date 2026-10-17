import {
  decideSalonLocationProposalSchema,
  submitSalonLocationProposalSchema,
} from "../schemas";

describe("salon location verification contracts", () => {
  it("accepts inclusive WGS84 coordinate limits and supported evidence sources", () => {
    expect(
      submitSalonLocationProposalSchema.safeParse({
        latitude: -90,
        longitude: 180,
        source: "GPS",
      }).success,
    ).toBe(true);
    expect(
      submitSalonLocationProposalSchema.safeParse({
        latitude: 90,
        longitude: -180,
        source: "MAP_PIN",
      }).success,
    ).toBe(true);
    expect(
      submitSalonLocationProposalSchema.safeParse({
        latitude: 0,
        longitude: 0,
        source: "MANUAL",
      }).success,
    ).toBe(true);
  });

  it.each([
    { latitude: -90.000001, longitude: 0, source: "GPS" },
    { latitude: 90.000001, longitude: 0, source: "GPS" },
    { latitude: 0, longitude: -180.000001, source: "GPS" },
    { latitude: 0, longitude: 180.000001, source: "GPS" },
    { latitude: Number.NaN, longitude: 0, source: "GPS" },
    { latitude: 0, longitude: Number.POSITIVE_INFINITY, source: "GPS" },
    { latitude: 0, longitude: 0, source: "EXIF" },
  ])("rejects invalid coordinate/source payloads: %j", (input) => {
    expect(submitSalonLocationProposalSchema.safeParse(input).success).toBe(
      false,
    );
  });

  it("requires an explicit decision and a useful bounded review note", () => {
    expect(
      decideSalonLocationProposalSchema.safeParse({
        decision: "APPROVED",
        note: "Owner evidence reviewed independently.",
      }).success,
    ).toBe(true);
    for (const note of ["", "  ", "ok", "x".repeat(501)]) {
      expect(
        decideSalonLocationProposalSchema.safeParse({
          decision: "REJECTED",
          note,
        }).success,
      ).toBe(false);
    }
    expect(
      decideSalonLocationProposalSchema.safeParse({
        decision: "SUPERSEDED",
        note: "Ignore.",
      }).success,
    ).toBe(false);
  });
});
