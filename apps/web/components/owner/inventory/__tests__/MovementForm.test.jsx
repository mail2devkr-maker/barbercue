import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { MovementForm } from "../MovementForm";
import { apiFetch, ApiError } from "../../../../lib/api";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href }) => <a href={href}>{children}</a> }));
jest.mock("next/navigation", () => ({ usePathname: () => "/dashboard/salons/s1/inventory" }));
jest.mock("../../parts", () => ({ ...jest.requireActual("../../parts"), Dialog: ({ title, children }) => <div role="dialog" aria-label={title}>{children}</div> }));
jest.mock("../../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(message, status = 400, code = "ERR") {
      super(message);
      this.status = status;
      this.code = code;
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
const button = (r, label) => r.root.findAllByType("button").find((b) => new RegExp(label).test(collect(b.props.children)));
const field = (r, id) => r.root.findByProps({ id });
const type = async (r, id, value) => { await act(async () => { field(r, id).props.onChange({ target: { value } }); }); };

const PRODUCT = { id: "p1", salonId: "s1", name: "Shampoo", sku: "SH-1", unit: "LITER", stockOnHand: "12.500", averageUnitCost: "80.00", reorderThreshold: "5.000", isLowStock: false, isActive: true, category: null, supplier: null, updatedAt: "x" };
const movement = (over = {}) => ({ id: "m1", salonId: "s1", productId: "p1", productName: "Shampoo", sku: "SH-1", kind: "PURCHASE", quantityDelta: "5.000", unitCost: "80.00", stockAfter: "17.500", averageUnitCostAfter: "80.00", supplier: null, actorUserId: "u", reason: null, reference: null, recordedAt: "2026-10-17T10:00:00.000Z", ...over });

let posts;
function install({ onPost } = {}) {
  posts = [];
  apiFetch.mockImplementation(async (path, opts) => {
    if (opts?.method === "POST") {
      posts.push({ path, headers: opts.headers, body: JSON.parse(opts.body) });
      return onPost ? onPost() : { movement: movement(), created: true };
    }
    return { items: [PRODUCT], nextCursor: null, hasMore: false };
  });
}

async function mount(props = {}) {
  let r;
  await act(async () => { r = TestRenderer.create(<MovementForm salonId="s1" kind="PURCHASE" suppliers={[{ id: "sup1", name: "Acme" }]} {...props} />); });
  await flush();
  return r;
}
async function pickProduct(r) {
  await act(async () => { r.root.findAllByType("button").find((b) => /Shampoo/.test(collect(b.props.children))).props.onClick(); });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

describe("MovementForm", () => {
  it("shows the product's current stock from the server once chosen, and asks for nothing before that", async () => {
    install();
    const r = await mount();
    expect(r.root.findAllByProps({ id: "qty-PURCHASE" })).toHaveLength(0);
    await pickProduct(r);
    expect(text(r)).toContain("in stock now: 12.5 L");
    expect(field(r, "qty-PURCHASE")).toBeTruthy();
  });

  it("checks the entry, sends nothing, and shows what is wrong", async () => {
    install();
    const r = await mount();
    await pickProduct(r);
    await act(async () => { button(r, "^Review").props.onClick(); });
    expect(text(r)).toContain("Enter a quantity");
    expect(text(r)).toContain("Enter the cost per unit");
    expect(posts).toHaveLength(0);
    expect(r.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  });

  it("asks for confirmation in plain words and records nothing until confirmed", async () => {
    install();
    const r = await mount();
    await pickProduct(r);
    await type(r, "qty-PURCHASE", "5");
    await type(r, "cost-PURCHASE", "80");
    await act(async () => { button(r, "^Review").props.onClick(); });
    expect(text(r)).toContain("Add 5 L of Shampoo bought at 80 per L.");
    expect(text(r)).toContain("cannot be edited or deleted");
    expect(posts).toHaveLength(0);
    await act(async () => { button(r, "Back").props.onClick(); });
    expect(posts).toHaveLength(0);
  });

  it("sends the entry with an Idempotency-Key and shows only the balance the server returns", async () => {
    install();
    const onRecorded = jest.fn();
    const r = await mount({ onRecorded });
    await pickProduct(r);
    await type(r, "qty-PURCHASE", "5");
    await type(r, "cost-PURCHASE", "80");
    await type(r, "supplier-PURCHASE", "sup1");
    await act(async () => { button(r, "^Review").props.onClick(); });
    await act(async () => { button(r, "Confirm and record").props.onClick(); });
    await flush();
    expect(posts[0].path).toBe("dashboard/salons/s1/inventory/products/p1/movements");
    expect(posts[0].headers["Idempotency-Key"]).toMatch(/^inv-/);
    expect(posts[0].body).toEqual({ kind: "PURCHASE", quantity: 5, unitCost: 80, supplierId: "sup1" });
    expect(text(r)).toContain("Purchase recorded.");
    expect(text(r)).toContain("Stock of Shampoo is now 17.5 L as reported by the server.");
    expect(onRecorded).toHaveBeenCalledTimes(1);
  });

  it("keeps the same key when the same attempt is retried after a network failure, and renews it when the entry changes", async () => {
    let call = 0;
    install({ onPost: () => { call += 1; if (call === 1) throw new Error("offline"); return { movement: movement(), created: true }; } });
    const r = await mount();
    await pickProduct(r);
    await type(r, "qty-PURCHASE", "5");
    await type(r, "cost-PURCHASE", "80");
    await act(async () => { button(r, "^Review").props.onClick(); });
    await act(async () => { button(r, "Confirm and record").props.onClick(); });
    await flush();
    expect(text(r)).toContain("press the same button again safely");
    await act(async () => { button(r, "^Review").props.onClick(); });
    await act(async () => { button(r, "Confirm and record").props.onClick(); });
    await flush();
    expect(posts).toHaveLength(2);
    expect(posts[1].headers["Idempotency-Key"]).toBe(posts[0].headers["Idempotency-Key"]);
    // a different entry is a different attempt
    await pickProduct(r);
    await type(r, "qty-PURCHASE", "6");
    await type(r, "cost-PURCHASE", "80");
    await act(async () => { button(r, "^Review").props.onClick(); });
    await act(async () => { button(r, "Confirm and record").props.onClick(); });
    await flush();
    expect(posts[2].headers["Idempotency-Key"]).not.toBe(posts[0].headers["Idempotency-Key"]);
  });

  it("sends only once when the confirm button is pressed several times before the answer arrives", async () => {
    let release;
    install({ onPost: () => new Promise((resolve) => { release = () => resolve({ movement: movement(), created: true }); }) });
    const r = await mount();
    await pickProduct(r);
    await type(r, "qty-PURCHASE", "5");
    await type(r, "cost-PURCHASE", "80");
    await act(async () => { button(r, "^Review").props.onClick(); });
    const confirm = button(r, "Confirm and record");
    await act(async () => { confirm.props.onClick(); confirm.props.onClick(); confirm.props.onClick(); });
    expect(posts).toHaveLength(1);
    await act(async () => { release(); });
    await flush();
    expect(posts).toHaveLength(1);
    expect(text(r)).toContain("Purchase recorded.");
    expect(text(r)).not.toContain("already been recorded");
  });

  it("says plainly when the server replayed an entry it had already recorded", async () => {
    install({ onPost: () => ({ movement: movement(), created: false }) });
    const r = await mount();
    await pickProduct(r);
    await type(r, "qty-PURCHASE", "5");
    await type(r, "cost-PURCHASE", "80");
    await act(async () => { button(r, "^Review").props.onClick(); });
    await act(async () => { button(r, "Confirm and record").props.onClick(); });
    await flush();
    expect(text(r)).toContain("already been recorded, so nothing was added again");
  });

  it("shows the server's refusal for not enough stock and records nothing", async () => {
    install({ onPost: () => { throw new ApiError("Not enough", 409, "INVENTORY_INSUFFICIENT_STOCK"); } });
    const r = await mount({ kind: "CONSUMPTION" });
    await pickProduct(r);
    await type(r, "qty-CONSUMPTION", "100");
    await act(async () => { button(r, "^Review").props.onClick(); });
    await act(async () => { button(r, "Confirm and record").props.onClick(); });
    await flush();
    expect(text(r)).toContain("not enough stock for this. Nothing was recorded.");
    expect(text(r)).not.toContain("as reported by the server");
  });

  it("requires a direction and a reason for an adjustment, and sends them", async () => {
    install({ onPost: () => ({ movement: movement({ kind: "ADJUSTMENT", quantityDelta: "-1.000", stockAfter: "11.500" }), created: true }) });
    const r = await mount({ kind: "ADJUSTMENT" });
    await pickProduct(r);
    await type(r, "qty-ADJUSTMENT", "1");
    await act(async () => { button(r, "^Review").props.onClick(); });
    expect(text(r)).toContain("Choose whether stock goes up or down");
    expect(text(r)).toContain("Say why you are adjusting stock");
    await type(r, "dir-ADJUSTMENT", "DECREASE");
    await type(r, "reason-ADJUSTMENT", "Spilled");
    await act(async () => { button(r, "^Review").props.onClick(); });
    await act(async () => { button(r, "Confirm and record").props.onClick(); });
    await flush();
    expect(posts[0].body).toEqual({ kind: "ADJUSTMENT", quantity: 1, adjustmentDirection: "DECREASE", reason: "Spilled" });
    expect(text(r)).toContain("Adjustment recorded.");
  });

  it("sends no cost and no supplier for stock used", async () => {
    install({ onPost: () => ({ movement: movement({ kind: "CONSUMPTION", quantityDelta: "-2.000", stockAfter: "10.500" }), created: true }) });
    const r = await mount({ kind: "CONSUMPTION" });
    await pickProduct(r);
    expect(r.root.findAllByProps({ id: "cost-CONSUMPTION" })).toHaveLength(0);
    await type(r, "qty-CONSUMPTION", "2");
    await act(async () => { button(r, "^Review").props.onClick(); });
    await act(async () => { button(r, "Confirm and record").props.onClick(); });
    await flush();
    expect(posts[0].body).toEqual({ kind: "CONSUMPTION", quantity: 2 });
  });

  it("opening stock for a pre-chosen product shows the new server balance next to it", async () => {
    install({ onPost: () => ({ movement: movement({ kind: "OPENING", quantityDelta: "10.000", stockAfter: "10.000" }), created: true }) });
    const r = await mount({ kind: "OPENING", fixedProduct: { ...PRODUCT, stockOnHand: "0.000" } });
    expect(text(r)).toContain("in stock now: 0 L");
    await type(r, "qty-OPENING", "10");
    await type(r, "cost-OPENING", "50");
    await act(async () => { button(r, "^Review").props.onClick(); });
    await act(async () => { button(r, "Confirm and record").props.onClick(); });
    await flush();
    expect(text(r)).toContain("in stock now: 10 L");
  });
});
