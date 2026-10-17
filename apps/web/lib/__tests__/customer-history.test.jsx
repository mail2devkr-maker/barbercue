// Pure logic only (PR #235 contract). Money arrives as decimal strings and is read as exact cents.
import * as H from "../customer-history";

describe("labels", () => {
  it("uses the owner's words for the three visit types and nine statuses, and shows an unknown value as sent", () => {
    expect(H.sourceLabel("ONLINE_BOOKING")).toBe("Online booking");
    expect(H.sourceLabel("IN_SHOP_APPOINTMENT")).toBe("In-shop appointment");
    expect(H.sourceLabel("LIVE_QUEUE")).toBe("Live Queue");
    expect(H.sourceLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(H.HISTORY_STATUSES).toHaveLength(9);
    expect(H.statusLabel("NO_SHOW")).toBe("No-show");
    expect(H.statusLabel("PENDING_PAYMENT")).toBe("Awaiting payment");
    expect(H.statusLabel("WEIRD")).toBe("WEIRD");
  });
  it("names a visit by its services or a plain word", () => {
    expect(H.visitTitle({ serviceNames: ["Haircut", "Beard Trim"] })).toBe("Haircut, Beard Trim");
    expect(H.visitTitle({ serviceNames: [] })).toBe("Visit");
  });
  it("labels payment methods", () => {
    expect(H.methodLabel("UPI")).toBe("UPI");
    expect(H.methodLabel("CASH")).toBe("Cash");
    expect(H.methodLabel("WALLET")).toBe("WALLET");
  });
});

describe("validateHistoryRange", () => {
  it("accepts no dates, one date, or a sensible range", () => {
    expect(H.validateHistoryRange("", "")).toBeNull();
    expect(H.validateHistoryRange("2026-10-01", "")).toBeNull();
    expect(H.validateHistoryRange("", "2026-10-16")).toBeNull();
    expect(H.validateHistoryRange("2026-10-01", "2026-10-16")).toBeNull();
  });
  it("rejects fake dates, a reversed range and more than 366 days (the server's own rules)", () => {
    expect(H.validateHistoryRange("2026-02-30", "")).toContain("real dates");
    expect(H.validateHistoryRange("2026-10-16", "2026-10-01")).toContain("on or before");
    expect(H.validateHistoryRange("2024-10-16", "2025-10-16")).toBeNull();
    expect(H.validateHistoryRange("2024-10-15", "2025-10-16")).toContain("366");
  });
});

describe("historyQueryString", () => {
  it("leaves out empty filters and adds the cursor only when there is one", () => {
    expect(H.historyQueryString(H.EMPTY_FILTER, null)).toBe("limit=20");
    expect(H.historyQueryString({ source: "LIVE_QUEUE", status: "COMPLETED", from: "2026-10-01", to: "2026-10-16" }, "abc")).toBe(
      "limit=20&source=LIVE_QUEUE&status=COMPLETED&from=2026-10-01&to=2026-10-16&cursor=abc",
    );
  });
  it("knows when a filter is active", () => {
    expect(H.isFiltering(H.EMPTY_FILTER)).toBe(false);
    expect(H.isFiltering({ ...H.EMPTY_FILTER, status: "NO_SHOW" })).toBe(true);
  });
});

describe("exact money", () => {
  it("reads decimal strings as cents without floating point", () => {
    expect(H.toCents("1250.50")).toBe(125050);
    expect(H.toCents("0.1")).toBe(10);
    expect(H.toCents("0.07")).toBe(7);
    expect(H.toCents("19.99")).toBe(1999);
    expect(H.toCents("100")).toBe(10000);
    expect(H.toCents("-5.25")).toBe(-525);
  });
  it("never turns a malformed amount into money", () => {
    for (const bad of ["", "abc", "1,250", "1.234", "₹100", "1e3", "NaN"]) expect(H.toCents(bad)).toBeNull();
  });
  it("formats cents in the invoice's own currency, and a dash when unreadable", () => {
    expect(H.formatCents(125050, "INR")).toBe("₹1,250.50");
    expect(H.formatCents(1000, "INR")).toBe("₹10");
    expect(H.formatCents(2599, "USD")).toBe("USD 25.99");
    expect(H.formatCents(null, "INR")).toBe("—");
  });
  it("nets recorded payments and refunds per invoice", () => {
    const invoice = {
      total: "1000.00",
      discountTotal: "100.00",
      payments: [
        { kind: "PAYMENT", method: "CASH", amount: "600.00", recordedAt: "x" },
        { kind: "PAYMENT", method: "UPI", amount: "400.00", recordedAt: "x" },
        { kind: "REFUND", method: "CASH", amount: "250.50", recordedAt: "x" },
      ],
    };
    expect(H.invoiceTotals(invoice)).toEqual({ netCents: 74950, totalCents: 100000, discountCents: 10000 });
  });
  it("reports an unreadable payment as unknown instead of a wrong total", () => {
    const invoice = { total: "10.00", discountTotal: "0.00", payments: [{ kind: "PAYMENT", method: "CASH", amount: "oops", recordedAt: "x" }] };
    expect(H.invoiceTotals(invoice).netCents).toBeNull();
  });
  it("an invoice with no payments has zero recorded", () => {
    expect(H.invoiceTotals({ total: "10.00", discountTotal: "0.00", payments: [] }).netCents).toBe(0);
  });
});

describe("formatVisitTime", () => {
  it("shows the visit on the shop's own clock", () => {
    expect(H.formatVisitTime("2026-10-11T18:30:00.000Z", "Asia/Kolkata")).toContain("12 Oct 2026");
    expect(H.formatVisitTime("2026-10-11T18:30:00.000Z", "Asia/Kolkata")).toMatch(/12:00\s?am/i);
  });
  it("falls back to the raw instant for an unusable zone", () => {
    expect(H.formatVisitTime("2026-10-11T18:30:00.000Z", "Not/AZone")).toBe("2026-10-11T18:30:00.000Z");
  });
});
