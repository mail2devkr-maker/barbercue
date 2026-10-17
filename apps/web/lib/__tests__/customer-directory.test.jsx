import { filterCustomers, loadCustomerPages, repeatVisits, segmentCounts, serverSearchTerm, sortCustomers } from "../customer-directory";

const c = (id, over = {}) => ({
  customerId: id, phone: null, email: null, completedCount: 0, firstVisitAt: null, lastVisitAt: null,
  preferredServiceName: null, preferredStaffName: null, segment: null, outstandingTotalAmount: 0, ...over,
});

const rows = [
  c("a", { phone: "+91 98765 43210", completedCount: 5, segment: "frequent", firstVisitAt: "2026-01-10T00:00:00Z", lastVisitAt: "2026-10-10T00:00:00Z", preferredServiceName: "Classic Haircut", preferredStaffName: "Arjun" }),
  c("b", { phone: "9123456780", completedCount: 2, segment: "repeat", firstVisitAt: "2026-05-01T00:00:00Z", lastVisitAt: "2026-10-15T00:00:00Z", outstandingTotalAmount: 150 }),
  c("c", { email: "Meera@Example.com", completedCount: 1, segment: "new", firstVisitAt: "2026-10-01T00:00:00Z", lastVisitAt: "2026-10-01T00:00:00Z" }),
  c("d", { phone: "+44 7700 900123", completedCount: 0 }),
];

describe("repeatVisits", () => {
  it("counts completed visits after the first, never below zero", () => {
    expect(repeatVisits({ completedCount: 5 })).toBe(4);
    expect(repeatVisits({ completedCount: 1 })).toBe(0);
    expect(repeatVisits({ completedCount: 0 })).toBe(0);
  });
});

describe("serverSearchTerm", () => {
  it("reduces a typed phone number to digits so any format finds the stored number", () => {
    for (const q of ["9876543210", "98765 43210", "+91-98765-43210", "(987) 654.3210"]) expect(serverSearchTerm(q)).toMatch(/^\d+$/);
    expect(serverSearchTerm("+91-98765-43210")).toBe("919876543210");
  });
  it("sends text such as an email as typed, trimmed", () => {
    expect(serverSearchTerm("  Meera@Example.com ")).toBe("Meera@Example.com");
  });
  it("does not search for one keystroke or for fewer than 3 digits", () => {
    expect(serverSearchTerm("")).toBeNull();
    expect(serverSearchTerm("a")).toBeNull();
    expect(serverSearchTerm("98")).toBeNull();
    expect(serverSearchTerm("+9")).toBeNull();
    expect(serverSearchTerm("987")).toBe("987");
  });
  it("never sends more than the server accepts", () => {
    expect(serverSearchTerm("x".repeat(300))).toHaveLength(120);
    expect(serverSearchTerm("1".repeat(300))).toHaveLength(120);
  });
});

describe("filterCustomers and segmentCounts", () => {
  it("filters by segment and by dues", () => {
    expect(filterCustomers(rows, "frequent").map((r) => r.customerId)).toEqual(["a"]);
    expect(filterCustomers(rows, "dues").map((r) => r.customerId)).toEqual(["b"]);
    expect(filterCustomers(rows, "all")).toHaveLength(4);
  });
  it("counts each chip among the loaded rows", () => {
    expect(segmentCounts(rows)).toEqual({ all: 4, new: 1, repeat: 1, frequent: 1, dues: 1 });
    expect(segmentCounts([])).toEqual({ all: 0, new: 0, repeat: 0, frequent: 0, dues: 0 });
  });
  it("does not change the input", () => {
    const copy = JSON.stringify(rows);
    filterCustomers(rows, "all");
    expect(JSON.stringify(rows)).toBe(copy);
  });
});

describe("sortCustomers", () => {
  it("sorts by most recent visit with customers who never visited last", () => {
    expect(sortCustomers(rows, "lastVisit").map((r) => r.customerId)).toEqual(["b", "a", "c", "d"]);
  });
  it("sorts by most completed visits, keeping the server order on ties", () => {
    const tied = [c("x", { completedCount: 2 }), c("y", { completedCount: 2 }), c("z", { completedCount: 3 })];
    expect(sortCustomers(tied, "mostVisits").map((r) => r.customerId)).toEqual(["z", "x", "y"]);
  });
  it("sorts by longest-standing (earliest first visit), unknown last", () => {
    expect(sortCustomers(rows, "firstVisit").map((r) => r.customerId)).toEqual(["a", "b", "c", "d"]);
  });
  it("ignores a malformed date instead of crashing", () => {
    expect(sortCustomers([c("p", { lastVisitAt: "not a date" }), c("q", { lastVisitAt: "2026-01-01T00:00:00Z" })], "lastVisit").map((r) => r.customerId)).toEqual(["q", "p"]);
  });
});

describe("loadCustomerPages", () => {
  const page = (ids, nextCursor) => ({ items: ids.map((i) => c(i)), nextCursor });
  it("follows the offset cursor to the end", async () => {
    const fetchPage = jest.fn(async (cursor) => (cursor === undefined ? page(["1", "2"], "2") : page(["3"], null)));
    const result = await loadCustomerPages(fetchPage);
    expect(result.items.map((r) => r.customerId)).toEqual(["1", "2", "3"]);
    expect(result.nextCursor).toBeNull();
  });
  it("stops at the page cap and returns the cursor to continue from", async () => {
    const fetchPage = jest.fn(async (cursor) => page(["x"], String((Number(cursor ?? 0)) + 1)));
    const result = await loadCustomerPages(fetchPage, undefined, 3);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).toBe("3");
  });
  it("keeps what loaded and the failing cursor when a later page fails", async () => {
    const fetchPage = jest.fn(async (cursor) => { if (cursor === "2") throw new Error("boom"); return page(["1", "2"], "2"); });
    const result = await loadCustomerPages(fetchPage);
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe("2");
  });
  it("throws when the first page fails", async () => {
    await expect(loadCustomerPages(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  });
  it("can continue from a given cursor", async () => {
    const fetchPage = jest.fn(async () => page(["9"], null));
    await loadCustomerPages(fetchPage, "100");
    expect(fetchPage).toHaveBeenCalledWith("100");
  });
});
