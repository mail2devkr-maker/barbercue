import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { CustomerAssistant } from "../CustomerAssistant";
import { apiFetch, ApiError } from "../../../lib/api";
import { localToday } from "../../../lib/customer-assistant";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));
jest.mock("../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(status, body) {
      super(body?.error?.message ?? "Request failed");
      this.status = status;
      this.code = body?.error?.code ?? "UNKNOWN_ERROR";
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
const byId = (r, id) => r.root.findByProps({ id });
const setValue = async (r, id, value) => { await act(async () => { byId(r, id).props.onChange({ target: { value } }); }); };
const submit = async (r) => { await act(async () => { r.root.findByType("form").props.onSubmit({ preventDefault() {} }); }); await flush(); };
const button = (r, label) => r.root.findAllByType("button").find((b) => new RegExp(label).test(collect(b.props.children)));
const links = (r) => r.root.findAllByType("a").map((a) => ({ href: a.props.href, label: collect(a.props.children) }));

const candidate = (over = {}) => ({
  salon: { id: "s1", publicId: "BC-SHOP-000001", name: "Example Salon", slug: "example-salon", citySlug: "hajipur", countryCode: "IN", distanceKm: 2.4 },
  service: { id: "svc-1", name: "Haircut", category: "Hair", price: 250, durationMinutes: 30 },
  currency: "INR", timeZone: "Asia/Kolkata",
  availableSlots: [{ slotStart: "2026-10-22T03:30:00.000Z", slotEnd: "2026-10-22T04:00:00.000Z" }, { slotStart: "2026-10-22T04:30:00.000Z", slotEnd: "2026-10-22T05:00:00.000Z" }], ...over,
});
const reply = (cands = [candidate()]) => ({ mode: "DETERMINISTIC_CATALOG_AVAILABILITY", generated: false, bookingConfirmationRequired: true, date: "2026-10-22", candidates: cands });

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<CustomerAssistant />); });
  return r;
}
async function fill(r, over = {}) {
  await setValue(r, "ca-service", over.service ?? "haircut");
  if (over.city !== null) await setValue(r, "ca-city", over.city ?? "Hajipur");
}

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => {
  if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
  else delete globalThis.navigator;
});
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  apiFetch.mockReset();
});

