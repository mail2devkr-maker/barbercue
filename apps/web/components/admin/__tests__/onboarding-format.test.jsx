import { conversion, stageLabel, ONBOARDING_STEPS } from "../onboarding-format";

describe("onboarding format", () => {
  it("labels every stage in order", () => {
    expect(ONBOARDING_STEPS.map(stageLabel)).toEqual([
      "Registered",
      "Verified",
      "Set up",
      "Open",
      "First customer",
    ]);
  });
  it("conversion percent against registered shops", () => {
    expect(conversion(3, 4)).toBe("75%");
    expect(conversion(0, 0)).toBe("—");
    expect(conversion(1, 3)).toBe("33%");
  });
});
