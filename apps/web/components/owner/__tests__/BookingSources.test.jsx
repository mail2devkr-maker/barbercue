import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { BookingSources } from "../BookingSources";
import { apiFetch, ApiError } from "../../../lib/api";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href }) => <a href={href}>{children}</a> }));
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

const campaign = (over = {}) => ({
  id: "11111111-1111-4111-8111-111111111111", salonId: "s1", source: "FACEBOOK", label: "Diwali post", startsAt: null, endsAt: null,
  revokedAt: null, bookingCount: 4, createdAt: "2026-10-01T00:00:00.000Z", ...over,
});
const summary = (over = {}) => ({
  salonId: "s1", from: "2026-09-18", to: "2026-10-17", timezone: "Asia/Kolkata", asOf: "2026-10-17T10:00:00.000Z",
  bySource: [{ source: "FASTQUE_APP", bookingCount: 3 }, { source: "FACEBOOK", bookingCount: 4 }, { source: "UNKNOWN", bookingCount: 1 }],
  campaigns: [{ campaignId: "11111111-1111-4111-8111-111111111111", source: "FACEBOOK", label: "Diwali post", bookingCount: 4 }],
  ...over,
});

let calls;
function install({ timezone = "Asia/Kolkata", summaryResult = summary(), campaigns = [campaign()], nextCursor = null, onPost } = {}) {
  calls = [];
  apiFetch.mockImplementation(async (path, opts) => {
    calls.push({ path, opts });
    if (path.endsWith("/timezone")) return { id: "s1", timezone, countryCode: "IN" };
    if (path.includes("/booking-attribution/summary")) {
      if (summaryResult instanceof Error) throw summaryResult;
      return summaryResult;
    }
    if (path.includes("/booking-attribution/campaigns/") && path.endsWith("/revoke")) return onPost ? onPost(path, opts) : campaign({ revokedAt: "2026-10-17T00:00:00.000Z" });
    if (path.includes("/booking-attribution/campaigns") && opts?.method === "POST") return onPost ? onPost(path, opts) : { ...campaign({ id: "22222222-2222-4222-8222-222222222222", label: "Bio link" }), token: "T".repeat(43) };
    if (path.includes("/booking-attribution/campaigns")) return { items: campaigns, nextCursor };
    throw new Error(`unexpected ${path}`);
  });
}

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<BookingSources salonId="s1" />); });
  await flush();
  await flush();
  return r;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

