// Pure date, bucketing and CSV logic. No browser, no network.
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

  it("starts weeks on Monday and months on the 1st", () => {
    expect(R.weekStart("2026-10-12")).toBe("2026-10-12"); // Monday
    expect(R.weekStart("2026-10-18")).toBe("2026-10-12"); // Sunday belongs to the week that began Monday 12th
    expect(R.weekStart("2026-10-19")).toBe("2026-10-19");
    expect(R.monthStart("2026-10-16")).toBe("2026-10-01");
  });
});

describe("shop-local day to instant", () => {
  it("converts IST midnight (UTC+5:30) correctly", () => {
    expect(R.zonedDayStart("2026-10-16", "Asia/Kolkata").toISOString()).toBe("2026-10-15T18:30:00.000Z");
  });
  it("handles daylight saving: New York in summer and winter", () => {
    expect(R.zonedDayStart("2026-07-01", "America/New_York").toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(R.zonedDayStart("2026-01-15", "America/New_York").toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });
  it("handles a half-hour DST zone (Lord Howe)", () => {
    expect(R.zonedDayStart("2026-01-15", "Australia/Lord_Howe").toISOString()).toBe("2026-01-14T13:00:00.000Z");
    expect(R.zonedDayStart("2026-07-15", "Australia/Lord_Howe").toISOString()).toBe("2026-07-14T13:30:00.000Z");
  });
  it("builds analytics instants: from inclusive, to = start of the day AFTER the last day", () => {
    expect(R.analyticsInstants("2026-10-01", "2026-10-02", "Asia/Kolkata")).toEqual({
      from: "2026-09-30T18:30:00.000Z",
      to: "2026-10-02T18:30:00.000Z",
    });
  });
  it("reads today and a payment's date on the shop's calendar, not the browser's", () => {
    // 20:30 UTC on 15 Oct is already 16 Oct in India.
    expect(R.todayInZone("Asia/Kolkata", new Date("2026-10-15T20:30:00Z"))).toBe("2026-10-16");
    expect(R.dateInZone("2026-10-15T20:30:00Z", "America/New_York")).toBe("2026-10-15");
    expect(R.dateInZone("2026-10-15T20:30:00Z", "Asia/Kolkata")).toBe("2026-10-16");
  });
});

describe("range validation and presets", () => {
  it("accepts a normal range and rejects bad ones with a reason", () => {
    expect(R.validateRange("2026-10-01", "2026-10-16")).toBeNull();
    expect(R.validateRange("", "2026-10-16")).toBe("MISSING");
    expect(R.validateRange("2026-02-30", "2026-03-01")).toBe("INVALID_DATE");
    expect(R.validateRange("2026-10-16", "2026-10-01")).toBe("ORDER");
    expect(R.validateRange("2025-01-01", "2026-10-01")).toBe("TOO_LONG");
  });
  it("allows exactly 366 days and refuses 367", () => {
    expect(R.validateRange("2025-10-16", "2026-10-15")).toBeNull(); // 365 days
    expect(R.validateRange("2024-10-16", "2025-10-16")).toBeNull(); // 366 days inclusive (leap span)
    expect(R.validateRange("2024-10-15", "2025-10-16")).toBe("TOO_LONG"); // 367
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

const pay = (recordedAt, amount, kind = "PAYMENT") => ({ id: recordedAt + amount, invoiceId: "i", invoiceNumber: "INV-1", customerName: null, kind, method: "CASH", amount, reference: null, note: null, recordedAt, recordedBy: "Owner" });

describe("day rows and buckets", () => {
  const est = [
    { date: "2026-10-12", completedCount: 2, estimatedServiceValue: 500 },
    { date: "2026-10-14", completedCount: 1, estimatedServiceValue: 250.5 },
    { date: "2026-10-19", completedCount: 3, estimatedServiceValue: 900 },
  ];
  const payments = [
    pay("2026-10-12T06:00:00Z", 400),
    pay("2026-10-12T12:00:00Z", 100.25),
    pay("2026-10-14T06:00:00Z", 50, "REFUND"),
    pay("2026-10-19T06:00:00Z", 900),
    pay("2026-11-30T06:00:00Z", 999), // outside the range: ignored
  ];

  it("fills every day of the range with zeros and never skips one", () => {
    const rows = R.buildDayRows("2026-10-12", "2026-10-19", "Asia/Kolkata", est, payments);
    expect(rows.map((r) => r.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"]);
    expect(rows[1]).toMatchObject({ collected: 0, refunded: 0, estimated: 0 });
  });

  it("keeps collections and estimates in separate columns and never mixes them", () => {
    const rows = R.buildDayRows("2026-10-12", "2026-10-19", "Asia/Kolkata", est, payments);
    expect(rows[0]).toMatchObject({ collected: 500.25, refunded: 0, estimated: 500 });
    expect(rows[2]).toMatchObject({ collected: 0, refunded: 50, estimated: 250.5 });
    expect(R.netCollected(rows[2])).toBe(-50);
  });

  it("weekly and monthly buckets add up to exactly the daily total (consistent date semantics)", () => {
    const rows = R.buildDayRows("2026-10-12", "2026-10-19", "Asia/Kolkata", est, payments);
    const sum = (list, k) => Math.round(list.reduce((a, r) => a + r[k], 0) * 100) / 100;
    const weekly = R.bucketRows(rows, "week");
    const monthly = R.bucketRows(rows, "month");
    expect(weekly.map((b) => b.date)).toEqual(["2026-10-12", "2026-10-19"]);
    for (const k of ["collected", "refunded", "estimated", "completedServices"]) {
      expect(sum(weekly, k)).toBe(sum(rows, k));
      expect(sum(monthly, k)).toBe(sum(rows, k));
    }
    expect(weekly[0]).toMatchObject({ collected: 500.25, refunded: 50, estimated: 750.5 });
    expect(monthly).toHaveLength(1);
  });

  it("a month boundary inside one week splits into two monthly buckets", () => {
    const rows = R.buildDayRows("2026-09-28", "2026-10-04", "Asia/Kolkata", [], [pay("2026-09-30T06:00:00Z", 10), pay("2026-10-01T06:00:00Z", 20)]);
    const monthly = R.bucketRows(rows, "month");
    expect(monthly.map((b) => [b.date, b.collected])).toEqual([["2026-09-01", 10], ["2026-10-01", 20]]);
    expect(R.bucketRows(rows, "week")).toHaveLength(1);
  });

  it("assigns a late-evening UTC payment to the next shop-local day", () => {
    const rows = R.buildDayRows("2026-10-15", "2026-10-16", "Asia/Kolkata", [], [pay("2026-10-15T20:30:00Z", 70)]);
    expect(rows.find((r) => r.date === "2026-10-16").collected).toBe(70);
    expect(rows.find((r) => r.date === "2026-10-15").collected).toBe(0);
  });

  it("does not drift on decimal money", () => {
    const rows = R.buildDayRows("2026-10-12", "2026-10-12", "Asia/Kolkata", [], [pay("2026-10-12T06:00:00Z", 0.1), pay("2026-10-12T07:00:00Z", 0.2), pay("2026-10-12T08:00:00Z", 0.3)]);
    expect(rows[0].collected).toBe(0.6);
  });

  it("with no payment rows loaded, collections stay zero and estimates still show", () => {
    const rows = R.buildDayRows("2026-10-12", "2026-10-12", "Asia/Kolkata", est, null);
    expect(rows[0]).toMatchObject({ collected: 0, estimated: 500 });
  });
});

describe("CSV export", () => {
  it("quotes commas, quotes and newlines, and starts with a BOM", () => {
    const csv = R.toCsv(["Name", "Amount"], [['Cut, "fade"', 100], ["Line\nbreak", 5.5]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Cut, ""fade""",100');
    expect(csv).toContain('"Line\nbreak",5.5');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
  it("neutralises spreadsheet formulas in text but keeps negative numbers as numbers", () => {
    expect(R.csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(R.csvCell("+91 98765")).toBe("'+91 98765");
    expect(R.csvCell("-cmd")).toBe("'-cmd");
    expect(R.csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(R.csvCell(-50)).toBe("-50");
    expect(R.csvCell(null)).toBe("");
    expect(R.csvCell("Haircut")).toBe("Haircut");
  });
});

describe("labels, filters and export rows", () => {
  it("labels buckets for people", () => {
    expect(R.periodLabel("2026-10-12", "day")).toBe("12 Oct");
    expect(R.periodLabel("2026-10-12", "week")).toBe("Week of 12 Oct");
    expect(R.periodLabel("2026-10-01", "month")).toBe("Oct 2026");
  });

  it("filters by name case-insensitively and keeps everything for an empty search", () => {
    const rows = [{ name: "Classic Haircut" }, { name: "Beard Trim" }, { displayName: "Arjun Mehta" }];
    expect(R.filterByName(rows, "  HAIR ")).toEqual([{ name: "Classic Haircut" }]);
    expect(R.filterByName(rows, "arjun")).toEqual([{ displayName: "Arjun Mehta" }]);
    expect(R.filterByName(rows, "")).toHaveLength(3);
    expect(R.filterByName(rows, "zzz")).toEqual([]);
  });

  it("builds period CSV rows with collected, refunded, net and estimated in separate columns", () => {
    const rows = R.buildDayRows("2026-10-12", "2026-10-13", "Asia/Kolkata", [{ date: "2026-10-12", completedCount: 2, estimatedServiceValue: 500 }], [pay("2026-10-12T06:00:00Z", 400), pay("2026-10-13T06:00:00Z", 50, "REFUND")]);
    expect(R.periodCsvRows(rows, "day")).toEqual([
      ["2026-10-12", 400, 0, 400, 500, 2],
      ["2026-10-13", 0, 50, -50, 0, 0],
    ]);
    expect(R.periodCsvRows(rows, "week")).toEqual([["2026-10-12", 400, 50, 350, 500, 2]]);
    expect(R.PERIOD_CSV_HEADERS).toHaveLength(6);
  });

  it("builds payment CSV rows on the shop calendar with refunds as negative amounts", () => {
    const rows = R.paymentCsvRows([pay("2026-10-15T20:30:00Z", 70), pay("2026-10-15T21:00:00Z", 20, "REFUND")], "Asia/Kolkata");
    expect(rows[0][0]).toBe("2026-10-16");
    expect(rows[0][6]).toBe(70);
    expect(rows[1][3]).toBe("Refund");
    expect(rows[1][6]).toBe(-20);
  });

  it("names the export file after the range", () => {
    expect(R.reportFileName("revenue", "2026-10-01", "2026-10-16")).toBe("revenue-2026-10-01-to-2026-10-16.csv");
  });
});

describe("loadAllPayments", () => {
  const page = (ids, nextCursor) => ({ from: "2026-10-01", to: "2026-10-16", currency: "INR", items: ids.map((i) => pay(`2026-10-1${i}T06:00:00Z`, i)), nextCursor, totals: { received: 99, refunded: 0, net: 99, count: 5 }, byMethod: [] });

  it("follows the cursor to the end and reports a complete load", async () => {
    const fetchPage = jest.fn(async (cursor) => (cursor === undefined ? page([1, 2], "a") : cursor === "a" ? page([3], "b") : page([4], null)));
    const result = await R.loadAllPayments(fetchPage);
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(4);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([undefined, "a", "b"]);
    expect(result.first.totals.net).toBe(99);
  });

  it("stops at the page cap and says the load is incomplete", async () => {
    const fetchPage = jest.fn(async () => page([1], "more"));
    const result = await R.loadAllPayments(fetchPage, 3);
    expect(result.complete).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("keeps the rows loaded so far when a later page fails, flagged incomplete", async () => {
    const fetchPage = jest.fn(async (cursor) => { if (cursor === "a") throw new Error("boom"); return page([1, 2], "a"); });
    const result = await R.loadAllPayments(fetchPage);
    expect(result.complete).toBe(false);
    expect(result.items).toHaveLength(2);
  });

  it("throws when the first page fails (nothing to show)", async () => {
    await expect(R.loadAllPayments(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  });
});

describe("serviceMix", () => {
  it("splits completed services by arrival and totals both parts", () => {
    expect(R.serviceMix({ bookingCompletedCount: 1, walkInCompletedCount: 2 })).toEqual({ booked: 1, liveQueue: 2, total: 3 });
    expect(R.serviceMix({ bookingCompletedCount: 0, walkInCompletedCount: 83 }).total).toBe(83);
  });
});
