import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { RevenueReport } from "../RevenueReport";
import { apiFetch, apiFetchBlob, ApiError } from "../../../lib/api";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href }) => <a href={href}>{children}</a> }));
jest.mock("../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  }
  return { apiFetch: jest.fn(), apiFetchBlob: jest.fn(), ApiError: MockApiError };
});

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join(" ");
  return collect(node.children);
};
const text = (r) => collect(r.toJSON());
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

const metric = (over = {}) => ({
  completedVisits: 3, grossServiceValue: 800, estimatedServiceValue: 750, invoiceCount: 2, invoiceDiscounts: 50,
  invoicedAmount: 700, recordedCollections: 500, refunds: 50, netRecordedCollections: 450, ...over,
});

function report(over = {}) {
  return {
    salonId: "s1", currency: "INR", timeZone: "Asia/Kolkata", from: "2026-09-17", to: "2026-10-16", groupBy: "day", source: null,
    periods: [{ period: "2026-10-12", ...metric() }],
    totals: metric(),
    byService: [
      { key: "s-hair", label: "Classic Haircut", ...metric({ netRecordedCollections: 300, estimatedServiceValue: 500 }) },
      { key: "s-beard", label: "Beard Trim", ...metric({ netRecordedCollections: 150, estimatedServiceValue: 250 }) },
    ],
    byStaff: [{ key: "b1", label: "Arjun", identityVerified: true, ...metric() }, { key: "b2", label: "Unlinked name", identityVerified: false, ...metric({ netRecordedCollections: 1 }) }],
    byCustomer: [{ key: "c1", label: "Asha", identityVerified: true, ...metric() }, { key: "c2", label: "Guest Ravi", identityVerified: false, ...metric({ netRecordedCollections: 2 }) }],
    dataSemantics: {
      estimateBasis: "BOOKING_PRICE_SNAPSHOT_AND_CURRENT_QUEUE_SERVICE_PRICE",
      cashSource: "SHOP_RECORDED_INVOICE_PAYMENT_LEDGER",
      serviceCashAllocation: "PRO_RATA_BY_INVOICE_LINE_TOTAL",
      externalAttribution: "NOT_CAPTURED_BY_EXISTING_SOURCE_FIELDS",
    },
    ...over,
  };
}

function install({ timezone = "Asia/Kolkata", result = report() } = {}) {
  apiFetch.mockImplementation(async (path) => {
    if (path.endsWith("/timezone")) return { id: "s1", timezone, countryCode: "IN" };
    if (path.includes("/revenue/report?")) {
      if (result instanceof Error) throw result;
      return typeof result === "function" ? result(path) : result;
    }
    throw new Error(`unexpected ${path}`);
  });
}

const reportCalls = () => apiFetch.mock.calls.map(([p]) => p).filter((p) => p.includes("/revenue/report?"));
const params = (path) => new URLSearchParams(path.split("?")[1]);
const button = (r, label) => r.root.findAllByType("button").find((b) => new RegExp(label).test(collect(b.props.children)));

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<RevenueReport salonId="s1" />); });
  await flush();
  await flush();
  return r;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

