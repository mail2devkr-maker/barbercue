import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { ShopLocation } from "../ShopLocation";
import { apiFetch, ApiError } from "../../../lib/api";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));
jest.mock("../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join(" ");
  return collect(node.children);
};
const text = (r) => collect(r.toJSON());
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const button = (r, label) => r.root.findAllByType("button").find((b) => new RegExp(label).test(collect(b.props.children)));
const input = (r, id) => r.root.findByProps({ id });

const NONE = { salonId: "s1", current: { latitude: null, longitude: null, verification: "UNVERIFIED", verifiedAt: null }, pendingProposal: null };
const VERIFIED = { salonId: "s1", current: { latitude: 28.6139, longitude: 77.209, verification: "VERIFIED", verifiedAt: "2026-10-01T00:00:00.000Z" }, pendingProposal: null };
const PENDING = { ...VERIFIED, pendingProposal: { id: "p1", status: "PENDING", latitude: 28.61, longitude: 77.2, source: "GPS", submittedAt: "2026-10-16T10:00:00.000Z", reviewedAt: null, reviewNote: null } };

let calls;
let answer;
function install({ get = NONE, patch } = {}) {
  calls = [];
  answer = get;
  apiFetch.mockImplementation(async (path, opts) => {
    calls.push({ path, opts });
    if (opts?.method === "PATCH") return patch ? patch(opts) : { id: "p2" };
    if (get instanceof Error) throw get;
    return answer;
  });
}

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<ShopLocation salonId="s1" />); });
  await flush();
  return r;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});
afterEach(() => { delete globalThis.navigator; });

describe("ShopLocation current state", () => {
  it("says plainly that no location is set", async () => {
    install();
    expect(text(await mount())).toContain("No location is set for your shop yet");
  });

  it("shows a verified location with a link to check it, and never calls an unverified one verified", async () => {
    install({ get: VERIFIED });
    const r = await mount();
    expect(text(r)).toContain("28.613900, 77.209000");
    expect(text(r)).toContain("Verified");
    const link = r.root.findAll((n) => n.type === "a" && /Check on a map/.test(collect(n.props.children)))[0];
    expect(link.props.href).toContain("openstreetmap.org");
    expect(link.props.rel).toContain("noopener");
    install({ get: { ...VERIFIED, current: { ...VERIFIED.current, verification: "UNVERIFIED", verifiedAt: null } } });
    expect(text(await mount())).toContain("Not verified yet");
  });

  it("shows a waiting proposal as private and waiting, not as the shop's location", async () => {
    install({ get: PENDING });
    const t = text(await mount());
    expect(t).toContain("Your proposal");
    expect(t).toContain("Waiting for review");
    expect(t).toContain("Device location");
    expect(t).toContain("28.610000, 77.200000");
  });

  it("shows the server's message when the location cannot be loaded", async () => {
    install({ get: new ApiError("Forbidden", 403) });
    expect(text(await mount())).toContain("Forbidden");
  });

  it("does not show a location for an answer it cannot read", async () => {
    install({ get: { weird: true } });
    const t = text(await mount());
    expect(t).toContain("could not read");
    expect(t).not.toContain("What customers see now");
  });
});