describe("CustomerAssistant", () => {
  it("says plainly that it is a search, not a chat, not AI, not a booking", async () => {
    const r = await mount();
    expect(text(r)).toMatch(/not a chat and not AI/);
    expect(text(r)).toMatch(/Nothing is booked or paid until you confirm/);
    expect(text(r)).toMatch(/not held for you/);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("sends exactly the validated public request for a city search", async () => {
    apiFetch.mockResolvedValue(reply());
    const r = await mount();
    await fill(r);
    await submit(r);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, options] = apiFetch.mock.calls[0];
    expect(path).toBe("assistant/search");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ serviceQuery: "haircut", date: localToday(), city: "hajipur", limit: 3 });
  });

  it("shows each shop with price, duration, distance and open times in the SHOP's time zone, and links to booking with only the service", async () => {
    apiFetch.mockResolvedValue(reply());
    const r = await mount();
    await fill(r);
    await submit(r);
    const t = text(r);
    expect(t).toMatch(/Example Salon/);
    expect(t).toMatch(/Haircut/);
    expect(t).toMatch(/Hair/);
    expect(t).toMatch(/250/);
    expect(t).toMatch(/30 min/);
    expect(t).toMatch(/2\.4 km away/);
    expect(t).toMatch(/9:00\s?am/i);
    expect(t).toMatch(/10:00\s?am/i);
    expect(t).toMatch(/1 shop for/);
    expect(links(r)).toEqual([{ href: "/book/example-salon?country=in&city=hajipur&serviceId=svc-1", label: "Choose a time at Example Salon" }]);
  });

  it("validates before sending and lists every problem", async () => {
    const r = await mount();
    await submit(r);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(text(r)).toMatch(/Type the service you want/);
    expect(text(r)).toMatch(/Enter your city, or use your location/);
    await setValue(r, "ca-date", "2000-01-01");
    await fill(r);
    await submit(r);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(text(r)).toMatch(/today or a later day/);
    await setValue(r, "ca-date", localToday());
    await setValue(r, "ca-price", "cheap");
    await submit(r);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(text(r)).toMatch(/as a number/);
  });

  it("includes a price ceiling and shop count when chosen", async () => {
    apiFetch.mockResolvedValue(reply());
    const r = await mount();
    await fill(r);
    await setValue(r, "ca-price", "400");
    await setValue(r, "ca-limit", "5");
    await submit(r);
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toMatchObject({ maxPrice: 400, limit: 5 });
  });

  it("says so, without promising anything, when nothing is open", async () => {
    apiFetch.mockResolvedValue(reply([]));
    const r = await mount();
    await fill(r);
    await submit(r);
    expect(text(r)).toMatch(/No shop has an open time for “haircut”/);
    expect(links(r)).toEqual([]);
  });

  it("offers no booking link for a shop with no open time left", async () => {
    apiFetch.mockResolvedValue(reply([candidate({ availableSlots: [] })]));
    const r = await mount();
    await fill(r);
    await submit(r);
    expect(text(r)).toMatch(/No open time is left at this shop/);
    expect(links(r)).toEqual([]);
  });

  it("hides the distance when the server sends none", async () => {
    apiFetch.mockResolvedValue(reply([candidate({ salon: { ...candidate().salon, distanceKm: null } })]));
    const r = await mount();
    await fill(r);
    await submit(r);
    expect(text(r)).not.toMatch(/km away/);
  });

  it("never sends one search twice while it is running", async () => {
    let resolve;
    apiFetch.mockImplementation(() => new Promise((res) => { resolve = res; }));
    const r = await mount();
    await fill(r);
    await submit(r);
    await submit(r);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(button(r, "Searching")).toBeTruthy();
    await act(async () => { resolve(reply()); });
    await flush();
    expect(text(r)).toMatch(/Example Salon/);
  });

  it.each([
    [429, /5 a minute/],
    [400, /not accepted/],
    [0, /offline/],
    [500, /Nothing was booked/],
  ])("explains a %s failure and drops the previous results", async (status, pattern) => {
    apiFetch.mockResolvedValueOnce(reply());
    const r = await mount();
    await fill(r);
    await submit(r);
    expect(text(r)).toMatch(/Example Salon/);
    apiFetch.mockRejectedValueOnce(new ApiError(status, { error: { code: status === 400 ? "VALIDATION_ERROR" : "X", message: "m" } }));
    await submit(r);
    expect(text(r)).toMatch(pattern);
    expect(text(r)).not.toMatch(/Example Salon/);
  });

  it("treats a reply that is generated or malformed as a failure, never as results", async () => {
    apiFetch.mockResolvedValue({ ...reply(), generated: true });
    const r = await mount();
    await fill(r);
    await submit(r);
    expect(text(r)).toMatch(/could not be completed right now/);
    expect(text(r)).not.toMatch(/Example Salon/);
  });

  it("uses an approximate location (about 100 m) when the customer shares it, with no city", async () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: 25.69187, longitude: 85.21212 } }) } } });
    apiFetch.mockResolvedValue(reply());
    const r = await mount();
    await setValue(r, "ca-service", "haircut");
    await act(async () => { button(r, "Use my location").props.onClick(); });
    expect(text(r)).toMatch(/Using your location/);
    await submit(r);
    const body = JSON.parse(apiFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ lat: 25.692, lng: 85.212, radiusKm: 25 });
    expect(body.city).toBeUndefined();
  });

  it("falls back to the city box when location is refused, unsupported, or cleared", async () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) } } });
    let r = await mount();
    await act(async () => { button(r, "Use my location").props.onClick(); });
    expect(text(r)).toMatch(/Location was not shared/);
    expect(byId(r, "ca-city")).toBeTruthy();

    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    r = await mount();
    await act(async () => { button(r, "Use my location").props.onClick(); });
    expect(text(r)).toMatch(/cannot share a location/);

    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: 1, longitude: 2 } }) } } });
    r = await mount();
    await act(async () => { button(r, "Use my location").props.onClick(); });
    await act(async () => { button(r, "Use a city instead").props.onClick(); });
    expect(byId(r, "ca-city")).toBeTruthy();
  });
});
