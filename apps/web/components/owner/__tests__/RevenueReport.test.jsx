import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { RevenueReport } from "../RevenueReport";
import { apiFetch } from "../../../lib/api";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href }) => <a href={href}>{children}</a> }));
jest.mock("../../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

const collect = (node) => (node == null ? "" : typeof node === "string" ? node : Array.isArray(node) ? node.map(collect).join(" ") : collect(node.children));
const text = (r) => collect(r.toJSON());
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

const pay = (recordedAt, amount, kind = "PAYMENT") => ({ id: recordedAt + amount, invoiceId: "i1", invoiceNumber: "INV-1", customerName: "Asha", kind, method: "CASH", amount, reference: null, note: null, recordedAt, recordedBy: "Owner" });

function analytics(over = {}) {
  return {
    from: "x", to: "y", currency: "INR", completedCount: 0, estimatedServiceValue: 750,
    dailyServiceValue: [{ date: "2026-10-12", completedCount: 3, estimatedServiceValue: 750 }],
    serviceValue: [{ serviceId: "s1", name: "Haircut", completedCount: 2, estimatedServiceValue: 500 }, { serviceId: "s2", name: "Beard Trim", completedCount: 1, estimatedServiceValue: 250 }],
    barberValue: [{ staffId: "b1", displayName: "Arjun", completedSessions: 3, estimatedServiceValue: 750 }],
    sourceMix: { bookingCompletedCount: 1, walkInCompletedCount: 2 },
    ...over,
  };
}

function paymentsPage(items, nextCursor = null) {
  return { from: "a", to: "b", currency: "INR", items, nextCursor, totals: { received: 500, refunded: 50, net: 450, count: items.length }, byMethod: [{ method: "CASH", net: 450 }] };
}

function install({ timezone = "Asia/Kolkata", paymentPages, analyticsData = analytics() } = {}) {
  const pages = paymentPages ?? [paymentsPage([pay("2026-10-12T06:00:00Z", 500), pay("2026-10-12T08:00:00Z", 50, "REFUND")])];
  let call = 0;
  apiFetch.mockImplementation(async (path) => {
    if (path.endsWith("/timezone")) return { id: "s1", timezone, countryCode: "IN" };
    if (path.includes("/analytics?")) return analyticsData;
    if (path.includes("/payments?")) {
      const page = pages[Math.min(call, pages.length - 1)];
      call += 1;
      if (page instanceof Error) throw page;
      return page;
    }
    throw new Error(`unexpected ${path}`);
  });
}

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<RevenueReport salonId="s1" />); });
  await flush();
  await flush();
  return r;
}

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); });

describe("RevenueReport", () => {
  it("asks the owner to set the timezone instead of guessing dates", async () => {
    install({ timezone: null });
    const r = await mount();
    expect(text(r)).toContain("no timezone");
    expect(JSON.stringify(r.toJSON())).toContain("/dashboard/salons/s1/settings");
    expect(apiFetch.mock.calls.some(([p]) => p.includes("/analytics?"))).toBe(false);
  });

  it("loads the last 30 days with the server's totals, keeping collected and estimated apart", async () => {
    install();
    const r = await mount();
    const t = text(r);
    expect(t).toContain("Collected");
    expect(t).toContain("₹500");
    expect(t).toContain("₹450");
    expect(t).toContain("Estimated service value");
    expect(t).toContain("₹750");
    expect(t).toMatch(/Cash\s+\(net\)/);
    // Three completed services (1 booked + 2 walk-in), taken from the source mix, not the bookings-only counter.
    expect(t).toMatch(/Completed services\s+3/);
  });

  it("asks analytics for exact shop-local instants and payments for shop-local dates", async () => {
    install();
    await mount();
    const analyticsCall = apiFetch.mock.calls.find(([p]) => p.includes("/analytics?"))[0];
    const params = new URLSearchParams(analyticsCall.split("?")[1]);
    expect(params.get("range")).toBe("custom");
    expect(params.get("from")).toMatch(/T18:30:00\.000Z$/); // IST midnight
    expect(params.get("to")).toMatch(/T18:30:00\.000Z$/);
    const payCall = apiFetch.mock.calls.find(([p]) => p.includes("/payments?"))[0];
    const pp = new URLSearchParams(payCall.split("?")[1]);
    expect(pp.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(pp.get("limit")).toBe("100");
  });

  it("hides daily collected figures and says why when the payments could not all be loaded", async () => {
    install({ paymentPages: [paymentsPage([pay("2026-10-12T06:00:00Z", 500)], "next"), new Error("page 2 failed")] });
    const r = await mount();
    const t = text(r);
    expect(t).toContain("more payments than could be loaded");
    expect(t).toContain("₹500"); // the server's whole-range total is still shown
    expect(r.root.findAllByType("button").filter((b) => /Download/.test(collect(b.props.children))).every((b) => b.props.disabled)).toBe(true);
  });

  it("shows an honest empty state when no service was completed", async () => {
    install({ analyticsData: analytics({ serviceValue: [], barberValue: [], dailyServiceValue: [], estimatedServiceValue: 0, sourceMix: { bookingCompletedCount: 0, walkInCompletedCount: 0 } }), paymentPages: [paymentsPage([])] });
    const r = await mount();
    expect(text(r)).toContain("No completed services in this range");
  });

  it("refuses an over-long range with a clear message and sends no new request", async () => {
    install();
    const r = await mount();
    const before = apiFetch.mock.calls.length;
    const from = r.root.findByProps({ id: "rep-from" });
    await act(async () => { from.props.onChange({ target: { value: "2020-01-01" } }); });
    const show = r.root.findAllByType("button").find((b) => /Show report/.test(collect(b.props.children)));
    await act(async () => { show.props.onClick(); });
    expect(text(r)).toContain("at most 366 days");
    expect(apiFetch.mock.calls.length).toBe(before);
  });

  it("filters the service table by name", async () => {
    install();
    const r = await mount();
    const search = r.root.findByProps({ id: "rep-service-search" });
    await act(async () => { search.props.onChange({ target: { value: "beard" } }); });
    const t = text(r);
    expect(t).toContain("Beard Trim");
    expect(t).not.toContain("Classic Haircut");
    const serviceRows = r.root.findAllByType("tr").map((tr) => collect(tr.props.children));
    expect(serviceRows.some((row) => row.includes("Haircut ") && row.includes("₹500"))).toBe(false);
  });

  it("states what is not available yet instead of inventing it", async () => {
    install();
    const r = await mount();
    expect(text(r)).toContain("Revenue by customer, discounts given, and revenue by booking source");
  });
});
