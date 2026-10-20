import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { OffersWorkspace } from "../OffersWorkspace";
import { apiFetch, ApiError } from "../../../../lib/api";
import { resetCapabilitiesCache } from "../../../../lib/use-capabilities";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));
jest.mock("../../parts", () => ({
  ...jest.requireActual("../../parts"),
  Dialog: ({ title, children }) => <div role="dialog" aria-label={title}>{children}</div>,
}));
jest.mock("../../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(status, body) {
      super(body?.error?.message ?? "Request failed");
      this.status = status;
      this.code = body?.error?.code ?? "UNKNOWN_ERROR";
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
const dialogButton = (r, label) => r.root.findByProps({ role: "dialog" }).findAllByType("button").find((b) => new RegExp(label).test(collect(b.props.children)));
const change = async (r, id, value) => { await act(async () => { r.root.findByProps({ id }).props.onChange({ target: { value } }); }); };

const SVC = [
  { id: "a0000000-0000-4000-8000-000000000001", name: "Haircut", price: 300, isActive: true },
  { id: "a0000000-0000-4000-8000-000000000002", name: "Shave", price: 100, isActive: true },
  { id: "a0000000-0000-4000-8000-000000000003", name: "Old service", price: 50, isActive: false },
];
const offer = (extra = {}) => ({
  id: "o1", salonId: "s1", kind: "OFFER", status: "DRAFT", title: "Festival 20%", description: null, discountType: "PERCENT", discountValue: 20, currency: "INR",
  audience: "ALL", inactiveDays: null, validFrom: "2026-10-20T03:30:00.000Z", validTo: "2026-10-27T15:30:00.000Z", maxRedemptions: null, perCustomerLimit: 1,
  serviceIds: [], redemptionCount: 0, createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", ...extra,
});

let calls;
let offers;
let hook;
let previewHook;
let servicesAnswer;
function install({ capability = { status: "ENABLED" }, tz = "Asia/Kolkata", onPost, onPreview, services } = {}) {
  calls = [];
  hook = onPost;
  previewHook = onPreview;
  servicesAnswer = services ?? SVC;
  apiFetch.mockImplementation(async (path, opts) => {
    calls.push({ path, opts });
    if (path.endsWith("/capabilities")) return capability ? { features: { offers: capability } } : { features: {} };
    if (path.endsWith("/timezone")) return { timezone: tz };
    if (path.endsWith("/services")) return servicesAnswer;
    if (/\/offers(\?|$)/.test(path) && !opts?.method) return { items: offers, nextCursor: null };
    if (path.endsWith("/stats")) return { offerId: "o1", redemptionCount: 3, uniqueCustomers: 2, completedBookings: 2, cancelledBookings: 1, recordedDiscount: 150, currency: "INR" };
    if (/\/offers\/[^/]+\/preview$/.test(path)) return { offerId: "o1", currency: "INR", eligibleByRule: true, eligibilityRule: "ALL", lines: [{ serviceId: SVC[0].id, serviceName: "Haircut", basePrice: 300, discount: 60, finalPrice: 240, currency: "INR" }], subtotal: 300, discount: 60, finalTotal: 240 };
    if (path.endsWith("/offers/preview") && previewHook) return previewHook(opts);
    if (path.endsWith("/offers/preview")) return { offerId: null, currency: "INR", eligibleByRule: null, eligibilityRule: "ALL", lines: [{ serviceId: SVC[0].id, serviceName: "Haircut", basePrice: 300, discount: 60, finalPrice: 240, currency: "INR" }], subtotal: 300, discount: 60, finalTotal: 240 };
    if (opts?.method) return hook ? hook(path, opts) : offer();
    throw new Error(`unexpected ${path}`);
  });
}
async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<OffersWorkspace salonId="s1" />); });
  await flush();
  await flush();
  return r;
}
const mutations = () => calls.filter((c) => c.opts?.method);

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  resetCapabilitiesCache();
  offers = [offer(), offer({ id: "o2", title: "Live now", status: "ACTIVE", redemptionCount: 4, maxRedemptions: 10, serviceIds: [SVC[0].id] })];
});