describe("RevenueReport (server report)", () => {
  it("asks the owner to set the timezone instead of guessing dates, and requests no report", async () => {
    install({ timezone: null });
    const r = await mount();
    expect(text(r)).toContain("no timezone");
    expect(JSON.stringify(r.toJSON())).toContain("/dashboard/salons/s1/settings");
    expect(reportCalls()).toHaveLength(0);
  });

  it("loads the last 30 days daily from the server and shows its totals, collected apart from estimated", async () => {
    install();
    const r = await mount();
    const calls = reportCalls();
    expect(calls).toHaveLength(1);
    const q = params(calls[0]);
    expect(q.get("groupBy")).toBe("day");
    expect(q.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(q.get("to")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(q.has("source")).toBe(false);
    const t = text(r);
    expect(t).toContain("Collected");
    expect(t).toContain("₹500");
    expect(t).toContain("Net collected");
    expect(t).toContain("₹450");
    expect(t).toContain("Estimated service value");
    expect(t).toContain("₹750");
    expect(t).toMatch(/Completed services\s+3/);
    expect(t).toMatch(/Invoiced \(\s*2\s*\)/);
  });

  it("refetches with the chosen grouping when the view changes", async () => {
    install();
    const r = await mount();
    await act(async () => { button(r, "Weekly").props.onClick(); });
    await flush();
    expect(params(reportCalls().at(-1)).get("groupBy")).toBe("week");
    await act(async () => { button(r, "Monthly").props.onClick(); });
    await flush();
    expect(params(reportCalls().at(-1)).get("groupBy")).toBe("month");
  });

  it("sends only a known source filter", async () => {
    install();
    const r = await mount();
    const select = r.root.findByProps({ id: "rep-source" });
    await act(async () => { select.props.onChange({ target: { value: "WEB" } }); });
    await flush();
    expect(params(reportCalls().at(-1)).get("source")).toBe("WEB");
    await act(async () => { select.props.onChange({ target: { value: "FACEBOOK" } }); });
    await flush();
    expect(params(reportCalls().at(-1)).has("source")).toBe(false);
  });

  it("refuses an over-long range with a clear message and sends no new request", async () => {
    install();
    const r = await mount();
    const before = reportCalls().length;
    await act(async () => { r.root.findByProps({ id: "rep-from" }).props.onChange({ target: { value: "2020-01-01" } }); });
    await act(async () => { button(r, "Show report").props.onClick(); });
    expect(text(r)).toContain("at most 366 days");
    expect(reportCalls().length).toBe(before);
  });

  it("shows the server's message for a range that is too large and for a timezone problem", async () => {
    install({ result: new ApiError("Too many rows. Narrow the date range.", 413) });
    const r = await mount();
    expect(text(r)).toContain("Narrow the date range");
    install({ result: new ApiError("Shop timezone is not valid.", 422) });
    await act(async () => { button(r, "Show report").props.onClick(); });
    await flush();
    expect(text(r)).toContain("Shop timezone is not valid.");
    expect(text(r)).not.toContain("Net collected");
  });

  it("shows an honest empty state when the range has no activity", async () => {
    const zero = metric({ completedVisits: 0, grossServiceValue: 0, estimatedServiceValue: 0, invoiceCount: 0, invoiceDiscounts: 0, invoicedAmount: 0, recordedCollections: 0, refunds: 0, netRecordedCollections: 0 });
    install({ result: report({ periods: [], totals: zero, byService: [], byStaff: [], byCustomer: [] }) });
    const r = await mount();
    expect(text(r)).toContain("No activity in this range");
    expect(text(r)).not.toContain("Net collected");
  });

  it("marks staff and customers the server could not verify", async () => {
    install();
    const r = await mount();
    const t = text(r);
    expect(t).toMatch(/Unlinked name\s+Not linked/);
    expect(t).toMatch(/Guest Ravi\s+Guest/);
    expect(t).not.toMatch(/Arjun\s+Not linked/);
    expect(t).not.toMatch(/Asha\s+Guest/);
  });

  it("filters the service table by name", async () => {
    install();
    const r = await mount();
    await act(async () => { r.root.findByProps({ id: "rep-service-search" }).props.onChange({ target: { value: "beard" } }); });
    expect(text(r)).toContain("Beard Trim");
    expect(text(r)).not.toContain("Classic Haircut");
  });

  it("downloads the CSV with the same query the screen used, keeping the server's file name", async () => {
    install();
    const r = await mount();
    const shown = reportCalls()[0].split("?")[1];
    const saved = [];
    const anchor = { click: jest.fn(), remove: jest.fn() };
    globalThis.document = { createElement: jest.fn(() => anchor), body: { appendChild: jest.fn() } };
    URL.createObjectURL = jest.fn(() => "blob:x");
    URL.revokeObjectURL = jest.fn();
    apiFetchBlob.mockResolvedValue({ blob: { size: 1 }, filename: "fastque-revenue-server.csv" });
    try {
      await act(async () => { button(r, "Download report").props.onClick(); });
      await flush();
      expect(apiFetchBlob).toHaveBeenCalledTimes(1);
      expect(apiFetchBlob.mock.calls[0][0]).toBe(`dashboard/salons/s1/revenue/report.csv?${shown}`);
      expect(anchor.download).toBe("fastque-revenue-server.csv");
      expect(anchor.click).toHaveBeenCalled();
      saved.push(text(r));
      expect(saved[0]).toContain("Report downloaded.");
    } finally {
      delete globalThis.document;
    }
  });

  it("reports a failed download instead of staying silent", async () => {
    install();
    const r = await mount();
    apiFetchBlob.mockRejectedValue(new ApiError("Export is too large.", 413));
    await act(async () => { button(r, "Download report").props.onClick(); });
    await flush();
    expect(text(r)).toContain("Export is too large.");
  });

  it("explains how the numbers are made, in plain words", async () => {
    install();
    const r = await mount();
    const t = text(r);
    expect(t).toContain("How these numbers are made");
    expect(t).toContain("not cash");
    expect(t).toContain("Facebook, Instagram");
  });
});
