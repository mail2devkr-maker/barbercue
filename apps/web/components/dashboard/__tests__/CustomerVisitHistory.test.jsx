import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { CustomerVisitHistory } from "../CustomerVisitHistory";
import { apiFetch, ApiError } from "../../../lib/api";

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
  if (Array.isArray(node)) return node.map(collect).join("");
  return collect(node.children);
};
const text = (r) => collect(r.toJSON());
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const byText = (r, label) => r.root.findAllByType("button").find((b) => new RegExp(label).test(collect(b.props.children)));

const entry = (over = {}) => ({
  id: "b1", source: "ONLINE_BOOKING", occurredAt: "2026-10-11T18:30:00.000Z", createdAt: "2026-10-10T10:00:00.000Z", status: "COMPLETED",
  recordedName: null, serviceNames: ["Haircut"], staffName: "Arjun", startedAt: null, completedAt: null,
  invoices: [{
    id: "i1", number: "INV-1", status: "ISSUED", currency: "INR", total: "500.00", discountTotal: "50.00",
    payments: [{ kind: "PAYMENT", method: "UPI", amount: "450.00", recordedAt: "2026-10-12T05:00:00.000Z" }],
  }],
  ...over,
});
const page = (items, nextCursor = null) => ({ salonId: "s1", customerId: "c1", salonTimezone: "Asia/Kolkata", items, nextCursor });

let calls;
function install(handler) {
  calls = [];
  apiFetch.mockImplementation(async (path) => {
    calls.push(path);
    return handler(path);
  });
}
const params = (path) => new URLSearchParams(path.split("?")[1]);

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<CustomerVisitHistory salonId="s1" customerId="c1" />); });
  await flush();
  return r;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

describe("CustomerVisitHistory", () => {
  it("loads the first page from the salon-scoped history route", async () => {
    install(() => page([entry()]));
    const r = await mount();
    expect(calls[0].startsWith("dashboard/salons/s1/customers/c1/history?")).toBe(true);
    expect(params(calls[0]).get("limit")).toBe("20");
    const t = text(r);
    expect(t).toContain("Haircut");
    expect(t).toContain("Completed");
    expect(t).toContain("Online booking");
    expect(t).toContain("With Arjun");
    expect(t).toContain("12 Oct 2026");
  });

  it("shows invoices and the payments the shop recorded, with exact amounts, and says what they cover", async () => {
    install(() => page([entry()]));
    const r = await mount();
    const t = text(r);
    expect(t).toContain("Invoice INV-1");
    expect(t).toContain("Total ₹500");
    expect(t).toContain("Discount ₹50");
    expect(t).toContain("Recorded by shop ₹450");
    expect(t).toContain("Payment · UPI · ₹450");
    expect(t).toContain("only what your shop recorded in FastQue");
  });

  it("shows a refund as a refund and nets it out", async () => {
    install(() => page([entry({ invoices: [{ id: "i1", number: "INV-2", status: "ISSUED", currency: "INR", total: "500.00", discountTotal: "0.00", payments: [
      { kind: "PAYMENT", method: "CASH", amount: "500.00", recordedAt: "2026-10-12T05:00:00.000Z" },
      { kind: "REFUND", method: "CASH", amount: "100.00", recordedAt: "2026-10-13T05:00:00.000Z" },
    ] }] })]));
    const r = await mount();
    const t = text(r);
    expect(t).toContain("Refund · Cash · ₹100");
    expect(t).toContain("Recorded by shop ₹400");
  });

  it("marks a void invoice and a completed visit with no invoice", async () => {
    install(() => page([
      entry({ id: "v", invoices: [{ id: "i9", number: "INV-9", status: "VOID", currency: "INR", total: "10.00", discountTotal: "0.00", payments: [] }] }),
      entry({ id: "n", invoices: [] }),
    ]));
    const r = await mount();
    expect(text(r)).toContain("INV-9 (void)");
    expect(text(r)).toContain("No invoice recorded for this visit");
  });

  it("shows a visit's recorded label as recorded and never as the account's name", async () => {
    install(() => page([entry({ source: "LIVE_QUEUE", recordedName: "Ravi", serviceNames: [] })]));
    const r = await mount();
    const t = text(r);
    expect(t).toContain("Live Queue");
    expect(t).toContain("Recorded as “Ravi”");
    expect(t).toContain("no verified name");
  });

  it("shows an honest empty state, including when the server says the account has no visits here", async () => {
    install(() => page([]));
    expect(text(await mount())).toContain("No visits recorded for this customer at your shop yet");
    install(() => { throw new ApiError("No visits", 404); });
    expect(text(await mount())).toContain("No visits recorded for this customer at your shop yet");
  });

  it("shows the server's message when loading fails", async () => {
    install(() => { throw new ApiError("Set your shop’s timezone first.", 422); });
    const r = await mount();
    expect(text(r)).toContain("Set your shop’s timezone first.");
  });

  it("requests the next page with the cursor and the filters it was issued for, then appends", async () => {
    install((path) => (params(path).get("cursor") ? page([entry({ id: "b2", serviceNames: ["Beard Trim"] })]) : page([entry()], "CUR1")));
    const r = await mount();
    await act(async () => { r.root.findByProps({ id: "history-status" }).props.onChange({ target: { value: "COMPLETED" } }); });
    await flush();
    await act(async () => { byText(r, "Show more visits").props.onClick(); });
    await flush();
    const more = params(calls.at(-1));
    expect(more.get("cursor")).toBe("CUR1");
    expect(more.get("status")).toBe("COMPLETED");
    expect(text(r)).toContain("Haircut");
    expect(text(r)).toContain("Beard Trim");
  });

  it("reloads from the start with the chosen filters and can clear them", async () => {
    install(() => page([entry()]));
    const r = await mount();
    await act(async () => { r.root.findByProps({ id: "history-source" }).props.onChange({ target: { value: "LIVE_QUEUE" } }); });
    await flush();
    expect(params(calls.at(-1)).get("source")).toBe("LIVE_QUEUE");
    expect(params(calls.at(-1)).has("cursor")).toBe(false);
    await act(async () => { byText(r, "Clear filters").props.onClick(); });
    await flush();
    expect(params(calls.at(-1)).has("source")).toBe(false);
  });

  it("explains an empty filtered result differently from an empty history", async () => {
    install((path) => (params(path).get("status") ? page([]) : page([entry()])));
    const r = await mount();
    await act(async () => { r.root.findByProps({ id: "history-status" }).props.onChange({ target: { value: "NO_SHOW" } }); });
    await flush();
    expect(text(r)).toContain("No visits match these filters");
  });

  it("refuses an over-long or reversed date range and sends no request", async () => {
    install(() => page([entry()]));
    const r = await mount();
    const before = calls.length;
    await act(async () => { r.root.findByProps({ id: "history-from" }).props.onChange({ target: { value: "2020-01-01" } }); });
    await act(async () => { r.root.findByProps({ id: "history-to" }).props.onChange({ target: { value: "2026-10-01" } }); });
    expect(text(r)).toContain("at most 366 days");
    expect(calls.length).toBe(before + 1); // only the "from" change (no end date yet) was sent
  });
});