describe("BookingSources", () => {
  it("asks for the shop timezone instead of guessing dates, and requests no summary", async () => {
    install({ timezone: null });
    const r = await mount();
    expect(text(r)).toContain("no timezone");
    expect(JSON.stringify(r.toJSON())).toContain("/dashboard/salons/s1/settings");
    expect(calls.some((c) => c.path.includes("/summary"))).toBe(false);
  });

  it("shows bookings by source in the owner's words, biggest first, and by campaign", async () => {
    install();
    const r = await mount();
    const summaryCall = calls.find((c) => c.path.includes("/summary")).path;
    expect(new URLSearchParams(summaryCall.split("?")[1]).get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const t = text(r);
    expect(t.indexOf("Facebook campaign")).toBeLessThan(t.indexOf("FastQue app"));
    expect(t).toContain("Not recorded");
    expect(t).toContain("Bookings by campaign link");
    expect(t).toContain("does not prove the customer was on that platform");
  });

  it("shows an honest empty state when no bookings came in", async () => {
    install({ summaryResult: summary({ bySource: [], campaigns: [] }) });
    const r = await mount();
    expect(text(r)).toContain("No bookings in this range");
  });

  it("shows a server error for the summary without hiding the campaign list", async () => {
    install({ summaryResult: new ApiError("Set your shop’s timezone before viewing attribution.", 422) });
    const r = await mount();
    expect(text(r)).toContain("Set your shop’s timezone");
    expect(text(r)).toContain("Diwali post");
  });

  it("refuses an over-long range with a message and sends no new request", async () => {
    install();
    const r = await mount();
    const before = calls.length;
    await act(async () => { r.root.findByProps({ id: "src-from" }).props.onChange({ target: { value: "2020-01-01" } }); });
    await act(async () => { button(r, "^\\s*Show\\s*$").props.onClick(); });
    expect(text(r)).toContain("at most 366 days");
    expect(calls.length).toBe(before);
  });

  it("lists campaigns with their status and booking counts", async () => {
    install({ campaigns: [campaign(), campaign({ id: "33333333-3333-4333-8333-333333333333", label: "Old post", revokedAt: "2026-09-01T00:00:00.000Z" })] });
    const r = await mount();
    const t = text(r);
    expect(t).toContain("Active");
    expect(t).toContain("Turned off");
    expect(t).toContain("Old post");
  });

  it("validates the form before sending anything", async () => {
    install();
    const r = await mount();
    const before = calls.length;
    await act(async () => { r.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    expect(text(r)).toContain("Give the campaign a name");
    expect(calls.length).toBe(before);
  });

  it("creates a campaign with the chosen window and shows the code once", async () => {
    install();
    const r = await mount();
    await act(async () => { r.root.findByProps({ id: "camp-source" }).props.onChange({ target: { value: "INSTAGRAM" } }); });
    await act(async () => { r.root.findByProps({ id: "camp-label" }).props.onChange({ target: { value: "Bio link" } }); });
    await act(async () => { r.root.findByProps({ id: "camp-first" }).props.onChange({ target: { value: "2026-10-12" } }); });
    await act(async () => { r.root.findByProps({ id: "camp-last" }).props.onChange({ target: { value: "2026-10-31" } }); });
    await act(async () => { r.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    await flush();
    const post = calls.find((c) => c.opts?.method === "POST");
    expect(post.path).toBe("dashboard/salons/s1/booking-attribution/campaigns");
    expect(JSON.parse(post.opts.body)).toEqual({ source: "INSTAGRAM", label: "Bio link", startsAt: "2026-10-11T18:30:00.000Z", endsAt: "2026-10-31T18:30:00.000Z" });
    expect(text(r)).toContain("shown only once");
    expect(r.root.findByProps({ "data-testid": "campaign-code" }).props.children).toBe("T".repeat(43));
    await act(async () => { button(r, "I have saved it").props.onClick(); });
    expect(text(r)).not.toContain("shown only once");
  });

  it("is honest that booking pages do not read the code from a link yet", async () => {
    install();
    const r = await mount();
    await act(async () => { r.root.findByProps({ id: "camp-label" }).props.onChange({ target: { value: "Bio link" } }); });
    await act(async () => { r.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    await flush();
    expect(text(r)).toContain("do not read the code from a link yet");
  });

  it("shows the server's message when creating fails and keeps no code on screen", async () => {
    install({ onPost: async () => { throw new ApiError("Campaign limit reached.", 409); } });
    const r = await mount();
    await act(async () => { r.root.findByProps({ id: "camp-label" }).props.onChange({ target: { value: "Bio link" } }); });
    await act(async () => { r.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    await flush();
    expect(text(r)).toContain("Campaign limit reached.");
    expect(r.root.findAllByProps({ "data-testid": "campaign-code" })).toHaveLength(0);
  });

  it("asks for confirmation before turning a campaign off, then updates the row", async () => {
    install();
    const r = await mount();
    await act(async () => { button(r, "Turn off").props.onClick(); });
    expect(calls.some((c) => c.path.endsWith("/revoke"))).toBe(false);
    await act(async () => { button(r, "Yes, turn off").props.onClick(); });
    await flush();
    expect(calls.find((c) => c.path.endsWith("/revoke")).opts.method).toBe("POST");
    expect(text(r)).toContain("Turned off");
    expect(button(r, "Turn off")).toBeUndefined();
  });

  it("keeps a campaign when the owner chooses Keep", async () => {
    install();
    const r = await mount();
    await act(async () => { button(r, "Turn off").props.onClick(); });
    await act(async () => { button(r, "Keep").props.onClick(); });
    expect(calls.some((c) => c.path.endsWith("/revoke"))).toBe(false);
    expect(button(r, "Turn off")).toBeTruthy();
  });

  it("loads more campaigns with the server's cursor", async () => {
    install({ nextCursor: "44444444-4444-4444-8444-444444444444" });
    const r = await mount();
    await act(async () => { button(r, "Load more").props.onClick(); });
    await flush();
    const more = calls.filter((c) => c.path.includes("/campaigns?")).at(-1).path;
    expect(new URLSearchParams(more.split("?")[1]).get("cursor")).toBe("44444444-4444-4444-8444-444444444444");
  });
});