describe("ShopLocation proposing", () => {
  it("validates before sending anything", async () => {
    install();
    const r = await mount();
    await act(async () => { input(r, "loc-lat").props.onChange({ target: { value: "95" } }); });
    await act(async () => { input(r, "loc-lng").props.onChange({ target: { value: "abc" } }); });
    await act(async () => { button(r, "Send for review").props.onClick(); });
    expect(text(r)).toContain("-90 and 90");
    expect(text(r)).toContain("Enter the longitude");
    expect(calls.some((c) => c.opts?.method === "PATCH")).toBe(false);
  });

  it("sends typed coordinates as a MANUAL proposal and says it is not public until approved", async () => {
    install();
    const r = await mount();
    await act(async () => { input(r, "loc-lat").props.onChange({ target: { value: "28.61393456" } }); });
    await act(async () => { input(r, "loc-lng").props.onChange({ target: { value: "77.209" } }); });
    await act(async () => { button(r, "Send for review").props.onClick(); });
    await flush();
    const patch = calls.find((c) => c.opts?.method === "PATCH");
    expect(patch.path).toBe("dashboard/salons/s1/location");
    expect(JSON.parse(patch.opts.body)).toEqual({ latitude: 28.613935, longitude: 77.209, source: "MANUAL" });
    expect(text(r)).toContain("does not change until FastQue approves it");
  });

  it("fills the boxes from the device location only after the owner asks, and sends it as GPS", async () => {
    install();
    globalThis.navigator = { geolocation: { getCurrentPosition: jest.fn((ok) => ok({ coords: { latitude: 28.6139123, longitude: 77.2090456, accuracy: 12.4 } })) } };
    const r = await mount();
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    await act(async () => { button(r, "Use my device location").props.onClick(); });
    expect(input(r, "loc-lat").props.value).toBe("28.613912");
    expect(input(r, "loc-lng").props.value).toBe("77.209046");
    expect(text(r)).toMatch(/accurate to about\s+12\s+m/);
    expect(calls.some((c) => c.opts?.method === "PATCH")).toBe(false); // nothing is sent by finding the location
    await act(async () => { button(r, "Send for review").props.onClick(); });
    await flush();
    expect(JSON.parse(calls.find((c) => c.opts?.method === "PATCH").opts.body).source).toBe("GPS");
  });

  it("treats numbers the owner edits after using the device location as typed in", async () => {
    install();
    globalThis.navigator = { geolocation: { getCurrentPosition: jest.fn((ok) => ok({ coords: { latitude: 28.6, longitude: 77.2, accuracy: 5 } })) } };
    const r = await mount();
    await act(async () => { button(r, "Use my device location").props.onClick(); });
    await act(async () => { input(r, "loc-lat").props.onChange({ target: { value: "28.7" } }); });
    await act(async () => { button(r, "Send for review").props.onClick(); });
    await flush();
    expect(JSON.parse(calls.find((c) => c.opts?.method === "PATCH").opts.body).source).toBe("MANUAL");
  });

  it("explains a blocked or failed device location and leaves typing available", async () => {
    install();
    globalThis.navigator = { geolocation: { getCurrentPosition: jest.fn((_ok, fail) => fail({ code: 1 })) } };
    const r = await mount();
    await act(async () => { button(r, "Use my device location").props.onClick(); });
    expect(text(r)).toContain("blocked");
    expect(input(r, "loc-lat").props.value).toBe("");
  });

  it("says so when the browser cannot share a location", async () => {
    install();
    globalThis.navigator = {};
    const r = await mount();
    await act(async () => { button(r, "Use my device location").props.onClick(); });
    expect(text(r)).toContain("cannot share a location");
  });

  it("shows the server's message when the proposal is refused and claims nothing was saved", async () => {
    install({ patch: () => { throw new ApiError("Another proposal was just decided.", 409); } });
    const r = await mount();
    await act(async () => { input(r, "loc-lat").props.onChange({ target: { value: "28.6" } }); });
    await act(async () => { input(r, "loc-lng").props.onChange({ target: { value: "77.2" } }); });
    await act(async () => { button(r, "Send for review").props.onClick(); });
    await flush();
    expect(text(r)).toContain("Another proposal was just decided.");
    expect(text(r)).not.toContain("Sent for review");
  });

  it("reloads after sending so the waiting proposal appears", async () => {
    install();
    const r = await mount();
    await act(async () => { input(r, "loc-lat").props.onChange({ target: { value: "28.61" } }); });
    await act(async () => { input(r, "loc-lng").props.onChange({ target: { value: "77.2" } }); });
    answer = PENDING;
    await act(async () => { button(r, "Send for review").props.onClick(); });
    await flush();
    expect(text(r)).toContain("Your proposal");
    expect(text(r)).toContain("Waiting for review");
  });
});