async function fillValidForm(r) {
  await change(r, "offer-title", "Diwali 15%");
  await change(r, "offer-discount-value", "15");
  await change(r, "offer-valid-from", "2026-10-20T09:00");
  await change(r, "offer-valid-to", "2026-10-27T21:00");
}

describe("OffersWorkspace availability", () => {
  it("says offers are unavailable and calls nothing else when the capability is off", async () => {
    install({ capability: { status: "DISABLED", reasonCode: "FEATURE_DISABLED" } });
    const r = await mount();
    expect(text(r)).toContain("Offers are not available yet");
    expect(calls.some((c) => c.path.includes("/offers"))).toBe(false);
  });
});

describe("OffersWorkspace list", () => {
  it("lists offers with status, discount, validity in the shop timezone and usage", async () => {
    install();
    const r = await mount();
    const t = text(r);
    expect(t).toContain("Festival 20%");
    expect(t).toContain("20% off");
    expect(t).toContain("Draft");
    expect(t).toContain("Active");
    expect(t).toContain("20 Oct 2026");
    expect(t).toContain("4 bookings used it of 10 allowed");
    expect(t).toContain("1 service");
    expect(t).toContain("Pause it to change it.");
  });

  it("offers edit and publish for a draft, pause for an active offer, and no edit for an active one", async () => {
    install();
    const r = await mount();
    const rows = r.root.findAllByType("li");
    const draftButtons = rows[0].findAllByType("button").map((b) => collect(b.props.children).trim());
    const activeButtons = rows[1].findAllByType("button").map((b) => collect(b.props.children).trim());
    expect(draftButtons).toEqual(expect.arrayContaining(["Edit", "Publish"]));
    expect(draftButtons).not.toContain("Pause");
    expect(activeButtons).toContain("Pause");
    expect(activeButtons).not.toContain("Edit");
    expect(activeButtons).not.toContain("Publish");
  });

  it("asks the server for the chosen type and status", async () => {
    install();
    const r = await mount();
    await change(r, "offer-kind", "DAILY_DEAL");
    await change(r, "offer-status", "PAUSED");
    await flush();
    const last = calls.filter((c) => /\/offers\?/.test(c.path)).at(-1).path;
    const q = new URLSearchParams(last.split("?")[1]);
    expect(q.get("kind")).toBe("DAILY_DEAL");
    expect(q.get("status")).toBe("PAUSED");
  });

  it("shows the numbers and a price check without sending a mutation", async () => {
    install();
    const r = await mount();
    const row = r.root.findAllByType("li")[0];
    await act(async () => { row.findAllByType("button").find((b) => /See numbers/.test(collect(b.props.children))).props.onClick(); });
    await flush();
    expect(text(r)).toContain("used this offer");
    expect(text(r)).toContain("150");
    expect(text(r)).toContain("not a payment or a refund");
    await act(async () => { r.root.findAllByType("li")[0].findAllByType("button").find((b) => /Preview prices/.test(collect(b.props.children))).props.onClick(); });
    await flush();
    expect(text(r)).toContain("Customer pays");
    const body = JSON.parse(calls.find((c) => /\/offers\/o1\/preview$/.test(c.path)).opts.body);
    expect(body.serviceIds).toEqual([SVC[0].id, SVC[1].id]); // all active services, never the inactive one
  });
});

