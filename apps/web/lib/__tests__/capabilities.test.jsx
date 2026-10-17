// Pure parsing only. The server (owner decision D1) says which features are usable; anything unclear means "not available".
import { FEATURE_KEYS, isSandbox, isUsable, parseCapabilities, unavailableMessage } from "../capabilities";

const entry = (status, extra = {}) => ({ status, ...extra });

describe("parseCapabilities", () => {
  it("keeps the documented features with their status, reason and read-only time", () => {
    const map = parseCapabilities({
      features: {
        demoData: entry("ENABLED", { updatedAt: "2026-10-17T00:00:00.000Z" }),
        inventory: entry("DISABLED", { reasonCode: "FEATURE_DISABLED" }),
        offers: entry("SANDBOX"),
        aiDescription: entry("UNCONFIGURED", { reasonCode: "PROVIDER_NOT_CONFIGURED" }),
      },
    });
    expect(map.demoData).toEqual({ status: "ENABLED", reasonCode: null, updatedAt: "2026-10-17T00:00:00.000Z" });
    expect(map.inventory.reasonCode).toBe("FEATURE_DISABLED");
    expect(Object.keys(map).sort()).toEqual(["aiDescription", "demoData", "inventory", "offers"]);
  });

  it("drops unknown features, unknown statuses and malformed entries instead of guessing", () => {
    const map = parseCapabilities({
      features: { demoData: entry("MAYBE"), inventory: "ENABLED", offers: null, mystery: entry("ENABLED"), locationPin: entry(true) },
    });
    expect(map).toEqual({});
  });

  it("returns nothing for a missing, empty or non-object response", () => {
    for (const raw of [undefined, null, "ENABLED", [], {}, { features: null }, { features: [] }]) expect(parseCapabilities(raw)).toEqual({});
  });

  it("knows the fourteen documented feature keys", () => {
    expect(FEATURE_KEYS).toHaveLength(14);
    expect(FEATURE_KEYS).toContain("demoData");
  });
});

describe("isUsable / isSandbox", () => {
  const map = parseCapabilities({ features: { demoData: entry("ENABLED"), offers: entry("SANDBOX"), inventory: entry("DISABLED"), subscription: entry("UNCONFIGURED") } });
  it("treats only ENABLED and SANDBOX as usable", () => {
    expect(isUsable(map, "demoData")).toBe(true);
    expect(isUsable(map, "offers")).toBe(true);
    expect(isUsable(map, "inventory")).toBe(false);
    expect(isUsable(map, "subscription")).toBe(false);
    expect(isUsable(map, "consultations")).toBe(false); // never reported
    expect(isUsable({}, "demoData")).toBe(false);
  });
  it("labels only SANDBOX as test mode", () => {
    expect(isSandbox(map, "offers")).toBe(true);
    expect(isSandbox(map, "demoData")).toBe(false);
  });
});

describe("unavailableMessage", () => {
  it("explains the reason in plain words and never shows a bare code", () => {
    const map = parseCapabilities({ features: { inventory: entry("DISABLED", { reasonCode: "FEATURE_DISABLED" }), aiDescription: entry("UNCONFIGURED", { reasonCode: "PROVIDER_NOT_CONFIGURED" }), offers: entry("UNCONFIGURED"), demoData: entry("DISABLED", { reasonCode: "SOMETHING_NEW" }) } });
    expect(unavailableMessage(map, "inventory")).toContain("not been switched on");
    expect(unavailableMessage(map, "aiDescription")).toContain("not been set up");
    expect(unavailableMessage(map, "offers")).toContain("not been set up");
    expect(unavailableMessage(map, "demoData")).not.toContain("SOMETHING_NEW");
  });
  it("is honest when the server said nothing", () => {
    expect(unavailableMessage(null, "demoData")).toBe("This is not available for your shop yet.");
    expect(unavailableMessage({}, "demoData")).toBe("This is not available for your shop yet.");
  });
});
