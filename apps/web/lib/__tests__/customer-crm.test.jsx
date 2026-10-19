// Pure rules of the owner Customers directory (Codex PR #265 contract FASTQUE_CUSTOMER_CRM_DIRECTORY_V1).
import * as C from "../customer-crm";

describe("directorySearchTerm", () => {
  it("sends nothing for fewer than two characters or a phone-like entry with fewer than three digits", () => {
    expect(C.directorySearchTerm("")).toBeNull();
    expect(C.directorySearchTerm(" a ")).toBeNull();
    expect(C.directorySearchTerm("+9")).toBeNull();
  });
  it("reduces a phone-like entry to its digits and keeps other text as typed", () => {
    expect(C.directorySearchTerm("+91-98765 43210")).toBe("919876543210");
    expect(C.directorySearchTerm("  asha@example.com ")).toBe("asha@example.com");
  });
  it("never sends more than the server's 120 characters", () => {
    expect(C.directorySearchTerm("x".repeat(300))).toHaveLength(120);
  });
});

describe("minimum visits", () => {
  it("accepts a whole number from 0 to 50,000 only", () => {
    expect(C.parseMinVisits("0")).toBe(0);
    expect(C.parseMinVisits(" 12 ")).toBe(12);
    expect(C.parseMinVisits("50000")).toBe(50000);
    for (const bad of ["", "50001", "-1", "1.5", "abc", "1e3", "123456"]) expect(C.parseMinVisits(bad)).toBeNull();
  });
  it("explains a bad value but not an empty one", () => {
    expect(C.minVisitsProblem("")).toBeNull();
    expect(C.minVisitsProblem("7")).toBeNull();
    expect(C.minVisitsProblem("x")).toContain("whole number");
  });
});

describe("directoryParams", () => {
  it("leaves out everything that is at its default", () => {
    expect(C.directoryParams(C.EMPTY_DIRECTORY_FILTER)).toEqual({ q: undefined, segment: undefined, sort: undefined, minVisits: undefined });
  });
  it("sends the chosen filters, and never an invalid minimum", () => {
    expect(C.directoryParams({ search: "asha", segment: "frequent", sort: "totalSpent", minVisits: "3" })).toEqual({ q: "asha", segment: "frequent", sort: "totalSpent", minVisits: "3" });
    expect(C.directoryParams({ search: "", segment: "", sort: "visits", minVisits: "oops" }).minVisits).toBeUndefined();
    expect(C.directoryParams({ search: "", segment: "", sort: "lastVisit", minVisits: "0" }).minVisits).toBeUndefined();
  });
  it("knows when anything is filtered", () => {
    expect(C.isFilteringDirectory(C.EMPTY_DIRECTORY_FILTER)).toBe(false);
    expect(C.isFilteringDirectory({ ...C.EMPTY_DIRECTORY_FILTER, sort: "visits" })).toBe(true);
    expect(C.isFilteringDirectory({ ...C.EMPTY_DIRECTORY_FILTER, search: " x" })).toBe(true);
  });
});

describe("row words", () => {
  it("shows recorded contact, never a guessed name", () => {
    expect(C.contactLine({ phone: "+919876543210", email: null })).toBe("+919876543210");
    expect(C.contactLine({ phone: "+919876543210", email: "a@b.test" })).toBe("+919876543210 · a@b.test");
    expect(C.contactLine({ phone: null, email: " " })).toBe("No contact recorded");
  });
  it("pluralises visit counts", () => {
    expect(C.visitsText(1)).toBe("1 completed visit");
    expect(C.visitsText(0)).toBe("0 completed visits");
    expect(C.repeatText(2)).toBe("2 repeat visits");
  });
  it("labels segments and says where spend comes from", () => {
    expect(C.segmentLabel("frequent")).toBe("Frequent");
    expect(C.segmentLabel(null)).toBeNull();
    const note = C.spendNote({ recordedCollections: 500, recordedRefunds: 100 }, "INR");
    expect(note).toContain("as recorded in FastQue");
    expect(note).toContain("500");
    expect(note).toContain("100");
  });
});

describe("error words", () => {
  it("says a stale cursor reloads, a missing signing key stops paging, and a non-owner is refused", () => {
    expect(C.directoryErrorText("INVALID_FILTER", "m")).toContain("reloaded");
    expect(C.directoryErrorText("CUSTOMER_DIRECTORY_CURSOR_UNAVAILABLE", "m")).toContain("not available");
    expect(C.directoryErrorText("FORBIDDEN_ROLE", "m")).toContain("shop owner");
    expect(C.directoryErrorText("SOMETHING", "as sent")).toBe("as sent");
  });
  it("explains an unknown customer for the services list", () => {
    expect(C.serviceHistoryErrorText("BOOKING_NOT_FOUND", "m")).toContain("no visits");
  });
});

describe("completed service rows", () => {
  it("shows an invoiced line total, or says there is no invoice line", () => {
    expect(C.serviceAmountText({ amount: 250, currency: "INR" })).toContain("invoiced");
    expect(C.serviceAmountText({ amount: null, currency: "INR" })).toBe("No invoice line recorded");
  });
  it("names the sources", () => {
    expect(C.serviceSourceLabel("LIVE_QUEUE")).toBe("Live Queue");
    expect(C.serviceSourceLabel("ONLINE_BOOKING")).toBe("Online booking");
    expect(C.serviceSourceLabel("IN_SHOP_APPOINTMENT")).toBe("In-shop appointment");
  });
});