describe("OffersWorkspace create", () => {
  it("saves a draft with an Idempotency-Key and the shop-timezone dates as UTC", async () => {
    install();
    const r = await mount();
    await act(async () => { button(r, "Create an offer").props.onClick(); });
    await fillValidForm(r);
    const form = r.root.findByType("form");
    await act(async () => { form.props.onSubmit({ preventDefault() {} }); });
    await flush();
    const post = mutations().find((c) => c.opts.method === "POST" && c.path.endsWith("/offers"));
    expect(post.opts.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    const body = JSON.parse(post.opts.body);
    expect(body).toMatchObject({ title: "Diwali 15%", discountType: "PERCENT", discountValue: 15, validFrom: "2026-10-20T03:30:00.000Z", validTo: "2026-10-27T15:30:00.000Z", serviceIds: [] });
    expect(text(r)).toContain("saved as a draft");
    expect(text(r)).toContain("Customers cannot see it until you publish it");
  });

  it("does not send an invalid offer and says what is wrong", async () => {
    install();
    const r = await mount();
    await act(async () => { button(r, "Create an offer").props.onClick(); });
    await act(async () => { r.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    expect(mutations()).toHaveLength(0);
    expect(text(r)).toContain("Give the offer a name");
  });

  it("reuses the same Idempotency-Key when the same offer is sent again after a failure", async () => {
    let attempt = 0;
    install({ onPost: () => { attempt += 1; if (attempt === 1) throw new ApiError(500, { error: { code: "X", message: "lost" } }); return offer(); } });
    const r = await mount();
    await act(async () => { button(r, "Create an offer").props.onClick(); });
    await fillValidForm(r);
    await act(async () => { r.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    await flush();
    await act(async () => { r.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    await flush();
    const keys = mutations().map((c) => c.opts.headers["Idempotency-Key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("checks prices without saving", async () => {
    install();
    const r = await mount();
    await act(async () => { button(r, "Create an offer").props.onClick(); });
    await fillValidForm(r);
    await act(async () => { button(r, "Check prices").props.onClick(); });
    await flush();
    expect(text(r)).toContain("Customer pays");
    expect(mutations().every((c) => c.path.endsWith("/offers/preview"))).toBe(true);
    // An offer for all services is sent with no service ids: the server previews every active service itself (PR #268).
    expect(JSON.parse(mutations()[0].opts.body).serviceIds).toEqual([]);
  });

  it("blocks creating until the shop has a timezone", async () => {
    install({ tz: null });
    const r = await mount();
    expect(text(r)).toContain("no timezone yet");
    expect(button(r, "Create an offer")).toBeUndefined();
  });
});

describe("OffersWorkspace price check bounds (Codex PR #268)", () => {
  async function openAndCheck(r) {
    await act(async () => { button(r, "Create an offer").props.onClick(); });
    await fillValidForm(r);
    await act(async () => { button(r, "Check prices").props.onClick(); });
    await flush();
  }

  it("sends the ticked services as chosen, and never fills in the list itself", async () => {
    install();
    const r = await mount();
    await act(async () => { button(r, "Create an offer").props.onClick(); });
    await fillValidForm(r);
    const boxes = r.root.findAllByType("input").filter((i) => i.props.type === "checkbox");
    await act(async () => { boxes[1].props.onChange(); });
    await act(async () => { button(r, "Check prices").props.onClick(); });
    await flush();
    expect(JSON.parse(mutations()[0].opts.body).serviceIds).toEqual([SVC[1].id]);
  });

  it("explains a shop with no active service in plain words", async () => {
    install({ onPreview: () => { throw new ApiError(400, { error: { code: "OFFER_SERVICE_MISMATCH", message: "There are no active services to preview for this shop." } }); } });
    const r = await mount();
    await openAndCheck(r);
    expect(text(r)).toContain("no active service to check");
  });

  it("explains the bound of 100 services when the shop has more, and asks for a bounded choice", async () => {
    install({ onPreview: () => { throw new ApiError(400, { error: { code: "OFFER_INVALID", message: "This shop has more than 100 active services. Select a bounded set to preview." } }); } });
    const r = await mount();
    await openAndCheck(r);
    expect(text(r)).toContain("more than 100 active services");
    expect(text(r)).toContain("Tick up to 100 services");
  });

  it("refuses to send more than 100 chosen services and says so", async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ id: `b0000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Service ${i}`, price: 10, isActive: true }));
    install({ services: many });
    const r = await mount();
    await act(async () => { button(r, "Create an offer").props.onClick(); });
    await fillValidForm(r);
    const boxes = r.root.findAllByType("input").filter((i) => i.props.type === "checkbox");
    for (const box of boxes) await act(async () => { box.props.onChange(); });
    await act(async () => { r.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    expect(mutations()).toHaveLength(0);
    expect(text(r)).toContain("Choose at most 100 services");
  });

  it("says when a saved offer for all services is checked against only the first 100", async () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ id: `b0000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Service ${i}`, price: 10, isActive: true }));
    install({ services: many });
    const r = await mount();
    await act(async () => { r.root.findAllByType("li")[0].findAllByType("button").find((b) => /Preview prices/.test(collect(b.props.children))).props.onClick(); });
    await flush();
    const body = JSON.parse(calls.find((c) => /\/offers\/o1\/preview$/.test(c.path)).opts.body);
    expect(body.serviceIds).toHaveLength(100);
    expect(text(r)).toContain("first 100 of your 130 active services");
  });
});

describe("OffersWorkspace publish, pause and edit", () => {
  it("asks before publishing, then publishes once with an Idempotency-Key", async () => {
    install();
    const r = await mount();
    await act(async () => { r.root.findAllByType("li")[0].findAllByType("button").find((b) => /Publish/.test(collect(b.props.children))).props.onClick(); });
    expect(text(r)).toContain("takes no payment and sends no message");
    expect(mutations()).toHaveLength(0);
    await act(async () => { dialogButton(r, "^\\s*Publish\\s*$").props.onClick(); });
    await flush();
    const post = mutations()[0];
    expect(post.path).toBe("dashboard/salons/s1/offers/o1/publish");
    expect(post.opts.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(text(r)).toContain("is now active");
  });

  it("pauses an active offer and says existing bookings keep their price", async () => {
    install();
    const r = await mount();
    await act(async () => { r.root.findAllByType("li")[1].findAllByType("button").find((b) => /^\s*Pause\s*$/.test(collect(b.props.children))).props.onClick(); });
    expect(text(r)).toContain("keep their price");
    await act(async () => { dialogButton(r, "^\\s*Pause\\s*$").props.onClick(); });
    await flush();
    expect(mutations()[0].path).toBe("dashboard/salons/s1/offers/o2/pause");
    expect(text(r)).toContain("is paused");
  });

  it("shows the server's reason when publishing is refused", async () => {
    install({ onPost: () => { throw new ApiError(409, { error: { code: "OFFER_NOT_PUBLISHABLE", message: "x" } }); } });
    const r = await mount();
    await act(async () => { r.root.findAllByType("li")[0].findAllByType("button").find((b) => /Publish/.test(collect(b.props.children))).props.onClick(); });
    await act(async () => { dialogButton(r, "^\\s*Publish\\s*$").props.onClick(); });
    await flush();
    expect(text(r)).toContain("cannot be published yet");
  });

  it("edits a draft by sending only what changed", async () => {
    install();
    const r = await mount();
    await act(async () => { r.root.findAllByType("li")[0].findAllByType("button").find((b) => /^\s*Edit\s*$/.test(collect(b.props.children))).props.onClick(); });
    expect(r.root.findByProps({ id: "offer-title" }).props.value).toBe("Festival 20%");
    expect(r.root.findByProps({ id: "offer-valid-from" }).props.value).toBe("2026-10-20T09:00");
    await change(r, "offer-discount-value", "25");
    await act(async () => { r.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    await flush();
    const patch = mutations()[0];
    expect(patch.opts.method).toBe("PATCH");
    expect(patch.path).toBe("dashboard/salons/s1/offers/o1");
    expect(JSON.parse(patch.opts.body)).toEqual({ discountValue: 25 });
  });
});
