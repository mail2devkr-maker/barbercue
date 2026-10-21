import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { OwnerAssistant } from "../OwnerAssistant";
import { apiFetch, ApiError } from "../../../lib/api";
import { QUICK_QUESTIONS } from "../../../lib/owner-assistant";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));
jest.mock("../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(status, body) {
      super(body?.error?.message ?? "Request failed");
      this.status = status;
      this.code = body?.error?.code ?? "UNKNOWN_ERROR";
      this.details = body?.error?.details;
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
const button = (r, label) => r.root.findAllByType("button").find((b) => new RegExp(label).test(collect(b.props.children)));
const input = (r) => r.root.findByProps({ id: "owner-assistant-question" });
const type = async (r, value) => { await act(async () => { input(r).props.onChange({ target: { value } }); }); };
const submit = async (r) => { await act(async () => { r.root.findByType("form").props.onSubmit({ preventDefault() {} }); }); await flush(); };

const ANSWER = {
  salonId: "s1", mode: "DETERMINISTIC", intent: "TODAY_RECORDED_AND_ESTIMATED_VALUE", localDate: "2026-10-21", timezone: "Asia/Kolkata",
  answer: "For 2026-10-21 (Asia/Kolkata), shop-recorded collections are INR 245.00. Completed-service listed-price value is estimated at INR 380.00; this estimate is not collected revenue.",
  figures: [
    { metric: "recordedCollectionsToday", value: 245, unit: "money", currency: "INR", estimated: false },
    { metric: "estimatedServiceValueToday", value: 380, unit: "money", currency: "INR", estimated: true },
  ],
  generatedAt: "2026-10-21T10:00:00.000Z",
};

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<OwnerAssistant salonId="s1" />); });
  return r;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  apiFetch.mockReset();
});

describe("OwnerAssistant", () => {
  it("says plainly what it is and is not, and offers every documented question", async () => {
    const r = await mount();
    const t = text(r);
    expect(t).toMatch(/not a chat and does not use AI/);
    expect(t).toMatch(/cannot change anything/);
    expect(t).toMatch(/never shows customer details/);
    for (const q of QUICK_QUESTIONS) expect(button(r, q.label)).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("asks the server with the exact documented request and shows the answer with its figures", async () => {
    apiFetch.mockResolvedValue(ANSWER);
    const r = await mount();
    await act(async () => { button(r, "Collections today").props.onClick(); });
    await flush();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, options] = apiFetch.mock.calls[0];
    expect(path).toBe("dashboard/salons/s1/assistant/query");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ question: "How much was collected today" });
    const t = text(r);
    expect(t).toMatch(/You asked: How much was collected today/);
    expect(t).toMatch(/shop-recorded collections are INR 245\.00/);
    expect(t).toMatch(/Collections recorded today/);
    expect(t).toMatch(/Estimated value of completed services/);
    expect(t).toMatch(/2026-10-21 \(Asia\/Kolkata\)/);
    expect(t).toMatch(/not money collected/);
    expect(input(r).props.value).toBe("How much was collected today");
  });

  it("labels ONLY the estimated figure as an estimate", async () => {
    apiFetch.mockResolvedValue(ANSWER);
    const r = await mount();
    await act(async () => { button(r, "Collections today").props.onClick(); });
    await flush();
    const figures = r.root.findAll((n) => n.type === "li" && /Figures|figure/.test(String(n.props.className)));
    expect(figures).toHaveLength(2);
    expect(collect(figures[0].children)).not.toMatch(/Estimate/);
    expect(collect(figures[1].children)).toMatch(/Estimate/);
  });

  it("sends a typed question, trimmed, from the form", async () => {
    apiFetch.mockResolvedValue(ANSWER);
    const r = await mount();
    await type(r, "  How many appointments today  ");
    await submit(r);
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ question: "How many appointments today" });
  });

  it("refuses a too-short question without calling the server", async () => {
    const r = await mount();
    await type(r, "a");
    await submit(r);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(text(r)).toMatch(/at least 2 characters/);
    await type(r, "ab");
    expect(text(r)).not.toMatch(/at least 2 characters/);
  });

  it("never sends one question twice while it is being answered", async () => {
    let resolve;
    apiFetch.mockImplementation(() => new Promise((res) => { resolve = res; }));
    const r = await mount();
    await act(async () => { button(r, "Waiting now").props.onClick(); });
    await act(async () => { button(r, "Waiting now")?.props.onClick?.(); });
    await submit(r);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(button(r, "Asking")).toBeTruthy();
    await act(async () => { resolve(ANSWER); });
    await flush();
    expect(text(r)).toMatch(/shop-recorded collections/);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("on an unsupported question lists what is supported and drops any earlier answer", async () => {
    apiFetch.mockResolvedValueOnce(ANSWER);
    const r = await mount();
    await act(async () => { button(r, "Collections today").props.onClick(); });
    await flush();
    expect(text(r)).toMatch(/shop-recorded collections/);
    apiFetch.mockRejectedValueOnce(new ApiError(422, { error: { code: "OWNER_ASSISTANT_QUERY_UNSUPPORTED", message: "no", details: { supportedIntents: ["today summary", "waiting queue now"] } } }));
    await type(r, "Why are sales down this month");
    await submit(r);
    const t = text(r);
    expect(t).toMatch(/cannot answer that/);
    expect(t).toMatch(/today summary/);
    expect(t).toMatch(/waiting queue now/);
    expect(t).not.toMatch(/shop-recorded collections/);
    expect(t).not.toMatch(/Answer/);
  });

  it("falls back to its own list when the server sends none", async () => {
    apiFetch.mockRejectedValue(new ApiError(422, { error: { code: "OWNER_ASSISTANT_QUERY_UNSUPPORTED", message: "no" } }));
    const r = await mount();
    await type(r, "something else entirely");
    await submit(r);
    expect(text(r)).toMatch(/Today's summary/);
  });

  it.each([
    [429, /12 a minute/],
    [403, /Only the shop owner/],
    [401, /Only the shop owner/],
    [0, /offline/],
    [500, /Nothing was changed/],
  ])("explains a %s refusal in plain words and shows no answer", async (status, pattern) => {
    apiFetch.mockRejectedValue(new ApiError(status, { error: { code: "X", message: "m" } }));
    const r = await mount();
    await act(async () => { button(r, "Today's summary").props.onClick(); });
    await flush();
    expect(text(r)).toMatch(pattern);
    expect(text(r)).not.toMatch(/Figures/);
  });

  it("treats a network failure that is not an ApiError as try-later, and a malformed reply as no answer", async () => {
    apiFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    const r = await mount();
    await act(async () => { button(r, "Today's summary").props.onClick(); });
    await flush();
    expect(text(r)).toMatch(/could not answer right now/);
    apiFetch.mockResolvedValueOnce({ mode: "GENERATIVE", answer: "made up" });
    await act(async () => { button(r, "Today's summary").props.onClick(); });
    await flush();
    expect(text(r)).toMatch(/could not answer right now/);
    expect(text(r)).not.toMatch(/made up/);
  });
});
