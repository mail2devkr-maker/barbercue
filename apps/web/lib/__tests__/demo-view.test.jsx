// Reading the Demo Workspace dataset (Codex PR #252): defensive parsing and display helpers. Amounts are simulated minor units.
import * as D from "../demo-workspace";

const DATASET = {
  schemaVersion: 1,
  banner: "DEMO DATA — Not real business records",
  generatedAt: "2026-10-17T06:00:00.000Z",
  timezone: "Asia/Kolkata",
  currency: "INR",
  counts: { customers: 1, staff: 1, chairs: 1, services: 1, visits: 1, bookings: 1, invoices: 1, reviews: 1 },
  customers: [{ id: "c1", name: "Demo Customer", email: "demo.c1@example.test", phone: null, firstVisitAt: "2026-09-01T05:00:00.000Z", lastVisitAt: "2026-10-10T05:00:00.000Z", visitCount: 3 }],
  staff: [{ id: "st1", name: "Demo Barber", role: "BARBER", serviceIds: ["sv1"] }],
  chairs: [{ id: "ch1", label: "Chair 1", status: "AVAILABLE" }],
  services: [{ id: "sv1", name: "Haircut", category: "Hair", durationMinutes: 30, listPriceMinor: 25000 }],
  visits: [{ id: "v1", source: "LIVE_QUEUE", status: "COMPLETED", customerId: "c1", customerName: "Demo Customer", serviceId: "sv1", staffId: "st1", chairId: "ch1", joinedAt: "2026-10-10T05:00:00.000Z", completedAt: "2026-10-10T05:30:00.000Z", estimatedValueMinor: 25000, simulatedCollectionMinor: 25000, paymentProjection: "SIMULATED_ONLY" }],
  bookings: [{ id: "b1", source: "FASTQUE_WEB", status: "CONFIRMED", customerId: "c1", serviceIds: ["sv1"], slotStart: "2026-10-20T05:00:00.000Z", slotEnd: "2026-10-20T05:30:00.000Z", linkedQueueVisitId: null }],
  invoices: [{ id: "i1", status: "PAID", totalMinor: 25000, simulatedCollectionProjectionMinor: 25000, isRecordedPayment: false }],
  reviews: [{ id: "r1", customerName: "Demo Customer", rating: 5, comment: "Great" }],
  revenue: {
    disclaimer: "Simulated",
    daily: [{ date: "2026-10-10", estimatedValueMinor: 25000, collectionProjectionMinor: 25000 }],
    weekly: [{ weekStarting: "2026-10-05", estimatedValueMinor: 25000, collectionProjectionMinor: 25000 }],
    monthly: [{ month: "2026-10", estimatedValueMinor: 25000, collectionProjectionMinor: 25000 }],
    byService: [{ serviceId: "sv1", completedVisits: 1, estimatedValueMinor: 25000, collectionProjectionMinor: 25000 }],
    byStaff: [{ staffId: "st1", completedVisits: 1, estimatedValueMinor: 25000, collectionProjectionMinor: 25000 }],
    byCustomer: [{ customerId: "c1", completedVisits: 1, estimatedValueMinor: 25000, collectionProjectionMinor: 25000 }],
  },
};

describe("parseDemoView", () => {
  it("reads the workspace read answer into plain lists and series", () => {
    const v = D.parseDemoView({ workspaceId: "w1", salonId: "s1", label: "DEMO DATA", dataset: DATASET });
    expect(v.workspaceId).toBe("w1");
    expect(v.currency).toBe("INR");
    expect(v.customers).toHaveLength(1);
    expect(v.visits[0].estimatedValueMinor).toBe(25000);
    expect(v.revenue.weekly).toEqual([{ label: "2026-10-05", estimated: 25000, collection: 25000 }]);
    expect(v.revenue.byStaff[0]).toEqual({ id: "st1", completedVisits: 1, estimatedValueMinor: 25000, collectionProjectionMinor: 25000 });
    expect(v.counts.chairs).toBe(1);
  });

  it("returns null unless the answer names a workspace and has a dataset", () => {
    for (const raw of [null, {}, { workspaceId: "w1" }, { workspaceId: "", dataset: {} }, { dataset: {} }, "x", []]) expect(D.parseDemoView(raw)).toBeNull();
  });

  it("tolerates a sparse dataset without inventing rows", () => {
    const v = D.parseDemoView({ workspaceId: "w1", dataset: { customers: "nope", revenue: null } });
    expect(v.customers).toEqual([]);
    expect(v.revenue.daily).toEqual([]);
    expect(v.currency).toBe("");
  });
});

describe("demo display helpers", () => {
  it("shows whole minor units as money", () => {
    expect(D.minorText(25000, "INR")).toBe("₹250");
    expect(D.minorText(12550, "INR")).toBe("₹125.50");
    expect(D.minorText(500, "USD")).toBe("USD 5");
    expect(D.minorText(500, "")).toBe("5");
  });

  it("names ids from the dataset and says Unknown rather than guessing", () => {
    const list = [{ id: "a", name: "Asha" }];
    expect(D.nameOf(list, "a")).toBe("Asha");
    expect(D.nameOf(list, "zzz")).toBe("Unknown");
    expect(D.nameOf(list, null)).toBe("Not assigned");
  });

  it("labels simulated payment states as simulated", () => {
    expect(D.statusWord("PAID")).toContain("simulated");
    expect(D.statusWord("NO_SHOW")).toBe("No-show");
    expect(D.statusWord("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("turns a series into chart points in major units", () => {
    expect(D.chartPoints([{ label: "a", estimated: 25000, collection: 5000 }], "collection")).toEqual([{ label: "a", value: 50 }]);
  });

  it("carries the demo banner text", () => {
    expect(D.DEMO_BANNER).toBe("DEMO DATA — NOT REAL BUSINESS RECORDS");
  });
});
