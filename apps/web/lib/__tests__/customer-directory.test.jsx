import { filterCustomers, loadCustomerPages, matchesSearch, repeatVisits, segmentCounts, sortCustomers } from "../customer-directory";

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

describe("matchesSearch", () => {
  it("finds a phone number however it is typed or stored", () => {
    for (const q of ["9876543210", "98765 43210", "+91-98765-43210", "98765", "43210"]) expect(matchesSearch(rows[0], q)).toBe(true);
    expect(matchesSearch(rows[1], "98765")).toBe(false);
  });
  it("needs at least 3 digits for a digit match so one digit does not match every number", () => {
    expect(matchesSearch(rows[0], "9")).toBe(true); // falls back to text match on the stored phone text, which contains a 9
    expect(matchesSearch(rows[3], "98")).toBe(false);
  });
  it("matches email, usual service and usual barber case-insensitively", () => {
    expect(matchesSearch(rows[2], "MEERA")).toBe(true);
    expect(matchesSearch(rows[0], "haircut")).toBe(true);
    expect(matchesSearch(rows[0], "arjun")).toBe(true);
    expect(matchesSearch(rows[0], "meera")).toBe(false);
  });
  it("an empty or blank search matches everyone", () => {
    expect(rows.every((r) => matchesSearch(r, "  "))).toBe(true);
  });
});

describe("filterCustomers and segmentCounts", () => {
  it("filters by segment and by dues", () => {
    expect(filterCustomers(rows, { search: "", segment: "frequent" }).map((r) => r.customerId)).toEqual(["a"]);
    expect(filterCustomers(rows, { search: "", segment: "dues" }).map((r) => r.customerId)).toEqual(["b"]);
    expect(filterCustomers(rows, { search: "", segment: "all" })).toHaveLength(4);
  });
  it("combines search and segment", () => {
    expect(filterCustomers(rows, { search: "haircut", segment: "frequent" }).map((r) => r.customerId)).toEqual(["a"]);
    expect(filterCustomers(rows, { search: "haircut", segment: "new" })).toEqual([]);
  });
  it("counts each chip among the rows that match the search", () => {
    expect(segmentCounts(rows, "")).toEqual({ all: 4, new: 1, repeat: 1, frequent: 1, dues: 1 });
    expect(segmentCounts(rows, "meera")).toEqual({ all: 1, new: 1, repeat: 0, frequent: 0, dues: 0 });
  });
  it("does not change the input", () => {
    const copy = JSON.stringify(rows);
    filterCustomers(rows, { search: "a", segment: "all" });
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
