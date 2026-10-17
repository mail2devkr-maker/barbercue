import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { DemoDashboard } from "../DemoDashboard";
import { apiFetch } from "../../../lib/api";
import { resetCapabilitiesCache } from "../../../lib/use-capabilities";

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
const tab = (r, label) => r.root.findAll((n) => n.type === "button" && n.props.role === "tab" && collect(n.props.children).trim().startsWith(label))[0];

const DATASET = {
  schemaVersion: 1,
  banner: "DEMO DATA — Not real business records",
  generatedAt: "2026-10-17T06:00:00.000Z",
  timezone: "Asia/Kolkata",
  currency: "INR",
  counts: { customers: 1, staff: 1, chairs: 1, services: 1, visits: 2, bookings: 1, invoices: 1, reviews: 1 },
  customers: [{ id: "c1", name: "Demo Customer", email: "demo.c1@example.test", phone: null, firstVisitAt: "2026-09-01T05:00:00.000Z", lastVisitAt: "2026-10-10T05:00:00.000Z", visitCount: 3 }],
  staff: [{ id: "st1", name: "Demo Barber", role: "BARBER", serviceIds: ["sv1"] }],
  chairs: [{ id: "ch1", label: "Chair 1", status: "OCCUPIED" }],
  services: [{ id: "sv1", name: "Haircut", category: "Hair", durationMinutes: 30, listPriceMinor: 25000 }],
  visits: [
    { id: "v1", source: "LIVE_QUEUE", status: "COMPLETED", customerId: "c1", customerName: "Demo Customer", serviceId: "sv1", staffId: "st1", chairId: "ch1", joinedAt: "2026-10-10T05:00:00.000Z", completedAt: "2026-10-10T05:30:00.000Z", estimatedValueMinor: 25000, simulatedCollectionMinor: 20000, paymentProjection: "SIMULATED_ONLY" },
    { id: "v2", source: "LIVE_QUEUE", status: "NO_SHOW", customerId: null, customerName: "Demo Visitor", serviceId: "sv-gone", staffId: null, chairId: null, joinedAt: "2026-10-11T05:00:00.000Z", completedAt: null, estimatedValueMinor: 0, simulatedCollectionMinor: 0, paymentProjection: "SIMULATED_ONLY" },
  ],
  bookings: [{ id: "b1", source: "FASTQUE_WEB", status: "CONFIRMED", customerId: "c1", serviceIds: ["sv1"], slotStart: "2026-10-20T05:00:00.000Z", slotEnd: "2026-10-20T05:30:00.000Z", linkedQueueVisitId: null }],
  invoices: [{ id: "i1", status: "PARTIALLY_PAID", totalMinor: 25000, simulatedCollectionProjectionMinor: 10000, isRecordedPayment: false }],
  reviews: [{ id: "r1", customerName: "Demo Customer", rating: 4, comment: "Nice cut" }],
  revenue: {
    disclaimer: "Simulated",
    daily: [{ date: "2026-10-10", estimatedValueMinor: 25000, collectionProjectionMinor: 20000 }],
    weekly: [{ weekStarting: "2026-10-05", estimatedValueMinor: 25000, collectionProjectionMinor: 20000 }],
    monthly: [{ month: "2026-10", estimatedValueMinor: 25000, collectionProjectionMinor: 20000 }],
    byService: [{ serviceId: "sv1", completedVisits: 1, estimatedValueMinor: 25000, collectionProjectionMinor: 20000 }],
    byStaff: [{ staffId: "st1", completedVisits: 1, estimatedValueMinor: 25000, collectionProjectionMinor: 20000 }],
    byCustomer: [{ customerId: "c1", completedVisits: 1, estimatedValueMinor: 25000, collectionProjectionMinor: 20000 }],
  },
};

let calls;
function install({ capability = { status: "SANDBOX" }, status = { active: true, workspaceId: "w1", label: "DEMO DATA — Not real business records" }, read } = {}) {
  calls = [];
  apiFetch.mockImplementation(async (path, opts) => {
    calls.push({ path, opts });
    if (path.endsWith("/capabilities")) return capability ? { features: { demoData: capability } } : { features: {} };
    if (path.endsWith("/demo/status")) return status;
    if (path.includes("/demo/workspaces/")) return read ? read() : { workspaceId: "w1", salonId: "s1", label: "DEMO DATA — Not real business records", dataset: DATASET };
    throw new Error(`unexpected ${path}`);
  });
}

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<DemoDashboard salonId="s1" />); });
  await flush();
  await flush();
  return r;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  resetCapabilitiesCache();
});

