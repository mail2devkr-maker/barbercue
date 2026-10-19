// Pure parsing and wording only (PR #237 contract). The server decides readiness; this explains it.
import { describePhotoReadiness, parsePhotoReadiness } from "../photo-readiness";

const answer = (over = {}) => ({ required: 3, current: 2, ready: false, grandfathered: false, reasons: ["THREE_VALID_PHOTOS_REQUIRED"], ...over });

describe("parsePhotoReadiness", () => {
  it("reads the documented shape", () => {
    expect(parsePhotoReadiness(answer())).toEqual({ required: 3, current: 2, ready: false, grandfathered: false, reasons: ["THREE_VALID_PHOTOS_REQUIRED"] });
  });
  it("returns no answer for anything that is not that shape, never a guess", () => {
    for (const bad of [null, undefined, "x", [], {}, answer({ required: "3" }), answer({ current: -1 }), answer({ current: 1.5 }), answer({ ready: "yes" }), answer({ grandfathered: null })]) {
      expect(parsePhotoReadiness(bad)).toBeNull();
    }
  });
  it("tolerates a missing or odd reasons list", () => {
    expect(parsePhotoReadiness(answer({ reasons: undefined })).reasons).toEqual([]);
    expect(parsePhotoReadiness(answer({ reasons: ["A", 5, null] })).reasons).toEqual(["A"]);
  });
});

describe("describePhotoReadiness", () => {
  it("tells a new shop how many photos are still needed", () => {
    const v = describePhotoReadiness(parsePhotoReadiness(answer()));
    expect(v.tone).toBe("warn");
    expect(v.title).toBe("2 of 3 photos added");
    expect(v.body).toContain("Add 1 more photo before");
    expect(v.counted).toBe(2);
  });
  it("uses the plural for two or three missing", () => {
    expect(describePhotoReadiness(parsePhotoReadiness(answer({ current: 0 }))).body).toContain("Add 3 more photos");
    expect(describePhotoReadiness(parsePhotoReadiness(answer({ current: 1 }))).body).toContain("Add 2 more photos");
  });
  it("explains that the same image added twice counts once", () => {
    expect(describePhotoReadiness(parsePhotoReadiness(answer())).body).toContain("counts once");
  });
  it("says a shop with enough photos is ready", () => {
    const v = describePhotoReadiness(parsePhotoReadiness(answer({ current: 3, ready: true, reasons: [] })));
    expect(v.tone).toBe("ok");
    expect(v.title).toBe("3 of 3 photos added");
  });
  it("never shows more than the requirement as counted", () => {
    expect(describePhotoReadiness(parsePhotoReadiness(answer({ current: 7, ready: true, reasons: [] }))).counted).toBe(3);
  });
  it("tells an already-open shop the rule does not apply to it, whatever its count", () => {
    const v = describePhotoReadiness(parsePhotoReadiness(answer({ current: 0, ready: false, grandfathered: true, reasons: [] })));
    expect(v.tone).toBe("info");
    expect(v.title).toBe("Your shop is already open");
    expect(v.body).toContain("does not apply to yours");
  });
});
