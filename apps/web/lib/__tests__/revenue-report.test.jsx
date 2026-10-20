// Pure date, label and query logic. No browser, no network. Financial figures come from the server report.
import * as R from "../revenue-report";

describe("date helpers", () => {
  it("validates real calendar dates only", () => {
    expect(R.isIsoDate("2026-10-16")).toBe(true);
    expect(R.isIsoDate("2026-02-30")).toBe(false);
    expect(R.isIsoDate("2024-02-29")).toBe(true);
    expect(R.isIsoDate("2026-13-01")).toBe(false);
    expect(R.isIsoDate("16/10/2026")).toBe(false);
  });
  it("adds days across month and year ends and counts inclusive days", () => {
    expect(R.addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(R.addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(R.inclusiveDays("2026-10-01", "2026-10-01")).toBe(1);
    expect(R.inclusiveDays("2026-10-01", "2026-10-31")).toBe(31);
  });
  it("reads today on the shop's calendar, not the browser's", () => {
    expect(R.todayInZone("Asia/Kolkata", new Date("2026-10-15T20:30:00Z"))).toBe("2026-10-16");
    expect(R.todayInZone("America/New_York", new Date("2026-10-15T20:30:00Z"))).toBe("2026-10-15");
  });
});

describe("range validation and presets", () => {
  it("accepts a normal range and rejects bad ones with a reason", () => {
    expect(R.validateRange("2026-10-01", "2026-10-16")).toBeNull();
    expect(R.validateRange("", "2026-10-16")).toBe("MISSING");
    expect(R.validateRange("2026-02-30", "2026-03-01")).toBe("INVALID_DATE");
    expect(R.validateRange("2026-10-16", "2026-10-01")).toBe("ORDER");
  });
  it("allows exactly 366 days and refuses 367 (the server's own limit)", () => {
    expect(R.validateRange("2024-10-16", "2025-10-16")).toBeNull();
    expect(R.validateRange("2024-10-15", "2025-10-16")).toBe("TOO_LONG");
  });
  it("computes presets on the shop calendar", () => {
    expect(R.presetRange("today", "2026-10-16")).toEqual({ from: "2026-10-16", to: "2026-10-16" });
    expect(R.presetRange("last7", "2026-10-16")).toEqual({ from: "2026-10-10", to: "2026-10-16" });
    expect(R.presetRange("last30", "2026-10-16")).toEqual({ from: "2026-09-17", to: "2026-10-16" });
    expect(R.presetRange("thisMonth", "2026-10-16")).toEqual({ from: "2026-10-01", to: "2026-10-16" });
    expect(R.presetRange("lastMonth", "2026-10-16")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(R.presetRange("lastMonth", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("labels", () => {
  it("labels server period keys for people", () => {
    expect(R.periodLabel("2026-10-12", "day")).toBe("12 Oct");
    expect(R.periodLabel("2026-10-12", "week")).toBe("Week of 12 Oct");
    expect(R.periodLabel("2026-10-01", "month")).toBe("Oct 2026");
  });
});

describe("source filter", () => {
  it("offers the sources the server reports, with the owner-facing words", () => {
    expect(R.SOURCE_FILTERS.map((s) => s.value)).toEqual(["", "FASTQUE_APP", "FASTQUE_WEB", "WALK_IN", "IN_SHOP", "FACEBOOK", "INSTAGRAM", "CHATGPT", "OTHER", "UNKNOWN"]);
    expect(R.SOURCE_FILTERS.find((s) => s.value === "WALK_IN").label).toBe("Live Queue");
    expect(R.SOURCE_FILTERS.find((s) => s.value === "FACEBOOK").label).toBe("Facebook campaign");
    expect(R.SOURCE_FILTERS.find((s) => s.value === "UNKNOWN").label).toBe("Not recorded");
    for (const unsupported of ["TIKTOK", "APP", "WEB", ""]) expect(R.isKnownSource(unsupported)).toBe(false);
    expect(R.isKnownSource("FASTQUE_APP")).toBe(true);
    expect(R.isKnownSource("INSTAGRAM")).toBe(true);
  });
});

describe("query string", () => {
  it("builds the same query for the report and the export, leaving out an empty source", () => {
    expect(R.reportQueryString({ from: "2026-10-01", to: "2026-10-16", groupBy: "week", source: "" })).toBe("from=2026-10-01&to=2026-10-16&groupBy=week");
    expect(R.reportQueryString({ from: "2026-10-01", to: "2026-10-16", groupBy: "day", source: "FASTQUE_WEB" })).toBe("from=2026-10-01&to=2026-10-16&groupBy=day&source=FASTQUE_WEB");
  });
  it("names the export file like the server does when no name is sent", () => {
    expect(R.csvFallbackName({ from: "2026-10-01", to: "2026-10-16" })).toBe("fastque-revenue-2026-10-01-2026-10-16.csv"); // same naming as the server's own Content-Disposition
  });
});

describe("row helpers", () => {
  const row = (label, net, est) => ({ label, netRecordedCollections: net, estimatedServiceValue: est });
  it("filters by label case-insensitively and keeps everything for an empty search", () => {
    const rows = [row("Classic Haircut"), row("Beard Trim"), row("Hair Spa")];
    expect(R.filterByLabel(rows, "  HAIR ").map((r) => r.label)).toEqual(["Classic Haircut", "Hair Spa"]);
    expect(R.filterByLabel(rows, "")).toHaveLength(3);
    expect(R.filterByLabel(rows, "zzz")).toEqual([]);
  });
  it("sorts by recorded collections, then estimated value, keeping the server order on ties, without mutating", () => {
    const rows = [row("a", 10, 5), row("b", 30, 1), row("c", 10, 9), row("d", 10, 9)];
    const copy = JSON.stringify(rows);
    expect(R.sortByValue(rows).map((r) => r.label)).toEqual(["b", "c", "d", "a"]);
    expect(JSON.stringify(rows)).toBe(copy);
  });
  it("detects a report with nothing in it", () => {
    const zero = { completedVisits: 0, invoiceCount: 0, recordedCollections: 0, refunds: 0, estimatedServiceValue: 0 };
    expect(R.isEmptyReport({ totals: zero })).toBe(true);
    for (const key of Object.keys(zero)) expect(R.isEmptyReport({ totals: { ...zero, [key]: 1 } })).toBe(false);
  });
});

describe("describeSemantics", () => {
  it("explains each documented semantic in plain words", () => {
    const lines = R.describeSemantics({
      estimateBasis: "BOOKING_PRICE_SNAPSHOT_AND_CURRENT_QUEUE_SERVICE_PRICE",
      cashSource: "SHOP_RECORDED_INVOICE_PAYMENT_LEDGER",
      serviceCashAllocation: "PRO_RATA_BY_INVOICE_LINE_TOTAL",
      externalAttribution: "NOT_CAPTURED_BY_EXISTING_SOURCE_FIELDS",
    });
    expect(lines).toHaveLength(4);
    expect(lines.join(" ")).toContain("not cash");
    expect(lines.join(" ")).toContain("Facebook, Instagram");
  });
  it("explains campaign attribution without claiming where the customer came from", () => {
    const [line] = R.describeSemantics({ externalAttribution: "CAMPAIGN_TOKEN_WHEN_PRESENT_LEGACY_SOURCE_PROJECTION_OTHERWISE" });
    expect(line).toContain("campaign code you created");
    expect(line).toContain("not where the customer really came from");
  });
  it("shows an unknown value verbatim instead of hiding it", () => {
    expect(R.describeSemantics({ cashSource: "SOMETHING_NEW" })).toEqual(["cashSource: SOMETHING_NEW"]);
  });
});