describe("DemoDashboard", () => {
  it("is unavailable and reads no demo data when the capability is off", async () => {
    install({ capability: { status: "DISABLED", reasonCode: "FEATURE_DISABLED" } });
    const r = await mount();
    expect(text(r)).toContain("Demo data is not available yet");
    expect(calls.some((c) => c.path.includes("/demo/"))).toBe(false);
  });

  it("shows the demo banner and a way back, reading only the demo workspace routes", async () => {
    install();
    const r = await mount();
    const t = text(r);
    expect(t).toContain("DEMO DATA — NOT REAL BUSINESS RECORDS");
    expect(t).toContain("simulated projection");
    expect(t).toContain("Back to real shop");
    expect(r.root.findAll((n) => n.props?.href === "/dashboard/salons/s1").length).toBeGreaterThan(0);
    const demoPaths = calls.filter((c) => !c.path.endsWith("/capabilities")).map((c) => c.path);
    expect(demoPaths).toEqual(["dashboard/salons/s1/demo/status", "dashboard/salons/s1/demo/workspaces/w1"]);
    expect(calls.every((c) => !c.opts?.method || c.opts.method === "GET")).toBe(true);
  });

  it("keeps the demo banner on every tab", async () => {
    install();
    const r = await mount();
    for (const name of ["Overview", "Revenue", "Customers", "Bookings", "Live Queue", "Services", "Staff and chairs", "Invoices", "Reviews"]) {
      await act(async () => { tab(r, name).props.onClick(); });
      expect(text(r)).toContain("DEMO DATA — NOT REAL BUSINESS RECORDS");
      // The persistent pill is fixed to the viewport (see owner.module.css), so it is still visible deep inside a long tab.
      const pills = r.root.findAll((n) => n.props?.["data-testid"] === "demo-pill" && typeof n.type === "string");
      expect(pills).toHaveLength(1);
      expect(collect(pills[0].children)).toContain("DEMO DATA — NOT REAL BUSINESS RECORDS");
    }
  });

  it("shows overview figures labelled as demo and simulated", async () => {
    install();
    const r = await mount();
    const t = text(r);
    expect(t).toContain("Customers (demo)");
    expect(t).toContain("Estimated value (simulated)");
    expect(t).toContain("₹250");
    expect(t).toContain("Simulated collection ₹200");
    expect(t).toContain("4.0");
  });

  it("switches revenue between daily, weekly and monthly and names breakdown rows from the dataset", async () => {
    install();
    const r = await mount();
    await act(async () => { tab(r, "Revenue").props.onClick(); });
    expect(JSON.stringify(r.toJSON())).toContain("Simulated estimated value per day");
    await act(async () => { tab(r, "Weekly").props.onClick(); });
    expect(JSON.stringify(r.toJSON())).toContain("Simulated estimated value per week");
    await act(async () => { tab(r, "Monthly").props.onClick(); });
    expect(JSON.stringify(r.toJSON())).toContain("Simulated estimated value per month");
    const t = text(r);
    expect(t).toContain("Haircut");
    expect(t).toContain("Demo Barber");
    expect(t).toContain("Demo Customer");
  });

  it("lists visits with Live Queue wording, and an unlisted service stays Unknown", async () => {
    install();
    const r = await mount();
    await act(async () => { tab(r, "Live Queue").props.onClick(); });
    const t = text(r);
    expect(t).toContain("Live Queue visits");
    expect(t).not.toMatch(/walk-in/i);
    expect(t).toContain("Unknown");
    expect(t).toContain("No-show");
    expect(t).toContain("Not assigned");
  });

  it("marks invoice states as simulated and never calls them recorded payments", async () => {
    install();
    const r = await mount();
    await act(async () => { tab(r, "Invoices").props.onClick(); });
    const t = text(r);
    expect(t).toContain("Part paid (simulated)");
    expect(t).toContain("None of them records a real payment");
  });

  it("shows an empty state, not a dashboard, when there is no demo data", async () => {
    install({ status: { active: false, workspaceId: null, label: "DEMO" } });
    const r = await mount();
    expect(text(r)).toContain("You have no demo data right now");
    expect(text(r)).toContain("DEMO DATA — NOT REAL BUSINESS RECORDS");
    expect(calls.some((c) => c.path.includes("/demo/workspaces/"))).toBe(false);
  });

  it("shows an honest error, not an invented dashboard, for an unreadable answer", async () => {
    install({ read: () => ({ nothing: true }) });
    const r = await mount();
    expect(text(r)).toContain("cannot read");
    expect(text(r)).not.toContain("Customers (demo)");
  });
});
