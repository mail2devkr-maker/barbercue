import React, { act, useEffect } from "react";
import TestRenderer from "react-test-renderer";
import { useCapabilities, resetCapabilitiesCache } from "../use-capabilities";
import { apiFetch } from "../api";

jest.mock("../api", () => ({ apiFetch: jest.fn() }));

let latest;
function Probe({ salonId, enabled }) {
  const state = useCapabilities(salonId, enabled);
  useEffect(() => {
    latest = state;
  });
  return null;
}
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
async function mount(props) {
  let r;
  await act(async () => { r = TestRenderer.create(<Probe {...props} />); });
  await flush();
  return r;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  resetCapabilitiesCache();
  latest = undefined;
});

describe("useCapabilities", () => {
  it("reads this shop's capabilities from the salon-scoped route", async () => {
    apiFetch.mockResolvedValue({ features: { demoData: { status: "ENABLED" } } });
    await mount({ salonId: "s1" });
    expect(apiFetch).toHaveBeenCalledWith("dashboard/salons/s1/capabilities");
    expect(latest.phase).toBe("ready");
    expect(latest.features.demoData.status).toBe("ENABLED");
  });

  it("reports unavailable with nothing enabled when the server has no such route or fails", async () => {
    apiFetch.mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));
    await mount({ salonId: "s1" });
    expect(latest).toEqual({ phase: "unavailable", features: {} });
  });

  it("shares one answer between callers for the same shop", async () => {
    apiFetch.mockResolvedValue({ features: { offers: { status: "SANDBOX" } } });
    await mount({ salonId: "s1" });
    await mount({ salonId: "s1" });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(latest.features.offers.status).toBe("SANDBOX");
  });

  it("never shows one shop's features for another", async () => {
    apiFetch.mockResolvedValueOnce({ features: { demoData: { status: "ENABLED" } } }).mockResolvedValueOnce({ features: {} });
    const r = await mount({ salonId: "s1" });
    expect(latest.features.demoData.status).toBe("ENABLED");
    await act(async () => { r.update(<Probe salonId="s2" />); });
    expect(latest.features.demoData).toBeUndefined();
    await flush();
    expect(latest.features).toEqual({});
  });

  it("makes no request for a caller who may not read capabilities", async () => {
    await mount({ salonId: "s1", enabled: false });
    expect(apiFetch).not.toHaveBeenCalled();
    expect(latest).toEqual({ phase: "unavailable", features: {} });
  });
});

describe("useCapabilities request sharing", () => {
  it("asks once for callers that mount together, even when the server answers with an error", async () => {
    apiFetch.mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));
    await act(async () => {
      TestRenderer.create(<Probe salonId="s1" />);
      TestRenderer.create(<Probe salonId="s1" />);
    });
    await flush();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(latest).toEqual({ phase: "unavailable", features: {} });
    await mount({ salonId: "s1" });
    expect(apiFetch).toHaveBeenCalledTimes(1); // the failure is remembered briefly instead of retried on every render
  });
});
